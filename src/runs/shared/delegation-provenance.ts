export const DELEGATION_REASONS = [
	"user_async",
	"independent_parallel_lane",
	"manager_continuity",
	"unresolved_ownership",
	"semantic_review",
	"elevated_risk_review",
] as const;

export type DelegationReason = typeof DELEGATION_REASONS[number];
export type DelegationBasis =
	| { ownership: string[]; deliverable: string }
	| { inspected: string[]; unresolved: string };

const REASONS = new Set<string>(DELEGATION_REASONS);
const MAX_ITEMS = 32;
const MAX_TEXT = 1024;

function boundedText(value: unknown, label: string): string | undefined {
	if (typeof value !== "string" || !value.trim()) return `${label} must be a non-empty string.`;
	if (value.length > MAX_TEXT) return `${label} exceeds ${MAX_TEXT} characters.`;
	return undefined;
}

function boundedList(value: unknown, label: string): string | undefined {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) return `${label} must contain 1-${MAX_ITEMS} strings.`;
	for (const [index, item] of value.entries()) {
		const error = boundedText(item, `${label}[${index}]`);
		if (error) return error;
	}
	return undefined;
}

export function validateDelegationProvenance(reason: unknown, basis: unknown): string | undefined {
	if (typeof reason !== "string" || !REASONS.has(reason)) return `delegationReason is required and must be one of: ${DELEGATION_REASONS.join(", ")}.`;
	if (reason === "independent_parallel_lane") {
		if (!basis || typeof basis !== "object" || Array.isArray(basis)) return "delegationBasis is required for independent_parallel_lane.";
		const record = basis as Record<string, unknown>;
		return boundedList(record.ownership, "delegationBasis.ownership") ?? boundedText(record.deliverable, "delegationBasis.deliverable");
	}
	if (reason === "unresolved_ownership") {
		if (!basis || typeof basis !== "object" || Array.isArray(basis)) return "delegationBasis is required for unresolved_ownership.";
		const record = basis as Record<string, unknown>;
		return boundedList(record.inspected, "delegationBasis.inspected") ?? boundedText(record.unresolved, "delegationBasis.unresolved");
	}
	if (basis !== undefined) return `delegationBasis is only valid for independent_parallel_lane or unresolved_ownership.`;
	return undefined;
}
