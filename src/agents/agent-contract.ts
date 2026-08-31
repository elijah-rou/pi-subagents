import type { AcceptanceInput, AcceptanceRole, AgentRunnerConfig, OutputMode, ToolBudgetConfig } from "../shared/types.ts";
import type { AgentSource } from "../shared/core-contracts.ts";
import type { PermissionRules } from "../runs/shared/permissions.ts";
import type { ThinkingLevel } from "../shared/thinking-ceiling.ts";

export type SystemPromptMode = "append" | "replace";
export type AgentDefaultContext = "fresh" | "fork";
export type AgentMemoryScope = "project" | "user";

export interface AgentMemoryConfig {
	scope: AgentMemoryScope;
	path: string;
}

export interface BuiltinAgentOverrideBase {
	description?: string;
	output?: string;
	outputMode?: OutputMode;
	defaultReads?: string[];
	model?: string;
	modelProvider?: string;
	fallbackModels?: string[];
	fast?: boolean;
	thinking?: string | false;
	systemPromptMode: SystemPromptMode;
	inheritProjectContext: boolean;
	inheritGlobalContext: boolean;
	inheritSkills: boolean;
	defaultContext?: AgentDefaultContext;
	acceptanceRole?: AcceptanceRole;
	disabled?: boolean;
	systemPrompt: string;
	skills?: string[];
	skillPath?: string[];
	tools?: string[];
	allowNestedSubagents?: boolean;
	mcpDirectTools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	mutationTools?: string[];
	completionGuard?: boolean;
	toolBudget?: ToolBudgetConfig;
}

export interface AgentModelSourceInfo {
	type: "subagents.defaultModel";
	scope: "user" | "project";
	path: string;
	model: string;
	defaultProvider?: string;
}

export interface ChainStepConfig {
	agent?: string;
	task?: string;
	phase?: string;
	label?: string;
	as?: string;
	outputSchema?: string | Record<string, unknown>;
	output?: string | false;
	outputMode?: OutputMode;
	reads?: string[] | false;
	model?: string;
	skills?: string[] | false;
	progress?: boolean;
	parallel?: unknown;
	expand?: unknown;
	collect?: unknown;
	concurrency?: number;
	failFast?: boolean;
	worktree?: boolean;
	acceptance?: AcceptanceInput;
	toolBudget?: ToolBudgetConfig;
}

export interface ChainConfig {
	name: string;
	localName?: string;
	packageName?: string;
	description: string;
	source: AgentSource;
	filePath: string;
	steps: ChainStepConfig[];
	extraFields?: Record<string, string>;
}

export interface ChainDiscoveryDiagnostic {
	source: AgentSource;
	filePath: string;
	error: string;
}

export interface AgentDiscoveryDiagnostic extends ChainDiscoveryDiagnostic {
	name?: string;
	runtimeName?: string;
	packageSpecified?: boolean;
	discoveryPriority?: number;
}

export interface AgentConfig {
	name: string;
	runner?: AgentRunnerConfig;
	localName?: string;
	packageName?: string;
	packageSourceName?: string;
	packageSourceVersion?: string;
	packageSourceRoot?: string;
	description: string;
	aliases?: string[];
	tools?: string[];
	allowNestedSubagents?: boolean;
	mcpDirectTools?: string[];
	model?: string;
	modelProvider?: string;
	fallbackModels?: string[];
	fast?: boolean;
	thinking?: string | false;
	systemPromptMode: SystemPromptMode;
	inheritProjectContext: boolean;
	inheritGlobalContext: boolean;
	inheritSkills: boolean;
	defaultContext?: AgentDefaultContext;
	defaultAsync?: boolean;
	defaultTimeoutMs?: number;
	defaultToolTimeoutMs?: number;
	defaultAcceptance?: AcceptanceInput;
	acceptanceRole?: AcceptanceRole;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
	discoveryPriority?: number;
	skills?: string[];
	skillPath?: string[];
	extensions?: string[];
	extensionsFromDefault?: boolean;
	subagentOnlyExtensions?: string[];
	mutationTools?: string[];
	output?: string;
	outputMode?: OutputMode;
	defaultReads?: string[];
	defaultProgress?: boolean;
	interactive?: boolean;
	maxSubagentDepth?: number;
	completionGuard?: boolean;
	toolBudget?: ToolBudgetConfig;
	permissions?: PermissionRules;
	memory?: AgentMemoryConfig;
	disabled?: boolean;
	extraFields?: Record<string, string>;
	override?: {
		scope: "user" | "project";
		path: string;
		base: BuiltinAgentOverrideBase;
	};
	modelSource?: AgentModelSourceInfo;
	maxThinking?: ThinkingLevel;
}
