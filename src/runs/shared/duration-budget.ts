export const MAX_DURATION_MS = 2_147_483_647;

export interface DurationBudgetInput {
	checkpointAfterMs?: number;
	timeoutMs?: number;
}

export interface LaunchDurationAliases {
	timeoutMs?: number;
	maxRuntimeMs?: number;
}

export interface ResolvedDurationBudget extends DurationBudgetInput {
	checkpointAt?: number;
	deadlineAt?: number;
}

function assertDuration(value: number | undefined, field: string): void {
	if (value === undefined) return;
	if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DURATION_MS) {
		throw new Error(`${field} must be a positive safe integer <= ${MAX_DURATION_MS}.`);
	}
}

export function clampDurationToAgentMaximum<T extends LaunchDurationAliases>(input: T, maximumMs: number | undefined): T {
	if (input.timeoutMs !== undefined && input.maxRuntimeMs !== undefined && input.timeoutMs !== input.maxRuntimeMs) {
		throw new Error("timeoutMs and maxRuntimeMs are aliases; provide only one value or use the same value for both.");
	}
	if (maximumMs === undefined) return input;
	assertDuration(maximumMs, "agent maximum timeoutMs");
	return {
		...input,
		...(input.timeoutMs !== undefined ? { timeoutMs: Math.min(input.timeoutMs, maximumMs) } : {}),
		...(input.maxRuntimeMs !== undefined ? { maxRuntimeMs: Math.min(input.maxRuntimeMs, maximumMs) } : {}),
	};
}

export function resolveDurationBudget(input: DurationBudgetInput, startedAt = Date.now()): ResolvedDurationBudget {
	assertDuration(input.checkpointAfterMs, "checkpointAfterMs");
	assertDuration(input.timeoutMs, "timeoutMs");
	if (input.checkpointAfterMs !== undefined && input.timeoutMs !== undefined && input.checkpointAfterMs >= input.timeoutMs) {
		throw new Error("checkpointAfterMs must be less than timeoutMs.");
	}
	return {
		...(input.checkpointAfterMs !== undefined ? { checkpointAfterMs: input.checkpointAfterMs, checkpointAt: startedAt + input.checkpointAfterMs } : {}),
		...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs, deadlineAt: startedAt + input.timeoutMs } : {}),
	};
}

export const SOFT_CHECKPOINT_MESSAGE = "The soft runtime checkpoint has been reached. After the current tool reaches its safe point, finish only bounded work and return: completed work, remaining work, and blockers.";
