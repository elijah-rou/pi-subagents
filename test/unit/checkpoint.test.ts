import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkpointCanReachSteerableStep, checkpointSteeringTargetIndexes } from "../../src/runs/shared/checkpoint.ts";

describe("soft checkpoint steering targets", () => {
	it("targets only supported recipients in a mixed run", () => {
		assert.deepEqual(checkpointSteeringTargetIndexes([
			{ status: "running" },
			{ status: "running", runner: { type: "external-cli" } },
			{ status: "complete" },
			{ status: "running", runner: { type: "external-job" } },
		]), [0]);
	});

	it("reports no delivery targets and stops polling for an external-only run", () => {
		const steps = [
			{ status: "running", runner: { type: "external-cli" } },
			{ status: "running", runner: { type: "external-job" } },
		];
		assert.deepEqual(checkpointSteeringTargetIndexes(steps), []);
		assert.equal(checkpointCanReachSteerableStep(steps), false);
	});

	it("keeps polling while a native recipient is pending in a mixed run", () => {
		const steps = [
			{ status: "running", runner: { type: "external-cli" } },
			{ status: "pending" },
		];
		assert.deepEqual(checkpointSteeringTargetIndexes(steps), []);
		assert.equal(checkpointCanReachSteerableStep(steps), true);
	});
});
