export const MAX_DURATION_MS = 2_147_483_647;
export interface LaunchDurationAliases { timeoutMs?: number; maxRuntimeMs?: number }

export function clampDurationToAgentMaximum<T extends LaunchDurationAliases>(input: T, maximumMs: number | undefined): T {
	if (input.timeoutMs !== undefined && input.maxRuntimeMs !== undefined && input.timeoutMs !== input.maxRuntimeMs) throw new Error("timeoutMs and maxRuntimeMs are aliases; provide only one value or use the same value for both.");
	if (maximumMs === undefined) return input;
	if (!Number.isSafeInteger(maximumMs) || maximumMs < 1 || maximumMs > MAX_DURATION_MS) throw new Error(`agent maximum timeoutMs must be a positive safe integer <= ${MAX_DURATION_MS}.`);
	return { ...input, ...(input.timeoutMs !== undefined ? { timeoutMs: Math.min(input.timeoutMs, maximumMs) } : {}), ...(input.maxRuntimeMs !== undefined ? { maxRuntimeMs: Math.min(input.maxRuntimeMs, maximumMs) } : {}) };
}

export const SOFT_CHECKPOINT_MESSAGE = "The soft runtime checkpoint has been reached. After the current tool reaches its safe point, finish only bounded work and return: completed work, remaining work, and blockers.";

export function resolveDurationBudget(input: { checkpointAfterMs?: number; timeoutMs?: number }, startedAt = Date.now()): { checkpointAfterMs?: number; timeoutMs?: number; checkpointAt?: number; deadlineAt?: number } {
	for (const [field, value] of [["checkpointAfterMs", input.checkpointAfterMs], ["timeoutMs", input.timeoutMs]] as const) {
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > MAX_DURATION_MS)) throw new Error(`${field} must be a positive safe integer <= ${MAX_DURATION_MS}.`);
	}
	if (input.checkpointAfterMs !== undefined && input.timeoutMs !== undefined && input.checkpointAfterMs >= input.timeoutMs) throw new Error("checkpointAfterMs must be less than timeoutMs.");
	return {
		...(input.checkpointAfterMs !== undefined ? { checkpointAfterMs: input.checkpointAfterMs, checkpointAt: startedAt + input.checkpointAfterMs } : {}),
		...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs, deadlineAt: startedAt + input.timeoutMs } : {}),
	};
}
