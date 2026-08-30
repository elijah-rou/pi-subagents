import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkpointCanReachSteerableStep, checkpointSteeringTargetIndexes, scheduleCheckpointDeadline } from "../../src/runs/shared/checkpoint.ts";

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

	it("keeps a native pending recipient reachable without polling", () => {
		const steps = [
			{ status: "running", runner: { type: "external-cli" } },
			{ status: "pending" },
		];
		assert.deepEqual(checkpointSteeringTargetIndexes(steps), []);
		assert.equal(checkpointCanReachSteerableStep(steps), true);
	});

	it("owns one deadline timer and fires exactly once", () => {
		const scheduled: Array<{ callback: () => void; delay: number }> = [];
		const cleared: unknown[] = [];
		let deliveries = 0;
		const deadline = scheduleCheckpointDeadline({
			checkpointAt: 1_250,
			now: () => 1_000,
			onDue: () => { deliveries++; },
			setTimer: (callback, delay) => {
				scheduled.push({ callback, delay });
				return callback;
			},
			clearTimer: (timer) => { cleared.push(timer); },
		});
		assert.deepEqual(scheduled.map(({ delay }) => delay), [250]);
		scheduled[0]!.callback();
		scheduled[0]!.callback();
		assert.equal(deliveries, 1);
		deadline.dispose();
		assert.equal(cleared.length, 0, "an elapsed timer is no longer owned");
	});

	it("cancels a pending deadline on disposal", () => {
		const timers: unknown[] = [];
		const cleared: unknown[] = [];
		const deadline = scheduleCheckpointDeadline({
			checkpointAt: 2_000,
			now: () => 1_000,
			onDue: () => assert.fail("disposed deadline fired"),
			setTimer: (callback) => {
				timers.push(callback);
				return callback;
			},
			clearTimer: (timer) => { cleared.push(timer); },
		});
		deadline.dispose();
		deadline.dispose();
		assert.equal(timers.length, 1);
		assert.deepEqual(cleared, timers);
	});

	for (const childCount of [1, 10, 64]) {
		it(`keeps timer ownership bounded for ${childCount} checkpointed children`, () => {
			let timerCount = 0;
			const deadlines = Array.from({ length: childCount }, () => scheduleCheckpointDeadline({
				checkpointAt: 1_001,
				now: () => 1_000,
				onDue() {},
				setTimer: (callback) => { timerCount++; return callback; },
				clearTimer() {},
			}));
			assert.equal(timerCount, childCount, "each child owns exactly one timer");
			for (const deadline of deadlines) deadline.dispose();
		});
	}
});
