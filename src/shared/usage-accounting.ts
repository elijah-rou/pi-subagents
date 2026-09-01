import type { CostSummary, ModelAttempt, NestedRunSummary, SingleResult, Usage } from "./types.ts";

export type ChildUsageRecordKind = "model-attempt" | "session" | "nested-session" | "external-run";

/** One package-owned accounting claim. The id is the deduplication key across persistence and delivery paths. */
export interface ChildUsageRecord {
	id: string;
	ownerRunId: string;
	kind: ChildUsageRecordKind;
	usage?: Usage;
	/** False means some usage dimensions or the whole external report are unavailable. */
	complete: boolean;
}

export interface ChildUsageAccounting {
	version: 1;
	records: ChildUsageRecord[];
	total: Usage;
	/** True only when every owned record has authoritative usage. */
	complete: boolean;
	unknownRecordIds: string[];
}

export function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

export function addUsage(target: Usage, source: Usage): void {
	target.input += source.input;
	target.output += source.output;
	target.cacheRead += source.cacheRead;
	target.cacheWrite += source.cacheWrite;
	target.cost += source.cost;
	target.turns += source.turns;
}

function usageFromCost(cost: CostSummary): Usage {
	return { input: cost.inputTokens, output: cost.outputTokens, cacheRead: 0, cacheWrite: 0, cost: cost.costUsd, turns: 0 };
}

function sameUsage(left: Usage | undefined, right: Usage | undefined): boolean {
	if (left === undefined || right === undefined) return left === right;
	return left.input === right.input && left.output === right.output
		&& left.cacheRead === right.cacheRead && left.cacheWrite === right.cacheWrite
		&& left.cost === right.cost && left.turns === right.turns;
}

function resultOwnerId(rootRunId: string, result: SingleResult): string {
	const persistedRunId = (result as SingleResult & { runId?: unknown }).runId;
	if (typeof persistedRunId === "string" && persistedRunId.length > 0) return persistedRunId;
	return `${rootRunId}/child:${result.index}`;
}

/**
 * Build the authoritative child-only aggregate. Direct results own their model attempts;
 * nested run ids own nested session totals. Repeated claims with the same id are counted once.
 */
export function accountChildUsage(rootRunId: string, results: readonly SingleResult[]): ChildUsageAccounting {
	if (!rootRunId) throw new Error("Child usage accounting requires a root run id.");
	const records = new Map<string, ChildUsageRecord>();

	const addRecord = (record: ChildUsageRecord): void => {
		const previous = records.get(record.id);
		if (!previous) {
			records.set(record.id, record);
			return;
		}
		if (previous.ownerRunId !== record.ownerRunId || previous.kind !== record.kind || previous.complete !== record.complete || !sameUsage(previous.usage, record.usage)) {
			throw new Error(`Conflicting child usage record '${record.id}'.`);
		}
	};

	const addNested = (children: readonly NestedRunSummary[] | undefined): void => {
		for (const child of children ?? []) {
			if (child.totalCost) {
				// The aggregate owns the entire subtree, so descendants must not also be claimed.
				// Nested cost summaries do not report cache or turn dimensions.
				addRecord({ id: `run:${child.id}/session`, ownerRunId: child.id, kind: "nested-session", usage: usageFromCost(child.totalCost), complete: false });
				continue;
			}
			addRecord({ id: `run:${child.id}/session`, ownerRunId: child.id, kind: "nested-session", complete: false });
			addNested(child.children);
			for (const step of child.steps ?? []) addNested(step.children);
		}
	};

	results.forEach((result) => {
		const importedAccounting = parseChildUsageAccounting(result.childUsageAccounting);
		if (result.childUsageAccounting !== undefined && !importedAccounting) throw new Error("Imported childUsageAccounting is malformed.");
		if (importedAccounting) {
			for (const record of importedAccounting.records) addRecord(record);
			return;
		}

		const ownerRunId = resultOwnerId(rootRunId, result);
		const attempts: readonly ModelAttempt[] | undefined = result.modelAttempts;
		if (attempts?.length && attempts.every((attempt) => attempt.usage !== undefined)) {
			attempts.forEach((attempt, attemptIndex) => addRecord({
				id: `run:${ownerRunId}/attempt:${attemptIndex}`,
				ownerRunId,
				kind: "model-attempt",
				usage: attempt.usage,
				complete: true,
			}));
		} else if (attempts?.length) {
			// Historical attempt arrays may omit per-attempt usage. Their top-level aggregate
			// owns the logical run because attempt-level claims would overlap it.
			addRecord({ id: `run:${ownerRunId}/session`, ownerRunId, kind: "session", usage: result.usage, complete: true });
		} else if (result.runner) {
			const hasReportedValue = result.usage.input !== 0 || result.usage.output !== 0 || result.usage.cacheRead !== 0 || result.usage.cacheWrite !== 0 || result.usage.cost !== 0 || result.usage.turns !== 0;
			const complete = result.usageKnown === true || hasReportedValue;
			addRecord({ id: `run:${ownerRunId}/external`, ownerRunId, kind: "external-run", ...(complete ? { usage: result.usage } : {}), complete });
		} else {
			addRecord({ id: `run:${ownerRunId}/session`, ownerRunId, kind: "session", usage: result.usage, complete: true });
		}
		addNested(result.children);
	});

	const total = emptyUsage();
	const unknownRecordIds: string[] = [];
	for (const record of records.values()) {
		if (record.usage) addUsage(total, record.usage);
		if (!record.complete) unknownRecordIds.push(record.id);
	}
	return { version: 1, records: [...records.values()], total, complete: unknownRecordIds.length === 0, unknownRecordIds };
}

