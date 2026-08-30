import type { ChildProfileProvenance } from "../../shared/types.ts";

function boundedText(value: unknown, field: string, maxLength: number, label: string): string {
	if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label}.${field} must be a non-empty string no longer than ${maxLength} characters.`);
	return value.trim();
}

export function parseChildProfileProvenance(value: unknown, label = "childProfile"): ChildProfileProvenance {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (key !== "profile" && key !== "source" && key !== "confidence") throw new Error(`${label} does not support field '${key}'.`);
	}
	if (!Number.isSafeInteger(record.confidence) || (record.confidence as number) < 0 || (record.confidence as number) > 100) throw new Error(`${label}.confidence must be an integer from 0 to 100.`);
	return {
		profile: boundedText(record.profile, "profile", 64, label),
		source: boundedText(record.source, "source", 256, label),
		confidence: record.confidence as number,
	};
}
