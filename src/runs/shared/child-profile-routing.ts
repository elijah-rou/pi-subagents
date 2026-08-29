import { isDynamicParallelStep, isParallelStep, type ChainStep } from "../../shared/settings.ts";
import type { ChildProfileProvenance } from "../../shared/types.ts";
import { resolveSubagentChildProfile, type ResolvedSubagentChildProfileSelection, type SubagentChildProfileRequest } from "./child-profile-resolver.ts";

interface RoutableItem {
	agent: string;
	task?: string;
	cwd?: string;
	model?: string;
	thinking?: string | false;
	modelSource?: "resolver";
	childProfile?: ChildProfileProvenance;
}

export interface SubagentChildProfileRoutableParams {
	agent?: string;
	task?: string;
	cwd?: string;
	model?: string;
	thinking?: string | false;
	modelSource?: "resolver";
	childProfile?: ChildProfileProvenance;
	context?: "fresh" | "fork" | "profile";
	tasks?: RoutableItem[];
	chain?: ChainStep[];
}

export interface ApplySubagentChildProfilesOptions {
	/** @deprecated Internal compatibility alias; prefer sessionIds. */
	sessionId?: string;
	sessionIds?: readonly string[];
	cwd: string;
	parentModel?: SubagentChildProfileRequest["parentModel"];
	directParallel?: boolean;
	tasksParallel?: boolean;
	disabled?: boolean;
	signal?: AbortSignal;
	isEligible?: (item: RoutableItem) => boolean;
	validateSelection?: (item: RoutableItem, selection: ResolvedSubagentChildProfileSelection) => void | Promise<void>;
	onWarning?: (warning: string) => void;
}

function provenance(selection: ResolvedSubagentChildProfileSelection): ChildProfileProvenance {
	return { profile: selection.profile, source: selection.source, confidence: selection.confidence };
}

async function routeItem<T extends RoutableItem>(item: T, parallel: boolean, params: SubagentChildProfileRoutableParams, options: ApplySubagentChildProfilesOptions): Promise<T> {
	if (item.model !== undefined || item.thinking !== undefined || options.isEligible?.(item) === false) return item;
	const result = await resolveSubagentChildProfile([...(options.sessionIds ?? []), options.sessionId ?? ""], {
		agent: item.agent,
		task: item.task ?? "",
		cwd: item.cwd ?? options.cwd,
		parallel,
		...(params.context === "fresh" || params.context === "fork" ? { context: params.context } : {}),
		...(options.parentModel ? { parentModel: options.parentModel } : {}),
	}, { signal: options.signal });
	for (const warning of result.warnings) options.onWarning?.(warning);
	if (!result.selection) return item;
	try {
		await options.validateSelection?.(item, result.selection);
	} catch (error) {
		options.onWarning?.(`Child profile resolver '${result.selection.source}' selection '${result.selection.profile}' failed open: ${error instanceof Error ? error.message : String(error)}`);
		return item;
	}
	return {
		...item,
		model: result.selection.model,
		...(result.selection.thinking ? { thinking: result.selection.thinking } : {}),
		modelSource: "resolver",
		childProfile: provenance(result.selection),
	};
}

async function routeChainStep(step: ChainStep, params: SubagentChildProfileRoutableParams, options: ApplySubagentChildProfilesOptions): Promise<ChainStep> {
	if ("checkpoint" in step) return step;
	if (isParallelStep(step)) return { ...step, parallel: await Promise.all(step.parallel.map((item) => routeItem(item, true, params, options))) };
	if (isDynamicParallelStep(step)) return { ...step, parallel: await routeItem(step.parallel, true, params, options) };
	return routeItem(step, false, params, options);
}

export async function applySubagentChildProfiles<T extends SubagentChildProfileRoutableParams>(params: T, options: ApplySubagentChildProfilesOptions): Promise<T> {
	if (!options.sessionId && !options.sessionIds?.length || options.disabled === true || params.model !== undefined || params.thinking !== undefined) return params;
	const tasks = params.tasks ? await Promise.all(params.tasks.map((item) => routeItem(item, options.tasksParallel !== false, params, options))) : undefined;
	const chain = params.chain ? await Promise.all(params.chain.map((step) => routeChainStep(step, params, options))) : undefined;
	let direct: RoutableItem | undefined;
	if (params.agent && !params.tasks?.length && !params.chain?.length) direct = await routeItem({ agent: params.agent, task: params.task, cwd: params.cwd, model: params.model, thinking: params.thinking, modelSource: params.modelSource, childProfile: params.childProfile }, options.directParallel === true, params, options);
	return { ...params, ...(tasks ? { tasks } : {}), ...(chain ? { chain } : {}), ...(direct ? direct : {}) };
}
