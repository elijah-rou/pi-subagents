import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Key } from "@earendil-works/pi-tui";
import { FLEET_KEYBINDING_ACTIONS, type ArtifactDirPreference, type ExtensionConfig } from "../shared/types.ts";
import { validateAuthorityPolicy } from "../policy/authority.ts";
import { getAgentDir } from "../shared/utils.ts";
import { DEFAULT_MODEL_EXCLUSION_TTL_MS, MAX_MODEL_EXCLUSION_TTL_MS, setDefaultTTL } from "../runs/shared/model-exclusions.ts";
import { validatePermissionConfig } from "../runs/shared/permissions.ts";
import { MAX_ABANDONED_SLOT_RELEASE_AFTER_MS, MIN_ABANDONED_SLOT_RELEASE_AFTER_MS } from "../runs/background/active-async-capacity.ts";

const ARTIFACT_DIR_PREFERENCES = new Set<ArtifactDirPreference>(["project", "session", "temp"]);
const FLEET_KEYBINDING_ACTION_SET = new Set<string>(FLEET_KEYBINDING_ACTIONS);
const KEY_MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);
const BASE_KEY_IDS = new Set([
	..."abcdefghijklmnopqrstuvwxyz0123456789",
	...Object.values(Key).flatMap((value) => typeof value === "string" ? [value.toLowerCase()] : []),
]);

class PrunedForkConfigError extends Error {}

function validateForkContextConfig(value: unknown): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config.forkContext must be a JSON object");
	const config = value as Record<string, unknown>;
	if (config.mode !== undefined && config.mode !== "full" && config.mode !== "pruned") {
		throw new Error('config.forkContext.mode must be "full" or "pruned"');
	}
	if (config.model !== undefined && (typeof config.model !== "string" || !config.model.trim())) {
		throw new PrunedForkConfigError("config.forkContext.model must be a non-empty string");
	}
	if (config.mode === "pruned" && config.model === undefined) {
		throw new PrunedForkConfigError('config.forkContext.model is required when config.forkContext.mode is "pruned"');
	}
}

function isValidKeyId(value: string): boolean {
	if (value !== value.trim()) return false;
	const parts = value.toLowerCase().split("+");
	const base = parts.pop();
	if (!base || !BASE_KEY_IDS.has(base)) return false;
	return parts.length <= KEY_MODIFIERS.size
		&& new Set(parts).size === parts.length
		&& parts.every((modifier) => KEY_MODIFIERS.has(modifier));
}

export function resolveScheduledStoreRoot(value: string): string {
	const expanded = value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
	if (!path.isAbsolute(expanded)) throw new Error(`config.scheduledRuns.storeRoot must be an absolute path or "~/...", got ${JSON.stringify(value)}`);
	return path.normalize(expanded);
}

function validateScheduledRunsConfig(value: unknown): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config.scheduledRuns must be a JSON object");
	const record = value as Record<string, unknown>;
	const unsupported = Object.keys(record).find((key) => key !== "enabled" && key !== "maxPending" && key !== "storeRoot");
	if (unsupported) throw new Error(`config.scheduledRuns.${unsupported} is not supported during the Package 2b compatibility horizon`);
	const storeRoot = record.storeRoot;
	if (storeRoot === undefined) return;
	if (typeof storeRoot !== "string" || !storeRoot.trim()) throw new Error("config.scheduledRuns.storeRoot must be a non-empty string");
	resolveScheduledStoreRoot(storeRoot);
}

function validateFleetKeybindingsConfig(value: unknown): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config.fleetKeybindings must be a JSON object");
	for (const [action, bindings] of Object.entries(value)) {
		if (!FLEET_KEYBINDING_ACTION_SET.has(action)) throw new Error(`config.fleetKeybindings.${action} is not a supported Fleet action`);
		if (!Array.isArray(bindings) || bindings.length === 0) throw new Error(`config.fleetKeybindings.${action} must be a non-empty array of strings`);
		for (const binding of bindings) {
			if (typeof binding !== "string" || !binding.trim()) throw new Error(`config.fleetKeybindings.${action} entries must be non-empty strings`);
		}
	}
}

