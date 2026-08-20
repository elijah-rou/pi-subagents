import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ChildRoutingMetadata, Details } from "../shared/types.ts";

export const WORKFLOW_CHAT_PROGRESS_MODES = ["auto", "off", "live-card"] as const;
export type WorkflowChatProgressMode = typeof WORKFLOW_CHAT_PROGRESS_MODES[number];
export type ResolvedWorkflowChatProgressMode = Exclude<WorkflowChatProgressMode, "auto">;

export interface GitRepositoryIdentity {
	root: string;
	commonDir: string;
}

export interface WorkflowChatProgressProjection {
	mode: ResolvedWorkflowChatProgressMode;
	repoRelation: "same" | "other";
	repoLabel?: string;
}

interface ResolveWorkflowChatProgressInput {
	requested: unknown;
	parentCwd: string;
	workflowCwd: string;
	background: boolean;
}

function git(cwd: string, args: string[]): string | undefined {
	const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8", windowsHide: true });
	if (result.status !== 0) return undefined;
	const output = result.stdout.trim();
	return output || undefined;
}

function realPath(value: string): string {
	try {
		return fs.realpathSync.native(value);
	} catch {
		return path.resolve(value);
	}
}

export function resolveGitRepositoryIdentity(cwd: string): GitRepositoryIdentity | undefined {
	if (git(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") return undefined;
	const root = git(cwd, ["rev-parse", "--show-toplevel"]);
	const commonDir = git(cwd, ["rev-parse", "--git-common-dir"]);
	if (!root || !commonDir) return undefined;
	const commonDirPath = path.isAbsolute(commonDir)
		? commonDir
		: [path.resolve(cwd, commonDir), path.resolve(root, commonDir)].find((candidate) => fs.existsSync(candidate)) ?? path.resolve(root, commonDir);
	return {
		root: realPath(root),
		commonDir: realPath(commonDirPath),
	};
}

function isSameGitRepositoryIdentity(left: GitRepositoryIdentity | undefined, right: GitRepositoryIdentity | undefined): boolean {
	if (!left || !right) return false;
	return left.commonDir === right.commonDir || left.root === right.root;
}

export function isSameGitRepository(leftCwd: string, rightCwd: string): boolean {
	return isSameGitRepositoryIdentity(resolveGitRepositoryIdentity(leftCwd), resolveGitRepositoryIdentity(rightCwd));
}

function normalizeRequestedMode(value: unknown): { mode?: WorkflowChatProgressMode; error?: string } {
	if (value === undefined) return { mode: "auto" };
	if (typeof value !== "string" || !WORKFLOW_CHAT_PROGRESS_MODES.includes(value as WorkflowChatProgressMode)) {
		return { error: `chatProgress must be one of: ${WORKFLOW_CHAT_PROGRESS_MODES.join(", ")}.` };
	}
	return { mode: value as WorkflowChatProgressMode };
}

export function resolveWorkflowChatProgress(input: ResolveWorkflowChatProgressInput): { projection?: WorkflowChatProgressProjection; error?: string } {
	const requested = normalizeRequestedMode(input.requested);
	if (requested.error) return { error: requested.error };
	const parentIdentity = resolveGitRepositoryIdentity(input.parentCwd);
	const workflowIdentity = resolveGitRepositoryIdentity(input.workflowCwd);
	const sameRepo = !!(
		parentIdentity
		&& workflowIdentity
		&& (parentIdentity.commonDir === workflowIdentity.commonDir || parentIdentity.root === workflowIdentity.root)
	);
	const repoLabel = workflowIdentity ? path.basename(workflowIdentity.root) : undefined;
	const repoRelation = sameRepo ? "same" : "other";

	const requestedMode = requested.mode ?? "auto";
	let mode: ResolvedWorkflowChatProgressMode;
	if (requestedMode === "auto") mode = sameRepo && !input.background ? "live-card" : "off";
	else mode = requestedMode;

	if (mode === "live-card" && !sameRepo) return { error: "chatProgress: 'live-card' is only available for workflowScript runs in the same Git repository." };
	if (mode === "live-card" && input.background) return { error: "chatProgress: 'live-card' is unavailable for async workflowScript. Async workflows have no inline live card; omit chatProgress or use auto/off. Use async:false only when the parent must block." };
	return { projection: { mode, repoRelation, ...(repoLabel ? { repoLabel } : {}) } };
}

export interface WorkflowChatProgressRow {
	key: string;
	state: "running" | "complete" | "failed" | "detached" | "stopped";
	label?: string;
	phase?: string;
	runId?: string;
	durationMs?: number;
	error?: string;
	model?: string;
	thinking?: string;
	childRouting?: ChildRoutingMetadata;
}

function cleanLabel(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const MAX_WORKFLOW_CHAT_ROWS = 16;
export const MAX_WORKFLOW_CHAT_TRACE_ENTRIES = 512;

export interface WorkflowChatProgressRowsProjection {
	rows: WorkflowChatProgressRow[];
	omittedRows: number;
	omittedTraceEntries: number;
}

export function buildWorkflowChatProgressProjection(
	trace: NonNullable<Details["workflow"]>["trace"],
	children: NonNullable<Details["workflow"]>["children"] = {},
): WorkflowChatProgressRowsProjection {
	const boundedTrace = trace.slice(-MAX_WORKFLOW_CHAT_TRACE_ENTRIES);
	const rows = new Map<string, WorkflowChatProgressRow>();
	for (const entry of boundedTrace) {
		if (entry.operation !== "run") continue;
		const existing = rows.get(entry.key);
		if (entry.state === "reused") {
			if (existing) {
				const label = cleanLabel(entry.label);
				const phase = cleanLabel(entry.phase);
				if (label) existing.label = label;
				if (phase) existing.phase = phase;
			}
			continue;
		}
		const next: WorkflowChatProgressRow = existing ?? { key: entry.key, state: "running" };
		next.state = entry.state === "completed"
			? "complete"
			: entry.state === "failed"
				? "failed"
				: entry.state === "detached"
					? "detached"
					: entry.state === "stopped"
						? "stopped"
						: "running";
		const label = cleanLabel(entry.label);
		const phase = cleanLabel(entry.phase);
		if (label) next.label = label;
		if (phase) next.phase = phase;
		if (entry.runId === undefined) delete next.runId;
		else next.runId = entry.runId;
		if (entry.durationMs === undefined) delete next.durationMs;
		else next.durationMs = entry.durationMs;
		if (entry.error === undefined) delete next.error;
		else next.error = entry.error;
		const child = children?.[entry.key];
		if (child?.runId && !next.runId) next.runId = child.runId;
		if (child?.model) next.model = child.model;
		if (child?.thinking) next.thinking = child.thinking;
		if (child?.childRouting) next.childRouting = child.childRouting;
		rows.set(entry.key, next);
	}
	const allRows = [...rows.values()];
	return {
		rows: allRows.slice(-MAX_WORKFLOW_CHAT_ROWS),
		omittedRows: Math.max(0, allRows.length - MAX_WORKFLOW_CHAT_ROWS),
		omittedTraceEntries: Math.max(0, trace.length - boundedTrace.length),
	};
}

export function buildWorkflowChatProgressRows(
	trace: NonNullable<Details["workflow"]>["trace"],
	children: NonNullable<Details["workflow"]>["children"] = {},
): WorkflowChatProgressRow[] {
	return buildWorkflowChatProgressProjection(trace, children).rows;
}

const MAX_TOPOLOGY_TRACE_ENTRIES = 2_048;
const MAX_TOPOLOGY_CHILDREN = 64;
const MAX_TOPOLOGY_DEPENDENCIES = 128;
const MAX_TOPOLOGY_DEPENDENCIES_PER_CHILD = 64;
const MAX_TOPOLOGY_LABEL_CHARACTERS = 80;
const MAX_TOPOLOGY_LABEL_INPUT_CHARACTERS = 512;

function mermaidLabel(value: string): string {
	let label = "";
	let scanned = 0;
	let previousWasSpace = true;
	for (const character of value) {
		scanned++;
		if (scanned > MAX_TOPOLOGY_LABEL_INPUT_CHARACTERS || label.length >= MAX_TOPOLOGY_LABEL_CHARACTERS) break;
		const unsafe = /[\s\[\]{}()<>|&"'`\\]/.test(character);
		if (unsafe) {
			if (!previousWasSpace && label.length < MAX_TOPOLOGY_LABEL_CHARACTERS) label += " ";
			previousWasSpace = true;
			continue;
		}
		label += character;
		previousWasSpace = false;
	}
	return label.trim() || "child";
}

interface WorkflowControlDependencies {
	keys: string[];
	omitted: boolean;
}

function traceControlDependencies(trace: NonNullable<Details["workflow"]>["trace"]): Map<string, WorkflowControlDependencies> {
	const dependencies = new Map<string, WorkflowControlDependencies>();
	let frontier: string[] = [];
	let waveDependencies: string[] | undefined;
	for (const entry of trace.slice(0, MAX_TOPOLOGY_TRACE_ENTRIES)) {
		if (entry.operation !== "run" || entry.state === "reused") continue;
		if (entry.state === "started") {
			waveDependencies ??= [...frontier];
			const rawDeclared = entry.dependencies ?? [];
			const boundedDeclared = rawDeclared.slice(0, MAX_TOPOLOGY_DEPENDENCIES_PER_CHILD);
			const declared = boundedDeclared.filter((key, index, values) => key !== entry.key && values.indexOf(key) === index);
			dependencies.set(entry.key, {
				keys: declared.length ? declared : [...waveDependencies],
				omitted: rawDeclared.length > boundedDeclared.length,
			});
			continue;
		}
		if (entry.state !== "completed" && entry.state !== "failed" && entry.state !== "detached" && entry.state !== "stopped") continue;
		const consumed = new Set(dependencies.get(entry.key)?.keys ?? []);
		frontier = frontier.filter((key) => !consumed.has(key) && key !== entry.key);
		if (!frontier.includes(entry.key)) frontier.push(entry.key);
		if (frontier.length > MAX_TOPOLOGY_CHILDREN) frontier = frontier.slice(-MAX_TOPOLOGY_CHILDREN);
		waveDependencies = undefined;
	}
	return dependencies;
}

/** Pure bounded projection of the current workflow launch trace and control-flow dependency frontier. */
export function formatWorkflowTopologyMermaid(trace: NonNullable<Details["workflow"]>["trace"]): string {
	const boundedTrace = trace.slice(0, MAX_TOPOLOGY_TRACE_ENTRIES);
	const starts: Array<NonNullable<Details["workflow"]>["trace"][number]> = [];
	let omittedChildren = trace.length > boundedTrace.length;
	for (const entry of boundedTrace) {
		if (entry.operation !== "run" || entry.state !== "started") continue;
		if (starts.length >= MAX_TOPOLOGY_CHILDREN) {
			omittedChildren = true;
			break;
		}
		starts.push(entry);
	}
	const controlDependencies = traceControlDependencies(boundedTrace);
	const indexByKey = new Map(starts.map((entry, index) => [entry.key, index]));
	const dependencySources: number[][] = starts.map(() => []);
	const hasDeclaredDependency = starts.map(() => false);
	const hasOmittedInput = starts.map(() => false);
	let dependencyCount = 0;
	for (let targetIndex = 0; targetIndex < starts.length; targetIndex++) {
		const dependencyProjection = controlDependencies.get(starts[targetIndex]!.key);
		const declared = dependencyProjection?.keys ?? [];
		if (declared.length === 0 && !dependencyProjection?.omitted) continue;
		hasDeclaredDependency[targetIndex] = true;
		hasOmittedInput[targetIndex] = dependencyProjection?.omitted === true;
		const scanLimit = Math.min(declared.length, MAX_TOPOLOGY_DEPENDENCIES_PER_CHILD);
		for (let dependencyIndex = 0; dependencyIndex < scanLimit; dependencyIndex++) {
			const sourceIndex = indexByKey.get(declared[dependencyIndex]!);
			if (sourceIndex === undefined || sourceIndex === targetIndex || dependencySources[targetIndex]!.includes(sourceIndex)) {
				hasOmittedInput[targetIndex] = sourceIndex === undefined || hasOmittedInput[targetIndex] === true;
				continue;
			}
			if (dependencyCount >= MAX_TOPOLOGY_DEPENDENCIES) {
				hasOmittedInput[targetIndex] = true;
				continue;
			}
			dependencySources[targetIndex]!.push(sourceIndex);
			dependencyCount++;
		}
		if (declared.length > scanLimit) hasOmittedInput[targetIndex] = true;
	}

	const lines = ["flowchart TD", "  start(( ))"];
	for (let index = 0; index < starts.length; index++) lines.push(`  child_${index}["${mermaidLabel(starts[index]!.label || starts[index]!.key)}"]`);
	for (let targetIndex = 0; targetIndex < starts.length; targetIndex++) {
		if (!hasDeclaredDependency[targetIndex]) lines.push(`  start --> child_${targetIndex}`);
		for (const sourceIndex of dependencySources[targetIndex]!) lines.push(`  child_${sourceIndex} --> child_${targetIndex}`);
		if (hasOmittedInput[targetIndex]) {
			lines.push(`  omitted_input_${targetIndex}["Additional input omitted"]`);
			lines.push(`  omitted_input_${targetIndex} --> child_${targetIndex}`);
		}
	}
	if (omittedChildren) {
		lines.push(`  omitted_children["Additional children omitted"]`);
		lines.push("  start --> omitted_children");
	}
	return lines.join("\n");
}
