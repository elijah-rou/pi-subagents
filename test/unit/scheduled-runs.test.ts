import assert from "node:assert/strict";
import fsDefault, * as fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	LEGACY_SCHEDULE_READ_ACTIONS,
	createLegacyScheduleReader,
	isLegacyScheduleReadAction,
	scheduledRunStorePath,
	type LegacyScheduleReader,
} from "../../src/runs/background/scheduled-runs.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function context(cwd: string): ExtensionContext {
	return { cwd, sessionManager: { getSessionId: () => "session-a", getSessionFile: () => null } } as unknown as ExtensionContext;
}

function fixture(): { root: string; project: string; storeRoot: string; reader: LegacyScheduleReader; ctx: ExtensionContext } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-legacy-schedule-reader-"));
	roots.push(root);
	const project = path.join(root, "project");
	const storeRoot = path.join(root, "stores");
	fs.mkdirSync(project, { recursive: true });
	return { root, project, storeRoot, reader: createLegacyScheduleReader({ storeRoot }), ctx: context(project) };
}

function writeSchedule(storeRoot: string, project: string, id: string, value: unknown, history?: unknown): string {
	const directory = path.join(scheduledRunStorePath(project, undefined, storeRoot), id);
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(path.join(directory, "schedule.json"), typeof value === "string" ? value : JSON.stringify(value));
	if (history !== undefined) fs.writeFileSync(path.join(directory, "history.json"), typeof history === "string" ? history : JSON.stringify(history));
	return directory;
}

function validSchedule(id: string): Record<string, unknown> {
	return {
		schemaVersion: 1,
		id,
		name: "Legacy nightly",
		cwd: "/original/project",
		trigger: { kind: "interval", every: "1h", everyMs: 3_600_000, anchorAt: "2030-01-01T00:00:00.000Z", nextRunAt: "2030-01-01T01:00:00.000Z" },
		target: { workflowScript: "return runs.run('main', { agent: 'worker' })" },
		overlap: "skip",
		catchUp: "latest",
		paused: false,
		createdAt: "2030-01-01T00:00:00.000Z",
		updatedAt: "2030-01-01T00:00:00.000Z",
		unknownFutureField: { preserve: true },
	};
}

function text(result: Awaited<ReturnType<LegacyScheduleReader["handleToolCall"]>>): string {
	return result.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
}

