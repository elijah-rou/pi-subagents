import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	deriveMetrics,
	executeOperationForTest,
	executeScenario,
	fixtureHash,
	matchingControls,
	runBenchmark,
	runScenario,
	unionDuration,
	workloadSpec,
} from "../../scripts/orchestration-benchmark.mjs";

describe("executable matched orchestration benchmark", () => {
	it("executes one hashed workload with matched controls and strategy-only guidance differences", () => {
		const baseline = runScenario("baseline");
		const proposed = runScenario("proposed");
		assert.deepEqual(baseline.controls, proposed.controls);
		assert.equal(baseline.controls.fixtureHash, fixtureHash(workloadSpec));
		assert.deepEqual(baseline.controls, matchingControls());
		assert.notEqual(baseline.strategy.id, proposed.strategy.id);
		assert.notEqual(baseline.strategy.guidancePacket, proposed.strategy.guidancePacket);
		assert.deepEqual(executeScenario("baseline").state, executeScenario("proposed").state);
	});

	it("emits explicit orchestration, evidence, and successful cutoff events", () => {
		for (const name of ["baseline", "proposed"] as const) {
			const events = executeScenario(name).events;
			for (const type of ["call", "wait", "launch", "resume", "review", "validation", "owner-decision", "finding", "cutoff"]) assert(events.some((event) => event.type === type), `${name} missing ${type}`);
		}
		const baseline = executeScenario("baseline").events;
		assert(baseline.some((event) => event.type === "wrapper"));
		assert(baseline.some((event) => event.type === "poll"));
		assert(baseline.some((event) => event.type === "cutoff" && event.outcome === "success"));
	});

	it("derives topology, timing, usage, validation, finding, and acceptance metrics from trace", () => {
		const result = runBenchmark();
		assert.deepEqual(result.baseline.quality, result.proposed.quality);
		assert.deepEqual(result.proposed.quality.validationCalls, { targeted: 2, checkpoint: 1, final: 1 });
		assert.deepEqual(result.proposed.quality.findings, { detected: 1, accepted: 1, fixed: 1, verified: 1 });
		assert.equal(result.proposed.quality.unresolvedAccepted, 0);
		assert.equal(result.proposed.quality.finalAcceptance, "accepted");
		assert.ok(result.proposed.topology.topLevelExecutionCalls < result.baseline.topology.topLevelExecutionCalls);
		assert.ok(result.proposed.topology.singletonWorkflowWrappers < result.baseline.topology.singletonWorkflowWrappers);
		assert.ok(result.proposed.topology.blockingWaits < result.baseline.topology.blockingWaits);
		assert.ok(result.proposed.topology.statusPolls < result.baseline.topology.statusPolls);
		assert.equal(result.baseline.programMapBeforeMutation, true);
		assert.equal(result.proposed.readOnlyStartsBeforeWriterCriticalPathBlocks, true);
		for (const scenario of [result.baseline, result.proposed]) {
			assert.deepEqual(Object.keys(scenario.timing.partitionMs), ["owner", "parent", "child", "tool", "wait", "idle"]);
			assert.equal((Object.values(scenario.timing.partitionMs) as number[]).reduce((sum, durationMs) => sum + durationMs, 0), scenario.timing.wallMs);
		}
	});

	it("unions overlapping and adjacent intervals without double counting", () => {
		assert.equal(unionDuration([{ startMs: 0, endMs: 10 }, { startMs: 3, endMs: 7 }, { startMs: 10, endMs: 14 }, { startMs: 20, endMs: 22 }]), 16);
	});

	it("fails mutation closed without the owner decision", () => {
		assert.throws(() => executeOperationForTest("slice-a", { programMap: { artifactPath: "artifact.json" } }), /owner-selected default/);
	});

	it("fails targeted validations when observable artifact or evidence state is bad", () => {
		assert.throws(() => executeOperationForTest("targeted-a", { ownerDefault: "owner-only", artifact: { writerId: "serial-writer-1", slices: [], access: "open" } }), /targeted-a state validation failed/);
		assert.throws(() => executeOperationForTest("targeted-b", { artifact: { writerId: "serial-writer-1", slices: ["slice-a", "slice-b"], access: "open" }, preparation: { mutationCount: 1 } }), /targeted-b state validation failed/);
	});

	it("links detected review evidence, accepted disposition, repair, and verification", () => {
		const review = executeOperationForTest("ordinary-review", { ownerDefault: "owner-only", artifact: { writerId: "serial-writer-1", slices: ["slice-a", "slice-b"], access: "open" } });
		assert.equal(review.state.findings["F-1"].reviewId, "R-ordinary");
		assert.equal(review.events.find((event) => event.type === "finding")?.action, "detected");
		assert.throws(() => executeOperationForTest("focused-re-review", { ownerDefault: "owner-only", artifact: { writerId: "serial-writer-1", slices: ["slice-a", "slice-b"], access: "owner-only" }, findings: { "F-1": { status: "fixed", reviewId: "R-ordinary" } } }), /link review and repair/);
	});

	it("blocks final acceptance while a finding remains unresolved", () => {
		assert.throws(() => executeOperationForTest("final-parent-acceptance", { validations: { "targeted-a": "passed", "targeted-b": "passed", checkpoint: "passed" }, findings: { "F-1": { status: "accepted" } } }), /blocked by incomplete evidence/);
	});

	it("rejects missing cutoff, cross-category overlap, and contradictory validation or usage events during derivation", () => {
		const events = executeScenario("proposed").events;
		assert.throws(() => deriveMetrics(events.filter((event) => event.type !== "cutoff")), /successful final cutoff required/);
		const operation = events.find((event) => event.type === "operation" && event.category === "child");
		assert(operation);
		assert.throws(() => deriveMetrics([...events, { ...operation, category: "parent" }]), /cross-category timing overlap/);
		const validation = events.find((event) => event.type === "validation");
		assert(validation);
		assert.throws(() => deriveMetrics([...events, { ...validation, outcome: "failed" }]), /contradictory\/duplicate validation gate/);
		const usage = events.find((event) => event.type === "usage");
		assert(usage);
		assert.throws(() => deriveMetrics([...events, { ...usage, contextBytes: usage.contextBytes + 1 }]), /contradictory usage/);
	});

	it("fails closed on missing review, repair operation, or repair finding evidence", () => {
		const events = executeScenario("proposed").events;
		assert.throws(() => deriveMetrics(events.filter((event) => !(event.type === "review" && event.scope === "ordinary"))), /exactly one ordinary review required/);
		assert.throws(() => deriveMetrics(events.filter((event) => !(event.type === "operation" && event.operationId === "repair"))), /exactly one repair operation required/);
		assert.throws(() => deriveMetrics(events.filter((event) => !(event.type === "finding" && event.action === "fixed"))), /finding lifecycle incomplete/);
	});

	it("fails closed on broken review, finding, repair, and prior-review IDs", () => {
		const events = executeScenario("proposed").events;
		const brokenTraces = [
			events.map((event) => event.type === "review" && event.scope === "ordinary" ? { ...event, reviewId: "R-broken" } : event),
			events.map((event) => event.type === "finding" && event.action === "detected" ? { ...event, findingId: "F-broken" } : event),
			events.map((event) => event.type === "review" && event.scope === "focused" ? { ...event, priorReviewId: "R-broken" } : event),
			events.map((event) => event.type === "operation" && event.operationId === "repair" ? { ...event, repairId: "repair-broken" } : event),
		];
		for (const trace of brokenTraces) assert.throws(() => deriveMetrics(trace), /evidence link invalid/);
	});

	it("reports synthetic and external-usage limitations", () => {
		const result = runBenchmark();
		assert.ok(result.residualUncertainty.some((item) => item.includes("cannot establish causal")));
		assert.ok(result.residualUncertainty.some((item) => item.includes("synthetic")));
		assert.ok(result.residualUncertainty.some((item) => item.includes("unknown")));
	});
});
