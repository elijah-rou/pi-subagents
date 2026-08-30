export interface CheckpointTargetStep {
	status: string;
	runner?: { type?: string };
}

export interface CheckpointDeadline {
	dispose(): void;
}

/** Arms one timer for an absolute soft-checkpoint deadline. */
export function scheduleCheckpointDeadline(input: {
	checkpointAt: number;
	onDue(): void;
	now?: () => number;
	setTimer?: (callback: () => void, delay: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}): CheckpointDeadline {
	const now = input.now ?? Date.now;
	const setTimer = input.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
	const clearTimer = input.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	let timer: unknown;
	let disposed = false;
	const due = () => {
		if (disposed) return;
		disposed = true;
		timer = undefined;
		input.onDue();
	};
	timer = setTimer(due, Math.max(0, input.checkpointAt - now()));
	(timer as { unref?: () => void } | undefined)?.unref?.();
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			if (timer !== undefined) clearTimer(timer);
			timer = undefined;
		},
	};
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
