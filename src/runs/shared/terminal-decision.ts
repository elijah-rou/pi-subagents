import type { AcceptanceLedgerStatus, EffectsProjection, ExecutionProjection, SingleResult, SubagentResultStatus } from "../../shared/types.ts";
import { acceptanceFailureMessage } from "./acceptance.ts";

export type TerminalAcceptanceOutcome = "not-requested" | "accepted" | "rejected";
export type TerminalEffectOutcome = "not-requested" | "not-applicable" | "observed" | "missing" | "blocked";

export interface ChildTerminalDecisionInput {
	exitCode: number;
	error?: string;
	interrupted?: boolean;
	timedOut?: boolean;
	stopped?: boolean;
	detached?: boolean;
	acceptance?: { status: AcceptanceLedgerStatus; diagnostic?: string; required?: boolean };
	effects?: EffectsProjection;
}

export interface ChildTerminalDecision {
	execution: ExecutionProjection;
	acceptance: { status: TerminalAcceptanceOutcome };
	effect: { status: TerminalEffectOutcome };
	status: SubagentResultStatus;
	success: boolean;
	exitCode: number;
	error?: string;
}

function acceptanceOutcome(status: AcceptanceLedgerStatus | undefined): TerminalAcceptanceOutcome {
	switch (status) {
		case undefined:
		case "not-required": return "not-requested";
		case "accepted":
		case "attested":
		case "checked":
		case "reviewed":
		case "verified": return "accepted";
		case "claimed":
		case "pending":
		case "rejected":
		case "review-required": return "rejected";
	}
}

export function childTerminalDecisionInputFromResult(result: Pick<SingleResult, "exitCode" | "error" | "interrupted" | "timedOut" | "stopped" | "detached" | "acceptance" | "effects">): ChildTerminalDecisionInput {
	return {
		exitCode: result.exitCode,
		error: result.error,
		interrupted: result.interrupted,
		timedOut: result.timedOut,
		stopped: result.stopped,
		detached: result.detached,
		...(result.acceptance ? {
			acceptance: {
				status: result.acceptance.status,
				diagnostic: acceptanceFailureMessage(result.acceptance),
				required: result.acceptance.effectiveAcceptance.onFailure === "fail",
			},
		} : {}),
		effects: result.effects,
	};
}

export function decideSingleResultTerminal(result: Pick<SingleResult, "exitCode" | "error" | "interrupted" | "timedOut" | "stopped" | "detached" | "acceptance" | "effects">): ChildTerminalDecision {
	return decideChildTerminal(childTerminalDecisionInputFromResult(result));
}

export function decideChildTerminal(input: ChildTerminalDecisionInput): ChildTerminalDecision {
	if (!Number.isInteger(input.exitCode)) throw new Error(`Terminal exit code must be an integer, received '${input.exitCode}'.`);
	const detached = input.detached === true;
	const stopped = !detached && input.stopped === true;
	const timedOut = !detached && !stopped && input.timedOut === true;
	const interrupted = !detached && !stopped && !timedOut && input.interrupted === true;
	const executionStatus = detached ? "detached" : stopped ? "stopped" : timedOut ? "failed" : interrupted ? "paused" : input.exitCode === 0 && !input.error ? "completed" : "failed";
	const executionExitCode = stopped || timedOut ? 1 : input.exitCode;
	const executionError = input.error
		?? (executionStatus === "stopped" ? "Subagent stopped by user."
			: timedOut ? "Subagent timed out."
				: executionStatus === "failed" ? `Child exited with code ${executionExitCode}.`
					: undefined);
	const execution: ExecutionProjection = {
		status: executionStatus,
		success: executionStatus === "completed",
		exitCode: executionExitCode,
		...(executionError ? { error: executionError } : {}),
		...(detached ? { detached: true } : {}),
		...(stopped ? { stopped: true } : {}),
		...(timedOut ? { timedOut: true } : {}),
		...(interrupted ? { interrupted: true } : {}),
	};
	const acceptanceStatus = acceptanceOutcome(input.acceptance?.status);
	const mutation = input.effects?.fileMutation;
	const effectStatus: TerminalEffectOutcome = mutation?.status === "blocked" ? "blocked"
		: mutation?.status === "missing" || input.effects?.settlementDiagnostic?.requiredOutput?.missing === true ? "missing"
			: mutation?.status ?? "not-requested";
	const acceptanceFailed = acceptanceStatus === "rejected" && input.acceptance?.required !== false;
	const effectRequired = mutation?.expected === true || input.effects?.settlementDiagnostic?.requiredOutput?.missing === true;
	const policyFailed = acceptanceFailed || (effectRequired && (effectStatus === "missing" || effectStatus === "blocked"));
	const status: SubagentResultStatus = executionStatus === "detached" || executionStatus === "stopped" || executionStatus === "paused" ? executionStatus : execution.success && !policyFailed ? "completed" : "failed";
	const exitCode = status === "stopped" || status === "failed" ? (input.exitCode === 0 ? 1 : input.exitCode) : input.exitCode;
	const diagnostics = executionError ? [executionError] : [];
	if (execution.success && acceptanceFailed) diagnostics.push(input.acceptance?.diagnostic ?? "Required acceptance evidence was rejected or incomplete.");
	if (execution.success && effectRequired && effectStatus === "missing") diagnostics.push(mutation?.message ?? (input.effects?.settlementDiagnostic?.requiredOutput?.missing === true ? `Required ${input.effects.settlementDiagnostic.requiredOutput.kind} output was not produced.` : "Required mutation evidence was not observed."));
	if (execution.success && effectRequired && effectStatus === "blocked") diagnostics.push(mutation?.message ?? "Required mutation was blocked.");
	const error = [...new Set(diagnostics)].join("\n") || undefined;
	return { execution, acceptance: { status: acceptanceStatus }, effect: { status: effectStatus }, status, success: status === "completed", exitCode, ...(error ? { error } : {}) };
}

export function applyChildTerminalDecision<T extends ChildTerminalDecisionInput & { execution?: ExecutionProjection }>(result: T): ChildTerminalDecision {
	const decision = decideChildTerminal(result);
	result.exitCode = decision.exitCode;
	result.error = decision.error;
	result.execution = decision.execution;
	return decision;
}
