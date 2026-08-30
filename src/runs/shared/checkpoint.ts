export interface CheckpointTargetStep {
	status: string;
	runner?: { type?: string };
}

export function checkpointSteeringTargetIndexes(steps: readonly CheckpointTargetStep[]): number[] {
	return steps.flatMap((step, index) => step.status === "running"
		&& step.runner?.type !== "external-cli"
		&& step.runner?.type !== "external-job"
		? [index]
		: []);
}
