import type { AgentContract, EffectsProjection, ReviewProjection, SingleResult } from "../../shared/types.ts";
import { applyChildTerminalDecision, childTerminalDecisionInputFromResult, decideChildTerminal, type ChildTerminalDecision } from "./terminal-decision.ts";

export function isAgentContractV1(contract: AgentContract | undefined): boolean {
	return contract?.version === 1;
}

export function buildExecutionProjection(result: Pick<SingleResult, "exitCode" | "error" | "interrupted" | "timedOut" | "stopped" | "detached">) {
	return decideChildTerminal(result).execution;
}

export function buildReviewProjection(result: Pick<SingleResult, "acceptance">): ReviewProjection {
	const review = result.acceptance?.reviewResult;
	if (!review) return { status: "not-requested" };
	const status = review.status === "no-blockers"
		? "reviewed"
		: review.status === "needs-parent-decision"
			? "review-required"
			: "blockers";
	return { status, findings: review.findings };
}

export function settleChildResult<T extends SingleResult>(result: T): ChildTerminalDecision {
	const decision = applyChildTerminalDecision(childTerminalDecisionInputFromResult(result));
	result.exitCode = decision.exitCode;
	result.error = decision.error;
	if (isAgentContractV1(result.agentContract)) {
		result.execution = decision.execution;
		result.review = buildReviewProjection(result);
		if (!result.effects) result.effects = {} satisfies EffectsProjection;
	}
	return decision;
}
