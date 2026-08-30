import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkpointSteeringTargetIndexes } from "../../src/runs/shared/checkpoint.ts";

describe("soft checkpoint steering targets", () => {
	it("targets only supported recipients in a mixed run", () => {
		assert.deepEqual(checkpointSteeringTargetIndexes([
			{ status: "running" },
			{ status: "running", runner: { type: "external-cli" } },
			{ status: "complete" },
			{ status: "running", runner: { type: "external-job" } },
		]), [0]);
	});

	it("reports no delivery targets for an external-only run", () => {
		assert.deepEqual(checkpointSteeringTargetIndexes([
			{ status: "running", runner: { type: "external-cli" } },
			{ status: "running", runner: { type: "external-job" } },
		]), []);
	});
});
