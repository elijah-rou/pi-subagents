import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { listAsyncRuns } from "../../src/runs/background/async-status.ts";

describe("retired pane compatibility", () => {
	it("ignores old status and event fields without touching retired artifacts", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-retired-pane-"));
		try {
			const asyncDir = path.join(root, "run-old-pane");
			const inspectorBinding = path.join(asyncDir, "inspectors", "herdr.json");
			const projectBinding = path.join(root, ".pi", "subagents", "project-panes", "herdr.json");
			const projectRoots = path.join(root, ".pi", "subagents", "project-panes", "herdr-roots.json");
			fs.mkdirSync(path.dirname(inspectorBinding), { recursive: true });
			fs.mkdirSync(path.dirname(projectBinding), { recursive: true });
			const artifacts = new Map([
				[inspectorBinding, '{"kind":"herdr-inspector","paneId":"old"}\n'],
				[projectBinding, '{"kind":"herdr-project-pane","paneId":"old"}\n'],
				[projectRoots, '{"kind":"herdr-project-pane-roots","projectRoots":[]}\n'],
			]);
			for (const [file, contents] of artifacts) fs.writeFileSync(file, contents, "utf-8");
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId: "run-old-pane",
				sessionId: "session-current",
				mode: "single",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				herdr: { state: "running", authoritative: true, paneId: "old" },
				steps: [{ agent: "worker", status: "complete", startedAt: 100, endedAt: 200, herdrPaneState: "blocked" }],
			}), "utf-8");
			fs.writeFileSync(path.join(asyncDir, "events.jsonl"), `${JSON.stringify({ type: "herdr:blocked", active: true, state: "running" })}\n`, "utf-8");

			const runs = listAsyncRuns(root, { sessionId: "session-current", repairScan: true });
			assert.equal(runs.length, 1);
			assert.equal(runs[0]?.state, "complete");
			assert.equal(runs[0]?.steps[0]?.status, "complete");
			for (const [file, contents] of artifacts) assert.equal(fs.readFileSync(file, "utf-8"), contents);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