function validateArtifactConfig(value: unknown): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config.artifactConfig must be a JSON object");
	const cleanupDays = (value as Record<string, unknown>).cleanupDays;
	if (cleanupDays !== undefined && (typeof cleanupDays !== "number" || !Number.isInteger(cleanupDays) || cleanupDays < 0)) {
		throw new Error("config.artifactConfig.cleanupDays must be a non-negative integer");
	}
}

function validateCapacityConfig(value: unknown): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config.capacity must be a JSON object");
	const abandonedSlotReleaseAfterMs = (value as Record<string, unknown>).abandonedSlotReleaseAfterMs;
	if (abandonedSlotReleaseAfterMs !== undefined
		&& abandonedSlotReleaseAfterMs !== false
		&& (typeof abandonedSlotReleaseAfterMs !== "number"
			|| !Number.isInteger(abandonedSlotReleaseAfterMs)
			|| abandonedSlotReleaseAfterMs < MIN_ABANDONED_SLOT_RELEASE_AFTER_MS
			|| abandonedSlotReleaseAfterMs > MAX_ABANDONED_SLOT_RELEASE_AFTER_MS)) {
		throw new Error(`config.capacity.abandonedSlotReleaseAfterMs must be false or an integer from ${MIN_ABANDONED_SLOT_RELEASE_AFTER_MS} to ${MAX_ABANDONED_SLOT_RELEASE_AFTER_MS}`);
	}
}

/** Validate the user-controlled TTL policy before it reaches the exclusion store. */
// TEST:test/unit/pi-coding-agent-dir.test.ts[loads and applies model exclusion TTL config]
function validateModelExclusionsConfig(value: unknown): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config.modelExclusions must be a JSON object");
	const defaultTtlMs = (value as Record<string, unknown>).defaultTtlMs;
	if (defaultTtlMs !== undefined && (typeof defaultTtlMs !== "number" || !Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0 || defaultTtlMs > MAX_MODEL_EXCLUSION_TTL_MS)) {
		throw new Error(`config.modelExclusions.defaultTtlMs must be a finite positive number no greater than ${MAX_MODEL_EXCLUSION_TTL_MS}`);
	}
}

function validateMainWindowRendererConfig(value: unknown): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config.mainWindowRenderer must be a JSON object");
	const rendererConfig = value as Record<string, unknown>;
	if (rendererConfig.horizontalSpacing !== undefined
		&& (typeof rendererConfig.horizontalSpacing !== "number"
			|| !Number.isInteger(rendererConfig.horizontalSpacing)
			|| rendererConfig.horizontalSpacing < 0
			|| rendererConfig.horizontalSpacing > 4)) {
		throw new Error("config.mainWindowRenderer.horizontalSpacing must be an integer from 0 to 4");
	}
	if (rendererConfig.compactResultMaxLines !== undefined
		&& (typeof rendererConfig.compactResultMaxLines !== "number"
			|| !Number.isInteger(rendererConfig.compactResultMaxLines)
			|| rendererConfig.compactResultMaxLines < 1)) {
		throw new Error("config.mainWindowRenderer.compactResultMaxLines must be a positive integer");
	}
}

const RETIRED_CONFIG_KEYS = ["missions", "orcaProgressTabs", "parallel"] as const;

function validatePositiveInteger(value: unknown, label: string, minimum = 1): void {
	if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < minimum)) {
		throw new Error(`${label} must be an integer >= ${minimum}`);
	}
}

