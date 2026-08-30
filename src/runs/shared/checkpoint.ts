export interface CheckpointTargetStep {
	status: string;
	runner?: { type?: string };
}

function supportsCheckpointSteering(step: CheckpointTargetStep): boolean {
	return step.runner?.type !== "external-cli" && step.runner?.type !== "external-job";
}

export function checkpointSteeringTargetIndexes(steps: readonly CheckpointTargetStep[]): number[] {
	return steps.flatMap((step, index) => step.status === "running" && supportsCheckpointSteering(step) ? [index] : []);
}

export function checkpointCanReachSteerableStep(steps: readonly CheckpointTargetStep[]): boolean {
	return steps.some((step) => (step.status === "pending" || step.status === "running") && supportsCheckpointSteering(step));
}
