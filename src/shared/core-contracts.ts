export type AgentScope = "user" | "project" | "both";
export type AgentSource = "builtin" | "package" | "user" | "project" | "runtime";
export type AgentDefinitionDirectoryState = "absent" | "empty" | "candidates" | "unreadable" | "not-directory";
export interface AgentDefinitionDirectoryReport {
	source: AgentSource;
	path: string;
	state: AgentDefinitionDirectoryState;
	candidateCount?: number;
}
export interface UnknownAgentDiagnosticContext {
	cwd: string;
	scope: AgentScope;
	directories: readonly AgentDefinitionDirectoryReport[];
	agents: ReadonlyArray<{ name: string; source: AgentSource }>;
}

export type PermissionDecision = "allow" | "ask" | "deny";
export type PermissionRules = Record<string, PermissionDecision>;
export interface PermissionConfig { rules?: PermissionRules }

export interface SingleOutputSnapshot {
	exists: boolean;
	managed?: boolean;
	mtimeMs?: number;
	size?: number;
	device?: number;
	inode?: number;
	ownedPlaceholder?: boolean;
}

export type TaskMutationVerdict = "read-only" | "implementation" | "unavailable";
export type TaskMutationArbiter = (task: string) => Promise<TaskMutationVerdict>;

export interface McpRuntimeSnapshotHost {
	events: { emit(event: string, request: unknown): void };
}

export type AuthorityAction =
	| "discardWorktree"
	| "destructiveCleanup"
	| "spawnBudgetGrant"
	| "scheduleCreate"
	| "stopRun"
	| "steerRun";

export type AuthorityDecision = "auto" | "confirm" | "forbid";
export type AuthorityPolicyConfig = Partial<Record<AuthorityAction, AuthorityDecision>>;

export interface ModelScopeRule {
	enforce?: boolean;
	strict?: boolean;
	allow?: string[];
}

export type ExtensionBindingJson =
	| null
	| boolean
	| number
	| string
	| ReadonlyArray<ExtensionBindingJson>
	| { readonly [key: string]: ExtensionBindingJson };
export type ExtensionBindings = Readonly<Record<string, ExtensionBindingJson>>;

export interface ResolvedSubagentCapabilityCeiling {
	version: 1;
	allowedTools?: string[];
	allowedAgents?: string[];
	denyExtensions: boolean;
	sources: string[];
}

export interface SubagentCapabilityAudit {
	ceiling: ResolvedSubagentCapabilityCeiling;
	requestedTools?: string[];
	effectiveTools: string[];
	removedTools: string[];
	internalTools: string[];
	extensionsDenied: boolean;
	removedExtensionCount: number;
	requestedMcpToolCount: number;
	effectiveMcpTools: string[];
	agentAllowed: boolean;
	agentRestrictionSources?: string[];
}
