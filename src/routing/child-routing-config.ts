import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { splitKnownThinkingSuffix, THINKING_LEVELS } from "../shared/model-info.ts";

export type ChildServiceTier = "default" | "priority";
export interface ChildRoutingProfile { description: string; model: string; thinking?: ThinkingLevel; serviceTier?: ChildServiceTier }
export interface ChildRoutingClassifierConfig {
	model: string;
	thinking: ThinkingLevel;
	reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary: "auto" | "concise" | "detailed" | null;
	textVerbosity: "low" | "medium" | "high";
	serviceTier?: "auto" | "default" | "priority";
	timeoutMs: number;
}
export interface ChildRoutingConfig {
	enabled: boolean;
	threshold: number;
	classifier: ChildRoutingClassifierConfig;
	profiles: Record<string, ChildRoutingProfile>;
}
export interface ChildRoutingRequest {
	agent: string;
	task: string;
	cwd: string;
	parallel: boolean;
	context?: "fresh" | "fork";
	parentModel?: { provider: string; id: string };
}
export interface ChildRoutingSelection extends ChildRoutingProfile { profile: string; confidence: number; source: "child-router" }

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_PROFILES = 16;
const REASONING_EFFORTS = new Set<unknown>(["none", "minimal", "low", "medium", "high", "xhigh"]);
const REASONING_SUMMARIES = new Set<unknown>([null, "auto", "concise", "detailed"]);
const TEXT_VERBOSITIES = new Set<unknown>(["low", "medium", "high"]);
const CLASSIFIER_SERVICE_TIERS = new Set<unknown>(["auto", "default", "priority"]);
const CHILD_SERVICE_TIERS = new Set<unknown>(["default", "priority"]);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function exactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
	for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new Error(`${label} has unsupported field '${key}'.`);
}
function text(value: unknown, label: string, max: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label} must be a non-empty control-free string up to ${max} characters.`);
	return value.trim();
}
function thinking(value: unknown, label: string): ThinkingLevel {
	if (typeof value !== "string" || !(THINKING_LEVELS as readonly string[]).includes(value)) throw new Error(`${label} must be one of ${THINKING_LEVELS.join(", ")}.`);
	return value as ThinkingLevel;
}

export function parseChildRoutingConfig(value: unknown, label = "subagents.childRouting"): ChildRoutingConfig | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error(`${label} must be an object.`);
	exactKeys(value, ["enabled", "threshold", "classifier", "profiles"], label);
	if (value.enabled !== undefined && typeof value.enabled !== "boolean") throw new Error(`${label}.enabled must be a boolean.`);
	const threshold = value.threshold ?? 75;
	if (!Number.isSafeInteger(threshold) || Number(threshold) < 0 || Number(threshold) > 100) throw new Error(`${label}.threshold must be an integer from 0 to 100.`);
	if (!isRecord(value.classifier)) throw new Error(`${label}.classifier must be an object.`);
	exactKeys(value.classifier, ["provider", "model", "thinking", "reasoningEffort", "reasoningSummary", "textVerbosity", "serviceTier", "timeoutMs"], `${label}.classifier`);
	const timeoutMs = value.classifier.timeoutMs ?? 5_000;
	if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 250 || Number(timeoutMs) > 30_000) throw new Error(`${label}.classifier.timeoutMs must be an integer from 250 to 30000.`);
	if (!isRecord(value.profiles)) throw new Error(`${label}.profiles must be an object.`);
	const entries = Object.entries(value.profiles);
	if (entries.length < 1 || entries.length > MAX_PROFILES) throw new Error(`${label}.profiles must contain 1 to ${MAX_PROFILES} profiles.`);
	const profiles: Record<string, ChildRoutingProfile> = {};
	for (const [name, raw] of entries) {
		if (!PROFILE_NAME.test(name)) throw new Error(`${label}.profiles has invalid name '${name}'.`);
		if (!isRecord(raw)) throw new Error(`${label}.profiles.${name} must be an object.`);
		exactKeys(raw, ["description", "model", "thinking", "serviceTier"], `${label}.profiles.${name}`);
		const model = text(raw.model, `${label}.profiles.${name}.model`, 256);
		const profileThinking = raw.thinking === undefined ? undefined : thinking(raw.thinking, `${label}.profiles.${name}.thinking`);
		if (profileThinking !== undefined && splitKnownThinkingSuffix(model).thinkingSuffix) throw new Error(`${label}.profiles.${name}.model must not include a thinking suffix when profile.thinking is set.`);
		if (raw.serviceTier !== undefined && !CHILD_SERVICE_TIERS.has(raw.serviceTier)) throw new Error(`${label}.profiles.${name}.serviceTier must be 'default' or 'priority'.`);
		profiles[name] = { description: text(raw.description, `${label}.profiles.${name}.description`, 240), model, ...(profileThinking === undefined ? {} : { thinking: profileThinking }), ...(raw.serviceTier === undefined ? {} : { serviceTier: raw.serviceTier as ChildServiceTier }) };
	}
	const provider = value.classifier.provider === undefined ? undefined : text(value.classifier.provider, `${label}.classifier.provider`, 128);
	const rawClassifierModel = text(value.classifier.model, `${label}.classifier.model`, 256);
	if (provider && rawClassifierModel.includes("/") && !rawClassifierModel.startsWith(`${provider}/`)) throw new Error(`${label}.classifier.provider conflicts with classifier.model.`);
	const classifierModel = provider && !rawClassifierModel.includes("/") ? `${provider}/${rawClassifierModel}` : rawClassifierModel;
	const legacyEffort = value.classifier.thinking === "off" ? "none" : value.classifier.thinking;
	if (value.classifier.reasoningEffort !== undefined && legacyEffort !== undefined && value.classifier.reasoningEffort !== legacyEffort) throw new Error(`${label}.classifier.thinking conflicts with reasoningEffort.`);
	const reasoningEffort = value.classifier.reasoningEffort ?? legacyEffort ?? "none";
	if (!REASONING_EFFORTS.has(reasoningEffort)) throw new Error(`${label}.classifier.reasoningEffort is unsupported.`);
	const reasoningSummary = value.classifier.reasoningSummary === undefined ? "auto" : value.classifier.reasoningSummary;
	if (!REASONING_SUMMARIES.has(reasoningSummary)) throw new Error(`${label}.classifier.reasoningSummary is unsupported.`);
	const textVerbosity = value.classifier.textVerbosity ?? "low";
	if (!TEXT_VERBOSITIES.has(textVerbosity)) throw new Error(`${label}.classifier.textVerbosity is unsupported.`);
	const serviceTier = value.classifier.serviceTier;
	if (serviceTier !== undefined && !CLASSIFIER_SERVICE_TIERS.has(serviceTier)) throw new Error(`${label}.classifier.serviceTier is unsupported.`);
	const classifierThinking = reasoningEffort === "none" ? "off" : thinking(reasoningEffort, `${label}.classifier.reasoningEffort`);
	return { enabled: value.enabled !== false, threshold: Number(threshold), classifier: { model: classifierModel, thinking: classifierThinking, reasoningEffort: reasoningEffort as ChildRoutingClassifierConfig["reasoningEffort"], reasoningSummary: reasoningSummary as ChildRoutingClassifierConfig["reasoningSummary"], textVerbosity: textVerbosity as ChildRoutingClassifierConfig["textVerbosity"], ...(serviceTier ? { serviceTier: serviceTier as ChildRoutingClassifierConfig["serviceTier"] } : {}), timeoutMs: Number(timeoutMs) }, profiles };
}
