/**
 * Agent discovery and configuration
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { parse as parseYaml } from "yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AcceptanceInput, AcceptanceRole, AgentRunnerConfig, OutputMode, ToolBudgetConfig } from "../shared/types.ts";
import type { AgentConfig, AgentDefaultContext, AgentDiscoveryDiagnostic, AgentMemoryConfig, AgentModelSourceInfo, BuiltinAgentOverrideBase, ChainConfig, ChainDiscoveryDiagnostic, ChainStepConfig, SystemPromptMode } from "./agent-contract.ts";
import type { AgentDefinitionDirectoryReport, AgentDefinitionDirectoryState, AgentScope, AgentSource, UnknownAgentDiagnosticContext } from "../shared/core-contracts.ts";
import { CODE_OWNED_EXTERNAL_CLI_ADAPTER_LABEL, isCodeOwnedExternalCliAdapterId, parseExternalCliCapabilityNarrowing, validateCodeOwnedProfileRunner } from "../runs/shared/external-cli-contract.ts";
import { getAgentDir, getProjectConfigDir } from "../shared/config-paths.ts";
import { KNOWN_FIELDS } from "./agent-serializer.ts";
import { parseChain, parseJsonChain } from "./chain-serializer.ts";
import { mergeAgentsForScope } from "./agent-selection.ts";
import { parseFrontmatter, parseFrontmatterList } from "./frontmatter.ts";
import { buildRuntimeName, parsePackageName } from "./identity.ts";
import { parseModelScopeConfig, type ModelScopeConfig } from "../runs/shared/model-scope.ts";
export { BUILTIN_AGENT_NAMES } from "./builtin-names.ts";
export { buildRuntimeName, frontmatterNameForConfig, parsePackageName } from "./identity.ts";
import { parseMemoryFrontmatter } from "./agent-memory.ts";
import { validateAcceptanceInput } from "../runs/shared/acceptance.ts";
import { validatePermissionRules, type PermissionRules } from "../runs/shared/permissions.ts";
import { parseThinkingLevel, type ThinkingLevel } from "../shared/thinking-ceiling.ts";
import { assertNoSymlinkPathComponents } from "../shared/private-state.ts";
import { findProjectRootCandidates } from "./project-root.ts";

export function defaultSystemPromptMode(name: string): SystemPromptMode {
	return name === "delegate" ? "append" : "replace";
}

export function defaultInheritProjectContext(name: string): boolean {
	return name === "delegate";
}

export function defaultInheritSkills(): boolean {
	return false;
}

interface BuiltinAgentOverrideConfig {
	description?: string;
	output?: string | false;
	outputMode?: OutputMode;
	defaultReads?: string[] | false;
	model?: string | false;
	defaultProvider?: string | false;
	fallbackModels?: string[] | false;
	fast?: boolean;
	thinking?: string | false;
	systemPromptMode?: SystemPromptMode;
	inheritProjectContext?: boolean;
	inheritGlobalContext?: boolean;
	inheritSkills?: boolean;
	defaultContext?: AgentDefaultContext | false;
	acceptanceRole?: AcceptanceRole | false;
	disabled?: boolean;
	systemPrompt?: string;
	skills?: string[] | false;
	tools?: string[] | false | "inherit";
	allowNestedSubagents?: boolean;
	extensions?: string[] | false;
	subagentOnlyExtensions?: string[] | false;
	mutationTools?: string[] | false;
	completionGuard?: boolean;
	toolBudget?: ToolBudgetConfig | false;
}

type ProjectRootResolution = "nearest" | "git-root";

interface SubagentSettings {
	overrides: Record<string, BuiltinAgentOverrideConfig>;
	providerOverrides: Record<string, Record<string, BuiltinAgentOverrideConfig>>;
	defaultModel?: string;
	defaultProvider?: string;
	defaultThinking?: string;
	maxThinking?: ThinkingLevel;
	defaultExtensions?: string[];
	disableBuiltins?: boolean;
	disableThinking?: boolean;
	modelScope?: ModelScopeConfig;
}

const EMPTY_SUBAGENT_SETTINGS: SubagentSettings = { overrides: {}, providerOverrides: {} };
const agentFrontmatterFields = new WeakMap<AgentConfig, Set<string>>();

const AGENT_SOURCE_PRIORITY: Record<AgentSource, number> = {
	builtin: 0,
	package: 1,
	user: 2,
	project: 3,
	runtime: 4,
};

function agentDefinitionPriority(definition: Pick<AgentConfig | AgentDiscoveryDiagnostic, "source" | "discoveryPriority">): number {
	return AGENT_SOURCE_PRIORITY[definition.source] * 1_000_000
		+ (definition.discoveryPriority ?? 0);
}

export function findBlockingAgentDiagnostic(name: string, agent: AgentConfig | readonly AgentConfig[] | undefined, diagnostics: AgentDiscoveryDiagnostic[] | undefined): AgentDiscoveryDiagnostic | undefined {
	const normalizedName = name.trim();
	const agents = Array.isArray(agent) ? agent : agent ? [agent] : [];
	let match: AgentDiscoveryDiagnostic | undefined;
	for (const diagnostic of diagnostics ?? []) {
		if ((diagnostic.runtimeName === normalizedName
			|| (diagnostic.name === normalizedName && (!diagnostic.packageSpecified
				|| diagnostic.runtimeName === undefined
				|| agents.some((agent) => agent.name === diagnostic.runtimeName && agent.localName === diagnostic.name))))
			&& (!match || agentDefinitionPriority(diagnostic) > agentDefinitionPriority(match))) {
			match = diagnostic;
		}
	}
	const highestPriority = Math.max(...agents.map(agentDefinitionPriority), -Infinity);
	return !agents.length || (match && agentDefinitionPriority(match) > highestPriority) ? match : undefined;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	agentDiagnostics?: AgentDiscoveryDiagnostic[];
	projectAgentsDir: string | null;
	cwd: string;
	scope: AgentScope;
	directories: readonly AgentDefinitionDirectoryReport[];
	modelScope?: ModelScopeConfig;
	maxThinking?: ThinkingLevel;
}

/** Create formatter input from the exact discovery operation used for resolution. */
export function unknownAgentDiagnosticContext(discovered: Pick<AgentDiscoveryResult, "cwd" | "scope" | "directories" | "agents">): UnknownAgentDiagnosticContext {
	return {
		cwd: discovered.cwd,
		scope: discovered.scope,
		directories: discovered.directories,
		agents: discovered.agents,
	};
}

/** Render local discovery evidence without exposing filesystem error details. */
export function formatUnknownAgentError(name: string, context: UnknownAgentDiagnosticContext, prefix = "Unknown agent"): string {
	const directories = context.directories.map((directory) => {
		const state = directory.state === "candidates"
			? `${directory.candidateCount ?? 0} candidate${directory.candidateCount === 1 ? "" : "s"}`
			: directory.state === "empty" ? "present but empty"
				: directory.state === "not-directory" ? "not a directory"
					: directory.state;
		return `- ${directory.source}: ${directory.path} (${state})`;
	});
	const agents = [...context.agents]
		.sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source))
		.map((agent) => `- ${agent.name} (${agent.source})`);
	return [
		`${prefix}: ${name}`,
		`Effective cwd: ${path.resolve(context.cwd)}`,
		"Consulted agent-definition directories:",
		...(directories.length ? directories : ["- (none)"]),
		"Discovered agents:",
		...(agents.length ? agents : ["- (none)"]),
	].join("\n");
}

function getUserChainDir(): string {
	return path.join(getAgentDir(), "chains");
}

interface PackageSubagentPath {
	dir: string;
	packageName?: string;
	packageVersion?: string;
	packageRoot: string;
}

interface PackageSubagentPaths {
	agents: PackageSubagentPath[];
	chains: string[];
}

let cachedGlobalNpmRoot: string | null = null;

function readJsonFileBestEffort(filePath: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		// Installed package scans are opportunistic; bad third-party manifests
		// should not break local agent discovery.
		return null;
	}
}

function readOptionalJsonFile(filePath: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch (error) {
		const code = typeof error === "object" && error !== null && "code" in error
			? (error as { code?: unknown }).code
			: undefined;
		if (code === "ENOENT") return null;
		throw error;
	}
}

function isSafePackagePath(value: string): boolean {
	return value.length > 0
		&& !path.isAbsolute(value)
		&& value.split(/[\\/]/).every((part) => part.length > 0 && part !== "." && part !== "..");
}

function parseNpmPackageName(source: string): string | undefined {
	const spec = source.slice(4).trim();
	if (!spec) return undefined;
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
	const packageName = match?.[1] ?? spec;
	return isSafePackagePath(packageName) ? packageName : undefined;
}

function stripGitRef(repoPath: string): string {
	const atIndex = repoPath.indexOf("@");
	const hashIndex = repoPath.indexOf("#");
	const refIndex = [atIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
	return refIndex === undefined ? repoPath : repoPath.slice(0, refIndex);
}

function parseGitPackagePath(source: string): { host: string; repoPath: string } | undefined {
	const spec = source.slice(4).trim();
	if (!spec) return undefined;

	let host = "";
	let repoPath = "";
	const scpLike = spec.match(/^git@([^:]+):(.+)$/);
	if (scpLike) {
		host = scpLike[1] ?? "";
		repoPath = scpLike[2] ?? "";
	} else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(spec)) {
		try {
			const url = new URL(spec);
			host = url.hostname;
			repoPath = url.pathname.replace(/^\/+/, "");
		} catch {
			return undefined;
		}
	} else {
		const slashIndex = spec.indexOf("/");
		if (slashIndex < 0) return undefined;
		host = spec.slice(0, slashIndex);
		repoPath = spec.slice(slashIndex + 1);
	}

	const normalizedPath = stripGitRef(repoPath).replace(/\.git$/, "").replace(/^\/+/, "");
	if (!host || !isSafePackagePath(host) || !isSafePackagePath(normalizedPath) || normalizedPath.split(/[\\/]/).length < 2) {
		return undefined;
	}
	return { host, repoPath: normalizedPath };
}

function resolveSettingsPackageRoot(source: string, baseDir: string): string | undefined {
	const trimmed = source.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("git:")) {
		const parsed = parseGitPackagePath(trimmed);
		return parsed ? path.join(baseDir, "git", parsed.host, parsed.repoPath) : undefined;
	}
	if (trimmed.startsWith("npm:")) {
		const packageName = parseNpmPackageName(trimmed);
		return packageName ? path.join(baseDir, "npm", "node_modules", packageName) : undefined;
	}
	const normalized = trimmed.startsWith("file:") ? trimmed.slice(5) : trimmed;
	if (normalized === "~") return os.homedir();
	if (normalized.startsWith("~/")) return path.join(os.homedir(), normalized.slice(2));
	if (path.isAbsolute(normalized)) return normalized;
	if (normalized === "." || normalized === ".." || normalized.startsWith("./") || normalized.startsWith("../")) {
		return path.resolve(baseDir, normalized);
	}
	if (/^https?:\/\//i.test(trimmed)) {
		const parsed = parseGitPackagePath(`git:${trimmed}`);
		return parsed ? path.join(baseDir, "git", parsed.host, parsed.repoPath) : undefined;
	}
	return undefined;
}

function getGlobalNpmRoot(): string | null {
	const offline = process.env.PI_OFFLINE?.toLowerCase();
	if (offline === "1" || offline === "true" || offline === "yes") return null;
	if (cachedGlobalNpmRoot !== null) return cachedGlobalNpmRoot;

	const windowsGlobalRoot = process.platform === "win32" && process.env.APPDATA
		? path.join(process.env.APPDATA, "npm", "node_modules")
		: undefined;
	if (windowsGlobalRoot) {
		try {
			if (fs.statSync(windowsGlobalRoot).isDirectory()) {
				cachedGlobalNpmRoot = fs.realpathSync(windowsGlobalRoot);
				return cachedGlobalNpmRoot;
			}
		} catch {
			// Fall through if the directory disappears while resolving it.
		}
	}

	try {
		cachedGlobalNpmRoot = fs.realpathSync(execSync("npm root -g", { encoding: "utf-8", timeout: 5000, windowsHide: true }).trim());
		return cachedGlobalNpmRoot;
	} catch {
		cachedGlobalNpmRoot = "";
		return null;
	}
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function packageMetadata(pkg: Record<string, unknown>, packageRoot: string): Omit<PackageSubagentPath, "dir"> {
	const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : undefined;
	const version = typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : undefined;
	return {
		packageRoot,
		...(name ? { packageName: name } : {}),
		...(version ? { packageVersion: version } : {}),
	};
}

function extractSubagentPathsFromPackageRoot(packageRoot: string): PackageSubagentPaths {
	const packageJsonPath = path.join(packageRoot, "package.json");
	const pkg = readJsonFileBestEffort(packageJsonPath);
	if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return { agents: [], chains: [] };
	const pkgRecord = pkg as Record<string, unknown>;
	const metadata = packageMetadata(pkgRecord, packageRoot);

	const roots: Record<string, unknown>[] = [];
	const piSubagents = pkgRecord["pi-subagents"];
	if (piSubagents && typeof piSubagents === "object" && !Array.isArray(piSubagents)) {
		roots.push(piSubagents as Record<string, unknown>);
	}

	const pi = pkgRecord.pi;
	if (pi && typeof pi === "object" && !Array.isArray(pi)) {
		const subagents = (pi as { subagents?: unknown }).subagents;
		if (subagents && typeof subagents === "object" && !Array.isArray(subagents)) {
			roots.push(subagents as Record<string, unknown>);
		}
	}

	const agents: PackageSubagentPath[] = [];
	const chains: string[] = [];
	for (const root of roots) {
		for (const entry of stringArray(root.agents)) agents.push({ dir: path.resolve(packageRoot, entry), ...metadata });
		for (const entry of stringArray(root.chains)) chains.push(path.resolve(packageRoot, entry));
	}
	return { agents, chains };
}

function collectPackageRootsFromNodeModules(nodeModulesDir: string): string[] {
	const roots: string[] = [];
	if (!fs.existsSync(nodeModulesDir)) return roots;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
	} catch {
		return roots;
	}

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

		if (entry.name.startsWith("@")) {
			const scopeDir = path.join(nodeModulesDir, entry.name);
			let scopeEntries: fs.Dirent[];
			try {
				scopeEntries = fs.readdirSync(scopeDir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const scopeEntry of scopeEntries) {
				if (scopeEntry.name.startsWith(".")) continue;
				if (!scopeEntry.isDirectory() && !scopeEntry.isSymbolicLink()) continue;
				roots.push(path.join(scopeDir, scopeEntry.name));
			}
			continue;
		}

		roots.push(path.join(nodeModulesDir, entry.name));
	}
	return roots;
}

function collectSettingsPackageRoots(settingsFile: string, baseDir: string): string[] {
	const settings = readOptionalJsonFile(settingsFile);
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
	const packages = (settings as { packages?: unknown }).packages;
	if (!Array.isArray(packages)) return [];

	const roots: string[] = [];
	for (const entry of packages) {
		const packageSource = typeof entry === "string"
			? entry
			: typeof entry === "object" && entry !== null && typeof (entry as { source?: unknown }).source === "string"
				? (entry as { source: string }).source
				: undefined;
		if (!packageSource) continue;
		const packageRoot = resolveSettingsPackageRoot(packageSource, baseDir);
		if (packageRoot) roots.push(packageRoot);
	}
	return roots;
}

