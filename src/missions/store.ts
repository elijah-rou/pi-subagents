import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "../shared/config-paths.ts";
import {
	MISSION_STATUSES,
	type MissionArtifact,
	type MissionDecision,
	type MissionGoal,
	type MissionJournalEntry,
	type MissionListResult,
	type MissionReceipt,
	type MissionRecord,
	type MissionRunLink,
	type MissionRunMode,
	type MissionStatus,
	type MissionStoreConfig,
	type MissionStoreLocation,
	type MissionWorkflowChild,
} from "./types.ts";

const MISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MISSION_STATUS_SET = new Set<string>(MISSION_STATUSES);
const MISSION_RUN_MODES = new Set<string>(["single", "parallel", "chain", "workflow", "scheduled", "external"]);

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function optionalText(value: unknown, label: string): string | undefined {
	if (value === undefined) return undefined;
	return text(value, label);
}

function time(value: unknown, label: string): string {
	const result = text(value, label);
	if (Number.isNaN(Date.parse(result))) {
		throw new Error(`${label} must be an ISO timestamp`);
	}
	return result;
}

function strings(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value.map((item, index) => text(item, `${label}[${index}]`));
}

function optionalTokens(value: unknown, label: string, positive = false): { tokens: number } | undefined {
	if (value === undefined) return undefined;
	const input = object(value, label);
	if (!Number.isSafeInteger(input.tokens) || (input.tokens as number) < (positive ? 1 : 0)) {
		throw new Error(`${label}.tokens is invalid`);
	}
	return { tokens: input.tokens as number };
}

export function validateMissionId(value: unknown, label = "missionId"): string {
	const id = text(value, label);
	if (!MISSION_ID_PATTERN.test(id) || id.includes("..")) {
		throw new Error(`${label} must contain only letters, numbers, '.', '_', or '-' and cannot contain '..'`);
	}
	return id;
}

function parseRun(value: unknown, label: string): MissionRunLink {
	const input = object(value, label);
	const mode = text(input.mode, `${label}.mode`);
	if (!MISSION_RUN_MODES.has(mode)) throw new Error(`${label}.mode is invalid`);
	if (input.childIndex !== undefined && (!Number.isInteger(input.childIndex) || (input.childIndex as number) < 0)) {
		throw new Error(`${label}.childIndex is invalid`);
	}

	const asyncDir = optionalText(input.asyncDir, `${label}.asyncDir`);
	const agent = optionalText(input.agent, `${label}.agent`);
	const status = optionalText(input.status, `${label}.status`);
	const usage = optionalTokens(input.usage, `${label}.usage`);
	return {
		runId: text(input.runId, `${label}.runId`),
		mode: mode as MissionRunMode,
		...(asyncDir ? { asyncDir } : {}),
		...(input.childIndex !== undefined ? { childIndex: input.childIndex as number } : {}),
		...(agent ? { agent } : {}),
		...(status ? { status } : {}),
		...(input.startedAt !== undefined ? { startedAt: time(input.startedAt, `${label}.startedAt`) } : {}),
		...(input.completedAt !== undefined ? { completedAt: time(input.completedAt, `${label}.completedAt`) } : {}),
		...(usage ? { usage } : {}),
	};
}

function parseWorkflowChild(value: unknown, label: string): MissionWorkflowChild {
	const input = object(value, label);
	const heartbeatInput = input.heartbeat === undefined ? undefined : object(input.heartbeat, `${label}.heartbeat`);
	const runId = optionalText(input.runId, `${label}.runId`);
	const agent = optionalText(input.agent, `${label}.agent`);
	const task = optionalText(input.task, `${label}.task`);
	const childLabel = optionalText(input.label, `${label}.label`);
	const phase = optionalText(input.phase, `${label}.phase`);
	const sessionPath = optionalText(input.sessionPath, `${label}.sessionPath`);

	let heartbeat: MissionWorkflowChild["heartbeat"];
	if (heartbeatInput) {
		const heartbeatStatus = optionalText(heartbeatInput.status, `${label}.heartbeat.status`);
		const heartbeatPhase = optionalText(heartbeatInput.phase, `${label}.heartbeat.phase`);
		const heartbeatMessage = optionalText(heartbeatInput.message, `${label}.heartbeat.message`);
		heartbeat = {
			updatedAt: time(heartbeatInput.updatedAt, `${label}.heartbeat.updatedAt`),
			...(heartbeatStatus ? { status: heartbeatStatus } : {}),
			...(heartbeatPhase ? { phase: heartbeatPhase } : {}),
			...(heartbeatMessage ? { message: heartbeatMessage } : {}),
		};
	}

	return {
		workflowRunId: text(input.workflowRunId, `${label}.workflowRunId`),
		key: validateMissionId(input.key, `${label}.key`),
		status: text(input.status, `${label}.status`),
		startedAt: time(input.startedAt, `${label}.startedAt`),
		updatedAt: time(input.updatedAt, `${label}.updatedAt`),
		artifactPaths: input.artifactPaths === undefined ? [] : strings(input.artifactPaths, `${label}.artifactPaths`),
		...(runId ? { runId } : {}),
		...(agent ? { agent } : {}),
		...(task ? { task } : {}),
		...(childLabel ? { label: childLabel } : {}),
		...(phase ? { phase } : {}),
		...(input.completedAt !== undefined ? { completedAt: time(input.completedAt, `${label}.completedAt`) } : {}),
		...(sessionPath ? { sessionPath } : {}),
		...(heartbeat ? { heartbeat } : {}),
	};
}

