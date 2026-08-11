import * as fs from "node:fs";
import * as path from "node:path";

export const REQUIRED_CHILD_TOOLS_ENV = "PI_SUBAGENT_REQUIRED_TOOLS";
export const MCP_DIRECT_CHILD_TOOLS_ENV = "PI_SUBAGENT_MCP_DIRECT_TOOLS";
export const CHILD_TOOL_DIAGNOSTIC_PATH_ENV = "PI_SUBAGENT_TOOL_DIAGNOSTIC_PATH";

export interface ChildToolDiagnostic {
	agent?: string;
	required: string[];
	available: string[];
	missing: string[];
	missingMcpDirectTools?: string[];
}

const PI_CORE_CHILD_TOOLS = new Set(["bash", "edit", "find", "grep", "ls", "read", "write"]);

export interface ChildToolAvailability {
	available: string[];
	deferred: string[];
	definiteMissing: string[];
}

export interface ClassifyRequiredChildToolsInput {
	required: readonly string[];
	internal?: readonly string[];
	mcp?: readonly string[];
	providerToolNames?: readonly string[];
	ambientExtensionsEnabled: boolean;
}

/**
 * Classify launch-time tool knowledge without probing child-only providers.
 * A deferred tool must be checked by the child after extension registration.
 */
export function classifyRequiredChildTools(input: ClassifyRequiredChildToolsInput): ChildToolAvailability {
	const internal = new Set(input.internal ?? []);
	const mcp = new Set(input.mcp ?? []);
	const providerToolNames = new Set(input.providerToolNames ?? []);
	const availability: ChildToolAvailability = { available: [], deferred: [], definiteMissing: [] };

	for (const name of new Set(input.required)) {
		if (PI_CORE_CHILD_TOOLS.has(name) || internal.has(name)) {
			availability.available.push(name);
			continue;
		}
		if (mcp.has(name) || providerToolNames.has(name) || input.ambientExtensionsEnabled) {
			availability.deferred.push(name);
			continue;
		}
		availability.definiteMissing.push(name);
	}
	return availability;
}

export function formatDefinitelyMissingChildTools(agent: string | undefined, missing: readonly string[]): string {
	if (missing.length === 0) throw new Error("Cannot format an empty definitely-missing tool list.");
	const subject = agent ? `Agent '${agent}'` : "Subagent";
	return [
		`${subject} requested definitely unavailable child tools: ${missing.join(", ")}.`,
		"No configured or ambient child provider can register these names, so the child was not spawned.",
		"For extension tools, add the provider path to `subagentOnlyExtensions` (child-only), `extensions`, or as a path-like entry in `tools`, while keeping each registered tool name in `tools`.",
		"For MCP tools, configure `mcpDirectTools` and verify the selected names. For builtin tools, verify the name against the installed Pi version.",
	].join("\n");
}

export function writeChildToolDiagnostic(
	filePath: string,
	required: string[],
	available: string[],
	agent?: string,
	mcpDirectTools?: string[],
): ChildToolDiagnostic | undefined {
	const availableNames = new Set([...available, ...PI_CORE_CHILD_TOOLS]);
	const missing = required.filter((name) => !availableNames.has(name));
	if (missing.length === 0) {
		fs.rmSync(filePath, { force: true });
		return undefined;
	}

	const missingMcpDirectTools = mcpDirectTools?.length
		? missing.filter((name) => mcpDirectTools.includes(name))
		: [];
	const diagnostic: ChildToolDiagnostic = {
		agent,
		required,
		available,
		missing,
		...(missingMcpDirectTools.length > 0 ? { missingMcpDirectTools } : {}),
	};
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(diagnostic), { mode: 0o600 });
	return diagnostic;
}

export function readChildToolDiagnostic(filePath: string | undefined): ChildToolDiagnostic | undefined {
	if (!filePath || !fs.existsSync(filePath)) return undefined;
	const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<ChildToolDiagnostic>;
	const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
	if (!stringArray(parsed.required) || !stringArray(parsed.available) || !stringArray(parsed.missing) || (parsed.agent !== undefined && typeof parsed.agent !== "string") || (parsed.missingMcpDirectTools !== undefined && !stringArray(parsed.missingMcpDirectTools))) {
		throw new Error(`Malformed child tool diagnostic at '${filePath}'.`);
	}
	return {
		...(parsed.agent ? { agent: parsed.agent } : {}),
		required: parsed.required,
		available: parsed.available,
		missing: parsed.missing,
		...(parsed.missingMcpDirectTools ? { missingMcpDirectTools: parsed.missingMcpDirectTools } : {}),
	};
}

export function formatChildToolDiagnostic(diagnostic: ChildToolDiagnostic): string {
	const subject = diagnostic.agent ? `Agent '${diagnostic.agent}'` : "Subagent";
	return [
		`${subject} requested unavailable child tools: ${diagnostic.missing.join(", ")}.`,
		"The `tools` field is a strict allowlist; it does not load extension code.",
		...(diagnostic.missingMcpDirectTools?.length
			? [`Resolved MCP direct tools missing from the child registry: ${diagnostic.missingMcpDirectTools.join(", ")}. This indicates a host/pi-mcp-adapter registration problem, not a tool-call failure.`]
			: []),
		"For extension tools, add the provider path to `subagentOnlyExtensions` (child-only), `extensions`, or as a path-like entry in `tools`, while keeping each registered tool name in `tools`.",
		"For MCP tools, verify the MCP adapter configuration and selected tool names. For builtin tools, verify the name against the installed Pi version.",
	].join("\n");
}

export function readChildToolDiagnosticError(filePath: string | undefined): string | undefined {
	try {
		const diagnostic = readChildToolDiagnostic(filePath);
		return diagnostic ? formatChildToolDiagnostic(diagnostic) : undefined;
	} catch (error) {
		return `Failed to read child tool availability diagnostic: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export interface ChildToolDiagnosticWatcher {
	dispose(): void;
}

/** Watch the post-extension diagnostic without treating an in-progress write as terminal. */
export function watchChildToolDiagnostic(
	filePath: string | undefined,
	onMissing: (error: string) => void,
	options: { intervalMs?: number } = {},
): ChildToolDiagnosticWatcher {
	if (!filePath) return { dispose() {} };
	const intervalMs = options.intervalMs ?? 25;
	if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new Error("Child tool diagnostic watch interval must be a positive safe integer.");
	let disposed = false;
	let timer: NodeJS.Timeout | undefined;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		if (timer) clearInterval(timer);
		timer = undefined;
	};
	const inspect = (): void => {
		if (disposed) return;
		try {
			const diagnostic = readChildToolDiagnostic(filePath);
			if (!diagnostic) return;
			dispose();
			onMissing(formatChildToolDiagnostic(diagnostic));
		} catch {
			// The child may be between truncate/write or temp-file rename operations.
		}
	};
	timer = setInterval(inspect, intervalMs);
	timer.unref?.();
	inspect();
	return { dispose };
}