function collectPackageSubagentPaths(cwd: string, options: { includeUser: boolean; includeProject: boolean } = { includeUser: true, includeProject: true }): PackageSubagentPaths {
	const agentDir = getAgentDir();
	const projectRoot = findConfiguredProjectRoot(cwd) ?? cwd;
	const packageRoots = [
		projectRoot,
	];

	if (options.includeProject) {
		const projectConfigDir = getProjectConfigDir(projectRoot);
		packageRoots.push(
			...collectPackageRootsFromNodeModules(path.join(projectConfigDir, "npm", "node_modules")),
			...collectSettingsPackageRoots(path.join(projectConfigDir, "settings.json"), projectConfigDir),
		);
	}

	if (options.includeUser) {
		packageRoots.push(
			...collectPackageRootsFromNodeModules(path.join(agentDir, "npm", "node_modules")),
			...collectSettingsPackageRoots(path.join(agentDir, "settings.json"), agentDir),
		);
	}

	if (options.includeUser) {
		const globalRoot = getGlobalNpmRoot();
		if (globalRoot) packageRoots.push(...collectPackageRootsFromNodeModules(globalRoot));
	}

	const seenRoots = new Set<string>();
	const seenAgents = new Set<string>();
	const seenChains = new Set<string>();
	const agents: PackageSubagentPath[] = [];
	const chains: string[] = [];
	for (const packageRoot of packageRoots) {
		const resolvedRoot = path.resolve(packageRoot);
		if (seenRoots.has(resolvedRoot)) continue;
		seenRoots.add(resolvedRoot);
		const paths = extractSubagentPathsFromPackageRoot(resolvedRoot);
		for (const agentPath of paths.agents) {
			if (seenAgents.has(agentPath.dir)) continue;
			seenAgents.add(agentPath.dir);
			agents.push(agentPath);
		}
		for (const chainDir of paths.chains) {
			if (seenChains.has(chainDir)) continue;
			seenChains.add(chainDir);
			chains.push(chainDir);
		}
	}
	return { agents, chains };
}

function normalizeAgentAliases(rawAliases: string[] | undefined, agentName: string): string[] | undefined {
	const aliases = [...new Set((rawAliases ?? []).map((alias) => alias.trim()).filter(Boolean))]
		.filter((alias) => alias !== agentName);
	return aliases.length > 0 ? aliases : undefined;
}

function effectiveAgentMatch(matches: AgentConfig[]): { agent?: AgentConfig; error?: string } {
	const distinctNames = [...new Set(matches.map((agent) => agent.name))];
	if (distinctNames.length === 1) {
		const sourceRank = new Map<AgentConfig["source"], number>([["builtin", 0], ["package", 1], ["user", 2], ["project", 3], ["runtime", 4]]);
		const agent = [...matches].sort((a, b) => (sourceRank.get(b.source) ?? 0) - (sourceRank.get(a.source) ?? 0))[0];
		return agent ? { agent } : {};
	}
	return {};
}

export function resolveAgentName(name: string, agents: AgentConfig[]): { agent?: AgentConfig; error?: string } {
	const raw = name.trim();
	const exact = agents.filter((agent) => agent.name === raw || agent.localName === raw);
	if (exact.length === 1) return exact[0] ? { agent: exact[0] } : {};
	if (exact.length > 1) {
		const effective = effectiveAgentMatch(exact);
		if (effective.agent) return effective;
		return { error: `Ambiguous agent name '${name}': ${exact.map((agent) => agent.name).join(", ")}` };
	}

	const aliases = agents.filter((agent) => agent.aliases?.includes(raw));
	if (aliases.length === 1) return aliases[0] ? { agent: aliases[0] } : {};
	if (aliases.length > 1) {
		const effective = effectiveAgentMatch(aliases);
		if (effective.agent) return effective;
		return { error: `Ambiguous agent alias '${name}': ${aliases.map((agent) => agent.name).join(", ")}` };
	}
	return {};
}

function splitToolList(rawTools: string[] | undefined): { tools?: string[]; mcpDirectTools?: string[] } {
	const mcpDirectTools: string[] = [];
	const tools: string[] = [];
	for (const tool of rawTools ?? []) {
		if (tool.startsWith("mcp:")) {
			mcpDirectTools.push(tool.slice(4));
		} else {
			tools.push(tool);
		}
	}
	return {
		...(rawTools !== undefined ? { tools } : {}),
		...(mcpDirectTools.length > 0 ? { mcpDirectTools } : {}),
	};
}

function joinToolList(config: Pick<AgentConfig, "tools" | "mcpDirectTools">): string[] | undefined {
	const joined = [
		...(config.tools ?? []),
		...(config.mcpDirectTools ?? []).map((tool) => `mcp:${tool}`),
	];
	return joined.length > 0 ? joined : undefined;
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function cloneOverrideBase(agent: AgentConfig): BuiltinAgentOverrideBase {
	return {
		description: agent.description,
		...(agent.output !== undefined ? { output: agent.output } : {}),
		...(agent.outputMode !== undefined ? { outputMode: agent.outputMode } : {}),
		...(agent.defaultReads !== undefined ? { defaultReads: [...agent.defaultReads] } : {}),
		...(agent.model !== undefined ? { model: agent.model } : {}),
		...(agent.modelProvider !== undefined ? { modelProvider: agent.modelProvider } : {}),
		...(agent.fallbackModels ? { fallbackModels: [...agent.fallbackModels] } : {}),
		...(agent.fast !== undefined ? { fast: agent.fast } : {}),
		...(agent.thinking !== undefined ? { thinking: agent.thinking } : {}),
		systemPromptMode: agent.systemPromptMode,
		inheritProjectContext: agent.inheritProjectContext,
		inheritGlobalContext: agent.inheritGlobalContext,
		inheritSkills: agent.inheritSkills,
		...(agent.defaultContext !== undefined ? { defaultContext: agent.defaultContext } : {}),
		...(agent.acceptanceRole !== undefined ? { acceptanceRole: agent.acceptanceRole } : {}),
		...(agent.disabled !== undefined ? { disabled: agent.disabled } : {}),
		systemPrompt: agent.systemPrompt,
		...(agent.skills ? { skills: [...agent.skills] } : {}),
		...(agent.skillPath ? { skillPath: [...agent.skillPath] } : {}),
		...(agent.tools ? { tools: [...agent.tools] } : {}),
		...(agent.allowNestedSubagents !== undefined ? { allowNestedSubagents: agent.allowNestedSubagents } : {}),
		...(agent.mcpDirectTools ? { mcpDirectTools: [...agent.mcpDirectTools] } : {}),
		...(!agent.extensionsFromDefault && agent.extensions ? { extensions: [...agent.extensions] } : {}),
		...(agent.subagentOnlyExtensions ? { subagentOnlyExtensions: [...agent.subagentOnlyExtensions] } : {}),
		...(agent.mutationTools ? { mutationTools: [...agent.mutationTools] } : {}),
		...(agent.completionGuard !== undefined ? { completionGuard: agent.completionGuard } : {}),
		...(agent.toolBudget !== undefined ? { toolBudget: agent.toolBudget } : {}),
	};
}

function cloneOverrideValue(override: BuiltinAgentOverrideConfig): BuiltinAgentOverrideConfig {
	return {
		...(override.description !== undefined ? { description: override.description } : {}),
		...(override.output !== undefined ? { output: override.output } : {}),
		...(override.outputMode !== undefined ? { outputMode: override.outputMode } : {}),
		...(override.defaultReads !== undefined ? { defaultReads: override.defaultReads === false ? false : [...override.defaultReads] } : {}),
		...(override.model !== undefined ? { model: override.model } : {}),
		...(override.defaultProvider !== undefined ? { defaultProvider: override.defaultProvider } : {}),
		...(override.fallbackModels !== undefined
			? { fallbackModels: override.fallbackModels === false ? false : [...override.fallbackModels] }
			: {}),
		...(override.fast !== undefined ? { fast: override.fast } : {}),
		...(override.thinking !== undefined ? { thinking: override.thinking } : {}),
		...(override.systemPromptMode !== undefined ? { systemPromptMode: override.systemPromptMode } : {}),
		...(override.inheritProjectContext !== undefined ? { inheritProjectContext: override.inheritProjectContext } : {}),
		...(override.inheritGlobalContext !== undefined ? { inheritGlobalContext: override.inheritGlobalContext } : {}),
		...(override.inheritSkills !== undefined ? { inheritSkills: override.inheritSkills } : {}),
		...(override.defaultContext !== undefined ? { defaultContext: override.defaultContext } : {}),
		...(override.acceptanceRole !== undefined ? { acceptanceRole: override.acceptanceRole } : {}),
		...(override.disabled !== undefined ? { disabled: override.disabled } : {}),
		...(override.systemPrompt !== undefined ? { systemPrompt: override.systemPrompt } : {}),
		...(override.skills !== undefined ? { skills: override.skills === false ? false : [...override.skills] } : {}),
		...(override.tools !== undefined ? { tools: Array.isArray(override.tools) ? [...override.tools] : override.tools } : {}),
		...(override.allowNestedSubagents !== undefined ? { allowNestedSubagents: override.allowNestedSubagents } : {}),
		...(override.extensions !== undefined ? { extensions: override.extensions === false ? false : [...override.extensions] } : {}),
		...(override.subagentOnlyExtensions !== undefined ? { subagentOnlyExtensions: override.subagentOnlyExtensions === false ? false : [...override.subagentOnlyExtensions] } : {}),
		...(override.mutationTools !== undefined ? { mutationTools: override.mutationTools === false ? false : [...override.mutationTools] } : {}),
		...(override.completionGuard !== undefined ? { completionGuard: override.completionGuard } : {}),
		...(override.toolBudget !== undefined ? { toolBudget: override.toolBudget === false ? false : { ...override.toolBudget, ...(Array.isArray(override.toolBudget.block) ? { block: [...override.toolBudget.block] } : {}) } } : {}),
	};
}

function findNearestGitRoot(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		if (fs.existsSync(path.join(currentDir, ".git"))) return currentDir;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function readProjectRootResolution(projectRoot: string): ProjectRootResolution | undefined {
	const settingsPath = path.join(getProjectConfigDir(projectRoot), "settings.json");
	if (!fs.existsSync(settingsPath)) return undefined;
	const settings = readSettingsFileStrict(settingsPath);
	const subagents = settings.subagents;
	if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) return undefined;

	const value = (subagents as Record<string, unknown>).projectRootResolution;
	if (value === undefined) return undefined;
	if (value === "nearest" || value === "git-root") return value;
	throw new Error(`Subagent settings in '${settingsPath}' have invalid 'projectRootResolution'; expected 'nearest' or 'git-root'.`);
}

export function findConfiguredProjectRoot(cwd: string): string | null {
	const candidates = findProjectRootCandidates(cwd);
	const nearestRoot = candidates[0];
	if (!nearestRoot) return null;

	let policyRoot: string | undefined;
	let policyRootIndex = -1;
	for (const [index, candidate] of candidates.entries()) {
		const mode = readProjectRootResolution(candidate);
		if (mode === "nearest") return nearestRoot;
		if (mode === "git-root") {
			policyRoot = candidate;
			policyRootIndex = index;
			break;
		}
	}
	if (!policyRoot) return nearestRoot;

	const gitRoot = findNearestGitRoot(cwd);
	const gitProjectRoot = gitRoot
		? candidates.slice(policyRootIndex).find((candidate) => path.resolve(candidate) === path.resolve(gitRoot))
		: undefined;
	const configuredGitRoot = fs.existsSync(path.join(policyRoot, ".git")) ? policyRoot : undefined;
	return gitProjectRoot ?? configuredGitRoot ?? nearestRoot;
}

function getUserAgentSettingsPath(): string {
	return path.join(getAgentDir(), "settings.json");
}

function getProjectAgentSettingsPath(cwd: string): string | null {
	const projectRoot = findConfiguredProjectRoot(cwd);
	return projectRoot ? path.join(getProjectConfigDir(projectRoot), "settings.json") : null;
}

function readSettingsFileStrict(filePath: string): Record<string, unknown> {
	if (!fs.existsSync(filePath)) return {};
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read settings file '${filePath}': ${message}`, { cause: error });
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse settings file '${filePath}': ${message}`, { cause: error });
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Settings file '${filePath}' must contain a JSON object.`);
	}
	return parsed as Record<string, unknown>;
}

function writeSettingsFile(filePath: string, settings: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

function parseOverrideStringArrayOrFalse(
	value: unknown,
	meta: { filePath: string; name: string; field: string },
): string[] | false | undefined {
	if (value === undefined) return undefined;
	if (value === false) return false;
	if (!Array.isArray(value)) {
		throw new Error(`Builtin override '${meta.name}' in '${meta.filePath}' has invalid '${meta.field}'; expected an array of strings or false.`);
	}

	const items: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			throw new Error(`Builtin override '${meta.name}' in '${meta.filePath}' has invalid '${meta.field}'; expected an array of strings or false.`);
		}
		const trimmed = item.trim();
		if (trimmed) items.push(trimmed);
	}
	return items;
}

function parseToolsOverride(
	value: unknown,
	meta: { filePath: string; name: string },
): BuiltinAgentOverrideConfig["tools"] | undefined {
	if (typeof value === "string" && value.trim() === "inherit") return "inherit";
	if (value === undefined || value === false || Array.isArray(value)) {
		return parseOverrideStringArrayOrFalse(value, { ...meta, field: "tools" });
	}
	throw new Error(`Builtin override '${meta.name}' in '${meta.filePath}' has invalid 'tools'; expected an array of strings, "inherit", or false.`);
}

function parseBuiltinOverrideEntry(
	name: string,
	value: unknown,
	filePath: string,
): BuiltinAgentOverrideConfig | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Builtin override '${name}' in '${filePath}' must be an object.`);
	}

	const input = value as Record<string, unknown>;
	const override: BuiltinAgentOverrideConfig = {};

	if ("description" in input) {
		if (typeof input.description === "string" && input.description.trim()) {
			override.description = input.description.trim();
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'description'; expected a non-empty string.`);
		}
	}

	if ("output" in input) {
		if ((typeof input.output === "string" && input.output.trim()) || input.output === false) override.output = input.output;
		else throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'output'; expected a non-empty string or false.`);
	}

	if ("outputMode" in input) {
		if (input.outputMode === "inline" || input.outputMode === "file-only") {
			override.outputMode = input.outputMode;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'outputMode'; expected 'inline' or 'file-only'.`);
		}
	}

	if ("model" in input) {
		if (typeof input.model === "string" || input.model === false) override.model = input.model;
		else throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'model'; expected a string or false.`);
	}

	if ("fast" in input) {
		if (typeof input.fast === "boolean") override.fast = input.fast;
		else throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'fast'; expected a boolean.`);
	}

	if ("thinking" in input) {
		if (typeof input.thinking === "string" || input.thinking === false) override.thinking = input.thinking;
		else throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'thinking'; expected a string or false.`);
	}

	if ("systemPromptMode" in input) {
		if (input.systemPromptMode === "append" || input.systemPromptMode === "replace") {
			override.systemPromptMode = input.systemPromptMode;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'systemPromptMode'; expected 'append' or 'replace'.`);
		}
	}

	if ("inheritProjectContext" in input) {
		if (typeof input.inheritProjectContext === "boolean") {
			override.inheritProjectContext = input.inheritProjectContext;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'inheritProjectContext'; expected a boolean.`);
		}
	}

	if ("inheritGlobalContext" in input) {
		if (typeof input.inheritGlobalContext === "boolean") {
			override.inheritGlobalContext = input.inheritGlobalContext;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'inheritGlobalContext'; expected a boolean.`);
		}
	}

	if ("inheritSkills" in input) {
		if (typeof input.inheritSkills === "boolean") {
			override.inheritSkills = input.inheritSkills;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'inheritSkills'; expected a boolean.`);
		}
	}

	if ("defaultContext" in input) {
		if (input.defaultContext === "fresh" || input.defaultContext === "fork" || input.defaultContext === false) {
			override.defaultContext = input.defaultContext;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'defaultContext'; expected 'fresh', 'fork', or false.`);
		}
	}

	if ("acceptanceRole" in input) {
		if (input.acceptanceRole === "read-only" || input.acceptanceRole === "writer" || input.acceptanceRole === false) {
			override.acceptanceRole = input.acceptanceRole;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'acceptanceRole'; expected 'read-only', 'writer', or false.`);
		}
	}

	if ("disabled" in input) {
		if (typeof input.disabled === "boolean") {
			override.disabled = input.disabled;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'disabled'; expected a boolean.`);
		}
	}

	if ("completionGuard" in input) {
		if (typeof input.completionGuard === "boolean") {
			override.completionGuard = input.completionGuard;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'completionGuard'; expected a boolean.`);
		}
	}

	if ("toolBudget" in input) {
		if (input.toolBudget === false) {
			override.toolBudget = false;
		} else if (input.toolBudget && typeof input.toolBudget === "object" && !Array.isArray(input.toolBudget)) {
			override.toolBudget = input.toolBudget as ToolBudgetConfig;
		} else {
			throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'toolBudget'; expected an object or false.`);
		}
	}

	if ("systemPrompt" in input) {
		if (typeof input.systemPrompt === "string") override.systemPrompt = input.systemPrompt;
		else throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'systemPrompt'; expected a string.`);
	}

	const defaultReads = parseOverrideStringArrayOrFalse(input.defaultReads, { filePath, name, field: "defaultReads" });
	if (defaultReads !== undefined) override.defaultReads = defaultReads;

	const fallbackModels = parseOverrideStringArrayOrFalse(input.fallbackModels, { filePath, name, field: "fallbackModels" });
	if (fallbackModels !== undefined) override.fallbackModels = fallbackModels;

	if ("defaultProvider" in input) {
		if (input.defaultProvider === false) override.defaultProvider = false;
		else if (typeof input.defaultProvider === "string" && input.defaultProvider.trim()) override.defaultProvider = input.defaultProvider.trim();
		else throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'defaultProvider'; expected a non-empty string or false.`);
	}

	const skills = parseOverrideStringArrayOrFalse(input.skills, { filePath, name, field: "skills" });
	if (skills !== undefined) override.skills = skills;

	const tools = parseToolsOverride(input.tools, { filePath, name });
	if (tools !== undefined) override.tools = tools;
	if ("allowNestedSubagents" in input) {
		if (typeof input.allowNestedSubagents === "boolean") override.allowNestedSubagents = input.allowNestedSubagents;
		else throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'allowNestedSubagents'; expected a boolean.`);
	}

	const extensions = parseOverrideStringArrayOrFalse(input.extensions, { filePath, name, field: "extensions" });
	if (extensions !== undefined) override.extensions = extensions;

	const subagentOnlyExtensions = parseOverrideStringArrayOrFalse(input.subagentOnlyExtensions, { filePath, name, field: "subagentOnlyExtensions" });
	if (subagentOnlyExtensions !== undefined) override.subagentOnlyExtensions = subagentOnlyExtensions;

	const mutationTools = parseOverrideStringArrayOrFalse(input.mutationTools, { filePath, name, field: "mutationTools" });
	if (mutationTools !== undefined) override.mutationTools = mutationTools;

	return Object.keys(override).length > 0 ? override : undefined;
}

