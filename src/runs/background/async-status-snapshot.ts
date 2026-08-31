import type { AsyncJobState, SubagentState } from "../../shared/types.ts";
import type { AsyncRunSummary } from "./async-status.ts";
import {
	projectAsyncStatusSnapshot,
	type AsyncStatusSnapshotOptions,
	type AsyncStatusSnapshotV1,
} from "../shared/async-status-projection.ts";

export {
	ASYNC_STATUS_SNAPSHOT_KIND,
	ASYNC_STATUS_SNAPSHOT_VERSION,
} from "../shared/async-status-projection.ts";
export type {
	AsyncStatusSnapshotActivityV1,
	AsyncStatusSnapshotCapsV1,
	AsyncStatusSnapshotHostStepV1,
	AsyncStatusSnapshotKind,
	AsyncStatusSnapshotNodeV1,
	AsyncStatusSnapshotOmittedV1,
	AsyncStatusSnapshotOptions,
	AsyncStatusSnapshotState,
	AsyncStatusSnapshotV1,
} from "../shared/async-status-projection.ts";

export const ASYNC_STATUS_SNAPSHOT_WIDGET_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";

export function buildAsyncStatusSnapshot(jobs: Iterable<AsyncJobState>, options: AsyncStatusSnapshotOptions = {}): AsyncStatusSnapshotV1 {
	return projectAsyncStatusSnapshot(jobs, options);
}

export function asyncRunSummaryToSnapshotJob(run: AsyncRunSummary): AsyncJobState {
	return {
		...run,
		asyncId: run.id,
		status: run.state,
		agents: run.steps.map((step) => step.agent),
		updatedAt: run.lastUpdate ?? run.endedAt ?? run.startedAt,
	} as AsyncJobState;
}

export function asyncStatusSnapshotJobsForState(state: SubagentState | undefined, sessionId: string | null | undefined): AsyncJobState[] {
	if (!state || !sessionId || state.currentSessionId !== sessionId) return [];
	return [...state.asyncJobs.values()].filter((job) => job.sessionId === sessionId);
}

export function buildAsyncStatusSnapshotForState(state: SubagentState | undefined, sessionId: string | null | undefined, options: AsyncStatusSnapshotOptions = {}): AsyncStatusSnapshotV1 {
	return buildAsyncStatusSnapshot(asyncStatusSnapshotJobsForState(state, sessionId), options);
}

export function encodeAsyncStatusSnapshotWidget(jobs: Iterable<AsyncJobState>, options: AsyncStatusSnapshotOptions = {}): string[] {
	return [`${ASYNC_STATUS_SNAPSHOT_WIDGET_PREFIX}${JSON.stringify(buildAsyncStatusSnapshot(jobs, options))}`];
}
