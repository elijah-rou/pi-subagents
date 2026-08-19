import { THINKING_LEVELS } from "../shared/model-info.ts";
import type { ChildRoutingMetadata } from "../shared/types.ts";

export interface RoleResultContractMetadata { id: string; version: 1; source: "role" }

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const CONTRACT_IDS = new Set([
	"pi-subagents/generic",
	"pi-subagents/scout",
	"pi-subagents/worker",
	"pi-subagents/reviewer",
	"pi-subagents/researcher",
	"pi-subagents/advisor",
]);
const CONTROL = /[\u0000-\u001f\u007f]/u;

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label} has unknown field '${key}'.`);
}

export function validateChildRoutingMetadata(value: unknown, label: string): ChildRoutingMetadata {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
	const record = value as Record<string, unknown>;
	exactKeys(record, ["profile", "confidence", "source", "model", "thinking", "serviceTier"], label);
	if (typeof record.profile !== "string" || !PROFILE_NAME.test(record.profile)) throw new Error(`${label}.profile is invalid.`);
	if (!Number.isSafeInteger(record.confidence) || (record.confidence as number) < 0 || (record.confidence as number) > 100) throw new Error(`${label}.confidence must be an integer from 0 to 100.`);
	if (record.source !== "child-router") throw new Error(`${label}.source must be 'child-router'.`);
	if (typeof record.model !== "string" || !record.model.trim() || record.model.length > 256 || CONTROL.test(record.model)) throw new Error(`${label}.model must be a non-empty control-free string up to 256 characters.`);
	if (record.thinking !== undefined && (typeof record.thinking !== "string" || !(THINKING_LEVELS as readonly string[]).includes(record.thinking))) throw new Error(`${label}.thinking is unsupported.`);
	if (record.serviceTier !== undefined && record.serviceTier !== "default" && record.serviceTier !== "priority") throw new Error(`${label}.serviceTier must be 'default' or 'priority'.`);
	if (record.serviceTier !== undefined && !record.model.trim().startsWith("openai-codex/")) throw new Error(`${label}.serviceTier requires an openai-codex routed model.`);
	return { profile: record.profile, confidence: record.confidence as number, source: "child-router", model: record.model.trim(), ...(record.thinking === undefined ? {} : { thinking: record.thinking as string }), ...(record.serviceTier === undefined ? {} : { serviceTier: record.serviceTier }) };
}

export function validateRoleResultContractMetadata(value: unknown, label: string): RoleResultContractMetadata {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
	const record = value as Record<string, unknown>;
	exactKeys(record, ["id", "version", "source"], label);
	if (typeof record.id !== "string" || !CONTRACT_IDS.has(record.id)) throw new Error(`${label}.id is unsupported.`);
	if (record.version !== 1) throw new Error(`${label}.version must be 1.`);
	if (record.source !== "role") throw new Error(`${label}.source must be 'role'.`);
	return { id: record.id, version: 1, source: "role" };
}