function normalizeConfigAliases(config: Record<string, unknown>): ExtensionConfig {
	const retired: string[] = RETIRED_CONFIG_KEYS.filter((key) => config[key] !== undefined);
	const fleetInspect = (config.fleetKeybindings as Record<string, unknown> | undefined)?.inspect;
	if (fleetInspect !== undefined) retired.push("fleetKeybindings.inspect");
	if (retired.length > 0) {
		throw new Error(`Retired subagent config ${retired.slice(0, 8).join(", ")} is no longer supported. Remove ${retired.length === 1 ? "this key" : "these keys"}; use workflowScript, Fleet status, and current lifecycle artifacts instead.`);
	}

	const legacyConcurrency = config.globalConcurrencyLimit;
	const canonicalConcurrency = config.perRunConcurrencyLimit;
	if (legacyConcurrency !== undefined && canonicalConcurrency !== undefined && legacyConcurrency !== canonicalConcurrency) {
		throw new Error("config.globalConcurrencyLimit conflicts with config.perRunConcurrencyLimit; keep only perRunConcurrencyLimit");
	}
	const chain = config.chain;
	if (chain !== undefined && (!chain || typeof chain !== "object" || Array.isArray(chain))) {
		throw new Error("config.chain is supported only as the legacy chain.dynamicFanout.maxItems alias");
	}
	const chainRecord = chain as Record<string, unknown> | undefined;
	if (chainRecord && (Object.keys(chainRecord).some((key) => key !== "dynamicFanout") || !chainRecord.dynamicFanout || typeof chainRecord.dynamicFanout !== "object" || Array.isArray(chainRecord.dynamicFanout))) {
		throw new Error("config.chain is supported only as the legacy chain.dynamicFanout.maxItems alias");
	}
	const dynamicFanout = chainRecord?.dynamicFanout as Record<string, unknown> | undefined;
	if (dynamicFanout && (Object.keys(dynamicFanout).some((key) => key !== "maxItems") || dynamicFanout.maxItems === undefined)) {
		throw new Error("config.chain is supported only as the legacy chain.dynamicFanout.maxItems alias");
	}
	const legacyFanout = dynamicFanout?.maxItems;
	const canonicalFanout = config.workflowDynamicFanoutMaxItems;
	if (legacyFanout !== undefined && canonicalFanout !== undefined && legacyFanout !== canonicalFanout) {
		throw new Error("config.chain.dynamicFanout.maxItems conflicts with config.workflowDynamicFanoutMaxItems; keep only workflowDynamicFanoutMaxItems");
	}
	if (legacyConcurrency !== undefined || legacyFanout !== undefined) {
		console.warn("Subagent config migration: replace globalConcurrencyLimit with perRunConcurrencyLimit and chain.dynamicFanout.maxItems with workflowDynamicFanoutMaxItems; compatibility aliases expire after one published release.");
	}

	const { globalConcurrencyLimit: _legacyConcurrency, chain: _legacyChain, ...canonical } = config;
	return {
		...canonical,
		...(canonicalConcurrency === undefined && legacyConcurrency !== undefined ? { perRunConcurrencyLimit: legacyConcurrency as number } : {}),
		...(canonicalFanout === undefined && legacyFanout !== undefined ? { workflowDynamicFanoutMaxItems: legacyFanout as number } : {}),
	} as ExtensionConfig;
}

