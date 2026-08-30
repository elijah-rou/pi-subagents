import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { persistForegroundRunHistory, restoreForegroundRunHistory } from "../../src/runs/foreground/foreground-history.ts";
import type { PersistedResolvedAcceptanceInput, SubagentState } from "../../src/shared/types.ts";

function state(sessionId: string): SubagentState {
	return {
		baseCwd: process.cwd(),
		currentSessionId: sessionId,
		asyncJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
	};
}

const acceptance: PersistedResolvedAcceptanceInput = {
	kind: "resolved-acceptance",
	contract: { report: { criteria: ["Original proof"], evidence: ["commands-run"] }, onFailure: "fail" },
	level: "checked",
	explicit: false,
	inferredReason: ["write-capable worker/task"],
	stopRules: ["Stop on mismatch"],
	reason: "original contract",
	deprecationWarnings: [],
};

describe("foreground history acceptance persistence", () => {
	it("restores canonical acceptance input losslessly", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-foreground-history-acceptance-"));
		try {
			const original = state("session-current");
			original.foregroundRuns!.set("run", {
				runId: "run",
				mode: "single",
				cwd: root,
				sessionId: "session-current",
				updatedAt: 1,
				children: [{ agent: "worker", index: 0, status: "completed", acceptanceInput: acceptance }],
			});
			persistForegroundRunHistory(original, { resultsDir: root });
			const restarted = state("session-current");
			assert.equal(restoreForegroundRunHistory(restarted, { resultsDir: root }), 1);
			assert.deepEqual(restarted.foregroundRuns!.get("run")!.children[0]!.acceptanceInput, acceptance);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects malformed and oversized persisted acceptance input", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-foreground-history-acceptance-invalid-"));
		try {
			fs.writeFileSync(path.join(root, "foreground-history.json"), JSON.stringify({
				version: 1,
				runs: [
					{ runId: "malformed", mode: "single", cwd: root, sessionId: "session-current", updatedAt: 2, children: [{ agent: "worker", index: 0, status: "completed", acceptanceInput: { kind: "resolved-acceptance", surprise: true } }] },
					{ runId: "oversized", mode: "single", cwd: root, sessionId: "session-current", updatedAt: 1, children: [{ agent: "worker", index: 0, status: "completed", acceptanceInput: { ...acceptance, reason: "x".repeat(65 * 1024) } }] },
				],
			}), "utf-8");
			const restarted = state("session-current");
			assert.equal(restoreForegroundRunHistory(restarted, { resultsDir: root }), 0);
			assert.equal(restarted.foregroundRuns!.size, 0);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
