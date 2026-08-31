import type { EffectsProjection } from "../../src/shared/types.ts";
import type { ChildTerminalDecisionInput } from "../../src/runs/shared/terminal-decision.ts";

export interface TerminalDecisionCase {
	name: string;
	input: ChildTerminalDecisionInput;
	expected: {
		status: "completed" | "failed" | "paused" | "stopped" | "detached";
		success: boolean;
		exitCode: number;
		acceptance: "not-requested" | "accepted" | "rejected";
		effect: "not-requested" | "not-applicable" | "observed" | "missing" | "blocked";
		error?: string;
	};
}

const missingMutation: EffectsProjection = {
	fileMutation: {
		status: "missing",
		expected: true,
		attempted: false,
		message: "Required implementation mutation was not observed.",
	},
};

export const terminalDecisionCases: TerminalDecisionCase[] = [
	{
		name: "successful execution with accepted evidence",
		input: { exitCode: 0, acceptance: { status: "accepted" }, effects: { fileMutation: { status: "observed", expected: true, attempted: true } } },
		expected: { status: "completed", success: true, exitCode: 0, acceptance: "accepted", effect: "observed" },
	},
	{
		name: "explicit acceptance rejection fails closed",
		input: { exitCode: 0, acceptance: { status: "rejected", diagnostic: "Acceptance rejected: tests failed." } },
		expected: { status: "failed", success: false, exitCode: 1, acceptance: "rejected", effect: "not-requested", error: "Acceptance rejected: tests failed." },
	},
	{
		name: "missing acceptance evidence fails closed",
		input: { exitCode: 0, acceptance: { status: "pending" } },
		expected: { status: "failed", success: false, exitCode: 1, acceptance: "rejected", effect: "not-requested", error: "Required acceptance evidence was rejected or incomplete." },
	},
	{
		name: "warning acceptance rejection remains non-blocking",
		input: { exitCode: 0, acceptance: { status: "rejected", diagnostic: "Advisory check failed.", required: false } },
		expected: { status: "completed", success: true, exitCode: 0, acceptance: "rejected", effect: "not-requested" },
	},
	{
		name: "missing mutation evidence fails closed",
		input: { exitCode: 0, effects: missingMutation },
		expected: { status: "failed", success: false, exitCode: 1, acceptance: "not-requested", effect: "missing", error: "Required implementation mutation was not observed." },
	},
	{
		name: "blocked required mutation fails closed",
		input: { exitCode: 0, effects: { fileMutation: { status: "blocked", expected: true, attempted: true, message: "Required mutation was blocked by policy." } } },
		expected: { status: "failed", success: false, exitCode: 1, acceptance: "not-requested", effect: "blocked", error: "Required mutation was blocked by policy." },
	},
	{
		name: "execution failure remains the primary diagnostic",
		input: { exitCode: 2, error: "Child process failed.", acceptance: { status: "rejected", diagnostic: "Acceptance rejected." }, effects: missingMutation },
		expected: { status: "failed", success: false, exitCode: 2, acceptance: "rejected", effect: "missing", error: "Child process failed." },
	},
	{
		name: "timeout wins over interrupt",
		input: { exitCode: 0, timedOut: true, interrupted: true, error: "Subagent timed out." },
		expected: { status: "failed", success: false, exitCode: 1, acceptance: "not-requested", effect: "not-requested", error: "Subagent timed out." },
	},
	{
		name: "stop remains stopped",
		input: { exitCode: 0, stopped: true, timedOut: true, interrupted: true, error: "Subagent stopped by user." },
		expected: { status: "stopped", success: false, exitCode: 1, acceptance: "not-requested", effect: "not-requested", error: "Subagent stopped by user." },
	},
	{
		name: "interrupt remains paused",
		input: { exitCode: 0, interrupted: true },
		expected: { status: "paused", success: false, exitCode: 0, acceptance: "not-requested", effect: "not-requested" },
	},
	{
		name: "detach remains detached",
		input: { exitCode: 0, detached: true, stopped: true, timedOut: true, interrupted: true },
		expected: { status: "detached", success: false, exitCode: 0, acceptance: "not-requested", effect: "not-requested" },
	},
];
