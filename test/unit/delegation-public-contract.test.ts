import assert from "node:assert/strict";
import test from "node:test";
import { Compile } from "typebox/compile";
import { SubagentParams } from "../../src/extension/schemas.ts";
import { normalizePublicSubagentExecution } from "../../src/extension/public-execution.ts";

const schema = Compile(SubagentParams);

for (const [reason, listKey, textKey] of [
	["independent_parallel_lane", "ownership", "deliverable"],
	["unresolved_ownership", "inspected", "unresolved"],
] as const) {
	function accepts(basis: unknown): boolean {
		const input = { agent: "worker", task: "Bounded task", delegationReason: reason, delegationBasis: basis };
		return schema.Check(input) && normalizePublicSubagentExecution(input).ok;
	}
	test(`${reason} passes the public schema and handler with bounded evidence`, () => {
		for (const size of [1, 32]) {
			for (const length of [1, 1024]) {
				assert.equal(accepts({ [listKey]: Array(size).fill("x".repeat(length)), [textKey]: "x".repeat(length) }), true);
			}
		}
	});
	test(`${reason} enforces the UTF-16 resource bound after Unicode schema validation`, () => {
		for (const [value, expected] of [
			["😀".repeat(512), true],
			["😀".repeat(513), false],
			["a\u0301".repeat(512), true],
			["a\u0301".repeat(513), false],
			["x".repeat(1022) + "😀", true],
			["x".repeat(1023) + "😀", false],
		] as const) {
			for (const key of [listKey, textKey]) {
				const basis = { [listKey]: ["path"], [textKey]: "outcome", [key]: key === listKey ? [value] : value };
				const input = { agent: "worker", task: "Bounded task", delegationReason: reason, delegationBasis: basis };
				assert.equal(schema.Check(input), true, "schema character count is only a prefilter");
				assert.equal(normalizePublicSubagentExecution(input).ok, expected, `${key}: ${value.length} UTF-16 code units`);
			}
		}
	});
	test(`${reason} rejects invalid evidence at the public boundary`, () => {
		for (const basis of [undefined, null, {}, [], true, 1, "evidence"]) assert.equal(accepts(basis), false);
		for (const value of [undefined, null, "", " ", "x".repeat(1025), 1, 1.5, NaN, Infinity, true, []]) {
			assert.equal(accepts({ [listKey]: ["path"], [textKey]: value }), false);
			assert.equal(accepts({ [listKey]: [value], [textKey]: "outcome" }), false);
		}
		for (const value of [undefined, null, [], Array(33).fill("path"), "path", 1]) {
			assert.equal(accepts({ [listKey]: value, [textKey]: "outcome" }), false);
		}
		assert.equal(accepts({ [listKey]: ["path"], [textKey]: "outcome", unexpected: true }), false);
		assert.equal(accepts(reason === "independent_parallel_lane" ? { inspected: ["path"], unresolved: "owner?" } : { ownership: ["path"], deliverable: "done" }), false);
	});
}

test("ordinary launches and management retain their provenance rules", () => {
	assert.equal(schema.Check({ action: "list" }), true);
	const input = { agent: "reviewer", task: "Review the diff", delegationReason: "semantic_review" };
	assert.equal(schema.Check(input) && normalizePublicSubagentExecution(input).ok, true);
	assert.equal(normalizePublicSubagentExecution({ ...input, delegationBasis: { ownership: ["a"], deliverable: "b" } }).ok, false);
	assert.equal(normalizePublicSubagentExecution({ agent: "worker", task: "task" }).ok, false);
});
