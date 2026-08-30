import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	normalizePublicSubagentExecution,
	normalizeTrustedHostSubagentExecution,
} from "../../src/extension/public-execution.ts";
import { SUBAGENT_ACTIONS, SUBAGENT_INTERNAL_ACTIONS } from "../../src/shared/types.ts";

describe("public subagent execution normalization", () => {
	it("rejects removed mission fields and new schedule origin on public and trusted surfaces", () => {
		for (const params of [{ missionId: "old" }, { mission: false }, { missionUpdate: {} }, { scheduleOrigin: { id: "legacy" } }]) {
			assert.equal(normalizePublicSubagentExecution(params).ok, false);
			assert.equal(normalizeTrustedHostSubagentExecution(params).ok, false);
		}
	});
	it("publishes exactly the retained model action surface while retaining internal dispatch", () => {
		assert.deepEqual(SUBAGENT_ACTIONS, [
			"list", "get", "models", "children.list", "guide", "validate", "worktree.discard", "lane.status",
			"status", "debug.run", "interrupt", "resume", "steer", "stop", "doctor",
		]);
		assert.equal(SUBAGENT_INTERNAL_ACTIONS.length, 36);
		assert.deepEqual(SUBAGENT_INTERNAL_ACTIONS.filter((action) => action.startsWith("schedule.")), []);
		assert.ok(!SUBAGENT_INTERNAL_ACTIONS.includes("append-step"));
	});

	it("accepts structured single-child, workflow, and retained management", () => {
		assert.deepEqual(normalizePublicSubagentExecution({ workflowScript: "return 1" }), { ok: true, params: { workflowScript: "return 1" } });
		assert.deepEqual(normalizePublicSubagentExecution({ workflowScript: "return 1", preflight: { version: 1, lanes: [] } }), { ok: true, params: { workflowScript: "return 1", preflight: { version: 1, lanes: [] } } });
		assert.deepEqual(normalizePublicSubagentExecution({ workflowScriptPath: "workflows/review.js" }), { ok: true, params: { workflowScriptPath: "workflows/review.js" } });
		const task = "Use `quotes`\nand newlines";
		assert.deepEqual(normalizePublicSubagentExecution({ agent: " worker ", task, context: "fresh", async: false }), {
			ok: true,
			params: {
				agent: "worker",
				task,
				context: "fresh",
				async: false,
				output: true,
			},
		});
		assert.deepEqual(normalizePublicSubagentExecution({ agent: "worker" }), {
			ok: true,
			params: {
				agent: "worker",
				output: true,
			},
		});
		assert.deepEqual(normalizePublicSubagentExecution({ agent: "worker", async: true }), {
			ok: true,
			params: {
				agent: "worker",
				async: true,
				output: true,
			},
		});
		assert.deepEqual(normalizePublicSubagentExecution({ agent: "worker", output: false }), {
			ok: true,
			params: {
				agent: "worker",
				output: false,
			},
		});
		assert.deepEqual(normalizePublicSubagentExecution({ agent: "worker", isolation: "none" }), {
			ok: true,
			params: {
				agent: "worker",
				worktree: false,
				output: true,
			},
		});
		assert.deepEqual(normalizePublicSubagentExecution({ action: " list " }), { ok: true, params: { action: "list" } });
		assert.deepEqual(
			normalizePublicSubagentExecution({ action: " validate ", workflowScript: "return 1" }),
			{ ok: true, params: { action: "validate", workflowScript: "return 1" } },
		);
		assert.deepEqual(
			normalizePublicSubagentExecution({ action: " validate ", workflowScriptPath: "workflow.js" }),
			{ ok: true, params: { action: "validate", workflowScriptPath: "workflow.js" } },
		);
	});

	it("rejects administration removed from the model surface but accepts it for trusted hosts", () => {
		for (const params of [
			{ action: "create" },
			{ action: "worktree.cleanup", mode: "plan" },
			{ action: "lane.recordMerge" },
		]) {
			const result = normalizePublicSubagentExecution(params);
			assert.equal(result.ok, false);
			if (!result.ok) assert.match(result.error, /human administration|removed from the model surface/i);
			assert.equal(normalizeTrustedHostSubagentExecution(params).ok, true, params.action);
		}
		for (const action of ["watchdog.status", "watchdog.check", "watchdog.configure", "watchdog.recommend-model", "schedule.create", "schedule.list", "schedule.show", "schedule.history", "schedule.pause", "schedule.resume", "schedule.run", "schedule.run-due", "schedule.delete"]) {
			assert.equal(normalizePublicSubagentExecution({ action }).ok, false);
			assert.equal(normalizeTrustedHostSubagentExecution({ action }).ok, false);
		}
		for (const normalize of [normalizePublicSubagentExecution, normalizeTrustedHostSubagentExecution]) {
			const appendStep = normalize({ action: "append-step", id: "run", step: { agent: "worker" } });
			assert.equal(appendStep.ok, false);
			if (!appendStep.ok) assert.match(appendStep.error, /internal executor compatibility.*unavailable through model, slash, or RPC/i);
		}
		const unknownPublic = normalizePublicSubagentExecution({ action: "not-a-real-action" });
		assert.equal(unknownPublic.ok, false);
		if (!unknownPublic.ok) assert.match(unknownPublic.error, /removed from the model surface.*trusted human administration/i);
		const unknownTrusted = normalizeTrustedHostSubagentExecution({ action: "not-a-real-action" });
		assert.equal(unknownTrusted.ok, false);
		if (!unknownTrusted.ok) assert.match(unknownTrusted.error, /Unknown trusted host action/);
	});

	it("rejects workflowScript with workflowScriptPath", () => {
		const result = normalizePublicSubagentExecution({ workflowScript: "return 1", workflowScriptPath: "workflow.js" });
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /mutually exclusive/);
	});

	it("rejects preflight without a workflow input", () => {
		const result = normalizePublicSubagentExecution({ agent: "worker", preflight: { version: 1, lanes: [] } });
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /preflight requires workflowScript or workflowScriptPath/);
	});

	it("rejects private run fan-out fields at the public boundary", () => {
		for (const params of [
			{ workflowScript: "return 1", runFanoutBudget: { version: 1 } },
			{ workflowScript: "return 1", runFanoutAdmitted: true },
		] as const) {
			const result = normalizePublicSubagentExecution(params);
			assert.equal(result.ok, false);
			if (!result.ok) assert.match(result.error, /does not accept internal run fan-out fields/);
		}
	});

	it("rejects private workflow child fields at the public boundary", () => {
		for (const params of [
			{ agent: "worker", workflowParentRunId: "workflow" },
			{ agent: "worker", workflowKey: "child" },
			{ agent: "worker", workflowChildAsyncId: "child" },
			{ agent: "worker", workflowAwaitAsync: true },
			{ agent: "worker", workflowAwaitDetached: true },
			{ agent: "worker", workflowParentDeadlineAt: Date.now() + 1_000 },
			{ agent: "worker", suppressRoutineResultIntercom: true },
		] as const) {
			const result = normalizePublicSubagentExecution(params);
			assert.equal(result.ok, false);
			if (!result.ok) assert.match(result.error, /internal workflow child fields/);
		}
	});

	it("rejects mixed, invalid, and removed public execution shapes", () => {
		for (const params of [
			{ action: " " },
			{ action: "single" },
			{ action: "parallel" },
			{ action: "chain" },
			{ action: "append-step", id: "run", step: { agent: "worker" } },
			{ action: "approve-checkpoint", id: "run" },
			{ action: "reject-checkpoint", id: "run" },
			{ agent: "" },
			{ agent: 42 },
			{ task: "work" },
			{ agent: "worker", task: 42 },
			{ agent: "worker", workflowScript: "return 1" },
			{ action: "status", task: "work" },
			{ tasks: [{ agent: "worker" }] },
			{ chain: [{ agent: "worker" }] },
			{ parallel: [{ agent: "worker" }] },
			{ concurrency: 2 },
			{ action: "get", chainName: "review-pipeline" },
			{ action: "create", config: { name: "review-pipeline", steps: [{ agent: "worker" }] } },
			{ clarify: true, workflowScript: "return 1" },
			{ resume: "retained-run", workflowScript: "return 1" },
			{},
			{ workflowScript: " " },
			{ workflowScriptPath: " " },
			{ action: "status", workflowScript: "return 1" },
			{ action: "schedule.create", every: "1h", agent: "worker", workflowScript: "return 1" },
			{ workflowScript: "return 1", isolation: "invalid" },
			{ workflowScript: "return 1", isolation: "none", worktree: true },
			{ workflowScript: "return 1", isolation: "worktree", worktree: false },
		] as const) {
			assert.equal(normalizePublicSubagentExecution(params).ok, false, JSON.stringify(params));
		}
	});
});
