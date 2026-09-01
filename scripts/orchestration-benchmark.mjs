#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const workloadSpec = Object.freeze({
	name: "repository-neutral-two-slice-change",
	version: 2,
	seed: "delegation-efficiency-workstream-9-seed-1",
	initialState: { programMap: null, ownerDefault: null, artifact: null, preparation: null, validations: {}, findings: {} },
	operations: [
		{ id: "program-map", actor: "parent", durationMs: 4, contextUnits: 8, rule: "record-map-before-mutation" },
		{ id: "owner-decision", actor: "owner", durationMs: 10, contextUnits: 0, rule: "select-owner-only-default" },
		{ id: "slice-a", actor: "writer", durationMs: 20, contextUnits: 14, rule: "require-owner-default-and-create-artifact" },
		{ id: "read-only-preparation", actor: "preparer", durationMs: 10, contextUnits: 12, rule: "inspect-map-without-mutation" },
		{ id: "targeted-a", actor: "validator", durationMs: 4, contextUnits: 5, rule: "inspect-slice-a-and-owner-default" },
		{ id: "slice-b", actor: "writer", durationMs: 15, contextUnits: 13, rule: "require-same-writer-and-seed-open-access-p1" },
		{ id: "targeted-b", actor: "validator", durationMs: 4, contextUnits: 5, rule: "inspect-two-slice-shape-and-preparation" },
		{ id: "ordinary-review", actor: "reviewer", durationMs: 12, contextUnits: 16, rule: "detect-open-access-against-owner-default" },
		{ id: "accept-disposition", actor: "parent", durationMs: 3, contextUnits: 6, rule: "accept-detected-p1" },
		{ id: "repair", actor: "writer", durationMs: 8, contextUnits: 10, rule: "repair-accepted-finding" },
		{ id: "focused-re-review", actor: "reviewer", durationMs: 6, contextUnits: 9, rule: "verify-linked-repair" },
		{ id: "checkpoint", actor: "validator", durationMs: 4, contextUnits: 6, rule: "inspect-complete-repaired-state" },
		{ id: "final-parent-acceptance", actor: "parent", durationMs: 5, contextUnits: 9, rule: "fail-closed-on-gates-and-findings" },
	],
	invariants: {
		writerId: "serial-writer-1",
		ownerDefault: "owner-only",
		seededFinding: { id: "F-1", severity: "P1", badValue: "open", repairedValue: "owner-only" },
		reviewEvidence: { ordinaryReviewId: "R-ordinary", focusedReviewId: "R-focused", repairId: "repair-F-1" },
		requiredValidations: ["targeted-a", "targeted-b", "checkpoint"],
		cutoff: "final-parent-acceptance",
	},
});

export const strategies = Object.freeze({
	baseline: {
		id: "serialized-singletons",
		guidancePacket: "Run every workload operation as a separately wrapped singleton invocation. Repeat the full program map, owner decision, artifact contract, evidence requirements, finding lifecycle, validation gates, and acceptance contract in each handoff. Block for completion, then poll status before constructing and sending the next singleton handoff.",
		wrappersPerCall: true,
		pollAfterChild: true,
		prepareWithSliceA: false,
	},
	proposed: {
		id: "mapped-coordinated-waves",
		guidancePacket: "Map once, launch independent preparation with slice A, checkpoint only at dependencies, and resume the serial writer.",
		wrappersPerCall: false,
		pollAfterChild: false,
		prepareWithSliceA: true,
	},
});

export const modelPolicy = Object.freeze({ id: "deterministic-mock-policy-v2", bytesPerContextUnit: 700, inputTokensPerContextUnit: 150, outputTokensPerDurationMs: 20, inputCostPerToken: 0.000004, outputCostPerToken: 0.000004 });

export function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value !== null && value === Object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}