function readSubagentSettings(filePath: string | null): SubagentSettings {
	if (!filePath) return EMPTY_SUBAGENT_SETTINGS;
	const settings = readSettingsFileStrict(filePath);
	const subagents = settings.subagents;
	if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) return EMPTY_SUBAGENT_SETTINGS;

	const subagentsObject = subagents as Record<string, unknown>;
	let disableBuiltins: boolean | undefined;
	if ("disableBuiltins" in subagentsObject) {
		if (typeof subagentsObject.disableBuiltins === "boolean") {
			disableBuiltins = subagentsObject.disableBuiltins;
		} else {
			throw new Error(`Subagent settings in '${filePath}' have invalid 'disableBuiltins'; expected a boolean.`);
		}
	}
	let disableThinking: boolean | undefined;
	if ("disableThinking" in subagentsObject) {
		if (typeof subagentsObject.disableThinking === "boolean") {
			disableThinking = subagentsObject.disableThinking;
		} else {
			throw new Error(`Subagent settings in '${filePath}' have invalid 'disableThinking'; expected a boolean.`);
		}
	}
	let defaultModel: string | undefined;
	if ("defaultModel" in subagentsObject) {
		if (typeof subagentsObject.defaultModel === "string" && subagentsObject.defaultModel.trim()) {
			defaultModel = subagentsObject.defaultModel.trim();
		} else {
			throw new Error(`Subagent settings in '${filePath}' have invalid 'defaultModel'; expected a non-empty string.`);
		}
	}
	let defaultProvider: string | undefined;
	if ("defaultProvider" in subagentsObject) {
		if (typeof subagentsObject.defaultProvider === "string" && subagentsObject.defaultProvider.trim()) {
			defaultProvider = subagentsObject.defaultProvider.trim();
		} else {
			throw new Error(`Subagent settings in '${filePath}' have invalid 'defaultProvider'; expected a non-empty string.`);
		}
	}
	let defaultThinking: string | undefined;
	if ("defaultThinking" in subagentsObject) {
		if (typeof subagentsObject.defaultThinking === "string" && subagentsObject.defaultThinking.trim()) {
			defaultThinking = subagentsObject.defaultThinking.trim();
		} else {
			throw new Error(`Subagent settings in '${filePath}' have invalid 'defaultThinking'; expected a non-empty string.`);
		}
	}
	let maxThinking: ThinkingLevel | undefined;
	if ("maxThinking" in subagentsObject) {
		try {
			maxThinking = parseThinkingLevel(subagentsObject.maxThinking, `'${filePath}' subagents.maxThinking`);
		} catch (error) {
			throw new Error(`Subagent settings in '${filePath}' have invalid 'maxThinking'; expected one of off, minimal, low, medium, high, xhigh, or max.`, { cause: error instanceof Error ? error : undefined });
		}
	}
	let defaultExtensions: string[] | undefined;
	if ("defaultExtensions" in subagentsObject) {
		if (!Array.isArray(subagentsObject.defaultExtensions)
			|| subagentsObject.defaultExtensions.some((item) => typeof item !== "string" || !item.trim())) {
			throw new Error(`Subagent settings in '${filePath}' have invalid 'defaultExtensions'; expected an array of non-empty strings.`);
		}
		defaultExtensions = subagentsObject.defaultExtensions.map((item) => item.trim());
	}
	const modelScope = parseModelScopeConfig(subagentsObject.modelScope, { filePath });

	const parsed: Record<string, BuiltinAgentOverrideConfig> = {};
	const providerOverrides: Record<string, Record<string, BuiltinAgentOverrideConfig>> = {};
	const agentOverrides = subagentsObject.agentOverrides;
	const agentOverridesByProvider = subagentsObject.agentOverridesByProvider;
	const parsedSettings: SubagentSettings = {
		overrides: parsed,
		providerOverrides,
		...(defaultModel !== undefined ? { defaultModel } : {}),
		...(defaultProvider !== undefined ? { defaultProvider } : {}),
		...(defaultThinking !== undefined ? { defaultThinking } : {}),
		...(maxThinking !== undefined ? { maxThinking } : {}),
		...(defaultExtensions !== undefined ? { defaultExtensions } : {}),
		...(disableBuiltins !== undefined ? { disableBuiltins } : {}),
		...(disableThinking !== undefined ? { disableThinking } : {}),
		...(modelScope !== undefined ? { modelScope } : {}),
	};
	if (agentOverrides && typeof agentOverrides === "object" && !Array.isArray(agentOverrides)) {
		for (const [name, value] of Object.entries(agentOverrides)) {
			const override = parseBuiltinOverrideEntry(name, value, filePath);
			if (override) parsed[name] = override;
		}
	}
	if (agentOverridesByProvider !== undefined) {
		if (!agentOverridesByProvider || typeof agentOverridesByProvider !== "object" || Array.isArray(agentOverridesByProvider)) {
			throw new Error(`Subagent settings in '${filePath}' have invalid 'agentOverridesByProvider'; expected an object keyed by provider.`);
		}
		for (const [provider, value] of Object.entries(agentOverridesByProvider)) {
			if (!value || typeof value !== "object" || Array.isArray(value)) {
				throw new Error(`Subagent settings in '${filePath}' have invalid 'agentOverridesByProvider.${provider}'; expected an object keyed by agent.`);
			}
			const entries: Record<string, BuiltinAgentOverrideConfig> = {};
			for (const [agentName, agentValue] of Object.entries(value)) {
				const override = parseBuiltinOverrideEntry(`agentOverridesByProvider.${provider}.${agentName}`, agentValue, filePath);
				if (override) entries[agentName] = override;
			}
			providerOverrides[provider] = entries;
		}
	}
	return parsedSettings;
}

function selectProviderOverrides(settings: SubagentSettings, provider: string | undefined): SubagentSettings {
	if (!provider) return settings;
	const selected = settings.providerOverrides[provider];
	if (!selected) return settings;
	const overrides = { ...settings.overrides };
	for (const [name, override] of Object.entries(selected)) {
		overrides[name] = { ...overrides[name], ...override };
	}
	return { ...settings, overrides };
}

function resolveSubagentDefaultProvider(
	userSettings: SubagentSettings,
	projectSettings: SubagentSettings,
	projectSettingsPath: string | null,
): string | undefined {
	if (projectSettingsPath && projectSettings.defaultProvider !== undefined) return projectSettings.defaultProvider;
	return userSettings.defaultProvider;
}

function resolveSubagentDefaultModel(
	userSettings: SubagentSettings,
	projectSettings: SubagentSettings,
	userSettingsPath: string,
	projectSettingsPath: string | null,
	defaultProvider: string | undefined,
): AgentModelSourceInfo | undefined {
	if (projectSettingsPath && projectSettings.defaultModel !== undefined) {
		return { type: "subagents.defaultModel", scope: "project", path: projectSettingsPath, model: projectSettings.defaultModel, ...(defaultProvider ? { defaultProvider } : {}) };
	}
	return userSettings.defaultModel !== undefined
		? { type: "subagents.defaultModel", scope: "user", path: userSettingsPath, model: userSettings.defaultModel, ...(defaultProvider ? { defaultProvider } : {}) }
		: undefined;
}

function applySubagentDefaultModel(agents: AgentConfig[], defaultModel: AgentModelSourceInfo | undefined, defaultProvider: string | undefined): AgentConfig[] {
	if (!defaultModel && !defaultProvider) return agents;
	return agents.map((agent) => {
		if (agent.model !== undefined && (agent.modelProvider !== undefined || !defaultProvider)) return agent;
		const next = {
			...agent,
			...(agent.model === undefined && defaultModel ? { model: defaultModel.model, modelSource: defaultModel } : {}),
			...(defaultProvider ? { modelProvider: defaultProvider } : {}),
		};
		const frontmatterFields = agentFrontmatterFields.get(agent);
		if (frontmatterFields) agentFrontmatterFields.set(next, frontmatterFields);
		return next;
	});
}

function resolveSubagentDefaultThinking(
	userSettings: SubagentSettings,
	projectSettings: SubagentSettings,
	projectSettingsPath: string | null,
): string | undefined {
	if (projectSettingsPath && projectSettings.defaultThinking !== undefined) return projectSettings.defaultThinking;
	return userSettings.defaultThinking;
}

function applySubagentDefaultThinking(agents: AgentConfig[], defaultThinking: string | undefined): AgentConfig[] {
	if (defaultThinking === undefined) return agents;
	return agents.map((agent) => {
		if (agent.thinking !== undefined) return agent;
		const next = { ...agent, thinking: defaultThinking };
		const frontmatterFields = agentFrontmatterFields.get(agent);
		if (frontmatterFields) agentFrontmatterFields.set(next, frontmatterFields);
		return next;
	});
}

function resolveSubagentMaxThinking(
	userSettings: SubagentSettings,
	projectSettings: SubagentSettings,
	projectSettingsPath: string | null,
): ThinkingLevel | undefined {
	if (projectSettingsPath && projectSettings.maxThinking !== undefined) return projectSettings.maxThinking;
	return userSettings.maxThinking;
}

function applySubagentMaxThinking(agents: AgentConfig[], maxThinking: ThinkingLevel | undefined): AgentConfig[] {
	if (maxThinking === undefined) return agents;
	return agents.map((agent) => agent.maxThinking === maxThinking ? agent : { ...agent, maxThinking });
}

function resolveSubagentDefaultExtensions(
	userSettings: SubagentSettings,
	projectSettings: SubagentSettings,
	projectSettingsPath: string | null,
): string[] | undefined {
	if (projectSettingsPath && projectSettings.defaultExtensions !== undefined) return projectSettings.defaultExtensions;
	return userSettings.defaultExtensions;
}

function applySubagentDefaultExtensions(agents: AgentConfig[], defaultExtensions: string[] | undefined): AgentConfig[] {
	if (defaultExtensions === undefined) return agents;
	return agents.map((agent) => {
		if (agent.extensions !== undefined) return agent;
		const next = { ...agent, extensions: [...defaultExtensions], extensionsFromDefault: true };
		const frontmatterFields = agentFrontmatterFields.get(agent);
		if (frontmatterFields) agentFrontmatterFields.set(next, frontmatterFields);
		return next;
	});
}

function applySubagentDefaults(
	agents: AgentConfig[],
	defaultModel: AgentModelSourceInfo | undefined,
	defaultProvider: string | undefined,
	defaultThinking: string | undefined,
	defaultExtensions: string[] | undefined,
): AgentConfig[] {
	return applySubagentDefaultExtensions(
		applySubagentDefaultThinking(applySubagentDefaultModel(agents, defaultModel, defaultProvider), defaultThinking),
		defaultExtensions,
	);
}

function applyToolsOverride(target: AgentConfig, toolsOverride: string[] | false | "inherit"): void {
	if (toolsOverride === "inherit") {
		delete target.tools;
		delete target.mcpDirectTools;
		return;
	}
	const { tools, mcpDirectTools } = splitToolList(toolsOverride === false ? [] : toolsOverride);
	if (tools === undefined) delete target.tools; else target.tools = tools;
	if (mcpDirectTools === undefined) delete target.mcpDirectTools; else target.mcpDirectTools = mcpDirectTools;
}

