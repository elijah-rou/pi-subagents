/**
 * Chain behavior, template resolution, and directory management
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OutputOverrideInput } from "../runs/shared/child-launch-plan.ts";
import type { AcceptanceInput, AgentContract, ChainGateLayer, ChildProfileProvenance, JsonSchemaObject, OutputMode, ToolBudgetConfig } from "./types.ts";

export {
	planChildLaunch,
	resolveStepBehavior,
	resolveTaskTextForFileUpdatePolicy,
	suppressProgressForReadOnlyTask,
	taskDisallowsFileUpdates,
} from "../runs/shared/child-launch-plan.ts";
export type { ChildLaunchPlan, ChildLaunchPlanInput, OutputOverrideInput, ResolvedStepBehavior, StepOverrides } from "../runs/shared/child-launch-plan.ts";

// =============================================================================
// Chain Step Types
// =============================================================================

/** Sequential step: single agent execution */
export interface SequentialStep {
	agent: string;
	task?: string;
	phase?: string;
	label?: string;
	as?: string;
	outputSchema?: JsonSchemaObject;
	cwd?: string;
	output?: OutputOverrideInput;
	outputMode?: OutputMode;
	reads?: string[] | false;
	progress?: boolean;
	skill?: string | string[] | false;
	model?: string;
	fast?: boolean;
	/** Internal parent-resolver launch fields. */
	thinking?: string | false;
	modelSource?: "resolver";
	childProfile?: ChildProfileProvenance;
	toolBudget?: ToolBudgetConfig;
	acceptance?: AcceptanceInput;
	agentContract?: AgentContract;
	gateOn?: ChainGateLayer;
	/** Internal workflow child isolation; public workflowScript supplies this on runs.run. */
	worktree?: boolean;
}

/** Parallel task item within a parallel step */
export interface ParallelTaskItem {
	agent: string;
	task?: string;
	phase?: string;
	label?: string;
	as?: string;
	outputSchema?: JsonSchemaObject;
	cwd?: string;
	count?: number;
	output?: OutputOverrideInput;
	outputMode?: OutputMode;
	reads?: string[] | false;
	progress?: boolean;
	skill?: string | string[] | false;
	model?: string;
	fast?: boolean;
	/** Internal parent-resolver launch fields. */
	thinking?: string | false;
	modelSource?: "resolver";
	childProfile?: ChildProfileProvenance;
	toolBudget?: ToolBudgetConfig;
	acceptance?: AcceptanceInput;
	agentContract?: AgentContract;
	gateOn?: ChainGateLayer;
}

export interface DynamicExpandSpec {
	from: {
		output: string;
		path: string;
	};
	item?: string;
	key?: string;
	maxItems?: number;
	onEmpty?: "skip" | "fail";
}

export type DynamicParallelTemplate = Omit<ParallelTaskItem, "as" | "count">;

export interface DynamicCollectSpec {
	as: string;
	outputSchema?: JsonSchemaObject;
}

export interface DynamicParallelStep {
	expand: DynamicExpandSpec;
	parallel: DynamicParallelTemplate;
	collect: DynamicCollectSpec;
	concurrency?: number;
	failFast?: boolean;
	phase?: string;
	label?: string;
	acceptance?: AcceptanceInput;
	agentContract?: AgentContract;
	gateOn?: ChainGateLayer;
}

/** Parallel step: multiple agents running concurrently */
export interface ParallelStep {
	parallel: ParallelTaskItem[];
	concurrency?: number;
	failFast?: boolean;
	worktree?: boolean;
	cwd?: string;
	acceptance?: AcceptanceInput;
	agentContract?: AgentContract;
	gateOn?: ChainGateLayer;
}

/** Union type for chain steps */
export type ChainStep = SequentialStep | ParallelStep | DynamicParallelStep;

// =============================================================================
// Type Guards
// =============================================================================

export function isParallelStep(step: ChainStep): step is ParallelStep {
	return "parallel" in step && Array.isArray((step as ParallelStep).parallel);
}

export function isDynamicParallelStep(step: ChainStep): step is DynamicParallelStep {
	return "expand" in step && "collect" in step && "parallel" in step && !Array.isArray((step as { parallel?: unknown }).parallel);
}

/** Get all agent names in a step (single for sequential, multiple for parallel) */
export function getStepAgents(step: ChainStep): string[] {
	if (isParallelStep(step)) {
		return step.parallel.map((t) => t.agent);
	}
	if (isDynamicParallelStep(step)) {
		return [step.parallel.agent];
	}
	return [step.agent];
}

/**
 * Expand a leading `~`/`~/` to the user's home directory. Other forms (relative,
 * absolute, `~user/`) pass through unchanged.
 */
export function expandHomePath(filePath: string): string {
	if (filePath === "~") return os.homedir();
	if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
	return filePath;
}

/**
 * Resolve a file path: `~`/`~/` expand to home first, then absolute paths pass
 * through and relative paths get chainDir prepended.
 */
export function resolveChainPath(filePath: string, chainDir: string): string {
	const expanded = expandHomePath(filePath);
	return path.isAbsolute(expanded) ? expanded : path.join(chainDir, expanded);
}

export function resolveExistingReadInstructionPaths(reads: readonly string[], instructionCwd: string, existenceCwd = instructionCwd): string[] {
	return reads.flatMap((filePath) => {
		const instructionPath = resolveChainPath(filePath, instructionCwd);
		const existencePath = resolveChainPath(filePath, existenceCwd);
		return fs.existsSync(existencePath) ? [instructionPath] : [];
	});
}

export function resolveExistingReadPaths(reads: readonly string[], cwd: string): string[] {
	return resolveExistingReadInstructionPaths(reads, cwd);
}

export type { ParallelTaskResult } from "../runs/shared/parallel-utils.ts";
export { aggregateParallelOutputs } from "../runs/shared/parallel-utils.ts";