export function fixtureHash(value = workloadSpec) {
	return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

export function matchingControls() {
	return { runtimeRevision: "pi-subagents@0.59.0-fork.1/workstream-9", modelPolicy: modelPolicy.id, taskSeed: workloadSpec.seed, fixtureHash: fixtureHash(), timeoutMs: 180_000, maxConcurrency: 2, measurementCutoff: workloadSpec.invariants.cutoff };
}

function initialState(overrides = {}) {
	return structuredClone({ ...workloadSpec.initialState, ...overrides });
}

function operation(id) {
	const value = workloadSpec.operations.find((item) => item.id === id);
	assert(value, `unknown operation ${id}`);
	return value;
}

function applyOperation(id, state, emit) {
	const finding = workloadSpec.invariants.seededFinding;
	switch (id) {
		case "program-map":
			assert.equal(state.artifact, null, "program map must precede mutation");
			state.programMap = { artifactPath: "artifact.json", ownerDefaultPath: "policy.default", slices: ["slice-a", "slice-b"] };
			return;
		case "owner-decision":
			assert(state.programMap, "owner decision requires program map");
			state.ownerDefault = workloadSpec.invariants.ownerDefault;
			emit("owner-decision", { decision: "selected", value: state.ownerDefault });
			return;
		case "slice-a":
			assert.equal(state.ownerDefault, workloadSpec.invariants.ownerDefault, "mutation requires owner-selected default");
			assert.equal(state.artifact, null, "slice A creates the artifact once");
			state.artifact = { writerId: workloadSpec.invariants.writerId, slices: ["slice-a"], access: state.ownerDefault };
			return;
		case "read-only-preparation":
			assert(state.programMap, "preparation requires map");
			state.preparation = { inspected: ["artifactPath", "ownerDefaultPath"], mutationCount: 0 };
			return;
		case "targeted-a": {
			const passed = state.artifact?.slices.join(",") === "slice-a" && state.artifact.access === state.ownerDefault;
			emit("validation", { gate: id, scope: "targeted", outcome: passed ? "passed" : "failed" });
			assert(passed, "targeted-a state validation failed");
			state.validations[id] = "passed";
			return;
		}
		case "slice-b":
			assert.equal(state.ownerDefault, workloadSpec.invariants.ownerDefault, "mutation requires owner-selected default");
			assert.equal(state.artifact?.writerId, workloadSpec.invariants.writerId, "slice B requires the serial writer");
			assert.deepEqual(state.artifact.slices, ["slice-a"]);
			state.artifact.slices.push("slice-b");
			state.artifact.access = finding.badValue;
			return;
		case "targeted-b": {
			const passed = state.artifact?.slices.join(",") === "slice-a,slice-b" && state.preparation?.mutationCount === 0;
			emit("validation", { gate: id, scope: "targeted", outcome: passed ? "passed" : "failed" });
			assert(passed, "targeted-b state validation failed");
			state.validations[id] = "passed";
			return;
		}
		case "ordinary-review": {
			const { ordinaryReviewId } = workloadSpec.invariants.reviewEvidence;
			const detected = state.artifact?.access !== state.ownerDefault;
			emit("review", { reviewId: ordinaryReviewId, scope: "ordinary", findingId: finding.id, outcome: detected ? "finding" : "clear" });
			assert(detected, "seeded P1 was not observable in artifact state");
			state.findings[finding.id] = { severity: finding.severity, status: "detected", reviewId: ordinaryReviewId, evidence: { actual: state.artifact.access, expected: state.ownerDefault } };
			emit("finding", { findingId: finding.id, severity: finding.severity, action: "detected", reviewId: ordinaryReviewId });
			return;
		}
		case "accept-disposition":
			assert.equal(state.findings[finding.id]?.status, "detected", "disposition requires detected finding");
			state.findings[finding.id].status = "accepted";
			emit("finding", { findingId: finding.id, severity: finding.severity, action: "accepted", reviewId: state.findings[finding.id].reviewId });
			return;
		case "repair": {
			const { repairId } = workloadSpec.invariants.reviewEvidence;
			assert.equal(state.findings[finding.id]?.status, "accepted", "repair requires accepted finding");
			assert.equal(state.artifact?.writerId, workloadSpec.invariants.writerId, "repair requires serial writer");
			state.artifact.access = finding.repairedValue;
			state.findings[finding.id].status = "fixed";
			state.findings[finding.id].repairId = repairId;
			emit("finding", { findingId: finding.id, severity: finding.severity, action: "fixed", reviewId: state.findings[finding.id].reviewId, repairId });
			return;
		}
		case "focused-re-review": {
			const { focusedReviewId } = workloadSpec.invariants.reviewEvidence;
			const record = state.findings[finding.id];
			assert.equal(record?.status, "fixed", "focused re-review requires repair");
			assert(record.reviewId && record.repairId, "verification must link review and repair");
			const repaired = state.artifact?.access === state.ownerDefault;
			emit("review", { reviewId: focusedReviewId, scope: "focused", findingId: finding.id, priorReviewId: record.reviewId, repairId: record.repairId, outcome: repaired ? "verified" : "failed" });
			assert(repaired, "focused re-review found unrepaired state");
			record.status = "verified";
			emit("finding", { findingId: finding.id, severity: finding.severity, action: "verified", reviewId: focusedReviewId, repairId: record.repairId });
			return;
		}
		case "checkpoint": {
			const passed = state.validations["targeted-a"] === "passed" && state.validations["targeted-b"] === "passed" && state.findings[finding.id]?.status === "verified" && state.artifact?.access === state.ownerDefault;
			emit("validation", { gate: id, scope: "checkpoint", outcome: passed ? "passed" : "failed" });
			assert(passed, "checkpoint state validation failed");
			state.validations[id] = "passed";
			return;
		}
		case "final-parent-acceptance": {
			const unresolved = Object.values(state.findings).filter((item) => item.status !== "verified").length;
			const passed = workloadSpec.invariants.requiredValidations.every((gate) => state.validations[gate] === "passed") && unresolved === 0;
			emit("validation", { gate: id, scope: "final", outcome: passed ? "passed" : "failed" });
			assert(passed, "final parent acceptance blocked by incomplete evidence");
			emit("acceptance", { outcome: "accepted", unresolvedAcceptedFindings: unresolved });
			emit("cutoff", { cutoff: id, outcome: "success" });
			return;
		}
		default: assert.fail(`unimplemented operation ${id}`);
	}
}

export function executeOperationForTest(id, stateOverrides = {}) {
	const state = initialState(stateOverrides);
	const events = [];
	applyOperation(id, state, (type, fields) => events.push({ type, ...fields }));
	return { state, events };
}

class Executor {
	constructor(strategy, stateOverrides = {}) {
		this.strategy = strategy;
		this.clock = 0;
		this.events = [];
		this.state = initialState(stateOverrides);
		this.attempt = 0;
		this.launched = new Set();
	}
	emit(type, fields = {}, atMs = this.clock) { this.events.push({ type, atMs, ...fields }); }
	modelUsage(spec, actor, startMs) {
		if (actor === "owner" || actor === "validator") return;
		const attemptId = `${this.strategy.id}-${spec.id}-${++this.attempt}`;
		const guidanceUnits = Math.ceil(this.strategy.guidancePacket.length / 40);
		const inputTokens = (spec.contextUnits + guidanceUnits) * modelPolicy.inputTokensPerContextUnit;
		const outputTokens = spec.durationMs * modelPolicy.outputTokensPerDurationMs;
		this.emit("usage", { attemptId, owner: actor === "parent" ? "parent" : "child", contextBytes: spec.contextUnits * modelPolicy.bytesPerContextUnit + Buffer.byteLength(this.strategy.guidancePacket), inputTokens, outputTokens, costUsd: Number((inputTokens * modelPolicy.inputCostPerToken + outputTokens * modelPolicy.outputCostPerToken).toFixed(5)) }, startMs + spec.durationMs);
	}
	control(type, fields = {}, durationMs = 0) {
		const startMs = this.clock;
		this.emit(type, { startMs, endMs: startMs + durationMs, category: type === "wait" ? "wait" : "parent", ...fields }, startMs);
		this.clock += durationMs;
	}
	before(id) {
		const proposedGroups = {
			"program-map": "map-and-gate", "owner-decision": "map-and-gate",
			"slice-a": "implementation", "read-only-preparation": "implementation", "targeted-a": "implementation", "slice-b": "implementation", "targeted-b": "implementation",
			"ordinary-review": "review-and-repair", "accept-disposition": "review-and-repair", repair: "review-and-repair", "focused-re-review": "review-and-repair",
			checkpoint: "acceptance", "final-parent-acceptance": "acceptance",
		};
		const callId = this.strategy.wrappersPerCall ? id : proposedGroups[id];
		if (this.lastCallId !== callId) {
			this.control("call", { callId, operationId: id }, 1);
			if (this.strategy.wrappersPerCall) this.control("wrapper", { operationId: id, wrapperKind: "singleton" }, 1);
			this.lastCallId = callId;
		}
		const actor = operation(id).actor;
		if (["writer", "preparer", "reviewer"].includes(actor)) {
			const identity = actor === "writer" ? workloadSpec.invariants.writerId : `${actor}-${id}`;
			if (this.launched.has(identity)) this.control("resume", { operationId: id, childId: identity });
			else { this.launched.add(identity); this.control("launch", { operationId: id, childId: identity }); }
		}
	}
	run(id) {
		this.before(id);
		const spec = operation(id);
		const startMs = this.clock;
		const findingId = workloadSpec.invariants.seededFinding.id;
		const { ordinaryReviewId, focusedReviewId, repairId } = workloadSpec.invariants.reviewEvidence;
		const evidence = id === "ordinary-review" ? { reviewId: ordinaryReviewId, findingId }
			: id === "repair" ? { findingId, priorReviewId: ordinaryReviewId, repairId }
				: id === "focused-re-review" ? { reviewId: focusedReviewId, findingId, priorReviewId: ordinaryReviewId, repairId } : {};
		this.emit("operation", { operationId: id, actor: spec.actor, category: spec.actor === "owner" ? "owner" : spec.actor === "validator" ? "tool" : spec.actor === "parent" ? "parent" : "child", startMs, endMs: startMs + spec.durationMs, ...evidence }, startMs);
		applyOperation(id, this.state, (type, fields) => this.emit(type, fields, startMs + spec.durationMs));
		this.modelUsage(spec, spec.actor, startMs);
		this.clock += spec.durationMs;
		if (this.strategy.pollAfterChild && ["writer", "preparer", "reviewer"].includes(spec.actor)) { this.control("wait", { operationId: id }, 2); this.control("poll", { operationId: id }); }
	}
	wave(ids) {
		assert(ids.length <= matchingControls().maxConcurrency, "wave exceeds matched concurrency limit");
		for (const id of ids) this.before(id);
		const waveStart = this.clock;
		const pending = [];
		for (const id of ids) {
			const spec = operation(id);
			const startMs = waveStart;
			pending.push({ id, spec, startMs, endMs: startMs + spec.durationMs });
			this.emit("operation", { operationId: id, actor: spec.actor, category: "child", startMs, endMs: startMs + spec.durationMs }, startMs);
		}
		for (const item of pending.sort((a, b) => a.endMs - b.endMs)) {
			applyOperation(item.id, this.state, (type, fields) => this.emit(type, fields, item.endMs));
			this.modelUsage(item.spec, item.spec.actor, item.startMs);
		}
		this.clock = Math.max(...pending.map((item) => item.endMs));
		this.control("wait", { operationId: "coordinated-wave" }, 2);
	}
}

export function executeScenario(name, options = {}) {
	const strategy = strategies[name];
	assert(strategy, `unknown strategy ${name}`);
	const executor = new Executor(strategy, options.stateOverrides);
	executor.run("program-map");
	executor.run("owner-decision");
	if (strategy.prepareWithSliceA) executor.wave(["slice-a", "read-only-preparation"]);
	else { executor.run("slice-a"); executor.run("targeted-a"); executor.run("read-only-preparation"); }
	if (strategy.prepareWithSliceA) executor.run("targeted-a");
	executor.run("slice-b");
	executor.run("targeted-b");
	executor.run("ordinary-review");
	executor.run("accept-disposition");
	executor.run("repair");
	executor.run("focused-re-review");
	executor.run("checkpoint");
	executor.run("final-parent-acceptance");
	assert(executor.clock <= matchingControls().timeoutMs, "scenario exceeded matched timeout");
	return { name, strategy: { id: strategy.id, guidancePacket: strategy.guidancePacket }, controls: matchingControls(), events: executor.events, state: executor.state };
}

export function unionDuration(intervals) {
	const sorted = intervals.map(({ startMs, endMs }) => ({ startMs, endMs })).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
	let total = 0; let end = -1;
	for (const item of sorted) { assert(item.endMs >= item.startMs); if (item.startMs >= end) total += item.endMs - item.startMs; else if (item.endMs > end) total += item.endMs - end; end = Math.max(end, item.endMs); }
	return total;
}

export function deriveMetrics(events) {
	assert(Array.isArray(events) && events.length > 0, "trace required");
	const cutoffEvents = events.filter((event) => event.type === "cutoff" && event.cutoff === workloadSpec.invariants.cutoff && event.outcome === "success");
	assert.equal(cutoffEvents.length, 1, "exactly one successful final cutoff required");
	const cutoffMs = cutoffEvents[0].atMs;
	const timed = events.filter((event) => Number.isFinite(event.startMs) && Number.isFinite(event.endMs));
	const partitionCategories = ["owner", "parent", "child", "tool", "wait"];
	for (const event of timed) {
		assert(event.startMs >= 0 && event.endMs >= event.startMs);
		assert(event.endMs <= cutoffMs, "event after cutoff");
		assert(partitionCategories.includes(event.category), `unknown timed category ${event.category}`);
	}
	for (let leftIndex = 0; leftIndex < timed.length; leftIndex += 1) {
		for (let rightIndex = leftIndex + 1; rightIndex < timed.length; rightIndex += 1) {
			const left = timed[leftIndex]; const right = timed[rightIndex];
			if (left.category !== right.category && Math.max(left.startMs, right.startMs) < Math.min(left.endMs, right.endMs)) {
				assert.fail(`cross-category timing overlap: ${left.category} and ${right.category}`);
			}
		}
	}
	const partitionMs = Object.fromEntries(partitionCategories.map((category) => [category, unionDuration(timed.filter((event) => event.category === category))]));
	partitionMs.idle = cutoffMs - Object.values(partitionMs).reduce((sum, durationMs) => sum + durationMs, 0);
	assert(partitionMs.idle >= 0, "timing partition exceeds wall time");
	assert.equal(Object.values(partitionMs).reduce((sum, durationMs) => sum + durationMs, 0), cutoffMs, "timing partition must equal wall time");
	const usageByAttempt = new Map();
	for (const event of events.filter((item) => item.type === "usage")) { const old = usageByAttempt.get(event.attemptId); if (old) assert.deepEqual(old, event, `contradictory usage ${event.attemptId}`); else usageByAttempt.set(event.attemptId, event); }
	const aggregate = (owner) => { const rows = [...usageByAttempt.values()].filter((item) => item.owner === owner); return { attempts: rows.length, contextBytes: rows.reduce((sum, item) => sum + item.contextBytes, 0), processedTokens: rows.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0), reportedCostUsd: Number(rows.reduce((sum, item) => sum + item.costUsd, 0).toFixed(5)) }; };
	const parent = aggregate("parent"); const child = aggregate("child");
	const validations = events.filter((event) => event.type === "validation");
	assert.equal(new Set(validations.map((event) => event.gate)).size, validations.length, "contradictory/duplicate validation gate");
	assert.deepEqual(validations.map((event) => event.gate), ["targeted-a", "targeted-b", "checkpoint", "final-parent-acceptance"], "required validation trace incomplete or out of order");
	assert(validations.every((event) => event.outcome === "passed"), "accepted trace contains failed validation");
	const finding = workloadSpec.invariants.seededFinding;
	const { ordinaryReviewId, focusedReviewId, repairId } = workloadSpec.invariants.reviewEvidence;
	const reviews = events.filter((event) => event.type === "review");
	const ordinaryReviews = reviews.filter((event) => event.scope === "ordinary");
	const focusedReviews = reviews.filter((event) => event.scope === "focused");
	assert.equal(ordinaryReviews.length, 1, "exactly one ordinary review required");
	assert.deepEqual(
		{ reviewId: ordinaryReviews[0].reviewId, findingId: ordinaryReviews[0].findingId, outcome: ordinaryReviews[0].outcome },
		{ reviewId: ordinaryReviewId, findingId: finding.id, outcome: "finding" },
		"ordinary review evidence link invalid",
	);
	assert.equal(focusedReviews.length, 1, "exactly one focused review required");
	assert.deepEqual(
		{ reviewId: focusedReviews[0].reviewId, findingId: focusedReviews[0].findingId, priorReviewId: focusedReviews[0].priorReviewId, repairId: focusedReviews[0].repairId, outcome: focusedReviews[0].outcome },
		{ reviewId: focusedReviewId, findingId: finding.id, priorReviewId: ordinaryReviewId, repairId, outcome: "verified" },
		"focused review evidence link invalid",
	);
	assert.equal(reviews.length, 2, "exactly two linked review events required");
	const findingEvents = events.filter((event) => event.type === "finding");
	const findingActions = findingEvents.map((event) => event.action);
	assert.deepEqual(findingActions, ["detected", "accepted", "fixed", "verified"], "finding lifecycle incomplete or contradictory");
	const expectedFindingLinks = [
		{ findingId: finding.id, action: "detected", reviewId: ordinaryReviewId, repairId: undefined },
		{ findingId: finding.id, action: "accepted", reviewId: ordinaryReviewId, repairId: undefined },
		{ findingId: finding.id, action: "fixed", reviewId: ordinaryReviewId, repairId },
		{ findingId: finding.id, action: "verified", reviewId: focusedReviewId, repairId },
	];
	assert.deepEqual(findingEvents.map((event) => ({ findingId: event.findingId, action: event.action, reviewId: event.reviewId, repairId: event.repairId })), expectedFindingLinks, "finding evidence link invalid");
	const acceptance = events.filter((event) => event.type === "acceptance");
	assert.equal(acceptance.length, 1, "exactly one acceptance required");
	assert.equal(acceptance[0].outcome, "accepted");
	assert.equal(acceptance[0].unresolvedAcceptedFindings, 0, "accepted trace reports unresolved findings");
	const operationEvents = events.filter((event) => event.type === "operation");
	const linkedOperations = [
		["ordinary-review", { reviewId: ordinaryReviewId, findingId: finding.id }],
		["repair", { findingId: finding.id, priorReviewId: ordinaryReviewId, repairId }],
		["focused-re-review", { reviewId: focusedReviewId, findingId: finding.id, priorReviewId: ordinaryReviewId, repairId }],
	];
	for (const [operationId, expectedLinks] of linkedOperations) {
		const matches = operationEvents.filter((event) => event.operationId === operationId);
		assert.equal(matches.length, 1, `exactly one ${operationId} operation required`);
		assert.deepEqual(Object.fromEntries(Object.keys(expectedLinks).map((key) => [key, matches[0][key]])), expectedLinks, `${operationId} operation evidence link invalid`);
	}
	const map = operationEvents.find((event) => event.operationId === "program-map");
	const mutation = operationEvents.find((event) => event.operationId === "slice-a");
	const preparation = operationEvents.find((event) => event.operationId === "read-only-preparation");
	assert(map && mutation && preparation);
	const ownerDecisions = events.filter((event) => event.type === "owner-decision" && event.decision === "selected");
	assert.equal(ownerDecisions.length, 1, "exactly one selected owner decision required");
	assert(ownerDecisions[0].atMs <= mutation.startMs, "owner decision must precede mutation");
	return {
		topology: { topLevelExecutionCalls: events.filter((e) => e.type === "call").length, singletonWorkflowWrappers: events.filter((e) => e.type === "wrapper").length, blockingWaits: events.filter((e) => e.type === "wait").length, statusPolls: events.filter((e) => e.type === "poll").length, childLaunches: events.filter((e) => e.type === "launch").length, childResumes: events.filter((e) => e.type === "resume").length, reviewRounds: events.filter((e) => e.type === "review").length },
		timing: { wallMs: cutoffMs, ownerExcludedWallMs: cutoffMs - partitionMs.owner, partitionMs },
		usage: { parent, child, combinedKnown: { attempts: parent.attempts + child.attempts, contextBytes: parent.contextBytes + child.contextBytes, processedTokens: parent.processedTokens + child.processedTokens, reportedCostUsd: Number((parent.reportedCostUsd + child.reportedCostUsd).toFixed(5)) }, accountingIdentity: "unique-model-attempt-id", externalUsage: "unknown" },
		quality: { validationCalls: { targeted: validations.filter((e) => e.scope === "targeted").length, checkpoint: validations.filter((e) => e.scope === "checkpoint").length, final: validations.filter((e) => e.scope === "final").length }, validationOutcomes: Object.fromEntries(validations.map((e) => [e.gate, e.outcome])), findings: Object.fromEntries(["detected", "accepted", "fixed", "verified"].map((action) => [action, findingActions.filter((value) => value === action).length])), unresolvedAccepted: acceptance[0].unresolvedAcceptedFindings, finalAcceptance: acceptance[0].outcome },
		programMapBeforeMutation: map.endMs <= mutation.startMs,
		readOnlyStartsBeforeWriterCriticalPathBlocks: preparation.startMs < mutation.endMs,
	};
}

