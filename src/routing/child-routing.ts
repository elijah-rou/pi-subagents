import { Agent, type StreamFn, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { convertToLlm, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { agentStreamOptions } from "../shared/agent-stream-options.ts";
import { resolveModelCandidate } from "../runs/shared/model-fallback.ts";
import { THINKING_LEVELS, toModelInfo } from "../shared/model-info.ts";

export interface ChildRoutingProfile { description: string; model: string; thinking?: ThinkingLevel }
export interface ChildRoutingClassifierConfig {
	model: string;
	thinking: ThinkingLevel;
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
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function exactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
	for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new Error(`${label} has unsupported field '${key}'.`);
}
function text(value: unknown, label: string, max: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string up to ${max} characters.`);
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
	exactKeys(value.classifier, ["model", "thinking", "timeoutMs"], `${label}.classifier`);
	const timeoutMs = value.classifier.timeoutMs ?? 5_000;
	if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 250 || Number(timeoutMs) > 30_000) throw new Error(`${label}.classifier.timeoutMs must be an integer from 250 to 30000.`);
	if (!isRecord(value.profiles)) throw new Error(`${label}.profiles must be an object.`);
	const entries = Object.entries(value.profiles);
	if (entries.length < 1 || entries.length > MAX_PROFILES) throw new Error(`${label}.profiles must contain 1 to ${MAX_PROFILES} profiles.`);
	const profiles: Record<string, ChildRoutingProfile> = {};
	for (const [name, raw] of entries) {
		if (!PROFILE_NAME.test(name)) throw new Error(`${label}.profiles has invalid name '${name}'.`);
		if (!isRecord(raw)) throw new Error(`${label}.profiles.${name} must be an object.`);
		exactKeys(raw, ["description", "model", "thinking"], `${label}.profiles.${name}`);
		profiles[name] = { description: text(raw.description, `${label}.profiles.${name}.description`, 240), model: text(raw.model, `${label}.profiles.${name}.model`, 256), ...(raw.thinking === undefined ? {} : { thinking: thinking(raw.thinking, `${label}.profiles.${name}.thinking`) }) };
	}
	return { enabled: value.enabled !== false, threshold: Number(threshold), classifier: { model: text(value.classifier.model, `${label}.classifier.model`, 256), thinking: thinking(value.classifier.thinking ?? "off", `${label}.classifier.thinking`), timeoutMs: Number(timeoutMs) }, profiles };
}

export function buildChildRoutingSystemPrompt(config: ChildRoutingConfig): string {
	return [
		"Select the lowest-cost child intelligence profile sufficient for the delegated task.",
		"The selection controls only child model and reasoning effort. Never change role, tools, permissions, context, worktree, acceptance, or topology.",
		"Return JSON only with exactly two fields: profile and confidence.",
		`profile must be one of: ${Object.keys(config.profiles).join(", ")}`,
		"confidence must be an integer from 0 to 100.",
		"Profiles:",
		...Object.entries(config.profiles).map(([name, profile]) => `${name}: ${profile.description}`),
	].join("\n");
}

export function buildChildRoutingInput(request: ChildRoutingRequest): string {
	const compact = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
	return JSON.stringify({ agent: compact(request.agent, 128), task: compact(request.task, 12_000), cwd: compact(request.cwd, 240), parallel: request.parallel, context: request.context ?? null, parentModel: request.parentModel ? `${request.parentModel.provider}/${request.parentModel.id}` : null });
}

export function parseChildRoutingSuggestion(value: string, profiles: Record<string, ChildRoutingProfile>): { profile: string; confidence: number } | null {
	try {
		const parsed = JSON.parse(value.trim()) as unknown;
		if (!isRecord(parsed) || Object.keys(parsed).sort().join(",") !== "confidence,profile") return null;
		if (typeof parsed.profile !== "string" || profiles[parsed.profile] === undefined) return null;
		if (!Number.isSafeInteger(parsed.confidence) || Number(parsed.confidence) < 0 || Number(parsed.confidence) > 100) return null;
		return { profile: parsed.profile, confidence: Number(parsed.confidence) };
	} catch { return null; }
}

function assistantText(agent: Agent): string {
	for (let index = agent.state.messages.length - 1; index >= 0; index--) {
		const message = agent.state.messages[index] as { role?: string; content?: Array<{ type?: string; text?: string }> } | undefined;
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		return message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
	}
	return "";
}

export async function classifyChildProfile(ctx: ExtensionContext, config: ChildRoutingConfig, request: ChildRoutingRequest, signal?: AbortSignal): Promise<ChildRoutingSelection | null> {
	if (!config.enabled) return null;
	const available = ctx.modelRegistry.getAvailable().map(toModelInfo);
	const resolvedClassifier = resolveModelCandidate(config.classifier.model, available, ctx.model?.provider);
	if (!resolvedClassifier) throw new Error(`Child routing classifier model '${config.classifier.model}' is unavailable.`);
	const slash = resolvedClassifier.indexOf("/");
	const model = slash > 0 ? ctx.modelRegistry.find(resolvedClassifier.slice(0, slash), resolvedClassifier.slice(slash + 1).split(":")[0]!) : undefined;
	if (!model) throw new Error(`Child routing classifier model '${resolvedClassifier}' is unavailable.`);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(`Child routing classifier auth failed: ${auth.error}`);
	const registered = (ctx.modelRegistry as { getRegisteredProviderConfig?: (provider: string) => { api?: string; streamSimple?: StreamFn } | undefined }).getRegisteredProviderConfig?.(model.provider);
	const base = registered?.streamSimple && registered.api === model.api ? registered.streamSimple : streamSimple;
	const streamFn: StreamFn = (selected, context, options) => base(selected, context, { ...options, ...(auth.apiKey ? { apiKey: auth.apiKey } : {}), env: auth.env || options?.env ? { ...(auth.env ?? {}), ...(options?.env ?? {}) } : undefined, headers: { ...(options?.headers ?? {}), ...(auth.headers ?? {}) } });
	const agent = new Agent({ initialState: { systemPrompt: buildChildRoutingSystemPrompt(config), model, thinkingLevel: config.classifier.thinking, tools: [] }, convertToLlm, ...agentStreamOptions(streamFn), getApiKey: async () => auth.apiKey, toolExecution: "sequential" });
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal?.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(() => controller.abort(), config.classifier.timeoutMs); timer.unref?.();
	controller.signal.addEventListener("abort", () => agent.abort(), { once: true });
	try { await agent.prompt(buildChildRoutingInput(request)); }
	finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
	const suggestion = parseChildRoutingSuggestion(assistantText(agent), config.profiles);
	if (!suggestion || suggestion.confidence < config.threshold) return null;
	const profile = config.profiles[suggestion.profile]!;
	if (!resolveModelCandidate(profile.model, available, ctx.model?.provider)) return null;
	return { ...profile, profile: suggestion.profile, confidence: suggestion.confidence, source: "child-router" };
}