export function parseChildUsageAccounting(value: unknown): ChildUsageAccounting | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const raw = value as Record<string, unknown>;
	if (raw.version !== 1 || !Array.isArray(raw.records) || raw.records.length > 4096) return undefined;
	const records: ChildUsageRecord[] = [];
	for (const item of raw.records) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
		const record = item as Record<string, unknown>;
		if (typeof record.id !== "string" || !record.id || record.id.length > 2048 || typeof record.ownerRunId !== "string" || !record.ownerRunId || record.ownerRunId.length > 2048 || typeof record.complete !== "boolean") return undefined;
		if (record.kind !== "model-attempt" && record.kind !== "session" && record.kind !== "nested-session" && record.kind !== "external-run") return undefined;
		const usage = record.usage;
		if (usage !== undefined && (!usage || typeof usage !== "object" || Array.isArray(usage))) return undefined;
		const candidate = usage as Partial<Usage> | undefined;
		const validUsage = candidate && [candidate.input, candidate.output, candidate.cacheRead, candidate.cacheWrite, candidate.cost, candidate.turns].every((number) => typeof number === "number" && Number.isFinite(number) && number >= 0) && Number.isSafeInteger(candidate.turns)
			? candidate as Usage
			: undefined;
		if (usage !== undefined && !validUsage) return undefined;
		records.push({ id: record.id, ownerRunId: record.ownerRunId, kind: record.kind, complete: record.complete, ...(validUsage ? { usage: validUsage } : {}) });
	}
	return mergeChildUsageAccountings([{ version: 1, records, total: emptyUsage(), complete: false, unknownRecordIds: [] }]);
}

export function mergeChildUsageAccountings(accountings: readonly ChildUsageAccounting[]): ChildUsageAccounting {
	const records = new Map<string, ChildUsageRecord>();
	for (const accounting of accountings) {
		for (const record of accounting.records) {
			const previous = records.get(record.id);
			if (previous && (previous.ownerRunId !== record.ownerRunId || previous.kind !== record.kind || previous.complete !== record.complete || !sameUsage(previous.usage, record.usage))) throw new Error(`Conflicting child usage record '${record.id}'.`);
			records.set(record.id, record);
		}
	}
	const total = emptyUsage();
	const unknownRecordIds: string[] = [];
	for (const record of records.values()) {
		if (record.usage) addUsage(total, record.usage);
		if (!record.complete) unknownRecordIds.push(record.id);
	}
	return { version: 1, records: [...records.values()], total, complete: unknownRecordIds.length === 0, unknownRecordIds };
}
