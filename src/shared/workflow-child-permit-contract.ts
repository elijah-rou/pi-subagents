export interface WorkflowChildPermit {
	readonly __workflowChildPermit: unique symbol;
}

export interface WorkflowChildPermitContext {
	permit: WorkflowChildPermit;
	workflowRunId: string;
	childKey: string;
}
