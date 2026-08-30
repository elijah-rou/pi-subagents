import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { readMissionBinding, syncMissionFromAsyncCompletion } from "../../src/missions/lifecycle.ts";
import { listMissions, readMission, resolveMissionStoreLocation } from "../../src/missions/store.ts";

const now = "2025-01-02T03:04:05.000Z";
function legacyRecord(id = "legacy-1"): Record<string, unknown> {
	return { schemaVersion: 1, id, title: "Legacy", objective: "Recover old run", status: "active", createdAt: now, updatedAt: now, runs: [], decisions: [], artifacts: [], legacyTop: { keep: true }, workflowChildren: [{ workflowRunId: "wf", key: "child", status: "running", startedAt: now, updatedAt: now, artifactPaths: [], legacyNested: { keep: true } }] };
}
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-compat-"));
	const location = resolveMissionStoreLocation({ projectRoot: root, config: { directory: path.join(root, "missions"), globalIndexDir: path.join(root, "index") } });
	fs.mkdirSync(location.missionDir, { recursive: true });
	return { root, location };
}
function writeBinding(asyncDir: string, location: ReturnType<typeof resolveMissionStoreLocation>, missionId: string, extra: Record<string, unknown> = {}) {
	fs.mkdirSync(asyncDir, { recursive: true });
	fs.writeFileSync(path.join(asyncDir, "mission.json"), JSON.stringify({ schemaVersion: 1, missionId, projectRoot: location.projectRoot, missionDir: location.missionDir, globalIndexDir: location.globalIndexDir, writeGlobalIndex: location.writeGlobalIndex, ...extra }));
}

describe("one-release mission compatibility", () => {
	it("reads old omitted optional fields and binding pointers without rewriting", () => {
		const f = fixture();
		try {
			const recordPath = path.join(f.location.missionDir, "legacy-1.json");
			const raw = JSON.stringify(legacyRecord());
			fs.writeFileSync(recordPath, raw);
			const asyncDir = path.join(f.root, "async");
			writeBinding(asyncDir, f.location, "legacy-1", { unknownBinding: "preserve" });
			assert.equal(readMission(f.location, "legacy-1").id, "legacy-1");
			assert.equal(readMissionBinding(asyncDir)?.missionId, "legacy-1");
			assert.equal(fs.readFileSync(recordPath, "utf-8"), raw);
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});

	it("leaves corrupt records and binding pointers untouched", () => {
		const f = fixture();
		try {
			const asyncDir = path.join(f.root, "bad-binding");
			fs.mkdirSync(asyncDir);
			const bindingPath = path.join(asyncDir, "mission.json");
			fs.writeFileSync(bindingPath, "{broken");
			assert.throws(() => readMissionBinding(asyncDir));
			assert.equal(fs.readFileSync(bindingPath, "utf-8"), "{broken");
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});

	it("lists around corrupt records without deleting or rewriting them", () => {
		const f = fixture();
		try {
			fs.writeFileSync(path.join(f.location.missionDir, "legacy-1.json"), JSON.stringify(legacyRecord()));
			const corruptPath = path.join(f.location.missionDir, "corrupt.json");
			fs.writeFileSync(corruptPath, "{broken");
			const listed = listMissions(f.location);
			assert.equal(listed.records.length, 1);
			assert.equal(listed.warnings.length, 1);
			assert.equal(fs.readFileSync(corruptPath, "utf-8"), "{broken");
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});

	it("merges only legacy completion fields while preserving unknown top-level and nested fields", () => {
		const f = fixture();
		try {
			const recordPath = path.join(f.location.missionDir, "legacy-1.json");
			const record = legacyRecord();
			record.runs = [{
				runId: "run-1",
				mode: "workflow",
				status: "running",
				startedAt: now,
				usage: { tokens: 1, legacyUsage: { keep: true } },
				legacyRunNested: { keep: true },
			}];
			fs.writeFileSync(recordPath, JSON.stringify(record));
			const asyncDir = path.join(f.root, "async");
			writeBinding(asyncDir, f.location, "legacy-1");
			const result = syncMissionFromAsyncCompletion({ asyncDir, runId: "run-1", state: "completed", mode: "workflow", totalTokens: { total: 9 }, parentWorkflowRunId: "wf", workflowKey: "child", summary: "done" });
			assert.equal(result?.status, "completed");
			const raw = JSON.parse(fs.readFileSync(recordPath, "utf-8"));
			assert.deepEqual(raw.legacyTop, { keep: true });
			assert.deepEqual(raw.workflowChildren[0].legacyNested, { keep: true });
			assert.equal(raw.workflowChildren[0].status, "completed");
			assert.deepEqual(raw.runs[0].legacyRunNested, { keep: true });
			assert.equal(raw.runs[0].usage.tokens, 9);
			assert.deepEqual(raw.runs[0].usage.legacyUsage, { keep: true });
			assert.equal(fs.existsSync(path.join(asyncDir, "mission.json")), true);
			assert.equal(fs.existsSync(f.location.globalIndexDir), false);
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});
});
