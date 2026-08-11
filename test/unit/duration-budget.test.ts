import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampDurationToAgentMaximum, resolveDurationBudget } from "../../src/runs/shared/duration-budget.ts";

describe("duration budget", () => {
	it("persists absolute checkpoint and deadline timestamps", () => {
		assert.deepEqual(resolveDurationBudget({ checkpointAfterMs: 480_000, timeoutMs: 900_000 }, 1_000), {
			checkpointAfterMs: 480_000,
			timeoutMs: 900_000,
			checkpointAt: 481_000,
			deadlineAt: 901_000,
		});
	});

	it("validates aliases before clamping to the per-agent hard maximum", () => {
		assert.deepEqual(clampDurationToAgentMaximum({ timeoutMs: 1_200_000 }, 900_000), { timeoutMs: 900_000 });
		assert.deepEqual(clampDurationToAgentMaximum({ maxRuntimeMs: 1_200_000 }, 900_000), { maxRuntimeMs: 900_000 });
		assert.deepEqual(clampDurationToAgentMaximum({ timeoutMs: 1_200_000, maxRuntimeMs: 1_200_000 }, 900_000), { timeoutMs: 900_000, maxRuntimeMs: 900_000 });
		assert.deepEqual(clampDurationToAgentMaximum({ timeoutMs: 600_000 }, 900_000), { timeoutMs: 600_000 });
		assert.throws(
			() => clampDurationToAgentMaximum({ timeoutMs: 1_200_000, maxRuntimeMs: 1_100_000 }, 900_000),
			/timeoutMs and maxRuntimeMs are aliases/,
		);
	});

	it("requires safe positive integers and checkpoint before timeout", () => {
		for (const input of [
			{ checkpointAfterMs: 0, timeoutMs: 10 },
			{ checkpointAfterMs: 1.5, timeoutMs: 10 },
			{ checkpointAfterMs: 10, timeoutMs: 10 },
			{ checkpointAfterMs: 11, timeoutMs: 10 },
			{ checkpointAfterMs: Number.MAX_SAFE_INTEGER + 1, timeoutMs: undefined },
		]) assert.throws(() => resolveDurationBudget(input, 0), /checkpointAfterMs/);
	});
});
