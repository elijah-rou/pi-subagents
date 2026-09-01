import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NestedRunSummary, SingleResult, Usage } from "../../src/shared/types.ts";
import { accountChildUsage, mergeChildUsageAccountings, parseChildUsageAccounting } from "../../src/shared/usage-accounting.ts";
import { usageBudgetState } from "../../src/runs/shared/usage-budget.ts";

const usage = (input: number, output: number, cost: number, cacheRead = 0): Usage => ({ input, output, cacheRead, cacheWrite: 0, cost, turns: 1 });

function result(overrides: Partial<SingleResult> = {}): SingleResult {
	return { index: 0, agent: "worker", task: "fixture", exitCode: 0, usage: usage(1, 1, 0.01), ...overrides };
}

function nested(id: string, totalCost?: NestedRunSummary["totalCost"], children?: NestedRunSummary[]): NestedRunSummary {
	return { id, parentRunId: "root", depth: 1, path: [{ runId: "root" }], state: "complete", ...(totalCost ? { totalCost } : {}), ...(children ? { children } : {}) };
}

describe("authoritative child usage accounting", () => {
	it("uses aggregate subtree ownership and exposes descendants only below unknown aggregates", () => {
		const owned = nested("owned", { inputTokens: 10, outputTokens: 4, costUsd: 0.1 }, [nested("must-not-count", { inputTokens: 99, outputTokens: 99, costUsd: 9 })]);
		const unknown = nested("unknown", undefined, [nested("reported-descendant", { inputTokens: 3, outputTokens: 2, costUsd: 0.03 })]);
		const accounting = accountChildUsage("root", [result({ usage: usage(5, 2, 0.05), children: [owned, unknown] })]);

		assert.deepEqual(accounting.total, { input: 18, output: 8, cacheRead: 0, cacheWrite: 0, cost: 0.18000000000000002, turns: 1 });
		assert.equal(accounting.records.some((record) => record.ownerRunId === "must-not-count"), false);
		assert.deepEqual(accounting.unknownRecordIds, ["run:owned/session", "run:unknown/session", "run:reported-descendant/session"]);
		assert.equal(accounting.complete, false);
	});

	it("feeds nested-inclusive terminal totals into usage-budget state", () => {
		const accounting = accountChildUsage("budget-root", [result({ usage: usage(2, 1, 0.02), children: [nested("nested-budget", { inputTokens: 20, outputTokens: 10, costUsd: 0.2 })] })]);
		const terminalCost = { inputTokens: accounting.total.input, outputTokens: accounting.total.output, costUsd: accounting.total.cost };
		const state = usageBudgetState({ tokens: { hard: 25 } }, terminalCost);
		assert.equal(state?.tokens.used, 33);
		assert.equal(state?.exhausted, true);
	});

	it("uses root-run identity instead of shared session paths and preserves historical aggregate usage", () => {
		const historical = result({ sessionFile: "/sessions/shared.jsonl", usage: usage(7, 3, 0.07), modelAttempts: [{ model: "old", success: true }] });
		const first = accountChildUsage("resume-a", [historical]);
		const second = accountChildUsage("resume-b", [historical]);

		assert.notEqual(first.records[0]?.id, second.records[0]?.id);
		assert.deepEqual(first.total, historical.usage);
		assert.equal(first.complete, true);
	});

	it("deduplicates exact completion rereads and rejects conflicting duplicate claims", () => {
		const accounting = accountChildUsage("root", [result({ runId: "child", usage: usage(4, 2, 0.04) })]);
		assert.deepEqual(mergeChildUsageAccountings([accounting, parseChildUsageAccounting(JSON.parse(JSON.stringify(accounting)))!]).total, accounting.total);
		const conflict = accountChildUsage("root", [result({ runId: "child", usage: usage(5, 2, 0.05) })]);
		assert.throws(() => mergeChildUsageAccountings([accounting, conflict]), /Conflicting child usage record/);
	});

	it("retains canonical ownership when an awaited detached async child crosses the workflow boundary", () => {
		const imported = accountChildUsage("async-child", [
			result({ runId: "external", agent: "external", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }, runner: { kind: "external-cli", command: "external" } }),
			result({ index: 1, runId: "nested", usage: usage(8, 3, 0.08) }),
		]);
		const outer = accountChildUsage("workflow", [result({ runId: "async-child", detached: true, usage: imported.total, childUsageAccounting: imported })]);

		assert.deepEqual(outer, imported);
		assert.equal(outer.records.some((record) => record.ownerRunId === "async-child"), false, "the workflow wrapper must not replace imported ownership");
	});

	it("keeps fallback identity stable across array reorder and rejects duplicate index conflicts", () => {
		const first = result({ index: 0, agent: "first", usage: usage(4, 2, 0.04) });
		const second = result({ index: 1, agent: "second", usage: usage(7, 3, 0.07) });
		const ordered = accountChildUsage("root", [first, second]);
		const reordered = accountChildUsage("root", [second, first]);
		assert.deepEqual(new Set(ordered.records.map((record) => record.id)), new Set(reordered.records.map((record) => record.id)));
		assert.deepEqual(ordered.total, reordered.total);

		const deduplicated = accountChildUsage("root", [first, { ...first }]);
		assert.equal(deduplicated.records.length, 1);
		assert.deepEqual(deduplicated.total, first.usage);
		assert.throws(() => accountChildUsage("root", [first, { ...first, usage: usage(5, 2, 0.05) }]), /Conflicting child usage record/);
	});

	it("accounts fallback attempts and external unknown usage without claiming a false zero", () => {
		const accounting = accountChildUsage("root", [
			result({ runId: "fallback", usage: usage(8, 3, 0.08, 6), modelAttempts: [{ model: "failed", success: false, usage: usage(2, 1, 0.02) }, { model: "fallback", success: true, usage: usage(6, 2, 0.06, 6) }] }),
			result({ index: 1, agent: "external", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }, runner: { kind: "external-cli", command: "external" } }),
		]);
		assert.deepEqual(accounting.total, { input: 8, output: 3, cacheRead: 6, cacheWrite: 0, cost: 0.08, turns: 2 });
		assert.equal(accounting.complete, false);
		assert.equal(accounting.unknownRecordIds.length, 1);
	});
});
