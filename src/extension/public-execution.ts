import { SUBAGENT_ACTIONS, SUBAGENT_INTERNAL_ACTIONS } from "../shared/types.ts";

export interface PublicSubagentExecutionParams {
	action?: unknown;
	mode?: unknown;
	repo?: unknown;
	agent?: unknown;
	task?: unknown;
	handoffPath?: unknown;
	laneId?: unknown;
	merge?: unknown;
	supersession?: unknown;
	step?: unknown;
	tasks?: unknown;
	chain?: unknown;
	parallel?: unknown;
	concurrency?: unknown;
	chainDir?: unknown;
	chainName?: unknown;
	config?: unknown;
	workflowScript?: unknown;
	workflowScriptPath?: unknown;
	preflight?: unknown;
	isolation?: unknown;
	worktree?: unknown;
	lane?: unknown;
	async?: unknown;
	output?: unknown;
	resume?: unknown;
	clarify?: unknown;
	workflowParentRunId?: unknown;
	workflowKey?: unknown;
	workflowChildAsyncId?: unknown;
	workflowAwaitAsync?: unknown;
	workflowAwaitDetached?: unknown;
	workflowParentDeadlineAt?: unknown;
	suppressRoutineResultIntercom?: unknown;
	runFanoutBudget?: unknown;
	runFanoutAdmitted?: unknown;
	missionId?: unknown;
	mission?: unknown;
	missionUpdate?: unknown;
	missionStatus?: unknown;
	missionScope?: unknown;
	scheduleOrigin?: unknown;
}

export type PublicSubagentExecutionMode = "workflow" | "management";

export type PublicSubagentExecutionNormalization<T> =
	| { ok: true; params: T }
	| { ok: false; error: string; mode: PublicSubagentExecutionMode };

const RETIRED_REFINEMENT_GUIDANCE: ReadonlyMap<string, string> = new Map([
	["refine", "Refinement overlays are retired. Use an explicit reviewer workflow for review and the human /subagents interface to edit agent definitions."],
	["refine.show", "Refinement overlay display is retired. Existing .pi/subagents/refinements artifacts are inert unknown files; inspect them directly only for historical reference."],
	["refine.rollback", "Refinement overlay rollback is retired and rollback is unavailable. Use the human /subagents interface to edit the agent definition; existing refinement artifacts remain untouched."],
]);

/**
 * Enforce the public execution cutover before requests reach the executor.
 * Internal runs.run children and structured owned delegation bypass this boundary.
 */
export function normalizePublicSubagentExecution<T extends PublicSubagentExecutionParams>(params: T): PublicSubagentExecutionNormalization<T> {
	return normalizeSubagentExecution(params, false);
}

/** Normalize administration requested by trusted slash-command and RPC hosts. Never expose this through model tools. */
export function normalizeTrustedHostSubagentExecution<T extends PublicSubagentExecutionParams>(params: T): PublicSubagentExecutionNormalization<T> {
	return normalizeSubagentExecution(params, true);
}