function parseDecision(value: unknown, label: string): MissionDecision {
	const input = object(value, label);
	if (input.status !== "open" && input.status !== "resolved") {
		throw new Error(`${label}.status is invalid`);
	}
	const resolution = optionalText(input.resolution, `${label}.resolution`);
	return {
		id: validateMissionId(input.id, `${label}.id`),
		status: input.status,
		title: text(input.title, `${label}.title`),
		createdAt: time(input.createdAt, `${label}.createdAt`),
		...(input.resolvedAt !== undefined ? { resolvedAt: time(input.resolvedAt, `${label}.resolvedAt`) } : {}),
		...(resolution ? { resolution } : {}),
	};
}

function parseArtifact(value: unknown, label: string): MissionArtifact {
	const input = object(value, label);
	const description = optionalText(input.description, `${label}.description`);
	return {
		kind: text(input.kind, `${label}.kind`) as MissionArtifact["kind"],
		path: text(input.path, `${label}.path`),
		...(description ? { description } : {}),
	};
}

function parseReceipt(value: unknown, label: string): MissionReceipt {
	const input = object(value, label);
	const description = optionalText(input.description, `${label}.description`);
	return {
		kind: text(input.kind, `${label}.kind`) as MissionReceipt["kind"],
		status: text(input.status, `${label}.status`) as MissionReceipt["status"],
		title: text(input.title, `${label}.title`),
		url: text(input.url, `${label}.url`),
		createdAt: time(input.createdAt, `${label}.createdAt`),
		...(description ? { description } : {}),
	};
}

function parseJournal(value: unknown, label: string): MissionJournalEntry {
	const input = object(value, label);
	const body = optionalText(input.body, `${label}.body`);
	const runId = optionalText(input.runId, `${label}.runId`);
	return {
		id: validateMissionId(input.id, `${label}.id`),
		kind: text(input.kind, `${label}.kind`) as MissionJournalEntry["kind"],
		title: text(input.title, `${label}.title`),
		createdAt: time(input.createdAt, `${label}.createdAt`),
		evidence: input.evidence === undefined ? [] : strings(input.evidence, `${label}.evidence`),
		...(body ? { body } : {}),
		...(runId ? { runId } : {}),
	};
}

