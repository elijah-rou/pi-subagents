export type PermissionDecision = "allow" | "ask" | "deny";
export type PermissionRules = Record<string, PermissionDecision>;
export interface PermissionConfig { rules?: PermissionRules }

export const PERMISSION_POLICY_ENV = "PI_SUBAGENT_PERMISSION_POLICY";
const INTERNAL_TOOLS = new Set(["contact_supervisor", "intercom", "subagent_wait", "structured_output"]);
const DECISIONS = new Set<PermissionDecision>(["allow", "ask", "deny"]);
const MAX_POLICY_BYTES = 16 * 1024;
const SECRET_VALUE = /\b(?:Bearer\s+\S+|(?:sk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{8,})\b/gi;

export function redactSecretValues(value: string): string {
	return value.replace(SECRET_VALUE, "[redacted]");
}

export function validatePermissionRules(value: unknown, label: string): PermissionRules | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object mapping tool names to allow, ask, or deny.`);
	const result: PermissionRules = {};
	for (const [tool, decision] of Object.entries(value)) {
		if (!tool.trim()) throw new Error(`${label} contains an empty tool name.`);
		if (tool === "bash") throw new Error(`${label}.bash is unsupported; pi-subagents leaves bash policy to pi-guard.`);
		if (INTERNAL_TOOLS.has(tool)) throw new Error(`${label}.${tool} is reserved for child coordination and cannot be gated.`);
		if (!DECISIONS.has(decision as PermissionDecision)) throw new Error(`${label}.${tool} must be allow, ask, or deny.`);
		result[tool] = decision as PermissionDecision;
	}
	return Object.keys(result).length ? result : undefined;
}

export function validatePermissionConfig(value: unknown, label = "config.permissions"): PermissionConfig | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
	const object = value as Record<string, unknown>;
	const unknown = Object.keys(object).filter((key) => key !== "rules");
	if (unknown.length) throw new Error(`${label} has unsupported fields: ${unknown.join(", ")}.`);
	return { rules: validatePermissionRules(object.rules, `${label}.rules`) };
}

export function resolvePermissionRules(globalConfig?: PermissionConfig, agentRules?: PermissionRules): PermissionRules | undefined {
	const merged = { ...(globalConfig?.rules ?? {}), ...(agentRules ?? {}) };
	for (const [tool, decision] of Object.entries(merged)) if (decision === "allow") delete merged[tool];
	return Object.keys(merged).length ? merged : undefined;
}

export function permissionDecision(rules: PermissionRules | undefined, toolName: string): PermissionDecision {
	if (toolName === "bash" || INTERNAL_TOOLS.has(toolName)) return "allow";
	return rules?.[toolName] ?? "allow";
}

export function encodePermissionRules(rules: PermissionRules | undefined): string | undefined {
	if (!rules || Object.keys(rules).length === 0) return undefined;
	const encoded = JSON.stringify(rules);
	if (Buffer.byteLength(encoded, "utf-8") > MAX_POLICY_BYTES) throw new Error("Resolved permission policy is too large.");
	return encoded;
}

export function decodePermissionRules(encoded: string | undefined): PermissionRules | undefined {
	if (!encoded?.trim()) return undefined;
	return validatePermissionRules(JSON.parse(encoded), PERMISSION_POLICY_ENV);
}