function normalizeSubagentExecution<T extends PublicSubagentExecutionParams>(params: T, trustedHost: boolean): PublicSubagentExecutionNormalization<T> {
	if (params.missionId !== undefined || params.mission !== undefined || params.missionUpdate !== undefined || params.missionStatus !== undefined || params.missionScope !== undefined) {
		return { ok: false, error: "Mission fields were removed. Workflow recovery uses run status, events, results, receipts, and workflow-owned state.", mode: params.action === undefined ? "workflow" : "management" };
	}
	if (params.scheduleOrigin !== undefined) {
		return { ok: false, error: "Schedule origin is historical artifact metadata and cannot be emitted by new launches.", mode: params.action === undefined ? "workflow" : "management" };
	}
	if (params.workflowScript !== undefined && params.workflowScriptPath !== undefined) {
		return { ok: false, error: "workflowScript and workflowScriptPath are mutually exclusive.", mode: "workflow" };
	}
	const hasWorkflowInput = params.workflowScript !== undefined || params.workflowScriptPath !== undefined;
	if (params.preflight !== undefined && !hasWorkflowInput) {
		return { ok: false, error: "preflight requires workflowScript or workflowScriptPath.", mode: params.action === undefined ? "workflow" : "management" };
	}
	const hasValidWorkflowInput = (typeof params.workflowScript === "string" && Boolean(params.workflowScript.trim()))
		|| (typeof params.workflowScriptPath === "string" && Boolean(params.workflowScriptPath.trim()));
	if (params.isolation !== undefined) {
		if (params.isolation !== "none" && params.isolation !== "worktree") {
			return { ok: false, error: "isolation must be 'none' or 'worktree'.", mode: hasWorkflowInput ? "workflow" : "management" };
		}
		const isolationWorktree = params.isolation === "worktree";
		if (params.worktree !== undefined && params.worktree !== isolationWorktree) {
			return { ok: false, error: `isolation '${params.isolation}' conflicts with worktree: ${String(params.worktree)}.`, mode: hasWorkflowInput ? "workflow" : "management" };
		}
		const { isolation: _isolation, ...normalizedParams } = params;
		params = { ...normalizedParams, worktree: isolationWorktree } as T;
	}
	if (params.runFanoutBudget !== undefined || params.runFanoutAdmitted !== undefined) {
		return { ok: false, error: "Public execution does not accept internal run fan-out fields.", mode: hasWorkflowInput ? "workflow" : "management" };
	}
	if (params.workflowParentRunId !== undefined || params.workflowKey !== undefined || params.workflowChildAsyncId !== undefined || params.workflowAwaitAsync !== undefined || params.workflowAwaitDetached !== undefined || params.workflowParentDeadlineAt !== undefined || params.suppressRoutineResultIntercom !== undefined) {
		return { ok: false, error: "Public execution does not accept internal workflow child fields.", mode: hasWorkflowInput ? "workflow" : "management" };
	}
	const action = params.action;
	if (action !== undefined && (typeof action !== "string" || !action.trim())) {
		return { ok: false, error: "action must be a non-empty management/control action, or omit action and use workflowScript.", mode: "management" };
	}
	const normalizedAction = typeof action === "string" ? action.trim() : undefined;
	if (normalizedAction !== undefined) {
		if (normalizedAction.toLowerCase() === "append-step") {
			return { ok: false, error: "Legacy append-step execution was removed. Existing append-request artifacts are inert and remain untouched; use workflowScript orchestration.", mode: "management" };
		}
		const retirementGuidance = RETIRED_REFINEMENT_GUIDANCE.get(normalizedAction.toLowerCase());
		if (retirementGuidance !== undefined) {
			return { ok: false, error: retirementGuidance, mode: "management" };
		}
		const allowedActions = trustedHost ? SUBAGENT_INTERNAL_ACTIONS : SUBAGENT_ACTIONS;
		if (!(allowedActions as readonly string[]).includes(normalizedAction)) {
			return {
				ok: false,
				error: trustedHost
					? `Unknown trusted host action '${normalizedAction}'.`
					: `Action '${normalizedAction}' was removed from the model surface. Use trusted human administration through slash commands or an existing RPC bridge.`,
				mode: "management",
			};
		}
	}
	if (params.clarify !== undefined) {
		return { ok: false, error: "Public workflowScript execution does not support clarify UI.", mode: "workflow" };
	}
	if (params.chainName !== undefined) {
		return { ok: false, error: "Durable chain management was removed; use workflowScript or /prompt-workflow for repeatable workflows.", mode: "management" };
	}
	if (params.config && typeof params.config === "object" && !Array.isArray(params.config) && Object.prototype.hasOwnProperty.call(params.config, "steps")) {
		return { ok: false, error: "Durable chain definitions were removed; use workflowScript or /prompt-workflow for repeatable workflows.", mode: "management" };
	}
	if (params.resume !== undefined) {
		return { ok: false, error: "Top-level resume execution is not available. Put resume on a workflowScript runs.run/runs.all item.", mode: "workflow" };
	}
	const hasLegacyOrchestration = params.tasks !== undefined || params.chain !== undefined || params.parallel !== undefined || params.concurrency !== undefined || params.chainDir !== undefined;
	if (hasLegacyOrchestration) {
		return { ok: false, error: "Legacy top-level chain and parallel inputs were removed; use workflowScript.", mode: normalizedAction ? "management" : "workflow" };
	}
	if (normalizedAction !== undefined) {
		const legacyAction = normalizedAction.toLowerCase();
		if (legacyAction === "approve-checkpoint" || legacyAction === "reject-checkpoint") {
			return { ok: false, error: "Legacy checkpoint approval controls were removed from the public subagent tool; use current workflowScript orchestration.", mode: "management" };
		}
		if (legacyAction === "single") {
			return { ok: false, error: "action='single' is not supported. Omit action and pass { agent, task } for one child.", mode: "workflow" };
		}
		if (legacyAction === "parallel" || legacyAction === "tasks" || legacyAction === "chain") {
			return { ok: false, error: "Legacy top-level chain and parallel inputs were removed; use workflowScript.", mode: "workflow" };
		}
		if (normalizedAction === "validate") {
			if (params.agent !== undefined || params.task !== undefined || params.step !== undefined) {
				return { ok: false, error: "validate requires workflowScript or workflowScriptPath and does not accept direct agent, task, or step execution fields.", mode: "management" };
			}
			if (!hasValidWorkflowInput) {
				return { ok: false, error: "validate requires a non-empty workflowScript or workflowScriptPath.", mode: "management" };
			}
			return { ok: true, params: { ...params, action: normalizedAction } };
		}
		if (hasWorkflowInput) {
			return { ok: false, error: "Workflow execution must omit action; only validate accepts action with workflowScript or workflowScriptPath.", mode: "management" };
		}
		if (params.task !== undefined) {
			return { ok: false, error: "Structured single-child task cannot be combined with a management/control action.", mode: "management" };
		}
		return { ok: true, params: { ...params, action: normalizedAction } };
	}
	if (params.step !== undefined) {
		return { ok: false, error: "step is not a public execution field; use workflowScript for orchestration.", mode: "workflow" };
	}
	if (hasWorkflowInput && (params.agent !== undefined || params.task !== undefined)) {
		return { ok: false, error: "Structured single-child execution cannot be combined with workflowScript or workflowScriptPath.", mode: "workflow" };
	}
	if (params.agent !== undefined || params.task !== undefined) {
		if (typeof params.agent !== "string" || !params.agent.trim()) {
			return { ok: false, error: "Structured single-child execution requires agent to be a non-empty string.", mode: "workflow" };
		}
		if (params.task !== undefined && typeof params.task !== "string") {
			return { ok: false, error: "Structured single-child task must be a string when provided.", mode: "workflow" };
		}
		return {
			ok: true,
			params: {
				...params,
				agent: params.agent.trim(),
				output: params.output === undefined ? true : params.output,
			} as T,
		};
	}
	if (!hasValidWorkflowInput) {
		return { ok: false, error: "Execution requires either { agent, task? } for one child or a non-empty workflowScript or workflowScriptPath for orchestration.", mode: "workflow" };
	}
	return { ok: true, params };
}