describe("legacy schedule compatibility reader", () => {
	it("recognizes only the three passive trusted actions", () => {
		assert.deepEqual(LEGACY_SCHEDULE_READ_ACTIONS, ["schedule.list", "schedule.show", "schedule.history"]);
		assert.equal(isLegacyScheduleReadAction("schedule.list"), true);
		for (const action of ["schedule.create", "schedule.pause", "schedule.resume", "schedule.run", "schedule.run-due", "schedule.delete"]) {
			assert.equal(isLegacyScheduleReadAction(action), false);
		}
	});

	it("preserves exact project-keyed custom-root and default path semantics", () => {
		const root = path.join("tmp", "schedules");
		assert.equal(scheduledRunStorePath("project", "a", root), scheduledRunStorePath("project", "b", root));
		assert.notEqual(scheduledRunStorePath("project", "a", root), scheduledRunStorePath("other", "a", root));
		assert.equal(scheduledRunStorePath("/project"), path.join(path.resolve("/project"), ".pi/subagents", "schedules"));
	});

	it("lazily lists valid records and reports unknown or corrupt records without rewriting anything", async () => {
		const h = fixture();
		const good = writeSchedule(h.storeRoot, h.project, "good", validSchedule("good"));
		const unknown = writeSchedule(h.storeRoot, h.project, "future", { ...validSchedule("future"), schemaVersion: 2 });
		const corrupt = writeSchedule(h.storeRoot, h.project, "corrupt", "{ bad");
		const before = new Map([good, unknown, corrupt].flatMap((directory) => fs.readdirSync(directory).map((name) => {
			const file = path.join(directory, name);
			return [file, fs.readFileSync(file)] as const;
		})));

		const result = await h.reader.handleToolCall({ action: "schedule.list" }, h.ctx);
		assert.equal(result.isError, undefined);
		assert.match(text(result), /good/);
		assert.match(text(result), /Skipped 2 unreadable legacy schedule records/);
		assert.deepEqual(result.details?.schedules?.records, [validSchedule("good")]);
		for (const [file, contents] of before) assert.deepEqual(fs.readFileSync(file), contents);
	});

	it("shows and reads bounded static history while preserving unknown fields", async () => {
		const h = fixture();
		const schedule = validSchedule("nightly");
		const runs = Array.from({ length: 140 }, (_, index) => ({ schemaVersion: 1, id: `run-${index}`, scheduleId: "nightly", plannedAt: "2030-01-01T01:00:00.000Z", dueReason: "timer", state: "completed", unknown: index }));
		const directory = writeSchedule(h.storeRoot, h.project, "nightly", schedule, { schemaVersion: 1, runs, unknownEnvelope: true });
		const beforeSchedule = fs.readFileSync(path.join(directory, "schedule.json"));
		const beforeHistory = fs.readFileSync(path.join(directory, "history.json"));

		const shown = await h.reader.handleToolCall({ action: "schedule.show", id: "nightly" }, h.ctx);
		assert.deepEqual(shown.details?.schedules?.records, [schedule]);
		const history = await h.reader.handleToolCall({ action: "schedule.history", id: "nightly" }, h.ctx);
		assert.equal(history.details?.schedules?.runs?.length, 100);
		assert.equal((history.details?.schedules?.runs?.[0] as { unknown?: number }).unknown, 0);
		assert.deepEqual(fs.readFileSync(path.join(directory, "schedule.json")), beforeSchedule);
		assert.deepEqual(fs.readFileSync(path.join(directory, "history.json")), beforeHistory);
	});

	it("rejects symlinked schedule and history files without reading outside the store", async () => {
		if (process.platform === "win32") return;
		const h = fixture();
		const outsideSchedule = path.join(h.root, "outside-schedule.json");
		fs.writeFileSync(outsideSchedule, JSON.stringify(validSchedule("linked")));
		const linkedDirectory = path.join(scheduledRunStorePath(h.project, undefined, h.storeRoot), "linked");
		fs.mkdirSync(linkedDirectory, { recursive: true });
		fs.symlinkSync(outsideSchedule, path.join(linkedDirectory, "schedule.json"));
		const shown = await h.reader.handleToolCall({ action: "schedule.show", id: "linked" }, h.ctx);
		assert.equal(shown.isError, true);
		assert.match(text(shown), /symbolic link|regular file|no-follow/i);

		const historyDirectory = writeSchedule(h.storeRoot, h.project, "history-link", validSchedule("history-link"));
		const outsideHistory = path.join(h.root, "outside-history.json");
		fs.writeFileSync(outsideHistory, JSON.stringify({ schemaVersion: 1, runs: [] }));
		fs.symlinkSync(outsideHistory, path.join(historyDirectory, "history.json"));
		const history = await h.reader.handleToolCall({ action: "schedule.history", id: "history-link" }, h.ctx);
		assert.equal(history.isError, true);
		assert.match(text(history), /symbolic link|regular file|no-follow/i);
	});

	it("rejects a schedule file replaced between inspection and descriptor open", async (t) => {
		const h = fixture();
		const directory = writeSchedule(h.storeRoot, h.project, "raced", validSchedule("raced"));
		const scheduleFile = path.join(directory, "schedule.json");
		const replacement = path.join(directory, "replacement.json");
		fs.writeFileSync(replacement, JSON.stringify({ ...validSchedule("raced"), name: "replacement" }));
		const originalOpen = fsDefault.openSync;
		let replaced = false;
		t.mock.method(fsDefault, "openSync", ((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
			if (!replaced && String(file) === scheduleFile) {
				replaced = true;
				fs.renameSync(replacement, scheduleFile);
			}
			return originalOpen(file, flags, mode);
		}) as typeof fsDefault.openSync);
		syncBuiltinESMExports();
		try {
			const shown = await h.reader.handleToolCall({ action: "schedule.show", id: "raced" }, h.ctx);
			assert.equal(shown.isError, true);
			assert.match(text(shown), /changed before|safely/i);
		} finally {
			t.mock.restoreAll();
			syncBuiltinESMExports();
		}
	});

	it("bounds candidate scans and aggregate schedule output under adversarial records", async () => {
		const h = fixture();
		for (let index = 0; index < 400; index++) writeSchedule(h.storeRoot, h.project, `bad-${String(index).padStart(3, "0")}`, "{ bad");
		for (let index = 0; index < 120; index++) writeSchedule(h.storeRoot, h.project, `good-${String(index).padStart(3, "0")}`, { ...validSchedule(`good-${String(index).padStart(3, "0")}`), name: "n".repeat(64 * 1024), cwd: "/" + "c".repeat(64 * 1024) });
		const result = await h.reader.handleToolCall({ action: "schedule.list" }, h.ctx);
		assert.equal(result.isError, undefined);
		assert.ok((result.details?.schedules?.records?.length ?? 0) <= 100);
		assert.ok(Buffer.byteLength(text(result)) <= 64 * 1024);
		assert.ok(Buffer.byteLength(JSON.stringify(result.details)) <= 512 * 1024);
		assert.match(text(result), /bounded scan|candidate scan stopped|omitted/i);
	});

	it("rejects files beyond their byte bounds and caps aggregate history details", async () => {
		const h = fixture();
		const oversized = writeSchedule(h.storeRoot, h.project, "oversized", validSchedule("oversized"));
		fs.writeFileSync(path.join(oversized, "schedule.json"), " ".repeat(64 * 1024 + 1));
		const shown = await h.reader.handleToolCall({ action: "schedule.show", id: "oversized" }, h.ctx);
		assert.equal(shown.isError, true);
		assert.match(text(shown), /read bound|exceeds/i);

		const runs = Array.from({ length: 200 }, (_, index) => ({ id: `run-${index}`, state: "completed", plannedAt: "t".repeat(4096) }));
		writeSchedule(h.storeRoot, h.project, "bounded-history", validSchedule("bounded-history"), { schemaVersion: 1, runs });
		const history = await h.reader.handleToolCall({ action: "schedule.history", id: "bounded-history" }, h.ctx);
		assert.ok((history.details?.schedules?.runs?.length ?? 0) <= 100);
		assert.ok(Buffer.byteLength(text(history)) <= 64 * 1024);
		assert.ok(Buffer.byteLength(JSON.stringify(history.details)) <= 512 * 1024);
	});

	it("does not create the configured or default legacy directory", async () => {
		const h = fixture();
		const customPath = scheduledRunStorePath(h.project, undefined, h.storeRoot);
		const result = await h.reader.handleToolCall({ action: "schedule.list" }, h.ctx);
		assert.match(text(result), /No legacy project schedules/);
		assert.equal(fs.existsSync(customPath), false);

		const other = path.join(h.root, "other");
		fs.mkdirSync(other);
		const defaultPath = scheduledRunStorePath(other);
		await createLegacyScheduleReader({}).handleToolCall({ action: "schedule.list" }, context(other));
		assert.equal(fs.existsSync(defaultPath), false);
	});
});
