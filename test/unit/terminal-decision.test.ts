import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foregroundStepStatus } from "../../src/runs/foreground/subagent-executor.ts";
import { workflowResultChildren } from "../../src/runs/foreground/workflow-detach-reconcile.ts";
import { applyChildTerminalDecision, childTerminalDecisionInputFromResult, decideChildTerminal, decideSingleResultTerminal } from "../../src/runs/shared/terminal-decision.ts";
import type { AcceptanceLedger, AsyncStatus, SingleResult } from "../../src/shared/types.ts";
import { terminalDecisionCases } from "../fixtures/terminal-decision-cases.ts";

function warningRejectionResult(): SingleResult {
	const acceptance = {
		status: "rejected",
		evidenceStatus: "missing",
		explicit: true,
		effectiveAcceptance: {
			level: "checked",
			explicit: true,
			report: false,
			onFailure: "warn",
			recommendations: [],
			deprecationWarnings: [],
			inferredReason: [],
			criteria: [],
			evidence: [],
			verify: [],
			review: false,
			stopRules: [],
		},
		inferredReason: [],
		criteria: [],
		runtimeChecks: [],
		verifyRuns: [],
	} satisfies AcceptanceLedger;
	return {
		index: 0,
		agent: "worker",
		task: "Inspect",
		exitCode: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		acceptance,
	};
}

describe("child terminal decision", () => {
	for (const fixture of terminalDecisionCases) {
		it(fixture.name, () => {
			const decision = decideChildTerminal(fixture.input);
			assert.equal(decision.status, fixture.expected.status);
			assert.equal(decision.success, fixture.expected.success);
			assert.equal(decision.exitCode, fixture.expected.exitCode);
			assert.equal(decision.acceptance.status, fixture.expected.acceptance);
			assert.equal(decision.effect.status, fixture.expected.effect);
			assert.equal(decision.error, fixture.expected.error);
		});
	}
});

describe("terminal decision adapters", () => {
	for (const fixture of terminalDecisionCases) {
		it(`projects the shared fixture for direct and background results: ${fixture.name}`, () => {
			const direct = { ...fixture.input };
			const background = { ...fixture.input };
			const directDecision = applyChildTerminalDecision(direct);
			const backgroundDecision = applyChildTerminalDecision(background);

			assert.deepEqual(backgroundDecision, directDecision);
			assert.equal(direct.exitCode, fixture.expected.exitCode);
			assert.equal(direct.error, fixture.expected.error);
			assert.equal(direct.execution?.status, directDecision.execution.status);
			assert.equal(direct.execution?.success, directDecision.execution.success);
		});
	}

	it("does not allow a settled policy failure to become success", () => {
		const result = { exitCode: 0, acceptance: { status: "rejected" as const } };
		const settled = applyChildTerminalDecision(result);
		assert.equal(settled.success, false);
		assert.equal(decideChildTerminal(result).success, false);
	});

	it("adapts warning-only acceptance without mutating the result", () => {
		const result = warningRejectionResult();
		const acceptanceBefore = structuredClone(result.acceptance);
		const input = childTerminalDecisionInputFromResult(result);

		assert.equal(input.acceptance?.required, false);
		assert.equal(decideSingleResultTerminal(result).success, true);
		assert.deepEqual(result.acceptance, acceptanceBefore);
	});

	it("keeps warning-only rejection complete in foreground nested status", () => {
		assert.equal(foregroundStepStatus(warningRejectionResult()), "complete");
	});

	it("keeps warning-only rejection successful in detached result reconstruction", () => {
		const result = warningRejectionResult();
		const children = workflowResultChildren({} as AsyncStatus, "child-warning", result, [{ runId: "child-warning", success: false }]) as Array<{ success?: boolean }>;

		assert.equal(children[0]?.success, true);
	});
});
