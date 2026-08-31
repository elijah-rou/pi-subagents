import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_ASYNC_TIMEOUT_MS, emitProcessTerminalEvent, formatAsyncStartedMessage, resolveAsyncRunnerLogPaths } from "../../src/runs/background/async-execution.ts";
import type { AgentConfig } from "../../src/agents/agent-contract.ts";
import { SUBAGENT_PROCESS_TERMINAL_EVENT } from "../../src/shared/types.ts";

const agent = (name: string, toolBudget?: AgentConfig["toolBudget"]): AgentConfig => ({
	name,
	description: `${name} agent`,
	systemPromptMode: "replace",
	inheritProjectContext: false,
	inheritSkills: false,
	systemPrompt: "You are a test agent.",
	source: "project",
	filePath: `${name}.md`,
	...(toolBudget ? { toolBudget } : {}),
});

const ctx = {
	cwd: process.cwd(),
	currentSessionId: "session-1",
	currentModel: undefined,
	currentModelProvider: undefined,
	modelScope: undefined,
};

describe("async runner execution", () => {

	it("formats interactive yield and headless auto-drain guidance separately", () => {
		const interactive = formatAsyncStartedMessage("Async: worker [interactive]", true);
		assert.match(interactive, /interactive session[\s\S]*return control/i);
		assert.match(interactive, /do not call subagent_wait\(\) merely to wait/i);
		assert.match(interactive, /nonBlocking: true/);
		assert.doesNotMatch(interactive, /auto-drains current-session background work/i);

		const headless = formatAsyncStartedMessage("Async: worker [headless]", false);
		assert.match(headless, /non-interactive run.*auto-drains current-session background work at agent_end/i);
		assert.match(headless, /call subagent_wait\(\).*results before it ends/i);
		assert.doesNotMatch(headless, /nonBlocking: true/);
		assert.doesNotMatch(headless, /By default, return control to the user/i);
	});

	it("places detached runner stdio logs in the async run directory", () => {
		const asyncDir = path.join("tmp", "async-run");
		assert.deepEqual(resolveAsyncRunnerLogPaths({ asyncDir }), {
			stdoutPath: path.join(asyncDir, "runner.stdout.log"),
			stderrPath: path.join(asyncDir, "runner.stderr.log"),
		});
	});

	it("omits runner log paths when asyncDir is unavailable", () => {
		assert.equal(resolveAsyncRunnerLogPaths({}), undefined);
	});
});

describe("async runner process terminal events", () => {
	const proof = { version: 1, runId: "run-terminal", runnerProcessInstanceId: "runner-1", state: "unknown", reason: "writer-close-unverified" };
	const staleMessage = "This extension ctx is stale after session replacement or reload.";

	const makeCtx = (emit: (name: string, payload?: unknown) => unknown) => ({
		...ctx,
		pi: { events: { emit } } as unknown as ExtensionAPI,
	});

	it("emits the process terminal proof on a live event bus", () => {
		const emitted: Array<[string, unknown]> = [];
		emitProcessTerminalEvent(makeCtx((name, payload) => { emitted.push([name, payload]); }), proof);

		assert.deepEqual(emitted, [[SUBAGENT_PROCESS_TERMINAL_EVENT, proof]]);
	});

	it("drops stale extension ctx failures without throwing", () => {
		assert.doesNotThrow(() => emitProcessTerminalEvent(makeCtx(() => {
			throw new Error(staleMessage);
		}), proof));
	});

	it("logs non-stale event bus failures without throwing", () => {
		const originalError = console.error;
		let logged: unknown[] | undefined;
		console.error = (...args: unknown[]) => { logged = args; };
		try {
			assert.doesNotThrow(() => emitProcessTerminalEvent(makeCtx(() => {
				throw new Error("event bus unavailable");
			}), proof));
		} finally {
			console.error = originalError;
		}

		assert.ok(logged?.some((arg) => arg instanceof Error && arg.message === "event bus unavailable"));
	});
});