function validateConfig(input: Record<string, unknown>): ExtensionConfig {
	const normalized = normalizeConfigAliases(input);
	const config = normalized as Record<string, unknown>;
	if (config.defaultSubagentContext !== undefined && config.defaultSubagentContext !== "fresh" && config.defaultSubagentContext !== "fork") {
		throw new Error('config.defaultSubagentContext must be "fresh" or "fork"');
	}
	validateForkContextConfig(config.forkContext);
	if (config.foregroundDetachShortcut !== undefined
		&& (typeof config.foregroundDetachShortcut !== "string" || !isValidKeyId(config.foregroundDetachShortcut))) {
		throw new Error("config.foregroundDetachShortcut must be a valid keybinding string such as \"ctrl+b\"");
	}
	if (config.artifactDir !== undefined && !ARTIFACT_DIR_PREFERENCES.has(config.artifactDir as ArtifactDirPreference)) {
		throw new Error(`config.artifactDir must be "project", "session", or "temp"`);
	}
	if (config.maxActiveAsyncRunsPerSession !== undefined
		&& (typeof config.maxActiveAsyncRunsPerSession !== "number"
			|| !Number.isInteger(config.maxActiveAsyncRunsPerSession)
			|| config.maxActiveAsyncRunsPerSession < 0)) {
		throw new Error("config.maxActiveAsyncRunsPerSession must be a non-negative integer");
	}
	validatePositiveInteger(config.perRunConcurrencyLimit, "config.perRunConcurrencyLimit");
	validatePositiveInteger(config.workflowDynamicFanoutMaxItems, "config.workflowDynamicFanoutMaxItems", 0);
	if (config.resultScanLogging !== undefined && config.resultScanLogging !== "all" && config.resultScanLogging !== "activity" && config.resultScanLogging !== "off") {
		throw new Error('config.resultScanLogging must be "all", "activity", or "off"');
	}
	validateAuthorityPolicy(config.authorityPolicy);
	validatePermissionConfig(config.permissions);
	validateScheduledRunsConfig(config.scheduledRuns);
	validateFleetKeybindingsConfig(config.fleetKeybindings);
	validateArtifactConfig(config.artifactConfig);
	validateCapacityConfig(config.capacity);
	validateModelExclusionsConfig(config.modelExclusions);
	validateMainWindowRendererConfig(config.mainWindowRenderer);
	return normalized;
}

export function getConfigPath(): string {
	return path.join(getAgentDir(), "extensions", "subagent", "config.json");
}

function readConfigForUpdate(configPath = getConfigPath()): ExtensionConfig {
	if (!fs.existsSync(configPath)) return {};
	const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Subagent config at '${configPath}' must be a JSON object`);
	}
	return validateConfig(parsed as Record<string, unknown>);
}

export function saveConfig(config: ExtensionConfig, configPath = getConfigPath()): void {
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`, "utf-8");
}

export function updateConfig(updater: (config: ExtensionConfig) => ExtensionConfig): ExtensionConfig {
	const configPath = getConfigPath();
	const next = updater(readConfigForUpdate(configPath));
	const canonical = validateConfig(next as Record<string, unknown>);
	saveConfig(canonical, configPath);
	return canonical;
}

/**
 * Resolve the default TTL that the process-wide exclusion store should use.
 *
 * @param config Extension configuration after validation.
 * @returns The configured TTL in milliseconds, or the built-in 24-hour default.
 */
// TEST:test/unit/pi-coding-agent-dir.test.ts[loads and applies model exclusion TTL config]
export function resolveModelExclusionTTL(config: Pick<ExtensionConfig, "modelExclusions">): number {
	return config.modelExclusions?.defaultTtlMs ?? DEFAULT_MODEL_EXCLUSION_TTL_MS;
}

/**
 * Apply the configured exclusion policy to the process-wide model store.
 *
 * @param config Extension configuration after validation.
 * @returns Nothing.
 */
// TEST:test/unit/pi-coding-agent-dir.test.ts[loads and applies model exclusion TTL config]
export function applyModelExclusionsConfig(config: Pick<ExtensionConfig, "modelExclusions">): void {
	setDefaultTTL(resolveModelExclusionTTL(config), { shortenExisting: config.modelExclusions?.defaultTtlMs !== undefined });
}

export function resolveAsyncByDefault(config: Pick<ExtensionConfig, "asyncByDefault">): boolean {
	return config.asyncByDefault !== false;
}

export function loadConfig(): ExtensionConfig {
	const configPath = getConfigPath();
	try {
		return readConfigForUpdate(configPath);
	} catch (error) {
		if (error instanceof PrunedForkConfigError) throw error;
		console.error(`Failed to load subagent config from '${configPath}':`, error);
	}
	return {};
}
