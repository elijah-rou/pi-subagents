import { isCheckpointStep, isDynamicParallelStep, isParallelStep, type ChainStep } from "../../shared/settings.ts";
import { resolveSubagentChildProfile, type SubagentChildProfileRequest } from "./child-profile-resolver.ts";

interface RoutableItem {
	agent: string;
	task?: string;
	cwd?: string;
	model?: string;
}

export interface SubagentChildProfileRoutableParams {
	agent?: string;
	task?: string;
	cwd?: string;
	model?: string;
	thinking?: string | false;
	context?: "fresh" | "fork";
	tasks?: RoutableItem[];
	chain?: ChainStep[];
}

export interface ApplySubagentChildProfilesOptions {
	sessionId?: string;
	cwd: string;
	parentModel?: SubagentChildProfileRequest["parentModel"];
	directParallel?: boolean;
	tasksParallel?: boolean;
	disabled?: boolean;
	onWarning?: (warning: string) => void;
}

function selectedModel(model: string, thinking: string | undefined): string {
	return thinking ? `${model}:${thinking}` : model;
}

async function routeItem<T extends RoutableItem>(item: T, parallel: boolean, params: SubagentChildProfileRoutableParams, options: ApplySubagentChildProfilesOptions): Promise<T> {
	if (item.model !== undefined) return item;
	const result = await resolveSubagentChildProfile(options.sessionId, {
		agent: item.agent,
		task: item.task ?? "",
		cwd: item.cwd ?? options.cwd,
		parallel,
		...(params.context ? { context: params.context } : {}),
		...(options.parentModel ? { parentModel: options.parentModel } : {}),
	});
	for (const warning of result.warnings) options.onWarning?.(warning);
	return result.selection ? { ...item, model: selectedModel(result.selection.model, result.selection.thinking) } : item;
}

async function routeChainStep(step: ChainStep, params: SubagentChildProfileRoutableParams, options: ApplySubagentChildProfilesOptions): Promise<ChainStep> {
	if (isCheckpointStep(step)) return step;
	if (isParallelStep(step)) return { ...step, parallel: await Promise.all(step.parallel.map((item) => routeItem(item, true, params, options))) };
	if (isDynamicParallelStep(step)) return { ...step, parallel: await routeItem(step.parallel, true, params, options) };
	return routeItem(step, false, params, options);
}

export async function applySubagentChildProfiles<T extends SubagentChildProfileRoutableParams>(params: T, options: ApplySubagentChildProfilesOptions): Promise<T> {
	if (!options.sessionId || options.disabled === true || params.model !== undefined || params.thinking !== undefined) return params;
	const tasks = params.tasks ? await Promise.all(params.tasks.map((item) => routeItem(item, options.tasksParallel !== false, params, options))) : undefined;
	const chain = params.chain ? await Promise.all(params.chain.map((step) => routeChainStep(step, params, options))) : undefined;
	let directModel = params.model;
	if (params.agent && params.model === undefined && params.thinking === undefined && !params.tasks?.length && !params.chain?.length) {
		directModel = (await routeItem({ agent: params.agent, task: params.task, cwd: params.cwd, model: params.model }, options.directParallel === true, params, options)).model;
	}
	return {
		...params,
		...(tasks ? { tasks } : {}),
		...(chain ? { chain } : {}),
		...(directModel ? { model: directModel } : {}),
	};
}
