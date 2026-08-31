import { PROMPT_REDACTED } from "../../shared/utils.ts";

const MAX_STATUS_STEP_DESCRIPTION_CHARS = 160;

/** Bounded redacted task description persisted into status.json for fleet display. */
export function statusStepDescription(task: string | undefined): string | undefined {
	if (!task?.trim()) return undefined;
	return PROMPT_REDACTED.length > MAX_STATUS_STEP_DESCRIPTION_CHARS
		? `${PROMPT_REDACTED.slice(0, MAX_STATUS_STEP_DESCRIPTION_CHARS - 1)}…`
		: PROMPT_REDACTED;
}