function applyBuiltinOverride(
	agent: AgentConfig,
	override: BuiltinAgentOverrideConfig,
	meta: { scope: "user" | "project"; path: string },
): AgentConfig {
	const next: AgentConfig = {
		...agent,
		override: { ...meta, base: agent.override?.base ?? cloneOverrideBase(agent) },
	};

	if (override.description !== undefined) next.description = override.description;
	if (override.output !== undefined) { if (override.output === false) delete next.output; else next.output = override.output; }
	if (override.outputMode !== undefined) next.outputMode = override.outputMode;
	if (override.defaultReads !== undefined) { if (override.defaultReads === false) delete next.defaultReads; else next.defaultReads = [...override.defaultReads]; }
	if (override.model !== undefined) {
		if (override.model === false) delete next.model; else next.model = override.model;
		delete next.modelSource;
	}
	if (override.defaultProvider !== undefined) {
		if (override.defaultProvider === false) delete next.modelProvider;
		else next.modelProvider = override.defaultProvider;
	}
	if (override.fallbackModels !== undefined) { if (override.fallbackModels === false) delete next.fallbackModels; else next.fallbackModels = [...override.fallbackModels]; }
	if (override.fast !== undefined) next.fast = override.fast;
	if (override.thinking !== undefined) { if (override.thinking === false) delete next.thinking; else next.thinking = override.thinking; }
	if (override.systemPromptMode !== undefined) next.systemPromptMode = override.systemPromptMode;
	if (override.inheritProjectContext !== undefined) next.inheritProjectContext = override.inheritProjectContext;
	if (override.inheritGlobalContext !== undefined) next.inheritGlobalContext = override.inheritGlobalContext;
	if (override.inheritSkills !== undefined) next.inheritSkills = override.inheritSkills;
	if (override.defaultContext !== undefined) { if (override.defaultContext === false) delete next.defaultContext; else next.defaultContext = override.defaultContext; }
	if (override.acceptanceRole !== undefined) { if (override.acceptanceRole === false) delete next.acceptanceRole; else next.acceptanceRole = override.acceptanceRole; }
	if (override.disabled !== undefined) next.disabled = override.disabled;
	if (override.systemPrompt !== undefined) next.systemPrompt = override.systemPrompt;
	if (override.skills !== undefined) { if (override.skills === false) delete next.skills; else next.skills = [...override.skills]; }
	if (override.tools !== undefined) applyToolsOverride(next, override.tools);
	if (override.allowNestedSubagents !== undefined) next.allowNestedSubagents = override.allowNestedSubagents;
	if (override.extensions !== undefined) { if (override.extensions === false) delete next.extensions; else next.extensions = [...override.extensions]; }
	if (override.subagentOnlyExtensions !== undefined) { if (override.subagentOnlyExtensions === false) delete next.subagentOnlyExtensions; else next.subagentOnlyExtensions = [...override.subagentOnlyExtensions]; }
	if (override.mutationTools !== undefined) { if (override.mutationTools === false) delete next.mutationTools; else next.mutationTools = [...override.mutationTools]; }
	if (override.completionGuard !== undefined) next.completionGuard = override.completionGuard;
	if (override.toolBudget !== undefined) { if (override.toolBudget === false) delete next.toolBudget; else next.toolBudget = override.toolBudget; }

	return next;
}

function clearBuiltinThinking(agent: AgentConfig, meta: { scope: "user" | "project"; path: string }): AgentConfig {
	if (agent.thinking === undefined) return agent;
	const { thinking: _thinking, ...next } = agent;
	return { ...next, override: agent.override ?? { ...meta, base: cloneOverrideBase(agent) } };
}

function applyBuiltinOverrides(
	builtinAgents: AgentConfig[],
	userSettings: SubagentSettings,
	projectSettings: SubagentSettings,
	userSettingsPath: string,
	projectSettingsPath: string | null,
): AgentConfig[] {
	const projectBulkDisabled = projectSettings.disableBuiltins === true && projectSettingsPath !== null;
	const userBulkDisabled = projectSettings.disableBuiltins === undefined && userSettings.disableBuiltins === true;
	const projectThinkingConfigured = projectSettings.disableThinking !== undefined && projectSettingsPath !== null;
	const disableThinking = projectThinkingConfigured ? projectSettings.disableThinking === true : userSettings.disableThinking === true;
	const disableThinkingMeta = projectThinkingConfigured
		? { scope: "project" as const, path: projectSettingsPath! }
		: { scope: "user" as const, path: userSettingsPath };

	const applyGlobalThinking = (agent: AgentConfig, hasExplicitThinkingOverride: boolean): AgentConfig => {
		if (!disableThinking || hasExplicitThinkingOverride) return agent;
		return clearBuiltinThinking(agent, disableThinkingMeta);
	};

	return builtinAgents.map((agent) => {
		const userOverride = userSettings.overrides[agent.name];
		let resolved = userOverride
			? applyBuiltinOverride(agent, userOverride, { scope: "user", path: userSettingsPath })
			: userBulkDisabled
				? applyBuiltinOverride(agent, { disabled: true }, { scope: "user", path: userSettingsPath })
				: agent;

		const projectOverride = projectSettings.overrides[agent.name];
		if (projectOverride && projectSettingsPath) {
			resolved = applyBuiltinOverride(resolved, projectOverride, { scope: "project", path: projectSettingsPath });
		} else if (projectBulkDisabled && projectSettingsPath) {
			resolved = applyBuiltinOverride(resolved, { disabled: true }, { scope: "project", path: projectSettingsPath });
		}

		const hasExplicitGlobalContext = agentHasFrontmatterField(agent, "inheritGlobalContext")
			|| userOverride?.inheritGlobalContext !== undefined
			|| projectOverride?.inheritGlobalContext !== undefined;
		if (!hasExplicitGlobalContext) resolved.inheritGlobalContext = resolved.inheritProjectContext;

		const hasExplicitThinkingOverride = projectOverride
			? projectOverride.thinking !== undefined
			: !projectThinkingConfigured && userOverride?.thinking !== undefined;
		return applyGlobalThinking(resolved, hasExplicitThinkingOverride);
	});
}

export function agentHasFrontmatterField(agent: AgentConfig, ...fields: string[]): boolean {
	const frontmatterFields = agentFrontmatterFields.get(agent);
	return frontmatterFields ? fields.some((field) => frontmatterFields.has(field)) : false;
}

function applyCustomAgentOverride(
	agent: AgentConfig,
	override: BuiltinAgentOverrideConfig,
	meta: { scope: "user" | "project"; path: string },
): AgentConfig {
	let next: AgentConfig | undefined;
	let anyFilled = false;

	const mutable = (): AgentConfig => {
		next ??= { ...agent };
		return next;
	};

	const fill = <K extends keyof AgentConfig>(
		field: K,
		frontmatterFields: string[],
		value: AgentConfig[K],
	): void => {
		if (agentHasFrontmatterField(agent, ...frontmatterFields)) return;
		const target = mutable();
		if (value === undefined) delete target[field]; else target[field] = value;
		anyFilled = true;
	};

	if (override.description !== undefined) {
		mutable().description = override.description;
		anyFilled = true;
	}
	if (override.output !== undefined) {
		fill("output", ["output"], override.output === false ? undefined : override.output);
	}
	if (override.outputMode !== undefined) {
		fill("outputMode", ["outputMode"], override.outputMode);
	}
	if (override.defaultReads !== undefined) {
		fill("defaultReads", ["defaultReads"], override.defaultReads === false ? undefined : [...override.defaultReads]);
	}
	if (override.model !== undefined && !agentHasFrontmatterField(agent, "model")) {
		const target = mutable();
		if (override.model === false) delete target.model; else target.model = override.model;
		delete target.modelSource;
		anyFilled = true;
	}
	if (override.defaultProvider !== undefined) {
		fill("modelProvider", ["modelProvider", "defaultProvider"], override.defaultProvider === false ? undefined : override.defaultProvider);
	}
	if (override.fallbackModels !== undefined) {
		fill(
			"fallbackModels",
			["fallbackModels"],
			override.fallbackModels === false ? undefined : [...override.fallbackModels],
		);
	}
	if (override.fast !== undefined) {
		fill("fast", ["fast"], override.fast);
	}
	if (override.thinking !== undefined) {
		fill("thinking", ["thinking"], override.thinking === false ? undefined : override.thinking);
	}
	if (override.systemPromptMode !== undefined) {
		fill("systemPromptMode", ["systemPromptMode"], override.systemPromptMode);
	}
	if (override.inheritProjectContext !== undefined) {
		fill("inheritProjectContext", ["inheritProjectContext"], override.inheritProjectContext);
	}
	if (override.inheritGlobalContext !== undefined) {
		fill("inheritGlobalContext", ["inheritGlobalContext"], override.inheritGlobalContext);
	}
	if (override.inheritSkills !== undefined) {
		fill("inheritSkills", ["inheritSkills"], override.inheritSkills);
	}
	if (override.defaultContext !== undefined) {
		fill("defaultContext", ["defaultContext"], override.defaultContext === false ? undefined : override.defaultContext);
	}
	if (override.acceptanceRole !== undefined) {
		fill("acceptanceRole", ["acceptanceRole"], override.acceptanceRole === false ? undefined : override.acceptanceRole);
	}
	if (override.disabled !== undefined) {
		// Custom agent files cannot set `disabled`, so project overrides replace user overrides.
		mutable().disabled = override.disabled;
		anyFilled = true;
	}
	if (override.skills !== undefined) {
		fill("skills", ["skill", "skills"], override.skills === false ? undefined : [...override.skills]);
	}
	if (override.tools !== undefined && !agentHasFrontmatterField(agent, "tools")) {
		applyToolsOverride(mutable(), override.tools);
		anyFilled = true;
	}
	if (override.allowNestedSubagents !== undefined) {
		fill("allowNestedSubagents", ["allowNestedSubagents"], override.allowNestedSubagents);
	}
	if (override.extensions !== undefined) {
		fill("extensions", ["extensions"], override.extensions === false ? undefined : [...override.extensions]);
	}
	if (override.subagentOnlyExtensions !== undefined) {
		fill(
			"subagentOnlyExtensions",
			["subagentOnlyExtensions"],
			override.subagentOnlyExtensions === false ? undefined : [...override.subagentOnlyExtensions],
		);
	}
	if (override.mutationTools !== undefined) {
		fill("mutationTools", ["mutationTools"], override.mutationTools === false ? undefined : [...override.mutationTools]);
	}
	if (override.completionGuard !== undefined) {
		fill("completionGuard", ["completionGuard"], override.completionGuard);
	}
	if (override.toolBudget !== undefined) {
		fill("toolBudget", ["toolBudget"], override.toolBudget === false ? undefined : override.toolBudget);
	}

	if (!anyFilled || !next) return agent;
	next.override = { ...meta, base: agent.override?.base ?? cloneOverrideBase(agent) };
	const frontmatterFields = agentFrontmatterFields.get(agent);
	if (frontmatterFields) agentFrontmatterFields.set(next, frontmatterFields);
	return next;
}

function applyCustomAgentOverrides(
	agents: AgentConfig[],
	userSettings: SubagentSettings,
	projectSettings: SubagentSettings,
	userSettingsPath: string,
	projectSettingsPath: string | null,
): AgentConfig[] {
	// Apply user then project so project fields win without dropping user-only fields.
	return agents.map((agent) => {
		const userOverride = userSettings.overrides[agent.name];
		const withUserOverride = userOverride
			? applyCustomAgentOverride(agent, userOverride, { scope: "user", path: userSettingsPath })
			: agent;

		const projectOverride = projectSettings.overrides[agent.name];
		const resolved = projectOverride && projectSettingsPath
			? applyCustomAgentOverride(withUserOverride, projectOverride, { scope: "project", path: projectSettingsPath })
			: withUserOverride;
		const hasExplicitGlobalContext = agentHasFrontmatterField(agent, "inheritGlobalContext")
			|| projectOverride?.inheritGlobalContext !== undefined
			|| userOverride?.inheritGlobalContext !== undefined;
		if (hasExplicitGlobalContext || resolved.inheritGlobalContext === resolved.inheritProjectContext) return resolved;
		const normalized = { ...resolved, inheritGlobalContext: resolved.inheritProjectContext };
		const frontmatterFields = agentFrontmatterFields.get(resolved);
		if (frontmatterFields) agentFrontmatterFields.set(normalized, frontmatterFields);
		return normalized;
	});
}

export function buildBuiltinOverrideConfig(
	base: BuiltinAgentOverrideBase,
	draft: Pick<AgentConfig, "model" | "modelProvider" | "fallbackModels" | "fast" | "thinking" | "systemPromptMode" | "inheritProjectContext" | "inheritGlobalContext" | "inheritSkills" | "defaultContext" | "acceptanceRole" | "disabled" | "systemPrompt" | "skills" | "tools" | "allowNestedSubagents" | "mcpDirectTools" | "extensions" | "subagentOnlyExtensions" | "mutationTools" | "completionGuard" | "toolBudget"> & Partial<Pick<AgentConfig, "description" | "output" | "outputMode" | "defaultReads">>,
): BuiltinAgentOverrideConfig | undefined {
	const override: BuiltinAgentOverrideConfig = {};

	if (draft.description !== undefined) {
		const description = draft.description.trim();
		if (description && description !== base.description) override.description = description;
	}
	if (draft.output !== base.output) override.output = draft.output ?? false;
	if (draft.outputMode !== undefined && draft.outputMode !== base.outputMode) override.outputMode = draft.outputMode;
	if (!arraysEqual(draft.defaultReads, base.defaultReads)) override.defaultReads = draft.defaultReads ? [...draft.defaultReads] : false;
	if (draft.model !== base.model) override.model = draft.model ?? false;
	if (draft.modelProvider !== base.modelProvider) override.defaultProvider = draft.modelProvider ?? false;
	if (!arraysEqual(draft.fallbackModels, base.fallbackModels)) override.fallbackModels = draft.fallbackModels ? [...draft.fallbackModels] : false;
	if (draft.fast !== base.fast) override.fast = draft.fast === true;
	if (draft.thinking !== base.thinking) override.thinking = draft.thinking ?? false;
	if (draft.systemPromptMode !== base.systemPromptMode) override.systemPromptMode = draft.systemPromptMode;
	if (draft.inheritProjectContext !== base.inheritProjectContext) override.inheritProjectContext = draft.inheritProjectContext;
	if (draft.inheritGlobalContext !== base.inheritGlobalContext) override.inheritGlobalContext = draft.inheritGlobalContext;
	if (draft.inheritSkills !== base.inheritSkills) override.inheritSkills = draft.inheritSkills;
	if (draft.defaultContext !== base.defaultContext) override.defaultContext = draft.defaultContext ?? false;
	if (draft.acceptanceRole !== base.acceptanceRole) override.acceptanceRole = draft.acceptanceRole ?? false;
	if (draft.disabled !== base.disabled) override.disabled = draft.disabled ?? false;
	if (draft.systemPrompt !== base.systemPrompt) override.systemPrompt = draft.systemPrompt;
	if (!arraysEqual(draft.skills, base.skills)) override.skills = draft.skills ? [...draft.skills] : false;

	const baseTools = joinToolList(base);
	const draftTools = joinToolList(draft);
	if (!arraysEqual(draftTools, baseTools)) override.tools = draftTools ? [...draftTools] : false;
	if (draft.allowNestedSubagents !== base.allowNestedSubagents) override.allowNestedSubagents = draft.allowNestedSubagents === true;
	if (!arraysEqual(draft.extensions, base.extensions)) override.extensions = draft.extensions ? [...draft.extensions] : false;
	if (!arraysEqual(draft.subagentOnlyExtensions, base.subagentOnlyExtensions)) {
		override.subagentOnlyExtensions = draft.subagentOnlyExtensions ? [...draft.subagentOnlyExtensions] : false;
	}
	if (!arraysEqual(draft.mutationTools, base.mutationTools)) override.mutationTools = draft.mutationTools ? [...draft.mutationTools] : false;
	if ((draft.completionGuard !== false) !== (base.completionGuard !== false)) {
		override.completionGuard = draft.completionGuard !== false;
	}
	if (JSON.stringify(draft.toolBudget) !== JSON.stringify(base.toolBudget)) override.toolBudget = draft.toolBudget ?? false;

	return Object.keys(override).length > 0 ? override : undefined;
}

