import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createSubagentExecutor } from "../../src/runs/foreground/subagent-executor.ts";
import { mergeAcceptanceInputs, resolveEffectiveAcceptance, validatePersistedAcceptanceInput, type EffectiveAcceptanceInput } from "../../src/runs/shared/acceptance.ts";
import { createNestedRoute, writeNestedEvent } from "../../src/runs/shared/nested-events.ts";
import { createRunFanoutBudget } from "../../src/runs/shared/run-fanout-budget.ts";
import { ASYNC_DIR, RESULTS_DIR, TEMP_ROOT_DIR, type AcceptanceInput, type SubagentState } from "../../src/shared/types.ts";
import { createMockPi, createTempDir, makeAgent, makeMinimalCtx, removeTempDir, type MockPi } from "../support/helpers.ts";

function createState(): SubagentState {
	return {
		baseCwd: "",
		currentSessionId: null,
		asyncJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		pendingForegroundControlNotices: new Map(),
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: { schedule: () => false, clear: () => {} },
	};
}

describe("nested revival acceptance propagation", () => {
	let tempDir: string;
	let mockPi: MockPi;
	let originalHome: string | undefined;
	let homeDir: string;
	let savedDepth: string | undefined;
	let savedMaxDepth: string | undefined;
	const cleanupPaths: string[] = [];

	before(() => {
		originalHome = process.env.HOME;
		homeDir = createTempDir("pi-nested-revival-home-");
		process.env.HOME = homeDir;
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => {
		mockPi.uninstall();
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		removeTempDir(homeDir);
	});

	beforeEach(() => {
		tempDir = createTempDir("pi-nested-revival-");
		savedDepth = process.env.PI_SUBAGENT_DEPTH;
		savedMaxDepth = process.env.PI_SUBAGENT_MAX_DEPTH;
		delete process.env.PI_SUBAGENT_DEPTH;
		delete process.env.PI_SUBAGENT_MAX_DEPTH;
		mockPi.reset();
		mockPi.onCall({ output: "revived nested answer" });
	});

	afterEach(() => {
		for (const cleanupPath of cleanupPaths.splice(0)) fs.rmSync(cleanupPath, { recursive: true, force: true });
		if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = savedDepth;
		if (savedMaxDepth === undefined) delete process.env.PI_SUBAGENT_MAX_DEPTH;
		else process.env.PI_SUBAGENT_MAX_DEPTH = savedMaxDepth;
		removeTempDir(tempDir);
	});

	async function reviveNested(options: {
		acceptanceInput?: unknown;
		resultAcceptanceInput?: unknown;
		descriptorAcceptance?: EffectiveAcceptanceInput;
		resumeAcceptance?: AcceptanceInput;
	}): Promise<EffectiveAcceptanceInput | undefined> {
		const rootRunId = `nested-root-${Date.now().toString(36)}`;
		const nestedRunId = `nested-child-${Math.random().toString(16).slice(2, 10)}`;
		const nestedAsyncDir = path.join(TEMP_ROOT_DIR, "nested-subagent-runs", rootRunId, nestedRunId);
		const nestedResultDir = path.join(RESULTS_DIR, "nested", rootRunId);
		const nestedResultPath = path.join(nestedResultDir, `${nestedRunId}.json`);
		const sessionFile = path.join(tempDir, nestedRunId, "session.jsonl");
		cleanupPaths.push(path.dirname(nestedAsyncDir), nestedResultDir);
		fs.mkdirSync(nestedAsyncDir, { recursive: true });
		fs.mkdirSync(nestedResultDir, { recursive: true });
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		fs.writeFileSync(sessionFile, "", "utf-8");
		fs.writeFileSync(path.join(nestedAsyncDir, "status.json"), JSON.stringify({
			runId: nestedRunId,
			mode: "single",
			state: "complete",
			cwd: tempDir,
			startedAt: 100,
			endedAt: 200,
			lastUpdate: 200,
			steps: [{
				agent: "worker",
				status: "complete",
				sessionFile,
				...(options.acceptanceInput !== undefined ? { acceptanceInput: options.acceptanceInput } : {}),
			}],
		}, null, 2), "utf-8");
		fs.writeFileSync(nestedResultPath, JSON.stringify({
			id: nestedRunId,
			runId: nestedRunId,
			mode: "single",
			state: "complete",
			cwd: tempDir,
			results: [{
				agent: "worker",
				success: true,
				sessionFile,
				...(options.resultAcceptanceInput !== undefined ? { acceptanceInput: options.resultAcceptanceInput } : {}),
			}],
		}, null, 2), "utf-8");
		if (options.descriptorAcceptance !== undefined) {
			fs.writeFileSync(path.join(nestedAsyncDir, "recovery-descriptor.json"), JSON.stringify({
				version: 1,
				sourceRunId: nestedRunId,
				agent: "worker",
				sessionFile,
				cwd: tempDir,
				systemPromptMode: "append",
				inheritProjectContext: true,
				inheritSkills: true,
				outputMode: "inline",
				acceptance: options.descriptorAcceptance,
				runFanoutBudget: createRunFanoutBudget(nestedRunId, 8),
				maxSubagentDepth: 1,
				share: false,
			}, null, 2), "utf-8");
		}

		const route = createNestedRoute(rootRunId);
		cleanupPaths.push(path.dirname(route.eventSink));
		writeNestedEvent(route, {
			type: "subagent.nested.completed",
			ts: 200,
			parentRunId: rootRunId,
			parentStepIndex: 0,
			child: {
				id: nestedRunId,
				parentRunId: rootRunId,
				parentStepIndex: 0,
				depth: 1,
				path: [{ runId: rootRunId, stepIndex: 0 }],
				asyncDir: nestedAsyncDir,
				state: "complete",
				agent: "worker",
				sessionFile,
				ownerState: "gone",
			},
		});
		const state = createState();
		state.foregroundControls.set(rootRunId, { runId: rootRunId, mode: "single", startedAt: 100, updatedAt: 200, nestedRoute: route });
		state.lastForegroundControlId = rootRunId;
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		fs.writeFileSync(parentSessionFile, "", "utf-8");
		const executor = createSubagentExecutor({
			pi: { events: { emit() {}, on() { return () => {}; } }, getSessionName() { return "parent"; } } as any,
			state,
			config: { maxSubagentDepth: 2, control: {}, intercomBridge: { mode: "off" } } as any,
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => tempDir,
			expandTilde: (value) => value,
			discoverAgents: () => ({ agents: [makeAgent("worker")] as any }),
			allowMutatingManagementActions: true,
		});
		const executionContext = makeMinimalCtx(tempDir);
		executionContext.sessionManager.getSessionFile = () => parentSessionFile;
		const result = await executor.execute("nested-revive", {
			action: "resume",
			id: nestedRunId,
			message: "Continue nested work",
			...(options.resumeAcceptance !== undefined ? { acceptance: options.resumeAcceptance } : {}),
		}, new AbortController().signal, undefined, executionContext as any);
		assert.equal((result as { isError?: boolean }).isError, undefined, result.content[0]?.type === "text" ? result.content[0].text : undefined);
		assert.ok(result.details.asyncDir);
		cleanupPaths.push(result.details.asyncDir, path.join(RESULTS_DIR, `${result.details.asyncId}.json`), path.join(ASYNC_DIR, result.details.asyncId ?? ""));
		const descriptor = JSON.parse(fs.readFileSync(path.join(result.details.asyncDir, "recovery-descriptor.json"), "utf-8")) as { acceptance?: EffectiveAcceptanceInput };
		return descriptor.acceptance;
	}

	function resolveRevived(value: EffectiveAcceptanceInput | undefined) {
		assert.ok(value);
		assert.deepEqual(validatePersistedAcceptanceInput(value), []);
		return resolveEffectiveAcceptance({ explicit: value, agentName: "worker", task: "Continue nested work", async: true });
	}

	it("inherits the original contract from nested result step metadata", async () => {
		const acceptance: AcceptanceInput = { verify: [{ id: "nested-result", command: "node -e \"process.exit(0)\"" }], onFailure: "warn" };
		const revived = resolveRevived(await reviveNested({ resultAcceptanceInput: acceptance }));
		assert.equal(revived.level, "verified");
		assert.equal(revived.verify[0]?.id, "nested-result");
		assert.equal(revived.onFailure, "warn");
	});

	it("revives persisted root legacy metadata and merges a nested canonical override", async () => {
		const persisted = mergeAcceptanceInputs(
			{ level: "checked", stopRules: ["Stop on nested mismatch"], reason: "root legacy policy" },
			{ verify: [] },
		);
		const revived = await reviveNested({
			acceptanceInput: persisted,
			resumeAcceptance: { review: false, onFailure: "warn" },
		});
		const resolved = resolveRevived(revived);
		assert.equal(resolved.level, "checked");
		assert.equal(resolved.onFailure, "warn");
		assert.deepEqual(resolved.stopRules, ["Stop on nested mismatch"]);
		assert.equal(resolved.reason, "root legacy policy");
	});

	it("merges a canonical partial override into nested status acceptance metadata", async () => {
		const resolved = resolveRevived(await reviveNested({
			acceptanceInput: { report: { criteria: ["nested status contract"] }, verify: [{ id: "status", command: "node -e \"process.exit(0)\"" }], onFailure: "warn" },
			resumeAcceptance: { review: false },
		}));
		assert.equal(resolved.level, "verified");
		assert.equal(resolved.criteria[0]?.must, "nested status contract");
		assert.equal(resolved.verify[0]?.id, "status");
		assert.equal(resolved.review, false);
		assert.equal(resolved.onFailure, "warn");
	});

	it("falls back from malformed nested internal metadata to valid legacy result metadata", async () => {
		const resolved = resolveRevived(await reviveNested({
			acceptanceInput: {
				kind: "merged-acceptance",
				adapted: { contract: { verify: [] }, stopRules: [7], deprecationWarnings: [] },
			},
			resultAcceptanceInput: { level: "checked", stopRules: ["Result fallback rule"], reason: "legacy fallback" },
			resumeAcceptance: { verify: [] },
		}));
		assert.equal(resolved.level, "checked");
		assert.deepEqual(resolved.stopRules, ["Result fallback rule"]);
		assert.equal(resolved.reason, "legacy fallback");
	});

	it("inherits a descriptor contract when old nested step metadata has no acceptance input", async () => {
		const acceptance: AcceptanceInput = { verify: [{ id: "descriptor", command: "node -e \"process.exit(0)\"" }] };
		const resolved = resolveRevived(await reviveNested({ descriptorAcceptance: acceptance }));
		assert.equal(resolved.level, "verified");
		assert.equal(resolved.verify[0]?.id, "descriptor");
	});

	it("preserves an explicit disable with provenance over a recovered descriptor contract", async () => {
		const resolved = resolveRevived(await reviveNested({
			descriptorAcceptance: { verify: [{ id: "descriptor", command: "node -e \"process.exit(0)\"" }] },
			resumeAcceptance: { level: "none", reason: "manual nested disable" },
		}));
		assert.equal(resolved.level, "none");
		assert.equal(resolved.explicit, true);
		assert.equal(resolved.reason, "manual nested disable");
	});
});