export function parseMissionRecord(value: unknown, source = "mission record"): MissionRecord {
	const input = object(value, source);
	if (input.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
	for (const field of ["runs", "decisions", "artifacts"] as const) {
		if (!Array.isArray(input[field])) throw new Error(`${source}.${field} must be an array`);
	}
	for (const field of ["workflowChildren", "receipts", "journal"] as const) {
		if (input[field] !== undefined && !Array.isArray(input[field])) {
			throw new Error(`${source}.${field} must be an array`);
		}
	}

	const status = text(input.status, `${source}.status`);
	if (!MISSION_STATUS_SET.has(status)) throw new Error(`${source}.status is invalid`);
	const goalInput = input.goal === undefined ? undefined : object(input.goal, `${source}.goal`);
	if (goalInput && !["active", "paused", "budget-exhausted"].includes(String(goalInput.status))) {
		throw new Error(`${source}.goal.status is invalid`);
	}
	const goal = goalInput ? { status: goalInput.status as MissionGoal["status"] } : undefined;
	const budget = optionalTokens(input.budget, `${source}.budget`, true);
	if (goal && !budget) throw new Error(`${source}.budget is required for a goal mission`);
	const usage = optionalTokens(input.usage, `${source}.usage`);
	const cwd = optionalText(input.cwd, `${source}.cwd`);
	const ownerSessionId = optionalText(input.ownerSessionId, `${source}.ownerSessionId`);
	const summary = optionalText(input.summary, `${source}.summary`);

	return {
		schemaVersion: 1,
		id: validateMissionId(input.id, `${source}.id`),
		title: text(input.title, `${source}.title`),
		objective: text(input.objective, `${source}.objective`),
		...(goal ? { goal } : {}),
		...(budget ? { budget } : {}),
		...(usage ? { usage } : {}),
		status: status as MissionStatus,
		createdAt: time(input.createdAt, `${source}.createdAt`),
		updatedAt: time(input.updatedAt, `${source}.updatedAt`),
		runs: (input.runs as unknown[]).map((item, index) => parseRun(item, `${source}.runs[${index}]`)),
		workflowChildren: ((input.workflowChildren ?? []) as unknown[]).map((item, index) => parseWorkflowChild(item, `${source}.workflowChildren[${index}]`)),
		decisions: (input.decisions as unknown[]).map((item, index) => parseDecision(item, `${source}.decisions[${index}]`)),
		artifacts: (input.artifacts as unknown[]).map((item, index) => parseArtifact(item, `${source}.artifacts[${index}]`)),
		receipts: ((input.receipts ?? []) as unknown[]).map((item, index) => parseReceipt(item, `${source}.receipts[${index}]`)),
		journal: ((input.journal ?? []) as unknown[]).map((item, index) => parseJournal(item, `${source}.journal[${index}]`)),
		...(cwd ? { cwd } : {}),
		...(ownerSessionId ? { ownerSessionId } : {}),
		...(summary ? { summary } : {}),
		...(input.acceptance !== undefined ? { acceptance: input.acceptance } : {}),
		...(input.labels !== undefined ? { labels: strings(input.labels, `${source}.labels`) } : {}),
	};
}

function configuredPath(value: string, projectRoot: string): string {
	const expanded = value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
	return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(projectRoot, expanded);
}

export function validateMissionStoreConfig(value: unknown, label = "config.missions"): MissionStoreConfig | undefined {
	if (value === undefined) return undefined;
	const input = object(value, label);
	for (const key of Object.keys(input)) {
		if (!["enabled", "directory", "globalIndex", "globalIndexDir", "retainTerminal"].includes(key)) {
			throw new Error(`${label}.${key} is unknown`);
		}
	}
	if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
		throw new Error(`${label}.enabled must be boolean`);
	}
	if (input.globalIndex !== undefined && typeof input.globalIndex !== "boolean") {
		throw new Error(`${label}.globalIndex must be boolean`);
	}
	if (input.retainTerminal !== undefined && (!Number.isInteger(input.retainTerminal) || (input.retainTerminal as number) < 1)) {
		throw new Error(`${label}.retainTerminal must be a positive integer`);
	}

	const directory = optionalText(input.directory, `${label}.directory`);
	const globalIndexDir = optionalText(input.globalIndexDir, `${label}.globalIndexDir`);
	return {
		...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
		...(directory ? { directory } : {}),
		...(typeof input.globalIndex === "boolean" ? { globalIndex: input.globalIndex } : {}),
		...(globalIndexDir ? { globalIndexDir } : {}),
		...(input.retainTerminal !== undefined ? { retainTerminal: input.retainTerminal as number } : {}),
	};
}

export function resolveMissionStoreLocation(input: {
	projectRoot: string;
	config?: MissionStoreConfig;
	agentDir?: string;
}): MissionStoreLocation {
	const projectRoot = path.resolve(input.projectRoot);
	const agentDir = input.agentDir ?? getAgentDir();
	const projectHash = createHash("sha256").update(projectRoot).digest("hex");
	const missionDir = input.config?.directory
		? configuredPath(input.config.directory, projectRoot)
		: path.join(agentDir, "missions", "projects", projectHash);
	const globalIndexDir = input.config?.globalIndexDir
		? configuredPath(input.config.globalIndexDir, projectRoot)
		: path.join(agentDir, "missions", "index");
	return {
		projectRoot,
		missionDir,
		globalIndexDir,
		writeGlobalIndex: input.config?.globalIndex !== false,
		...(input.config?.retainTerminal !== undefined ? { retainTerminal: input.config.retainTerminal } : {}),
	};
}

export function missionRecordPath(location: MissionStoreLocation, missionId: string): string {
	return path.join(location.missionDir, `${validateMissionId(missionId)}.json`);
}

export class MissionNotFoundError extends Error {
	readonly code = "MISSION_NOT_FOUND";
	readonly missionId: string;

	constructor(missionId: string, location: MissionStoreLocation) {
		super(`Mission '${missionId}' was not found in mission directory '${location.missionDir}'.`);
		this.name = "MissionNotFoundError";
		this.missionId = missionId;
	}
}

export function readMission(location: MissionStoreLocation, missionId: string): MissionRecord {
	const filePath = missionRecordPath(location, missionId);
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new MissionNotFoundError(missionId, location);
		throw error;
	}
	try {
		return parseMissionRecord(JSON.parse(raw), filePath);
	} catch (error) {
		throw new Error(`Invalid mission file '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function listMissions(location: MissionStoreLocation): MissionListResult {
	if (!fs.existsSync(location.missionDir)) return { records: [], warnings: [] };
	const records: MissionRecord[] = [];
	const warnings: string[] = [];
	const names = fs.readdirSync(location.missionDir).filter((item) => item.endsWith(".json")).sort();
	for (const name of names) {
		const filePath = path.join(location.missionDir, name);
		try {
			const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
			records.push(parseMissionRecord(parsed, filePath));
		} catch (error) {
			warnings.push(`Skipped corrupt mission '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	return { records, warnings };
}