export function saveBuiltinAgentOverride(
	cwd: string,
	name: string,
	scope: "user" | "project",
	override: BuiltinAgentOverrideConfig,
): string {
	const filePath = scope === "project" ? getProjectAgentSettingsPath(cwd) : getUserAgentSettingsPath();
	if (!filePath) throw new Error("Project override is not available here. No project config root was found.");

	const settings = readSettingsFileStrict(filePath);
	const subagents = settings.subagents && typeof settings.subagents === "object" && !Array.isArray(settings.subagents)
		? { ...(settings.subagents as Record<string, unknown>) }
		: {};
	const agentOverrides = subagents.agentOverrides && typeof subagents.agentOverrides === "object" && !Array.isArray(subagents.agentOverrides)
		? { ...(subagents.agentOverrides as Record<string, unknown>) }
		: {};

	agentOverrides[name] = cloneOverrideValue(override);
	subagents.agentOverrides = agentOverrides;
	settings.subagents = subagents;
	writeSettingsFile(filePath, settings);
	return filePath;
}

export function removeBuiltinAgentOverride(cwd: string, name: string, scope: "user" | "project"): { path: string; removed: boolean } {
	const filePath = scope === "project" ? getProjectAgentSettingsPath(cwd) : getUserAgentSettingsPath();
	if (!filePath) throw new Error("Project override is not available here. No project config root was found.");
	if (!fs.existsSync(filePath)) return { path: filePath, removed: false };

	const settings = readSettingsFileStrict(filePath);
	const subagents = settings.subagents;
	if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) return { path: filePath, removed: false };
	const nextSubagents = { ...(subagents as Record<string, unknown>) };
	const agentOverrides = nextSubagents.agentOverrides;
	if (!agentOverrides || typeof agentOverrides !== "object" || Array.isArray(agentOverrides)) return { path: filePath, removed: false };

	const nextOverrides = { ...(agentOverrides as Record<string, unknown>) };
	if (!Object.prototype.hasOwnProperty.call(nextOverrides, name)) return { path: filePath, removed: false };
	delete nextOverrides[name];
	if (Object.keys(nextOverrides).length > 0) nextSubagents.agentOverrides = nextOverrides;
	else delete nextSubagents.agentOverrides;

	if (Object.keys(nextSubagents).length > 0) settings.subagents = nextSubagents;
	else delete settings.subagents;

	writeSettingsFile(filePath, settings);
	return { path: filePath, removed: true };
}

export function mergeBuiltinAgentOverride(
	cwd: string,
	name: string,
	scope: "user" | "project",
	fields: BuiltinAgentOverrideConfig,
): string {
	const filePath = scope === "project" ? getProjectAgentSettingsPath(cwd) : getUserAgentSettingsPath();
	if (!filePath) throw new Error("Project override is not available here. No project config root was found.");

	const settings = readSettingsFileStrict(filePath);
	const subagents = settings.subagents && typeof settings.subagents === "object" && !Array.isArray(settings.subagents)
		? { ...(settings.subagents as Record<string, unknown>) }
		: {};
	const agentOverrides = subagents.agentOverrides && typeof subagents.agentOverrides === "object" && !Array.isArray(subagents.agentOverrides)
		? { ...(subagents.agentOverrides as Record<string, unknown>) }
		: {};

	const existing = agentOverrides[name];
	const base = existing && typeof existing === "object" && !Array.isArray(existing)
		? existing as Record<string, unknown>
		: {};
	agentOverrides[name] = { ...base, ...cloneOverrideValue(fields) };
	subagents.agentOverrides = agentOverrides;
	settings.subagents = subagents;
	writeSettingsFile(filePath, settings);
	return filePath;
}

export function removeBuiltinAgentOverrideFields(
	cwd: string,
	name: string,
	scope: "user" | "project",
	fields: string[],
): { path: string; removed: boolean } {
	const filePath = scope === "project" ? getProjectAgentSettingsPath(cwd) : getUserAgentSettingsPath();
	if (!filePath) throw new Error("Project override is not available here. No project config root was found.");
	if (!fs.existsSync(filePath)) return { path: filePath, removed: false };

	const settings = readSettingsFileStrict(filePath);
	const subagents = settings.subagents;
	if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) return { path: filePath, removed: false };
	const agentOverrides = (subagents as Record<string, unknown>).agentOverrides;
	if (!agentOverrides || typeof agentOverrides !== "object" || Array.isArray(agentOverrides)) return { path: filePath, removed: false };

	const entry = (agentOverrides as Record<string, unknown>)[name];
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { path: filePath, removed: false };

	const nextEntry: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
	let removed = false;
	for (const field of fields) {
		if (Object.prototype.hasOwnProperty.call(nextEntry, field)) {
			delete nextEntry[field];
			removed = true;
		}
	}
	if (!removed) return { path: filePath, removed: false };

	const nextSubagents = { ...(subagents as Record<string, unknown>) };
	if (Object.keys(nextEntry).length > 0) {
		(nextSubagents.agentOverrides as Record<string, unknown>)[name] = nextEntry;
	} else {
		const nextOverrides = { ...(agentOverrides as Record<string, unknown>) };
		delete nextOverrides[name];
		if (Object.keys(nextOverrides).length > 0) nextSubagents.agentOverrides = nextOverrides;
		else delete nextSubagents.agentOverrides;
	}
	if (Object.keys(nextSubagents).length > 0) settings.subagents = nextSubagents;
	else delete settings.subagents;
	writeSettingsFile(filePath, settings);
	return { path: filePath, removed: true };
}

const DISCOVERY_PRUNED_DIR_NAMES = new Set([".git", "node_modules", ".pi", "sync-backups"]);

function isDiscoveryNestedProjectRoot(dir: string): boolean {
	return isDirectory(getProjectConfigDir(dir)) || isDirectory(path.join(dir, ".agents"));
}

function shouldPruneDiscoveryDir(rootDir: string, dir: string, dirName: string): boolean {
	if (DISCOVERY_PRUNED_DIR_NAMES.has(dirName)) return true;
	if (fs.existsSync(path.join(dir, ".git"))) return true;
	return path.resolve(dir) !== path.resolve(rootDir) && isDiscoveryNestedProjectRoot(dir);
}

const LEGACY_CHAIN_DISCOVERY_MAX_DEPTH = 8;
const LEGACY_CHAIN_DISCOVERY_MAX_DIRECTORIES = 256;
const LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES = 4096;
const LEGACY_CHAIN_DISCOVERY_MAX_CANDIDATES = 256;
const LEGACY_CHAIN_FILE_MAX_BYTES = 256 * 1024;

interface LegacyChainFileDiscovery {
	files: string[];
	diagnostics: Array<{ filePath: string; error: string }>;
}

interface LegacyChainDiscoveryBudget {
	directories: number;
	entries: number;
	candidates: number;
}

function createLegacyChainDiscoveryBudget(): LegacyChainDiscoveryBudget {
	return { directories: 0, entries: 0, candidates: 0 };
}

function readLegacyCompatibilityJson(filePath: string): { value?: Record<string, unknown>; error?: string } {
	let descriptor: number | undefined;
	try {
		assertNoSymlinkPathComponents(filePath);
		const pathStat = fs.lstatSync(filePath);
		if (pathStat.isSymbolicLink() || !pathStat.isFile()) return {};
		if (pathStat.size > LEGACY_CHAIN_FILE_MAX_BYTES) {
			return { error: `Legacy chain compatibility discovery rejected '${filePath}' above its ${LEGACY_CHAIN_FILE_MAX_BYTES}-byte file limit.` };
		}
		descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
		const openedStat = fs.fstatSync(descriptor);
		if (!openedStat.isFile() || openedStat.size > LEGACY_CHAIN_FILE_MAX_BYTES) {
			return { error: `Legacy chain compatibility discovery rejected '${filePath}' above its ${LEGACY_CHAIN_FILE_MAX_BYTES}-byte file limit.` };
		}
		const content = Buffer.alloc(openedStat.size);
		let offset = 0;
		while (offset < content.length) {
			const count = fs.readSync(descriptor, content, offset, content.length - offset, offset);
			if (count === 0) break;
			offset += count;
		}
		if (offset !== content.length) return { error: `Legacy chain compatibility discovery could not read '${filePath}' completely.` };
		const value: unknown = JSON.parse(content.toString("utf-8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `Legacy chain compatibility discovery expected an object in '${filePath}'.` };
		return { value: value as Record<string, unknown> };
	} catch (error) {
		const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
		if (code === "ENOENT") return {};
		return { error: error instanceof Error ? error.message : String(error) };
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor);
	}
}

function legacyChainDiscoveryBudgetError(budget: LegacyChainDiscoveryBudget): string | undefined {
	if (budget.directories >= LEGACY_CHAIN_DISCOVERY_MAX_DIRECTORIES) return `Legacy chain compatibility discovery reached its directory limit of ${LEGACY_CHAIN_DISCOVERY_MAX_DIRECTORIES}.`;
	if (budget.entries >= LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES) return `Legacy chain compatibility discovery reached its entry limit of ${LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES}.`;
	if (budget.candidates >= LEGACY_CHAIN_DISCOVERY_MAX_CANDIDATES) return `Legacy chain compatibility discovery reached its candidate limit of ${LEGACY_CHAIN_DISCOVERY_MAX_CANDIDATES}.`;
	return undefined;
}

function collectLegacyPackageChainDirs(projectRoot: string | null, budget: LegacyChainDiscoveryBudget): { dirs: string[]; diagnostics: ChainDiscoveryDiagnostic[] } {
	const dirs: string[] = [];
	const diagnostics: ChainDiscoveryDiagnostic[] = [];
	const packageRoots: string[] = [];
	const seenPackageRoots = new Set<string>();
	let directoryLimitReported = false;
	let entryLimitReported = false;

	const report = (filePath: string, error: string): void => {
		diagnostics.push({ source: "package", filePath, error });
	};
	const claimDirectory = (dir: string): boolean => {
		if (budget.directories >= LEGACY_CHAIN_DISCOVERY_MAX_DIRECTORIES) {
			if (!directoryLimitReported) {
				directoryLimitReported = true;
				report(dir, `Legacy chain compatibility discovery reached its directory limit of ${LEGACY_CHAIN_DISCOVERY_MAX_DIRECTORIES}.`);
			}
			return false;
		}
		budget.directories += 1;
		return true;
	};
	const readDirectory = (dir: string): fs.Dirent[] => {
		if (!claimDirectory(dir)) return [];
		try {
			assertNoSymlinkPathComponents(dir);
			const stat = fs.lstatSync(dir);
			if (stat.isSymbolicLink() || !stat.isDirectory()) return [];
			const directory = fs.opendirSync(dir, { bufferSize: 32 });
			const entries: fs.Dirent[] = [];
			try {
				while (budget.entries < LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES) {
					const entry = directory.readSync();
					if (!entry) break;
					entries.push(entry);
					budget.entries += 1;
				}
				if (budget.entries === LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES && directory.readSync() !== null && !entryLimitReported) {
					entryLimitReported = true;
					report(dir, `Legacy chain compatibility discovery reached its entry limit of ${LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES}.`);
				}
			} finally {
				directory.closeSync();
			}
			return entries.sort((left, right) => left.name.localeCompare(right.name));
		} catch (error) {
			const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
			if (code !== "ENOENT") report(dir, error instanceof Error ? error.message : String(error));
			return [];
		}
	};
	const addPackageRoot = (packageRoot: string): void => {
		const resolvedRoot = path.resolve(packageRoot);
		if (seenPackageRoots.has(resolvedRoot)) return;
		seenPackageRoots.add(resolvedRoot);
		packageRoots.push(resolvedRoot);
	};
	const readSettingsPackageRoots = (settingsFile: string, baseDir: string): void => {
		if (budget.entries >= LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES) return;
		const loaded = readLegacyCompatibilityJson(settingsFile);
		if (loaded.error) report(settingsFile, loaded.error);
		const packages = loaded.value?.packages;
		if (!Array.isArray(packages)) return;
		for (const entry of packages) {
			if (budget.entries >= LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES) {
				if (!entryLimitReported) {
					entryLimitReported = true;
					report(settingsFile, `Legacy chain compatibility discovery reached its entry limit of ${LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES}.`);
				}
				break;
			}
			budget.entries += 1;
			const source = typeof entry === "string"
				? entry
				: entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string"
					? (entry as { source: string }).source
					: undefined;
			if (!source) continue;
			const packageRoot = resolveSettingsPackageRoot(source, baseDir);
			if (packageRoot) addPackageRoot(packageRoot);
		}
	};
	const readNodeModulesPackageRoots = (nodeModulesDir: string): void => {
		for (const entry of readDirectory(nodeModulesDir)) {
			if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
			const entryPath = path.join(nodeModulesDir, entry.name);
			if (entry.name.startsWith("@")) {
				for (const scopeEntry of readDirectory(entryPath)) {
					if (!scopeEntry.name.startsWith(".") && scopeEntry.isDirectory()) addPackageRoot(path.join(entryPath, scopeEntry.name));
				}
			} else {
				addPackageRoot(entryPath);
			}
		}
	};

	const agentDir = getAgentDir();
	if (projectRoot) {
		const projectConfigDir = getProjectConfigDir(projectRoot);
		addPackageRoot(projectRoot);
		readNodeModulesPackageRoots(path.join(projectConfigDir, "npm", "node_modules"));
		readSettingsPackageRoots(path.join(projectConfigDir, "settings.json"), projectConfigDir);
	}
	readNodeModulesPackageRoots(path.join(agentDir, "npm", "node_modules"));
	readSettingsPackageRoots(path.join(agentDir, "settings.json"), agentDir);
	const globalRoot = getGlobalNpmRoot();
	if (globalRoot) readNodeModulesPackageRoots(globalRoot);

	for (const packageRoot of packageRoots) {
		if (!claimDirectory(packageRoot)) break;
		const manifestPath = path.join(packageRoot, "package.json");
		const loaded = readLegacyCompatibilityJson(manifestPath);
		if (loaded.error) {
			report(manifestPath, loaded.error);
			continue;
		}
		if (!loaded.value) continue;
		const roots: Record<string, unknown>[] = [];
		const piSubagents = loaded.value["pi-subagents"];
		if (piSubagents && typeof piSubagents === "object" && !Array.isArray(piSubagents)) roots.push(piSubagents as Record<string, unknown>);
		const pi = loaded.value.pi;
		const subagents = pi && typeof pi === "object" && !Array.isArray(pi) ? (pi as { subagents?: unknown }).subagents : undefined;
		if (subagents && typeof subagents === "object" && !Array.isArray(subagents)) roots.push(subagents as Record<string, unknown>);
		for (const root of roots) {
			for (const chainDir of stringArray(root.chains)) {
				if (budget.entries >= LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES) {
					if (!entryLimitReported) {
						entryLimitReported = true;
						report(manifestPath, `Legacy chain compatibility discovery reached its entry limit of ${LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES}.`);
					}
					break;
				}
				budget.entries += 1;
				dirs.push(path.resolve(packageRoot, chainDir));
			}
		}
	}
	return { dirs: [...new Set(dirs)], diagnostics };
}

function discoverLegacyChainFiles(dir: string, budget: LegacyChainDiscoveryBudget): LegacyChainFileDiscovery {
	const rootDir = path.resolve(dir);
	const files: string[] = [];
	const diagnostics: Array<{ filePath: string; error: string }> = [];
	const budgetError = legacyChainDiscoveryBudgetError(budget);
	if (budgetError) return { files, diagnostics: [{ filePath: rootDir, error: budgetError }] };
	try {
		assertNoSymlinkPathComponents(rootDir);
	} catch (error) {
		return { files, diagnostics: [{ filePath: rootDir, error: error instanceof Error ? error.message : String(error) }] };
	}
	budget.directories += 1;
	try {
		const rootStat = fs.lstatSync(rootDir);
		if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return { files, diagnostics };
	} catch {
		return { files, diagnostics };
	}

	const pending: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
	let depthLimitReported = false;
	let directoryLimitReported = false;
	let entryLimitReported = false;
	let candidateLimitReported = false;

	while (pending.length > 0 && !entryLimitReported && !candidateLimitReported) {
		const current = pending.shift();
		if (!current) throw new Error("legacy chain discovery queue unexpectedly empty");
		let directory: fs.Dir;
		try {
			const directoryStat = fs.lstatSync(current.dir);
			if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) continue;
			directory = fs.opendirSync(current.dir, { bufferSize: 32 });
		} catch {
			continue;
		}
		const entries: fs.Dirent[] = [];
		try {
			while (budget.entries < LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES) {
				const entry = directory.readSync();
				if (!entry) break;
				entries.push(entry);
				budget.entries += 1;
			}
			if (budget.entries === LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES && directory.readSync() !== null) {
				entryLimitReported = true;
				diagnostics.push({ filePath: rootDir, error: `Legacy chain compatibility discovery reached its entry limit of ${LEGACY_CHAIN_DISCOVERY_MAX_ENTRIES}.` });
			}
		} catch {
			continue;
		} finally {
			try {
				directory.closeSync();
			} catch {
				// Discovery is best-effort and the bounded directory handle is already unusable.
			}
		}

		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			if (entry.isSymbolicLink()) continue;
			const filePath = path.join(current.dir, entry.name);
			if (entry.isDirectory()) {
				if (shouldPruneDiscoveryDir(rootDir, filePath, entry.name)) continue;
				if (current.depth >= LEGACY_CHAIN_DISCOVERY_MAX_DEPTH) {
					if (!depthLimitReported) {
						depthLimitReported = true;
						diagnostics.push({ filePath, error: `Legacy chain compatibility discovery reached its depth limit of ${LEGACY_CHAIN_DISCOVERY_MAX_DEPTH}.` });
					}
					continue;
				}
				if (budget.directories >= LEGACY_CHAIN_DISCOVERY_MAX_DIRECTORIES) {
					if (!directoryLimitReported) {
						directoryLimitReported = true;
						diagnostics.push({ filePath, error: `Legacy chain compatibility discovery reached its directory limit of ${LEGACY_CHAIN_DISCOVERY_MAX_DIRECTORIES}.` });
					}
					continue;
				}
				pending.push({ dir: filePath, depth: current.depth + 1 });
				budget.directories += 1;
				continue;
			}
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".chain.md") && !entry.name.endsWith(".chain.json")) continue;
			if (budget.candidates >= LEGACY_CHAIN_DISCOVERY_MAX_CANDIDATES) {
				candidateLimitReported = true;
				diagnostics.push({ filePath, error: `Legacy chain compatibility discovery reached its candidate limit of ${LEGACY_CHAIN_DISCOVERY_MAX_CANDIDATES}.` });
				break;
			}
			files.push(filePath);
			budget.candidates += 1;
		}
	}

	return { files, diagnostics };
}