export function runScenario(name) {
	const execution = executeScenario(name);
	return { name, strategy: execution.strategy, controls: execution.controls, ...deriveMetrics(execution.events), events: execution.events };
}

function withoutEvents(value) { const { events: _events, ...rest } = value; return rest; }
export function runBenchmark() {
	const baseline = runScenario("baseline"); const proposed = runScenario("proposed");
	assert.deepEqual(baseline.controls, proposed.controls);
	assert.deepEqual(baseline.quality, proposed.quality);
	const delta = {};
	for (const [key, a, b] of [["ownerExcludedWallMs", baseline.timing.ownerExcludedWallMs, proposed.timing.ownerExcludedWallMs], ["topLevelExecutionCalls", baseline.topology.topLevelExecutionCalls, proposed.topology.topLevelExecutionCalls], ["singletonWorkflowWrappers", baseline.topology.singletonWorkflowWrappers, proposed.topology.singletonWorkflowWrappers], ["blockingWaits", baseline.topology.blockingWaits, proposed.topology.blockingWaits], ["statusPolls", baseline.topology.statusPolls, proposed.topology.statusPolls], ["combinedContextBytes", baseline.usage.combinedKnown.contextBytes, proposed.usage.combinedKnown.contextBytes], ["combinedProcessedTokens", baseline.usage.combinedKnown.processedTokens, proposed.usage.combinedKnown.processedTokens], ["combinedReportedCostUsd", baseline.usage.combinedKnown.reportedCostUsd, proposed.usage.combinedKnown.reportedCostUsd]]) delta[key] = Number((b - a).toFixed(5));
	return { schemaVersion: 2, controls: matchingControls(), workload: { name: workloadSpec.name, version: workloadSpec.version, hash: fixtureHash() }, baseline: withoutEvents(baseline), proposed: withoutEvents(proposed), delta, residualUncertainty: ["One deterministic mock workload cannot establish causal or live-model generality.", "Virtual operation durations and policy-calculated usage are synthetic executor observations, not provider measurements.", "External usage is unknown and excluded from combined known usage."] };
}

function writeEvidence(result, rawPath, summaryPath) {
	fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
	const baseline = runScenario("baseline"); const proposed = runScenario("proposed");
	const records = [{ type: "benchmark-controls", controls: result.controls, workload: result.workload }, ...baseline.events.map((event) => ({ scenario: "baseline", ...event })), ...proposed.events.map((event) => ({ scenario: "proposed", ...event }))];
	fs.writeFileSync(rawPath, `${records.map(JSON.stringify).join("\n")}\n`); fs.writeFileSync(summaryPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = runBenchmark(); const rawPath = path.join(projectRoot, "tmp/orchestration-benchmark/raw-evidence.jsonl"); const summaryPath = path.join(projectRoot, "docs/delegation-efficiency-benchmark-summary.json");
	writeEvidence(result, rawPath, summaryPath); console.log(JSON.stringify({ rawEvidence: path.relative(projectRoot, rawPath), normalizedSummary: path.relative(projectRoot, summaryPath), delta: result.delta }));
}
