import * as fs from "node:fs";
import * as path from "node:path";
import { writePrivateAtomicJson } from "../shared/atomic-json.ts";
import { withPrivateFileLock } from "../shared/private-file-lock.ts";
import type { MissionRecord, MissionStatus, MissionStoreLocation } from "./types.ts";
import {
	MissionNotFoundError,
	missionRecordPath,
	parseMissionRecord,
	readMission,
	validateMissionId,
} from "./store.ts";

/** Compatibility expires after one published release following Package 2a. */
export const MISSION_BINDING_FILE = "mission.json";

export interface LegacyMissionBinding {
	missionId: string;
	location: MissionStoreLocation;
	autoCreated: false;
}

function parsePersistedBinding(value: unknown, source: string): LegacyMissionBinding {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${source} must be an object`);
	}
	const input = value as Record<string, unknown>;
	if (input.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
	for (const field of ["projectRoot", "missionDir", "globalIndexDir"] as const) {
		if (typeof input[field] !== "string" || !input[field].trim()) {
			throw new Error(`${source}.${field} must be a non-empty string`);
		}
	}
	if (typeof input.writeGlobalIndex !== "boolean") {
		throw new Error(`${source}.writeGlobalIndex must be boolean`);
	}
	if (input.retainTerminal !== undefined && (!Number.isInteger(input.retainTerminal) || (input.retainTerminal as number) < 1)) {
		throw new Error(`${source}.retainTerminal must be a positive integer`);
	}

	const location: MissionStoreLocation = {
		projectRoot: input.projectRoot as string,
		missionDir: input.missionDir as string,
		globalIndexDir: input.globalIndexDir as string,
		writeGlobalIndex: input.writeGlobalIndex,
		...(input.retainTerminal !== undefined ? { retainTerminal: input.retainTerminal as number } : {}),
	};
	return {
		missionId: validateMissionId(input.missionId, `${source}.missionId`),
		autoCreated: false,
		location,
	};
}

export function readMissionBinding(asyncDir: string): LegacyMissionBinding | undefined {
	const bindingPath = path.join(asyncDir, MISSION_BINDING_FILE);
	if (!fs.existsSync(bindingPath)) return undefined;
	const parsed: unknown = JSON.parse(fs.readFileSync(bindingPath, "utf-8"));
	return parsePersistedBinding(parsed, bindingPath);
}

function completionMissionStatus(record: MissionRecord, runId: string, runStatus: string): MissionStatus {
	if (["completed", "failed", "cancelled"].includes(record.status)) return record.status;
	if (["active", "queued", "running"].includes(runStatus) || record.goal) return "active";
	if (runStatus === "paused") return "waiting";
	const hasActiveSibling = record.runs.some((run) =>
		run.runId !== runId && ["active", "queued", "running"].includes(run.status ?? "")
	);
	if (hasActiveSibling) return "active";
	if (["completed", "complete"].includes(runStatus)) return "completed";
	if (["stopped", "rejected", "cancelled"].includes(runStatus)) return "cancelled";
	return "failed";
}

function tokens(value: unknown): number | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const total = (value as { total?: unknown }).total;
	return Number.isSafeInteger(total) && (total as number) >= 0 ? total as number : undefined;
}

function resultTokens(results: unknown): number | undefined {
	if (!Array.isArray(results)) return undefined;
	return results.reduce<number>((sum, result) => {
		if (!result || typeof result !== "object" || Array.isArray(result)) return sum;
		return sum + (tokens((result as { tokens?: unknown }).tokens) ?? 0);
	}, 0);
}

function rawObjects(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is Record<string, unknown> =>
		Boolean(item) && typeof item === "object" && !Array.isArray(item)
	);
}

function optionalTrimmedText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function workflowChildStatus(runStatus: string, success: unknown): string {
	if (["complete", "completed"].includes(runStatus) || success === true) return "completed";
	if (runStatus === "paused") return "paused";
	if (runStatus === "stopped") return "stopped";
	return "failed";
}

/** The only Package 2a mission writer. It can update an existing schema-v1 record, never create one. */
export function mergeLegacyMissionCompletion(
	binding: LegacyMissionBinding,
	event: Record<string, unknown>,
): MissionRecord | undefined {
	const recordPath = missionRecordPath(binding.location, binding.missionId);
	if (!fs.existsSync(recordPath)) return undefined;

	return withPrivateFileLock(recordPath, () => {
		let raw: Record<string, unknown>;
		try {
			const parsed: unknown = JSON.parse(fs.readFileSync(recordPath, "utf-8"));
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("root must be an object");
			}
			raw = parsed as Record<string, unknown>;
		} catch (error) {
			throw new Error(`Invalid legacy mission file '${recordPath}': ${error instanceof Error ? error.message : String(error)}`);
		}

		const current = parseMissionRecord(raw, recordPath);
		if (current.id !== binding.missionId) {
			throw new Error(`Legacy mission id '${current.id}' does not match binding '${binding.missionId}'.`);
		}
		const runId = typeof event.runId === "string"
			? event.runId
			: typeof event.id === "string" ? event.id : undefined;
		if (!runId) throw new Error("Async mission completion is missing runId");
		const runStatus = typeof event.state === "string"
			? event.state
			: event.success === true ? "completed" : "failed";
		const completedAt = new Date().toISOString();
		const usage = tokens(event.totalTokens) ?? resultTokens(event.results);

		const runs = rawObjects(raw.runs);
		const runIndex = runs.findIndex((run) => run.runId === runId && run.childIndex === undefined);
		const previousRun = runIndex >= 0 ? runs[runIndex]! : undefined;
		const previousUsage = previousRun?.usage && typeof previousRun.usage === "object" && !Array.isArray(previousRun.usage)
			? previousRun.usage as Record<string, unknown>
			: undefined;
		const mode = typeof event.mode === "string" && ["single", "parallel", "chain", "workflow"].includes(event.mode)
			? event.mode
			: "external";
		const runPatch: Record<string, unknown> = {
			runId,
			mode,
			asyncDir: event.asyncDir,
			status: runStatus,
			completedAt,
			...(usage && usage > 0 ? { usage: { ...previousUsage, tokens: usage } } : {}),
		};
		if (runIndex >= 0) {
			runs[runIndex] = { ...previousRun, ...runPatch };
		} else {
			runs.push(runPatch);
		}

		const artifacts = rawObjects(raw.artifacts);
		const addArtifact = (artifact: Record<string, unknown>): void => {
			const exists = artifacts.some((item) => item.path === artifact.path && item.kind === artifact.kind);
			if (!exists) artifacts.push(artifact);
		};
		const asyncDir = event.asyncDir as string;
		addArtifact({ kind: "status", path: path.join(asyncDir, "status.json") });
		addArtifact({ kind: "other", path: path.join(asyncDir, "events.jsonl"), description: "Lifecycle events" });

		if (event.parallelHandoff && typeof event.parallelHandoff === "object" && !Array.isArray(event.parallelHandoff)) {
			const handoffPath = (event.parallelHandoff as { path?: unknown }).path;
			if (typeof handoffPath === "string") addArtifact({ kind: "manifest", path: handoffPath });
		}
		for (const result of rawObjects(event.results)) {
			if (typeof result.artifactPath === "string") {
				addArtifact({ kind: "output", path: result.artifactPath });
			}
			if (result.artifactPaths && typeof result.artifactPaths === "object" && !Array.isArray(result.artifactPaths)) {
				const outputPath = (result.artifactPaths as { outputPath?: unknown }).outputPath;
				if (typeof outputPath === "string") addArtifact({ kind: "output", path: outputPath });
			}
		}

		const workflowRunId = optionalTrimmedText(event.parentWorkflowRunId);
		const workflowKey = optionalTrimmedText(event.workflowKey);
		const summary = typeof event.summary === "string" && event.summary.trim()
			? event.summary.slice(0, 2000)
			: undefined;
		const workflowChildren = rawObjects(raw.workflowChildren);
		if (workflowRunId && workflowKey) {
			const childIndex = workflowChildren.findIndex((child) =>
				child.workflowRunId === workflowRunId && child.key === workflowKey
			);
			const childStatus = workflowChildStatus(runStatus, event.success);
			const previousChild = childIndex >= 0
				? workflowChildren[childIndex]!
				: { workflowRunId, key: workflowKey, startedAt: completedAt };
			const previousHeartbeat = previousChild.heartbeat
				&& typeof previousChild.heartbeat === "object"
				&& !Array.isArray(previousChild.heartbeat)
				? previousChild.heartbeat as Record<string, unknown>
				: {};
			const artifactPaths = artifacts
				.map((artifact) => artifact.path)
				.filter((value): value is string => typeof value === "string");
			const childPatch: Record<string, unknown> = {
				...previousChild,
				runId,
				status: childStatus,
				updatedAt: completedAt,
				artifactPaths,
				...(!["running", "queued", "active", "paused"].includes(childStatus) ? { completedAt } : {}),
				heartbeat: {
					...previousHeartbeat,
					updatedAt: completedAt,
					status: childStatus,
					...(summary ? { message: summary } : {}),
				},
			};
			if (childIndex >= 0) {
				workflowChildren[childIndex] = childPatch;
			} else {
				workflowChildren.push(childPatch);
			}
		}

		raw.runs = runs;
		raw.artifacts = artifacts;
		raw.workflowChildren = workflowChildren;
		raw.status = completionMissionStatus(current, runId, runStatus);
		raw.updatedAt = completedAt;
		if (summary) raw.summary = summary;
		parseMissionRecord(raw, recordPath);
		writePrivateAtomicJson(recordPath, raw);
		return readMission(binding.location, binding.missionId);
	}, { label: "legacy mission completion" });
}

export function syncMissionFromAsyncCompletion(value: unknown): MissionRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const event = value as Record<string, unknown>;
	if (typeof event.asyncDir !== "string" || !event.asyncDir.trim()) return undefined;
	const binding = readMissionBinding(event.asyncDir);
	if (!binding) return undefined;
	try {
		return mergeLegacyMissionCompletion(binding, event);
	} catch (error) {
		if (error instanceof MissionNotFoundError) return undefined;
		throw error;
	}
}