function readLegacyChainFile(filePath: string): { content?: string; error?: string } {
	let descriptor: number | undefined;
	try {
		const pathStat = fs.lstatSync(filePath);
		if (pathStat.isSymbolicLink() || !pathStat.isFile()) return {};
		if (pathStat.size > LEGACY_CHAIN_FILE_MAX_BYTES) {
			return { error: `Legacy chain compatibility reader rejected a file above its ${LEGACY_CHAIN_FILE_MAX_BYTES}-byte file limit.` };
		}
		const noFollow = fs.constants.O_NOFOLLOW ?? 0;
		descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
		const openedStat = fs.fstatSync(descriptor);
		if (!openedStat.isFile()) return {};
		if (openedStat.size > LEGACY_CHAIN_FILE_MAX_BYTES) {
			return { error: `Legacy chain compatibility reader rejected a file above its ${LEGACY_CHAIN_FILE_MAX_BYTES}-byte file limit.` };
		}
		const chunks: Buffer[] = [];
		const buffer = Buffer.allocUnsafe(8192);
		let totalBytes = 0;
		while (totalBytes <= LEGACY_CHAIN_FILE_MAX_BYTES) {
			const remaining = LEGACY_CHAIN_FILE_MAX_BYTES + 1 - totalBytes;
			const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, remaining), null);
			if (count === 0) break;
			chunks.push(Buffer.from(buffer.subarray(0, count)));
			totalBytes += count;
		}
		if (totalBytes > LEGACY_CHAIN_FILE_MAX_BYTES) {
			return { error: `Legacy chain compatibility reader rejected a file above its ${LEGACY_CHAIN_FILE_MAX_BYTES}-byte file limit.` };
		}
		return { content: Buffer.concat(chunks, totalBytes).toString("utf-8") };
	} catch {
		return {};
	} finally {
		if (descriptor !== undefined) {
			try {
				fs.closeSync(descriptor);
			} catch {
				// The bounded read is already complete or failed.
			}
		}
	}
}

export interface AgentDefinitionInspection {
	files: string[];
	state: AgentDefinitionDirectoryState;
}

/** Narrow filesystem seam so unavailable paths can be tested without permissions. */
export interface AgentDefinitionInspectionFs {
	existsSync(filePath: string): boolean;
	realpathSync?(filePath: string): string;
	statSync(filePath: string): { isDirectory(): boolean };
	readdirSync(dir: string): fs.Dirent[];
}

const DEFAULT_AGENT_DEFINITION_INSPECTION_FS: AgentDefinitionInspectionFs = {
	existsSync: fs.existsSync,
	realpathSync: fs.realpathSync,
	statSync: fs.statSync,
	readdirSync: (dir) => fs.readdirSync(dir, { withFileTypes: true }),
};

/**
 * Inspect one agent-definition directory while retaining traversal failure
 * state. A nested unreadable directory makes the whole inspection unavailable,
 * preventing a partial traversal from being reported as empty or complete.
 */
export function inspectAgentDefinitionDirectory(dir: string, operations: AgentDefinitionInspectionFs = DEFAULT_AGENT_DEFINITION_INSPECTION_FS): AgentDefinitionInspection {
	const root = path.resolve(dir);
	try {
		if (!operations.existsSync(root)) return { files: [], state: "absent" };
		if (!operations.statSync(root).isDirectory()) return { files: [], state: "not-directory" };
	} catch {
		return { files: [], state: "unreadable" };
	}
	const files: string[] = [];
	let unreadable = false;
	const visitedDirectories = new Set<string>();
	const visit = (current: string): void => {
		let realDir: string;
		try {
			realDir = operations.realpathSync?.(current) ?? path.resolve(current);
		} catch {
			unreadable = true;
			return;
		}
		if (visitedDirectories.has(realDir)) return;
		visitedDirectories.add(realDir);

		let entries: fs.Dirent[];
		try {
			entries = operations.readdirSync(current).sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			unreadable = true;
			return;
		}
		for (const entry of entries) {
			const filePath = path.join(current, entry.name);
			let isDirectory = entry.isDirectory();
			if (entry.isSymbolicLink()) {
				try {
					isDirectory = operations.statSync(filePath).isDirectory();
				} catch {
					isDirectory = false;
				}
			}
			if (isDirectory) {
				if (!shouldPruneDiscoveryDir(root, filePath, entry.name)) visit(filePath);
				continue;
			}
			if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md") && !entry.name.endsWith(".chain.md") && !isLegacyAgentSkillPath(root, filePath)) files.push(filePath);
		}
	};
	visit(root);
	return { files, state: unreadable ? "unreadable" : files.length ? "candidates" : "empty" };
}

function isLegacyAgentSkillPath(rootDir: string, filePath: string): boolean {
	const relative = path.relative(rootDir, filePath);
	const parts = relative.split(path.sep).map((part) => part.toLowerCase());
	if (path.basename(rootDir).toLowerCase() === ".agents") {
		parts.unshift(".agents");
	}
	return parts.some((part, index) => part === ".agents" && parts[index + 1] === "skills");
}

function isJsonSerializable(value: unknown): boolean {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonSerializable);
	if (value && typeof value === "object") return Object.values(value).every(isJsonSerializable);
	return false;
}

function parseAgentRunnerFrontmatter(raw: string | undefined, agentName: string): AgentRunnerConfig | undefined {
	if (raw === undefined || !raw.trim()) return undefined;
	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (error) {
		throw new Error(`Agent '${agentName}' has invalid runner frontmatter: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Agent '${agentName}' has invalid runner frontmatter; expected an object.`);
	}
	const runner = parsed as Record<string, unknown>;
	if (runner.type === "pi") {
		if (Object.keys(runner).some((key) => key !== "type")) throw new Error(`Agent '${agentName}' has invalid Pi runner frontmatter; only 'type' is supported.`);
		return { type: "pi" };
	}
	if (runner.type === "external-job") {
		if (typeof runner.provider !== "string" || !runner.provider.trim() || runner.provider.trim() !== runner.provider) {
			throw new Error(`Agent '${agentName}' external-job runner requires a non-empty trimmed provider string.`);
		}
		if (runner.options !== undefined && (!runner.options || typeof runner.options !== "object" || Array.isArray(runner.options) || !isJsonSerializable(runner.options))) {
			throw new Error(`Agent '${agentName}' external-job runner options must be a JSON-serializable object.`);
		}
		const supported = new Set(["type", "provider", "options"]);
		const unknown = Object.keys(runner).filter((key) => !supported.has(key));
		if (unknown.length > 0) throw new Error(`Agent '${agentName}' external-job runner has unsupported fields: ${unknown.join(", ")}.`);
		return {
			type: "external-job",
			provider: runner.provider,
			...(runner.options ? { options: runner.options as Record<string, unknown> } : {}),
		};
	}
	if (runner.type !== "external-cli") {
		throw new Error(`Agent '${agentName}' has invalid runner.type; expected 'pi', 'external-cli', or 'external-job'.`);
	}
	if (typeof runner.command !== "string" || !runner.command.trim()) {
		throw new Error(`Agent '${agentName}' external-cli runner requires a non-empty command string.`);
	}
	if (runner.args !== undefined && (!Array.isArray(runner.args) || runner.args.some((arg) => typeof arg !== "string"))) {
		throw new Error(`Agent '${agentName}' external-cli runner args must be an array of strings.`);
	}
	if (runner.adapter !== undefined && !isCodeOwnedExternalCliAdapterId(runner.adapter)) throw new Error(`Agent '${agentName}' external-cli runner adapter must be ${CODE_OWNED_EXTERNAL_CLI_ADAPTER_LABEL}.`);
	if (runner.adapter !== undefined && Array.isArray(runner.args) && runner.args.length > 0) throw new Error(`Agent '${agentName}' ${runner.adapter} adapter owns its argv; runner args are not supported.`);
	if (runner.promptDelivery !== undefined && runner.promptDelivery !== "stdin") {
		throw new Error(`Agent '${agentName}' external-cli runner promptDelivery must be 'stdin'.`);
	}
	const capabilities = parseExternalCliCapabilityNarrowing(runner.capabilities, `Agent '${agentName}' external-cli runner capabilities`);
	const supported = new Set(["type", "adapter", "command", "args", "promptDelivery", "capabilities"]);
	const unknown = Object.keys(runner).filter((key) => !supported.has(key));
	if (unknown.length > 0) throw new Error(`Agent '${agentName}' external-cli runner has unsupported fields: ${unknown.join(", ")}.`);
	const runnerArgs = Array.isArray(runner.args) ? runner.args.filter((arg): arg is string => typeof arg === "string") : undefined;
	return {
		type: "external-cli",
		...(isCodeOwnedExternalCliAdapterId(runner.adapter) ? { adapter: runner.adapter } : {}),
		command: runner.command.trim(),
		...(runnerArgs?.length ? { args: runnerArgs } : {}),
		...(runner.promptDelivery ? { promptDelivery: "stdin" as const } : {}),
		...(capabilities ? { capabilities } : {}),
	};
}

function validateExternalRunnerProfile(frontmatter: Record<string, string>, agentName: string, runner: AgentRunnerConfig | undefined): void {
	if (runner?.type !== "external-cli" && runner?.type !== "external-job") return;
	const unsupported = ["tools", "allowNestedSubagents", "model", "fallbackModels", "thinking", "extensions", "subagentOnlyExtensions", "mutationTools", "maxSubagentDepth", "completionGuard", "skills", "skill", "skillPath", "toolBudget", "permission", "permissions"]
		.filter((field) => frontmatter[field] !== undefined);
	if (unsupported.length > 0) {
		throw new Error(`Agent '${agentName}' uses runner.type='${runner.type}' and declares unsupported Pi-only fields: ${unsupported.join(", ")}.`);
	}
}

function parseAgentAcceptanceFrontmatter(raw: string | undefined, agentName: string): AcceptanceInput | undefined {
	if (raw === undefined || !raw.trim()) return undefined;
	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (error) {
		throw new Error(`Agent '${agentName}' has invalid acceptance frontmatter: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	const errors = validateAcceptanceInput(parsed, `Agent '${agentName}' acceptance frontmatter`);
	if (errors.length > 0) throw new Error(errors.join(" "));
	return parsed as AcceptanceInput;
}

interface AgentDefinitionFile {
	filePath: string;
	content: string;
}

function readAgentDefinitionFiles(dir: string, inspection = inspectAgentDefinitionDirectory(dir)): AgentDefinitionFile[] {
	const files: AgentDefinitionFile[] = [];
	for (const filePath of inspection.files) {
		if (isLegacyAgentSkillPath(dir, filePath)) {
			continue;
		}

		try {
			files.push({ filePath, content: fs.readFileSync(filePath, "utf-8") });
		} catch {
			continue;
		}
	}
	return files;
}

function resolveAgentRelativeExtensionPaths(paths: string[] | undefined, agentFilePath: string): string[] | undefined {
	if (paths === undefined) return undefined;
	const baseDir = path.dirname(agentFilePath);
	return paths.map((entry) => {
		const trimmed = entry.trim();
		if (trimmed === "." || trimmed === ".." || trimmed.startsWith("./") || trimmed.startsWith("../")) {
			return path.resolve(baseDir, trimmed);
		}
		return entry;
	});
}

function loadAgentsFromDefinitionFiles(files: AgentDefinitionFile[], source: AgentSource, discoveryPriority?: number, packageSource?: Omit<PackageSubagentPath, "dir">): { agents: AgentConfig[]; diagnostics: AgentDiscoveryDiagnostic[] } {
	const agents: AgentConfig[] = [];
	const diagnostics: AgentDiscoveryDiagnostic[] = [];

	for (const { filePath, content } of files) {
		let name: string | undefined;
		let runtimeName: string | undefined;
		let packageSpecified = false;
		try {
		const { frontmatter, body } = parseFrontmatter(content);

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const localName = frontmatter.name;
		name = localName;
		const parsedPackage = parsePackageName(frontmatter.package, `Agent '${localName}' package`);
		packageSpecified = parsedPackage.packageName !== undefined || parsedPackage.error !== undefined;
		if (parsedPackage.error) throw new Error(parsedPackage.error);
		const packageName = parsedPackage.packageName;
		runtimeName = buildRuntimeName(localName, packageName);

		const runner = parseAgentRunnerFrontmatter(frontmatter.runner, localName);
		validateExternalRunnerProfile(frontmatter, localName, runner);
		const rawTools = parseFrontmatterList(frontmatter.tools);
		const parsedTools = splitToolList(rawTools);
		const tools = parsedTools.tools ?? [];
		const mcpDirectTools = parsedTools.mcpDirectTools ?? [];
		const defaultReads = parseFrontmatterList(frontmatter.defaultReads);
		const aliases = normalizeAgentAliases(parseFrontmatterList(frontmatter.aliases ?? frontmatter.alias), runtimeName);
		const profileError = validateCodeOwnedProfileRunner({ name: runtimeName, localName, aliases, runner });
		if (profileError) throw new Error(profileError);
		const skillStr = frontmatter.skill || frontmatter.skills;
		const skills = parseFrontmatterList(skillStr);
		const skillPath = parseFrontmatterList(frontmatter.skillPath);
		const fallbackModels = parseFrontmatterList(frontmatter.fallbackModels);
		const systemPromptMode = frontmatter.systemPromptMode === "replace"
			? "replace"
			: frontmatter.systemPromptMode === "append"
				? "append"
				: defaultSystemPromptMode(localName);
		const inheritProjectContext = frontmatter.inheritProjectContext === "true"
			? true
			: frontmatter.inheritProjectContext === "false"
				? false
				: defaultInheritProjectContext(localName);
		const inheritGlobalContext = frontmatter.inheritGlobalContext === "true"
			? true
			: frontmatter.inheritGlobalContext === "false"
				? false
				: inheritProjectContext;
		const inheritSkills = frontmatter.inheritSkills === "true"
			? true
			: frontmatter.inheritSkills === "false"
				? false
				: defaultInheritSkills();
		const defaultContext = frontmatter.defaultContext === "fork"
			? "fork" as const
			: frontmatter.defaultContext === "fresh"
				? "fresh" as const
				: undefined;
		let defaultAsync: boolean | undefined;
		if (frontmatter.async !== undefined) {
			if (frontmatter.async === "true") defaultAsync = true;
			else if (frontmatter.async === "false") defaultAsync = false;
			else throw new Error(`Agent '${localName}' has invalid async frontmatter; expected true or false.`);
		}
		let defaultTimeoutMs: number | undefined;
		if (frontmatter.timeoutMs !== undefined) {
			const parsed = Number(frontmatter.timeoutMs);
			if (!Number.isInteger(parsed) || parsed <= 0) {
				throw new Error(`Agent '${localName}' has invalid timeoutMs frontmatter; expected a positive integer.`);
			}
			defaultTimeoutMs = parsed;
		}
		let defaultToolTimeoutMs: number | undefined;
		if (frontmatter.toolTimeoutMs !== undefined) {
			const parsed = Number(frontmatter.toolTimeoutMs);
			if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
				throw new Error(`Agent '${localName}' has invalid toolTimeoutMs frontmatter; expected a positive integer no larger than 2147483647.`);
			}
			defaultToolTimeoutMs = parsed;
		}
		const defaultAcceptance = parseAgentAcceptanceFrontmatter(frontmatter.acceptance, localName);
		let outputMode: OutputMode | undefined;
		if (frontmatter.outputMode !== undefined) {
			if (frontmatter.outputMode === "inline" || frontmatter.outputMode === "file-only") outputMode = frontmatter.outputMode;
			else throw new Error(`Agent '${localName}' has invalid outputMode frontmatter; expected 'inline' or 'file-only'.`);
		}
		let acceptanceRole: AcceptanceRole | undefined;
		if (frontmatter.acceptanceRole !== undefined && frontmatter.acceptanceRole.trim()) {
			if (frontmatter.acceptanceRole === "read-only" || frontmatter.acceptanceRole === "writer") acceptanceRole = frontmatter.acceptanceRole;
			else throw new Error(`Agent '${localName}' has invalid acceptanceRole frontmatter; expected 'read-only' or 'writer'.`);
		}

		const extensions = resolveAgentRelativeExtensionPaths(parseFrontmatterList(frontmatter.extensions), filePath);
		const subagentOnlyExtensions = resolveAgentRelativeExtensionPaths(parseFrontmatterList(frontmatter.subagentOnlyExtensions), filePath);
		const mutationTools = parseFrontmatterList(frontmatter.mutationTools);
		let fast: boolean | undefined;
		if (frontmatter.fast !== undefined) {
			if (frontmatter.fast === "true") fast = true;
			else if (frontmatter.fast === "false") fast = false;
			else throw new Error(`Agent '${localName}' has invalid fast frontmatter; expected true or false.`);
		}
		let allowNestedSubagents: boolean | undefined;
		if (frontmatter.allowNestedSubagents !== undefined) {
			if (frontmatter.allowNestedSubagents === "true") allowNestedSubagents = true;
			else if (frontmatter.allowNestedSubagents === "false") allowNestedSubagents = false;
			else throw new Error(`Agent '${localName}' has invalid allowNestedSubagents frontmatter; expected true or false.`);
		}

		const extraFields: Record<string, string> = {};
		for (const [key, value] of Object.entries(frontmatter)) {
			if (!KNOWN_FIELDS.has(key)) extraFields[key] = value;
		}

		const parsedMaxSubagentDepth = Number(frontmatter.maxSubagentDepth);
		if (frontmatter.permission !== undefined && frontmatter.permissions !== undefined) {
			throw new Error(`Agent '${localName}' cannot declare both permission and permissions frontmatter.`);
		}
		const permissionSource = frontmatter.permissions ?? frontmatter.permission;
		const permissions = permissionSource?.trim()
			? validatePermissionRules(parseYaml(permissionSource), `Agent '${localName}' permissions`)
			: undefined;
		let toolBudget: ToolBudgetConfig | undefined;
		if (frontmatter.toolBudget !== undefined && frontmatter.toolBudget.trim()) {
			const parsed = JSON.parse(frontmatter.toolBudget) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error(`Agent '${localName}' has invalid toolBudget frontmatter; expected a JSON object.`);
			}
			toolBudget = parsed as ToolBudgetConfig;
		}
		const completionGuard = frontmatter.completionGuard === "false"
			? false
			: frontmatter.completionGuard === "true"
				? true
				: undefined;

		const maxSubagentDepth = Number.isInteger(parsedMaxSubagentDepth) && parsedMaxSubagentDepth >= 0
			? parsedMaxSubagentDepth
			: undefined;
		const memory = parseMemoryFrontmatter(frontmatter.memory);
		const agent: AgentConfig = {
			name: runtimeName,
			...(runner !== undefined ? { runner } : {}),
			localName,
			...(packageName !== undefined ? { packageName } : {}),
			...(packageSource?.packageName ? { packageSourceName: packageSource.packageName } : {}),
			...(packageSource?.packageVersion ? { packageSourceVersion: packageSource.packageVersion } : {}),
			...(packageSource?.packageRoot ? { packageSourceRoot: packageSource.packageRoot } : {}),
			description: frontmatter.description,
			...(aliases !== undefined ? { aliases } : {}),
			...(rawTools !== undefined ? { tools } : {}),
			...(allowNestedSubagents !== undefined ? { allowNestedSubagents } : {}),
			...(mcpDirectTools.length > 0 ? { mcpDirectTools } : {}),
			...(frontmatter.model !== undefined ? { model: frontmatter.model } : {}),
			...(fallbackModels?.length ? { fallbackModels } : {}),
			...(fast !== undefined ? { fast } : {}),
			...(frontmatter.thinking !== undefined ? { thinking: frontmatter.thinking === "false" ? false : frontmatter.thinking } : {}),
			systemPromptMode,
			inheritProjectContext,
			inheritGlobalContext,
			inheritSkills,
			...(defaultContext !== undefined ? { defaultContext } : {}),
			...(defaultAsync !== undefined ? { defaultAsync } : {}),
			...(defaultTimeoutMs !== undefined ? { defaultTimeoutMs } : {}),
			...(defaultToolTimeoutMs !== undefined ? { defaultToolTimeoutMs } : {}),
			...(defaultAcceptance !== undefined ? { defaultAcceptance } : {}),
			...(acceptanceRole !== undefined ? { acceptanceRole } : {}),
			systemPrompt: body,
			source,
			filePath,
			...(discoveryPriority !== undefined ? { discoveryPriority } : {}),
			...(skills?.length ? { skills } : {}),
			...(skillPath?.length ? { skillPath } : {}),
			...(extensions !== undefined ? { extensions } : {}),
			...(subagentOnlyExtensions !== undefined ? { subagentOnlyExtensions } : {}),
			...(mutationTools?.length ? { mutationTools } : {}),
			...(frontmatter.output !== undefined ? { output: frontmatter.output } : {}),
			...(outputMode !== undefined ? { outputMode } : {}),
			...(defaultReads?.length ? { defaultReads } : {}),
			defaultProgress: frontmatter.defaultProgress === "true",
			interactive: frontmatter.interactive === "true",
			...(maxSubagentDepth !== undefined ? { maxSubagentDepth } : {}),
			...(completionGuard !== undefined ? { completionGuard } : {}),
			...(toolBudget !== undefined ? { toolBudget } : {}),
			...(permissions !== undefined ? { permissions } : {}),
			...(memory !== undefined ? { memory } : {}),
			...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
		};
		agentFrontmatterFields.set(agent, new Set(Object.keys(frontmatter)));
		agents.push(agent);
		} catch (error) {
			diagnostics.push({ source, filePath, ...(name ? { name } : {}), ...(runtimeName && runtimeName !== name ? { runtimeName } : {}), ...(packageSpecified ? { packageSpecified: true } : {}), ...(discoveryPriority !== undefined ? { discoveryPriority } : {}), error: error instanceof Error ? error.message : String(error) });
		}
	}

	return { agents, diagnostics };
}

function loadAgentsFromDir(dir: string, source: AgentSource, discoveryPriority?: number, packageSource?: Omit<PackageSubagentPath, "dir">, inspection = inspectAgentDefinitionDirectory(dir)): { agents: AgentConfig[]; diagnostics: AgentDiscoveryDiagnostic[] } {
	return loadAgentsFromDefinitionFiles(readAgentDefinitionFiles(dir, inspection), source, discoveryPriority, packageSource);
}

function reportAgentDefinitionDirectory(source: AgentSource, dir: string, inspection: AgentDefinitionInspection): AgentDefinitionDirectoryReport {
	return {
		source,
		path: path.resolve(dir),
		state: inspection.state,
		...(inspection.state === "candidates" ? { candidateCount: inspection.files.length } : {}),
	};
}

function loadChainsFromDir(dir: string, source: AgentSource, budget: LegacyChainDiscoveryBudget): { chains: ChainConfig[]; diagnostics: ChainDiscoveryDiagnostic[] } {
	const chains = new Map<string, ChainConfig>();
	const discovered = discoverLegacyChainFiles(dir, budget);
	const diagnostics: ChainDiscoveryDiagnostic[] = discovered.diagnostics.map((diagnostic) => ({ source, ...diagnostic }));

	for (const filePath of discovered.files) {
		const read = readLegacyChainFile(filePath);
		if (read.error) {
			diagnostics.push({ source, filePath, error: read.error });
			continue;
		}
		if (read.content === undefined) continue;

		try {
			const chain = filePath.endsWith(".chain.json") ? parseJsonChain(read.content, source, filePath) : parseChain(read.content, source, filePath);
			const existing = chains.get(chain.name);
			if (existing && existing.filePath.endsWith(".chain.json") && filePath.endsWith(".chain.md")) continue;
			chains.set(chain.name, chain);
		} catch (error) {
			diagnostics.push({ source, filePath, error: error instanceof Error ? error.message : String(error) });
			continue;
		}
	}

	return { chains: Array.from(chains.values()), diagnostics };
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function resolveNearestProjectAgentDirs(cwd: string): { readDirs: string[]; candidateDirs: string[]; preferredDir: string | null } {
	const projectRoot = findConfiguredProjectRoot(cwd);
	if (!projectRoot) return { readDirs: [], candidateDirs: [], preferredDir: null };

	const legacyDir = path.join(projectRoot, ".agents");
	const preferredDir = path.join(getProjectConfigDir(projectRoot), "agents");
	const candidateDirs = [legacyDir, preferredDir];
	const readDirs: string[] = [];
	if (isDirectory(legacyDir)) readDirs.push(legacyDir);
	if (isDirectory(preferredDir)) readDirs.push(preferredDir);

	return { readDirs, candidateDirs, preferredDir };
}

function resolveLegacyCompatibilityProjectRoot(cwd: string): { projectRoot: string | null; diagnostics: ChainDiscoveryDiagnostic[] } {
	const diagnostics: ChainDiscoveryDiagnostic[] = [];
	const candidates: string[] = [];
	let currentDir = path.resolve(cwd);
	try {
		assertNoSymlinkPathComponents(currentDir);
	} catch (error) {
		diagnostics.push({ source: "project", filePath: currentDir, error: error instanceof Error ? error.message : String(error) });
		return { projectRoot: null, diagnostics };
	}
	while (true) {
		const configDir = getProjectConfigDir(currentDir);
		const legacyDir = path.join(currentDir, ".agents");
		const isRealDirectory = (candidate: string): boolean => {
			try {
				const stat = fs.lstatSync(candidate);
				return !stat.isSymbolicLink() && stat.isDirectory();
			} catch {
				return false;
			}
		};
		if (isRealDirectory(configDir) || isRealDirectory(legacyDir)) candidates.push(currentDir);
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}
	const nearestRoot = candidates[0];
	if (!nearestRoot) return { projectRoot: null, diagnostics };

	let policyRoot: string | undefined;
	let policyRootIndex = -1;
	for (const [index, candidate] of candidates.entries()) {
		const settingsPath = path.join(getProjectConfigDir(candidate), "settings.json");
		const loaded = readLegacyCompatibilityJson(settingsPath);
		if (loaded.error) diagnostics.push({ source: "project", filePath: settingsPath, error: loaded.error });
		const subagents = loaded.value?.subagents;
		const mode = subagents && typeof subagents === "object" && !Array.isArray(subagents)
			? (subagents as Record<string, unknown>).projectRootResolution
			: undefined;
		if (mode === "nearest") return { projectRoot: nearestRoot, diagnostics };
		if (mode === "git-root") {
			policyRoot = candidate;
			policyRootIndex = index;
			break;
		}
		if (mode !== undefined) diagnostics.push({ source: "project", filePath: settingsPath, error: "Legacy chain compatibility discovery ignored an invalid projectRootResolution value." });
	}
	if (!policyRoot) return { projectRoot: nearestRoot, diagnostics };

	let gitRoot: string | null = null;
	currentDir = path.resolve(cwd);
	while (true) {
		try {
			const stat = fs.lstatSync(path.join(currentDir, ".git"));
			if (!stat.isSymbolicLink()) {
				gitRoot = currentDir;
				break;
			}
		} catch {
			// Continue to the filesystem root.
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}
	const gitProjectRoot = gitRoot
		? candidates.slice(policyRootIndex).find((candidate) => path.resolve(candidate) === gitRoot)
		: undefined;
	let configuredGitRoot: string | undefined;
	try {
		const stat = fs.lstatSync(path.join(policyRoot, ".git"));
		if (!stat.isSymbolicLink()) configuredGitRoot = policyRoot;
	} catch {
		// The configured root is not itself a Git root.
	}
	return { projectRoot: gitProjectRoot ?? configuredGitRoot ?? nearestRoot, diagnostics };
}

function resolveLegacyCompatibilityProjectChainDirs(projectRoot: string | null): { readDirs: string[]; preferredDir: string | null } {
	if (!projectRoot) return { readDirs: [], preferredDir: null };
	const preferredDir = path.join(getProjectConfigDir(projectRoot), "chains");
	try {
		const stat = fs.lstatSync(preferredDir);
		return { readDirs: !stat.isSymbolicLink() && stat.isDirectory() ? [preferredDir] : [], preferredDir };
	} catch {
		return { readDirs: [], preferredDir };
	}
}
const BUILTIN_AGENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");
// Candidate files and inspection state must describe the same cached builtin scan.
const BUILTIN_AGENT_DEFINITION_INSPECTION = inspectAgentDefinitionDirectory(BUILTIN_AGENTS_DIR);
const BUILTIN_AGENT_DEFINITION_FILES = readAgentDefinitionFiles(BUILTIN_AGENTS_DIR, BUILTIN_AGENT_DEFINITION_INSPECTION);

export const EXTRA_AGENT_DIRS_ENV = "PI_SUBAGENT_EXTRA_AGENT_DIRS";

// Additional read-only directories to scan for agent definitions, supplied by the
// launcher via PI_SUBAGENT_EXTRA_AGENT_DIRS (PATH-style, split on os/path delimiter).
// Lets a hermetic wrapper (e.g. a Nix-store install) expose bundled agents without
// copying or symlinking them into the writable agent dir. Loaded as "user" source,
// at lower precedence than agents the user placed in their own agent dir.
function extraUserAgentDirs(): string[] {
	const raw = process.env[EXTRA_AGENT_DIRS_ENV];
	if (!raw) return [];
	return raw
		.split(path.delimiter)
		.map((dir) => dir.trim())
		.filter((dir) => dir.length > 0);
}

export function discoverAgents(cwd: string, scope: AgentScope, preferredModelProvider?: string): AgentDiscoveryResult {
	const effectiveCwd = path.resolve(cwd);
	const userDirOld = path.join(getAgentDir(), "agents");
	const userDirNew = path.join(os.homedir(), ".agents");
	const { readDirs: projectAgentDirs, candidateDirs: projectCandidateDirs, preferredDir: projectAgentsDir } = resolveNearestProjectAgentDirs(effectiveCwd);
	const userSettingsPath = getUserAgentSettingsPath();
	const projectSettingsPath = getProjectAgentSettingsPath(effectiveCwd);
	const userSettings = selectProviderOverrides(scope === "project" ? EMPTY_SUBAGENT_SETTINGS : readSubagentSettings(userSettingsPath), preferredModelProvider);
	const projectSettings = selectProviderOverrides(scope === "user" ? EMPTY_SUBAGENT_SETTINGS : readSubagentSettings(projectSettingsPath), preferredModelProvider);
	const defaultProvider = resolveSubagentDefaultProvider(userSettings, projectSettings, projectSettingsPath);
	const defaultModel = resolveSubagentDefaultModel(userSettings, projectSettings, userSettingsPath, projectSettingsPath, defaultProvider);
	const defaultThinking = resolveSubagentDefaultThinking(userSettings, projectSettings, projectSettingsPath);
	const maxThinking = resolveSubagentMaxThinking(userSettings, projectSettings, projectSettingsPath);
	const defaultExtensions = resolveSubagentDefaultExtensions(userSettings, projectSettings, projectSettingsPath);
	const modelScope = projectSettings.modelScope ?? userSettings.modelScope;
	const packageSubagentPaths = collectPackageSubagentPaths(effectiveCwd, {
		includeUser: scope !== "project",
		includeProject: scope !== "user",
	});
	const directories: AgentDefinitionDirectoryReport[] = [reportAgentDefinitionDirectory("builtin", BUILTIN_AGENTS_DIR, BUILTIN_AGENT_DEFINITION_INSPECTION)];

	const builtinLoaded = loadAgentsFromDefinitionFiles(BUILTIN_AGENT_DEFINITION_FILES, "builtin");
	const builtinAgents = applyBuiltinOverrides(
		applySubagentDefaults(builtinLoaded.agents, defaultModel, defaultProvider, defaultThinking, defaultExtensions),
		userSettings, projectSettings, userSettingsPath, projectSettingsPath,
	);

	const userLoaded = scope === "project" ? [] : [...extraUserAgentDirs(), userDirOld, userDirNew].map((dir, discoveryPriority) => {
		const inspection = inspectAgentDefinitionDirectory(dir);
		directories.push(reportAgentDefinitionDirectory("user", dir, inspection));
		return loadAgentsFromDir(dir, "user", discoveryPriority, undefined, inspection);
	});
	const userAgents = applyCustomAgentOverrides(
		applySubagentDefaults(userLoaded.flatMap((loaded) => loaded.agents), defaultModel, defaultProvider, defaultThinking, defaultExtensions),
		userSettings, projectSettings, userSettingsPath, projectSettingsPath,
	);

	// Report both legacy and preferred project definition paths only after the
	// existing configured-root resolver found a root; never synthesize cwd paths.
	const projectInspections = scope === "user" ? new Map<string, AgentDefinitionInspection>() : new Map(projectCandidateDirs.map((dir) => [dir, inspectAgentDefinitionDirectory(dir)]));
	if (scope !== "user") for (const dir of projectCandidateDirs) directories.push(reportAgentDefinitionDirectory("project", dir, projectInspections.get(dir)!));
	const projectLoaded = scope === "user" ? [] : projectAgentDirs.map((dir) => loadAgentsFromDir(dir, "project", dir === projectAgentsDir ? 1 : 0, undefined, projectInspections.get(dir)!));
	const projectAgents = applyCustomAgentOverrides(
		applySubagentDefaults(projectLoaded.flatMap((loaded) => loaded.agents), defaultModel, defaultProvider, defaultThinking, defaultExtensions),
		userSettings, projectSettings, userSettingsPath, projectSettingsPath,
	);

	const packageLoaded = packageSubagentPaths.agents.map((entry, index) => {
		const inspection = inspectAgentDefinitionDirectory(entry.dir);
		directories.push(reportAgentDefinitionDirectory("package", entry.dir, inspection));
		return loadAgentsFromDir(entry.dir, "package", packageSubagentPaths.agents.length - index, entry, inspection);
	});
	const packageMap = new Map<string, AgentConfig>();
	for (const loaded of packageLoaded) for (const agent of loaded.agents) if (!packageMap.has(agent.name)) packageMap.set(agent.name, agent);
	const packageAgents = applyCustomAgentOverrides(
		applySubagentDefaults(Array.from(packageMap.values()), defaultModel, defaultProvider, defaultThinking, defaultExtensions),
		userSettings, projectSettings, userSettingsPath, projectSettingsPath,
	);
	const agents = applySubagentMaxThinking(
		mergeAgentsForScope(scope, userAgents, projectAgents, builtinAgents, packageAgents).filter((agent) => agent.disabled !== true),
		maxThinking,
	);
	const agentDiagnostics = [
		...builtinLoaded.diagnostics,
		...userLoaded.flatMap((loaded) => loaded.diagnostics),
		...projectLoaded.flatMap((loaded) => loaded.diagnostics),
		...packageLoaded.flatMap((loaded) => loaded.diagnostics),
	];
	return { agents, agentDiagnostics, projectAgentsDir, cwd: effectiveCwd, scope, directories, ...(modelScope !== undefined ? { modelScope } : {}), ...(maxThinking !== undefined ? { maxThinking } : {}) };
}

export interface AllAgentDiscoveryResult {
	builtin: AgentConfig[];
	package: AgentConfig[];
	user: AgentConfig[];
	project: AgentConfig[];
	agentDiagnostics?: AgentDiscoveryDiagnostic[];
	userDir: string;
	projectDir: string | null;
	userSettingsPath: string;
	projectSettingsPath: string | null;
	maxThinking?: ThinkingLevel;
}

export interface LegacyChainInspectionResult {
	chains: ChainConfig[];
	chainDiagnostics: ChainDiscoveryDiagnostic[];
	userChainDir: string;
	projectChainDir: string | null;
}

export function discoverAgentsAll(cwd: string, preferredModelProvider?: string): AllAgentDiscoveryResult {
	const userDirOld = path.join(getAgentDir(), "agents");
	const userDirNew = path.join(os.homedir(), ".agents");
	const { readDirs: projectDirs, preferredDir: projectDir } = resolveNearestProjectAgentDirs(cwd);
	const userSettingsPath = getUserAgentSettingsPath();
	const projectSettingsPath = getProjectAgentSettingsPath(cwd);
	const userSettings = selectProviderOverrides(readSubagentSettings(userSettingsPath), preferredModelProvider);
	const projectSettings = selectProviderOverrides(readSubagentSettings(projectSettingsPath), preferredModelProvider);
	const defaultProvider = resolveSubagentDefaultProvider(userSettings, projectSettings, projectSettingsPath);
	const defaultModel = resolveSubagentDefaultModel(userSettings, projectSettings, userSettingsPath, projectSettingsPath, defaultProvider);
	const defaultThinking = resolveSubagentDefaultThinking(userSettings, projectSettings, projectSettingsPath);
	const maxThinking = resolveSubagentMaxThinking(userSettings, projectSettings, projectSettingsPath);
	const defaultExtensions = resolveSubagentDefaultExtensions(userSettings, projectSettings, projectSettingsPath);
	const packageSubagentPaths = collectPackageSubagentPaths(cwd);

	const builtinLoaded = loadAgentsFromDefinitionFiles(BUILTIN_AGENT_DEFINITION_FILES, "builtin");
	const builtin = applyBuiltinOverrides(
		applySubagentDefaults(builtinLoaded.agents, defaultModel, defaultProvider, defaultThinking, defaultExtensions),
		userSettings,
		projectSettings,
		userSettingsPath,
		projectSettingsPath,
	);
	const userLoaded = [...extraUserAgentDirs(), userDirOld, userDirNew]
		.map((dir, discoveryPriority) => loadAgentsFromDir(dir, "user", discoveryPriority));
	const user = applyCustomAgentOverrides(
		applySubagentDefaults(userLoaded.flatMap((loaded) => loaded.agents), defaultModel, defaultProvider, defaultThinking, defaultExtensions),
		userSettings,
		projectSettings,
		userSettingsPath,
		projectSettingsPath,
	);
	const packageMap = new Map<string, AgentConfig>();
	const packageAgentDiagnostics: AgentDiscoveryDiagnostic[] = [];
	for (const [index, entry] of packageSubagentPaths.agents.entries()) {
		const loaded = loadAgentsFromDir(entry.dir, "package", packageSubagentPaths.agents.length - index, entry);
		packageAgentDiagnostics.push(...loaded.diagnostics);
		for (const agent of loaded.agents) {
			if (!packageMap.has(agent.name)) packageMap.set(agent.name, agent);
		}
	}
	const packageAgents = applyCustomAgentOverrides(
		applySubagentDefaults(Array.from(packageMap.values()), defaultModel, defaultProvider, defaultThinking, defaultExtensions),
		userSettings,
		projectSettings,
		userSettingsPath,
		projectSettingsPath,
	);
	const projectMap = new Map<string, AgentConfig>();
	const projectAgentDiagnostics: AgentDiscoveryDiagnostic[] = [];
	for (const dir of projectDirs) {
		const loaded = loadAgentsFromDir(dir, "project", dir === projectDir ? 1 : 0);
		projectAgentDiagnostics.push(...loaded.diagnostics);
		for (const agent of loaded.agents) {
			projectMap.set(agent.name, agent);
		}
	}
	const project = applyCustomAgentOverrides(
		applySubagentDefaults(Array.from(projectMap.values()), defaultModel, defaultProvider, defaultThinking, defaultExtensions),
		userSettings,
		projectSettings,
		userSettingsPath,
		projectSettingsPath,
	);

	const agentDiagnostics = [
		...builtinLoaded.diagnostics,
		...userLoaded.flatMap((loaded) => loaded.diagnostics),
		...packageAgentDiagnostics,
		...projectAgentDiagnostics,
	];

	const userDir = process.env.PI_CODING_AGENT_DIR ? userDirOld : fs.existsSync(userDirNew) ? userDirNew : userDirOld;

	return {
		builtin: applySubagentMaxThinking(builtin, maxThinking),
		package: applySubagentMaxThinking(packageAgents, maxThinking),
		user: applySubagentMaxThinking(user, maxThinking),
		project: applySubagentMaxThinking(project, maxThinking),
		agentDiagnostics,
		userDir,
		projectDir,
		userSettingsPath,
		projectSettingsPath,
		...(maxThinking !== undefined ? { maxThinking } : {}),
	};
}

/** Explicitly inspect retired durable chain definitions for compatibility reporting. */
export function inspectLegacyChainDefinitions(cwd: string): LegacyChainInspectionResult {
	const userChainDir = getUserChainDir();
	const projectResolution = resolveLegacyCompatibilityProjectRoot(cwd);
	const { readDirs: projectChainDirs, preferredDir: projectChainDir } = resolveLegacyCompatibilityProjectChainDirs(projectResolution.projectRoot);
	const discoveryBudget = createLegacyChainDiscoveryBudget();

	const projectChains = new Map<string, ChainConfig>();
	const projectDiagnostics: ChainDiscoveryDiagnostic[] = [...projectResolution.diagnostics];
	for (const dir of projectChainDirs) {
		const loaded = loadChainsFromDir(dir, "project", discoveryBudget);
		projectDiagnostics.push(...loaded.diagnostics);
		for (const chain of loaded.chains) projectChains.set(chain.name, chain);
	}

	const userChains = loadChainsFromDir(userChainDir, "user", discoveryBudget);
	const packageDiscovery = collectLegacyPackageChainDirs(projectResolution.projectRoot ?? path.resolve(cwd), discoveryBudget);
	const packageChains = new Map<string, ChainConfig>();
	const packageDiagnostics: ChainDiscoveryDiagnostic[] = [...packageDiscovery.diagnostics];
	for (const dir of packageDiscovery.dirs) {
		const budgetError = legacyChainDiscoveryBudgetError(discoveryBudget);
		if (budgetError) {
			packageDiagnostics.push({ source: "package", filePath: path.resolve(dir), error: budgetError });
			break;
		}
		const loaded = loadChainsFromDir(dir, "package", discoveryBudget);
		packageDiagnostics.push(...loaded.diagnostics);
		for (const chain of loaded.chains) if (!packageChains.has(chain.name)) packageChains.set(chain.name, chain);
	}

	return {
		chains: [...packageChains.values(), ...userChains.chains, ...projectChains.values()],
		chainDiagnostics: [...packageDiagnostics, ...userChains.diagnostics, ...projectDiagnostics],
		userChainDir,
		projectChainDir,
	};
}
