/**
 * Async execution logic for subagent tool
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensurePrivateDirectory } from "../../shared/private-state.ts";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../agents/agents.ts";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { currentCompletionOwnerId } from "../../shared/completion-owner.ts";
import { applyThinkingSuffix, projectLaunchResolvedChildExtensions, resolvePiLaunchToolPlan } from "../shared/pi-args.ts";
import { cleanupManagedSingleOutput, injectOutputPathSystemPrompt, injectSingleOutputInstruction, normalizeSingleOutputOverride, prepareManagedSingleOutput, resolveSingleOutputPath, validateFileOnlyOutputMode } from "../shared/single-output.ts";
import { resolveExistingReadPaths } from "../../shared/settings.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import { resolvePiPackageRoot } from "../shared/pi-spawn.ts";
import { preflightLaunchCwd } from "../shared/launch-cwd.ts";
import { resolveNodeExecutable } from "../../shared/node-executable.ts";
import { backgroundProcessOptions } from "../shared/background-process-options.ts";
import { buildSkillInjection, resolveSkillsWithFallback } from "../../agents/skills.ts";
import { buildAgentMemoryInjection } from "../../agents/agent-memory.ts";
import { PI_CODING_AGENT_PACKAGE_ROOT_ENV, PROMPT_REDACTED, resolveChildCwd } from "../../shared/utils.ts";
import { buildModelCandidates, resolveSubagentModelOverride, type AvailableModelInfo, type ParentModel } from "../shared/model-fallback.ts";
import { resolveToolTimeoutMs, toolTimeoutFromEnv } from "../shared/tool-timeout.ts";
import { resolveModelScopesForAgent, type ModelScopeConfig } from "../shared/model-scope.ts";
import { findModelInfo, resolveEffectiveThinking } from "../../shared/model-info.ts";
import { assertThinkingWithinCeiling, decodeThinkingCeiling, intersectThinkingCeilings, SUBAGENT_THINKING_CEILING_ENV, type ThinkingLevel } from "../../shared/thinking-ceiling.ts";
import { resolveExpectedWorktreeAgentCwd } from "../shared/worktree.ts";
import { createStructuredOutputRuntime } from "../shared/structured-output.ts";
import { persistResolvedAcceptance, resolveEffectiveAcceptance, validateAcceptanceInput, validatePersistedAcceptanceInput } from "../shared/acceptance.ts";
import { createRunFanoutBudget, writeRunFanoutBudgetDescriptor } from "../shared/run-fanout-budget.ts";
import { validateImplementationToolContract } from "../shared/completion-guard.ts";
import {
	type AgentContract,
	type AsyncStatus,
	type ArtifactConfig,
	type Details,
	type IntercomBridgeConfig,
	type JsonSchemaObject,
	type MaxOutputConfig,
	type NestedRouteInfo,
	type ResolvedControlConfig,
	type ResolvedToolBudget,
	type RunFanoutBudgetDescriptor,
	type ToolBudgetConfig,
	type SubagentRunMode,
	type SteeringRecoveryDescriptor,
	type WorkflowLaneMetadata,
	type UsageBudgetConfig,
	DIRS,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
	TEMP_ROOT_DIR,
	getAsyncConfigPath,
	resolveChildMaxSubagentDepth,
} from "../../shared/types.ts";
import { nestedResultsPath, nestedSummaryFromAsyncStatus, resolveInheritedNestedRouteFromEnv, resolveNestedParentAddressFromEnv, writeNestedEvent } from "../shared/nested-events.ts";
import { resultFilePath } from "./result-files.ts";
import { validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { usageBudgetState } from "../shared/usage-budget.ts";
import type { SessionLeaseRequest } from "../shared/session-lease.ts";
import { finalizeProcessTerminal, readProcessTerminal } from "./process-terminal.ts";
import type { ActiveAsyncCapacityHandle } from "./active-async-capacity.ts";
import { SUBAGENT_PROCESS_TERMINAL_EVENT } from "../../shared/types.ts";
import { assertAgentAllowedByCapabilityCeiling, decodeSubagentCapabilityCeiling, intersectSubagentCapabilityCeilings, resolveCurrentSubagentCapabilityCeiling, SUBAGENT_CAPABILITY_CEILING_ENV, type ResolvedSubagentCapabilityCeiling } from "../shared/capability-ceiling.ts";
import { agentDefinitionDigest, launchBindingDigest } from "../../shared/launch-contract.ts";
import { resolvePermissionRules, type PermissionConfig } from "../shared/permissions.ts";
import { normalizeExtensionBindings, omitExtensionBindingsEnv, type ExtensionBindings } from "../shared/extension-bindings.ts";
import { assertWorkflowLaneKey, normalizeWorkflowLaneMetadata } from "../shared/lane-metadata.ts";

const require = createRequire(import.meta.url);
const piPackageRoot = resolvePiPackageRoot();

function resolveJitiCliFromPackageJson(packageJsonPath: string): string | undefined {
	if (!fs.existsSync(packageJsonPath)) return undefined;
	const packageRoot = path.dirname(packageJsonPath);
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
		bin?: string | Record<string, string>;
	};
	const binField = pkg.bin;
	const binPath = typeof binField === "string"
		? binField
		: binField?.jiti ?? Object.values(binField ?? {})[0];
	const candidates = [binPath, "lib/jiti-cli.mjs"].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		const cliPath = path.resolve(packageRoot, candidate);
		if (fs.existsSync(cliPath)) return cliPath;
	}
	return undefined;
}

function resolveJitiCliPath(): string | undefined {
	const candidates: Array<() => string | undefined> = [
		() => require.resolve("jiti/package.json"),
		() => piPackageRoot
			? createRequire(path.join(piPackageRoot, "package.json")).resolve("jiti/package.json")
			: undefined,
		() => {
			if (!process.argv[1]) return undefined;
			const piEntry = fs.realpathSync(process.argv[1]);
			return createRequire(piEntry).resolve("jiti/package.json");
		},
		() => piPackageRoot ? path.join(piPackageRoot, "node_modules", "jiti", "package.json") : undefined,
	];
	for (const candidate of candidates) {
		try {
			const packageJsonPath = candidate();
			if (!packageJsonPath) continue;
			const cliPath = resolveJitiCliFromPackageJson(packageJsonPath);
			if (cliPath) return cliPath;
		} catch {
			// Candidate not available in this install, continue probing.
		}
	}
	return undefined;
}

const jitiCliPath = resolveJitiCliPath();

interface AsyncExecutionContext {
	pi: ExtensionAPI;
	cwd: string;
	currentSessionId: string;
	completionOwnerId?: string;
	/** Parent session id used by permission-system ask forwarding. */
	parentSessionId?: string;
	permissions?: PermissionConfig;
	currentModelProvider?: string;
	currentModel?: ParentModel;
	/** Optional model-scope enforcement resolved from subagent settings. */
	modelScope?: ModelScopeConfig;
	/** Whether the parent session has an interactive UI. */
	interactive?: boolean;
}

export const DEFAULT_ASYNC_TIMEOUT_MS = 30 * 60 * 1000;

interface AsyncSingleParams {
	agent: string;
	task?: string;
	/** Raw caller-facing goal used only by the started event. */
	goal?: string;
	agentConfig: AgentConfig;
	/** Agent contract before per-run bridge injection, used only for recovery persistence. */
	recoveryAgentConfig?: AgentConfig;
	ctx: AsyncExecutionContext;
	cwd?: string;
	requestedCwd?: string;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig: ArtifactConfig;
	shareEnabled: boolean;
	sessionRoot?: string;
	sessionDir?: string;
	sessionFile?: string;
	revivalLease?: SessionLeaseRequest;
	context?: ContextMode;
	skills?: string[];
	output?: string | boolean;
	reads?: string[] | false;
	outputMode?: "inline" | "file-only";
	outputBaseDir?: string;
	outputClaimPath?: string;
	agentContract?: AgentContract;
	structuredOutputSchema?: JsonSchemaObject;
	modelOverride?: string;
	childProfile?: import("../../shared/types.ts").ChildProfileProvenance;
	modelOverrideFromParent?: boolean;
	fast?: boolean;
	thinkingOverride?: AgentConfig["thinking"];
	availableModels?: AvailableModelInfo[];
	maxSubagentDepth: number;
	waitToolEnabled?: boolean;
	waitToolDefaultTimeoutMs?: number;
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
	worktreeBaseDir?: string;
	worktree?: boolean;
	controlConfig?: ResolvedControlConfig;
	intercomBridge?: IntercomBridgeConfig;
	controlIntercomTarget?: string;
	childIntercomTarget?: (agent: string, index: number) => string | undefined;
	nestedRoute?: NestedRouteInfo;
	acceptance?: import("../shared/acceptance.ts").EffectiveAcceptanceInput;
	/** Internal revival seam: acceptance was read and validated from trusted run artifacts. */
	acceptanceIsPersisted?: boolean;
	/** Internal workflow seam: acceptance was composed by the runtime. */
	acceptanceIsRuntimeMerged?: boolean;
	timeoutMs?: number;
	absoluteDeadlineAt?: number;
	checkpointAfterMs?: number;
	checkpointAt?: number;
	/** Optional per-call hard toolTimeoutMs override (highest precedence). */
	toolTimeoutMs?: number;
	toolBudget?: ResolvedToolBudget | ToolBudgetConfig;
	usageBudget?: UsageBudgetConfig;
	configToolBudget?: ResolvedToolBudget;
	/** Global config.toolTimeoutMs (third precedence, after agent frontmatter). */
	configToolTimeoutMs?: number;
	/** PI_SUBAGENT_TOOL_TIMEOUT_MS override (lowest precedence). */
	toolTimeoutMsEnv?: string | undefined;
	allowZeroToolBudget?: boolean;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	thinkingCeiling?: ThinkingLevel;
	runFanoutBudget?: RunFanoutBudgetDescriptor;
	parentWorkflowRunId?: string;
	workflowKey?: string;
	lane?: WorkflowLaneMetadata;
	workflowAwaitAsync?: boolean;
	activeAsyncCapacity?: ActiveAsyncCapacityHandle;
	externalJobFollowUp?: {
		sourceRunId: string;
		sourceStepIndex: number;
		parentProviderJobId: string;
		requestId: string;
		requestDigest: string;
	};
	extensionBindings?: ExtensionBindings;
}

interface AsyncExecutionResult {
	content: Array<{ type: "text"; text: string }>;
	details: Details;
	isError?: boolean;
}

export function formatAsyncStartedMessage(headline: string, interactive: boolean): string {
	const guidance = interactive
		? [
			"The async run is detached and running in the background.",
			"You are in an interactive session. By default, return control to the user now; Pi will wake you on completion when the run finishes or needs attention. Do NOT call subagent_wait() merely to wait, and do not run sleep/polling loops to wait for it.",
			"When you need an explicit wake for one known run but do not need same-turn results, call subagent_wait({ id: \"...\", nonBlocking: true }) to arm a subscription and return immediately.",
			"Override the default and call blocking subagent_wait() before ending the turn only when the current request is run-to-completion — for example, the user asked you to report results back here before continuing, or a skill must finish in one turn. In that case, call subagent_wait() to block until the run completes so its results are delivered in this turn instead of deferred.",
			"Otherwise, continue any independent work or return control to the user. Use subagent({ action: \"status\", id: \"...\" }) for a one-shot status/result or to inspect a blocked/stale run, never as a wait loop.",
		]
		: [
			"The async run is detached. Do not run sleep timers or polling loops just to wait for it.",
			"This is a non-interactive run: Pi auto-drains current-session background work at agent_end so detached children are not abandoned; call subagent_wait() when this turn must receive the run's results before it ends, otherwise let the headless auto-drain finish the work.",
			"Use subagent({ action: \"status\", id: \"...\" }) when you need a one-shot status/result or to inspect a blocked/stale run. To block until completion, use subagent_wait() — do not poll in a loop.",
		];
	return [headline, "", ...guidance].join("\n");
}

/**
 * Check if jiti is available for async execution
 */
export function isAsyncAvailable(): boolean {
	return jitiCliPath !== undefined;
}

export function resolveAsyncRunnerLogPaths(cfg: object): { stdoutPath: string; stderrPath: string } | undefined {
	const asyncDir = typeof (cfg as { asyncDir?: unknown }).asyncDir === "string"
		? (cfg as { asyncDir: string }).asyncDir
		: undefined;
	if (!asyncDir) return undefined;
	return {
		stdoutPath: path.join(asyncDir, "runner.stdout.log"),
		stderrPath: path.join(asyncDir, "runner.stderr.log"),
	};
}

function closeFd(fd: number | undefined): void {
	if (fd === undefined) return;
	try {
		fs.closeSync(fd);
	} catch {
		// Best-effort cleanup; child process already owns its duplicated stdio fd.
	}
}

/**
 * Spawn the async runner process
 */
const RUNNER_STARTUP_TIMEOUT_MS = 10_000;
const RUNNER_STARTUP_WAIT_BUFFER = typeof SharedArrayBuffer !== "undefined" ? new SharedArrayBuffer(4) : undefined;
const RUNNER_STARTUP_WAIT_VIEW = RUNNER_STARTUP_WAIT_BUFFER ? new Int32Array(RUNNER_STARTUP_WAIT_BUFFER) : undefined;

type RunnerStartupState = "ready" | "acknowledged";

type RunnerStartupWaitResult =
	| { ok: true; token: string }
	| { ok: false; error: string; startupDidNotProceed?: boolean };

function waitForStartupInterval(delayMs = 20): void {
	if (RUNNER_STARTUP_WAIT_VIEW) {
		Atomics.wait(RUNNER_STARTUP_WAIT_VIEW, 0, 0, delayMs);
		return;
	}
	const waitUntil = Date.now() + delayMs;
	while (Date.now() < waitUntil) {
		// Startup handshakes are synchronous so resume rejects before reporting a run as started.
	}
}

function readRunnerStartup(startupPath: string, expectedState: RunnerStartupState, expectedToken?: string): RunnerStartupWaitResult | undefined {
	if (!fs.existsSync(startupPath)) return undefined;
	try {
		const payload = JSON.parse(fs.readFileSync(startupPath, "utf-8")) as { state?: unknown; token?: unknown; error?: unknown };
		if (payload.state === "error" && typeof payload.error === "string") return { ok: false, error: payload.error, startupDidNotProceed: true };
		if (payload.state !== expectedState) return undefined;
		if (typeof payload.token !== "string" || (expectedToken !== undefined && payload.token !== expectedToken)) {
			return { ok: false, error: `Async runner wrote an invalid ${expectedState} startup handshake: ${startupPath}`, startupDidNotProceed: true };
		}
		return { ok: true, token: payload.token };
	} catch (error) {
		return { ok: false, error: `Failed to read async runner startup handshake '${startupPath}': ${error instanceof Error ? error.message : String(error)}`, startupDidNotProceed: true };
	}
}

function waitForRunnerStartup(startupPath: string, expectedState: RunnerStartupState, timeoutMs: number, expectedToken?: string): RunnerStartupWaitResult {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const result = readRunnerStartup(startupPath, expectedState, expectedToken);
		if (result) return result;
		if (Date.now() >= deadline) break;
		waitForStartupInterval(Math.min(20, Math.max(1, deadline - Date.now())));
	}
	const finalResult = readRunnerStartup(startupPath, expectedState, expectedToken);
	if (finalResult) return finalResult;
	return { ok: false, error: `Timed out after ${timeoutMs}ms waiting for the async runner startup state '${expectedState}'.`, startupDidNotProceed: true };
}

function writeRunnerStartupControl(filePath: string, payload: { action: "ack" | "proceed"; token: string }): void {
	// Delegate to the shared atomic JSON writer (temp file + rename, retrying
	// transient Windows EPERM/EBUSY/EACCES locks and cleaning up the temp file
	// on failure), so the startup handshake gets the same locking resilience as
	// every other async control/result file. This is exercised by
	// test/unit/atomic-json.test.ts.
	writePrivateAtomicJson(filePath, payload);
}

function runnerIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function terminateRunnerBeforeProceed(pid: number): boolean {
	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		if (!runnerIsAlive(pid)) return true;
		try {
			process.kill(pid, signal);
		} catch {
			if (!runnerIsAlive(pid)) return true;
		}
		const deadline = Date.now() + 1000;
		while (runnerIsAlive(pid) && Date.now() < deadline) waitForStartupInterval();
	}
	return !runnerIsAlive(pid);
}

function persistPreProceedStartupFailure(asyncDir: string, runId: string, runnerProcessInstanceId: string, sessionId: string | undefined, completionOwnerId: string | undefined, message: string): void {
	const now = Date.now();
	try {
		const statusPath = path.join(asyncDir, "status.json");
		let status: Partial<AsyncStatus> = {};
		try {
			status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as Partial<AsyncStatus>;
		} catch {}
		writePrivateAtomicJson(statusPath, {
			...status,
			runId,
			...(sessionId ? { sessionId } : {}),
			...(completionOwnerId ? { completionOwnerId } : {}),
			state: "failed",
			lastUpdate: now,
			error: message,
			processTerminal: {
				version: 1,
				state: "not-started",
				runId,
				runnerProcessInstanceId,
			},
		});
		writePrivateAtomicJson(path.join(asyncDir, "process-terminal-candidate.json"), {
			version: 1,
			runId,
			runnerProcessInstanceId,
			writers: {},
			expectedWriters: { 0: 0 },
		});
	} catch {
		// Startup failures must still return the original launch error.
	}
}

interface SpawnRunnerResult {
	pid?: number;
	runnerProcessInstanceId?: string;
	error?: string;
	terminationObserved?: boolean;
	startupDidNotProceed?: boolean;
}

function isStaleExtensionContextError(error: unknown): boolean {
	return error instanceof Error && /extension ctx is stale|stale after session replacement or reload/i.test(error.message);
}

export function emitProcessTerminalEvent(ctx: AsyncExecutionContext, proof: unknown): void {
	try {
		ctx.pi.events.emit(SUBAGENT_PROCESS_TERMINAL_EVENT, proof);
	} catch (error) {
		if (isStaleExtensionContextError(error)) return;
		console.error("Failed to emit subagent process-terminal event:", error);
	}
}

function spawnRunner(cfg: object, suffix: string, cwd: string, initialStatus: Omit<AsyncStatus, "pid" | "processTerminal">, initialStatusPath: string, onProcessTerminal?: (proof: unknown) => void, requestedCwd = cwd): SpawnRunnerResult {
	const cwdError = preflightLaunchCwd(requestedCwd, cwd);
	if (cwdError) return { error: cwdError };

	if (!jitiCliPath) {
		return { error: "upstream jiti for TypeScript execution could not be found; ensure package dependencies are installed" };
	}

	ensurePrivateDirectory(TEMP_ROOT_DIR);
	const cfgPath = getAsyncConfigPath(suffix);
	const runnerProcessInstanceId = randomUUID();
	const hasRevivalLease = typeof (cfg as { revivalLease?: unknown }).revivalLease === "object";
	const launchBarrierToken = hasRevivalLease ? undefined : runnerProcessInstanceId;
	const launchConfig = { ...cfg, runnerProcessInstanceId, ...(launchBarrierToken ? { launchBarrierToken } : {}) };
	writePrivateAtomicJson(cfgPath, launchConfig);
	const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "subagent-runner.ts");
	const nodeCommand = resolveNodeExecutable();
	const launchForStartup = launchConfig as typeof launchConfig & { asyncDir?: unknown; id?: unknown; sessionId?: unknown; completionOwnerId?: unknown; revivalLease?: unknown };
	const launchAsyncDir = typeof launchForStartup.asyncDir === "string" ? launchForStartup.asyncDir : undefined;
	const launchRunId = typeof launchForStartup.id === "string" ? launchForStartup.id : suffix;
	const launchSessionId = typeof launchForStartup.sessionId === "string" ? launchForStartup.sessionId : undefined;
	const launchCompletionOwnerId = typeof launchForStartup.completionOwnerId === "string" ? launchForStartup.completionOwnerId : undefined;
	const startupPath = typeof launchForStartup.revivalLease === "object" && launchAsyncDir
		? path.join(launchAsyncDir, "runner-startup.json")
		: undefined;
	const startupAckPath = startupPath ? path.join(path.dirname(startupPath), "runner-startup-ack.json") : undefined;
	const startupProceedPath = launchAsyncDir && (startupPath || launchBarrierToken)
		? path.join(launchAsyncDir, "runner-startup-proceed.json")
		: undefined;
	if (startupPath) fs.rmSync(startupPath, { force: true });
	if (startupAckPath) fs.rmSync(startupAckPath, { force: true });
	if (startupProceedPath) fs.rmSync(startupProceedPath, { force: true });

	const logPaths = resolveAsyncRunnerLogPaths(launchConfig);
	let stdoutFd: number | undefined;
	let stderrFd: number | undefined;
	try {
		if (logPaths) {
			fs.mkdirSync(path.dirname(logPaths.stdoutPath), { recursive: true });
			stdoutFd = fs.openSync(logPaths.stdoutPath, "a");
			stderrFd = fs.openSync(logPaths.stderrPath, "a");
		}
		const proc = spawn(nodeCommand, [jitiCliPath, runner, cfgPath], {
			cwd,
			...backgroundProcessOptions(),
			stdio: ["ignore", stdoutFd ?? "ignore", stderrFd ?? "ignore"],
			env: {
				...omitExtensionBindingsEnv(process.env),
				...(piPackageRoot ? { [PI_CODING_AGENT_PACKAGE_ROOT_ENV]: piPackageRoot } : {}),
			},
		});
		closeFd(stdoutFd);
		closeFd(stderrFd);
		proc.on("error", (error) => {
			console.error(`[pi-subagents] async spawn failed: ${error.message}`);
		});
		proc.once("close", (exitCode, signal) => {
			const launch = launchConfig as { asyncDir?: unknown; id?: unknown; nestedRoute?: NestedRouteInfo; nestedSelf?: { parentRunId: string; parentStepIndex?: number; depth: number; path?: Array<{ runId: string; stepIndex?: number; agent?: string }> } };
			const asyncDir = launch.asyncDir;
			const runId = launch.id;
			if (typeof asyncDir !== "string" || typeof runId !== "string") return;
			finalizeProcessTerminal(asyncDir, runId, {
				processInstanceId: runnerProcessInstanceId,
				closeObservedAt: Date.now(),
				exitCode,
				signal,
			});
			const persisted = readProcessTerminal(asyncDir, { runId, runnerProcessInstanceId });
			if (!persisted) return;
			if (launch.nestedRoute && launch.nestedSelf) {
				try {
					let status: import("../../shared/types.ts").AsyncStatus;
					try {
						status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf-8")) as import("../../shared/types.ts").AsyncStatus;
						status.processTerminal = persisted;
					} catch {
						status = {
							runId,
							mode: "single",
							state: persisted.state === "observed" ? "complete" : "failed",
							startedAt: persisted.observedAt ?? Date.now(),
							lastUpdate: Date.now(),
							processTerminal: persisted,
						};
					}
					writeNestedEvent(launch.nestedRoute, {
						type: "subagent.nested.completed",
						ts: Date.now(),
						parentRunId: launch.nestedSelf.parentRunId,
						parentStepIndex: launch.nestedSelf.parentStepIndex,
						child: nestedSummaryFromAsyncStatus(status, asyncDir, {
							id: runId,
							parentRunId: launch.nestedSelf.parentRunId,
							parentStepIndex: launch.nestedSelf.parentStepIndex,
							depth: launch.nestedSelf.depth,
							path: launch.nestedSelf.path,
							mode: status.mode,
							ts: Date.now(),
						}),
					});
				} catch (error) {
					console.error("Failed to emit final nested process-terminal status:", error);
				}
			}
			onProcessTerminal?.(persisted);
		});
		if (typeof proc.pid !== "number") {
			return { error: `async runner did not produce a pid for cwd: ${cwd}` };
		}
		try {
			writePrivateAtomicJson(initialStatusPath, {
				...initialStatus,
				pid: proc.pid,
				processTerminal: { version: 1, state: "pending", runId: initialStatus.runId, runnerProcessInstanceId },
			});
		} catch (error) {
			const message = `Failed to persist initial async status: ${error instanceof Error ? error.message : String(error)}`;
			const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
			return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
		}
		if (launchBarrierToken && startupProceedPath) {
			try {
				writeRunnerStartupControl(startupProceedPath, { action: "proceed", token: launchBarrierToken });
			} catch (error) {
				const message = `Failed to authorize async runner startup: ${error instanceof Error ? error.message : String(error)}`;
				if (launchAsyncDir) persistPreProceedStartupFailure(launchAsyncDir, launchRunId, runnerProcessInstanceId, launchSessionId, launchCompletionOwnerId, message);
				const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
				return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
			}
		}
		proc.unref();
		if (startupPath && startupAckPath && startupProceedPath) {
			const persistStartupFailure = (message: string) => {
				if (launchAsyncDir) persistPreProceedStartupFailure(launchAsyncDir, launchRunId, runnerProcessInstanceId, launchSessionId, launchCompletionOwnerId, message);
			};
			const ready = waitForRunnerStartup(startupPath, "ready", RUNNER_STARTUP_TIMEOUT_MS);
			if (ready.ok === false) {
				persistStartupFailure(ready.error);
				const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
				return { pid: proc.pid, runnerProcessInstanceId, error: ready.error, terminationObserved, startupDidNotProceed: ready.startupDidNotProceed };
			}
			try {
				writeRunnerStartupControl(startupAckPath, { action: "ack", token: ready.token });
			} catch (error) {
				const message = `Failed to acknowledge async runner startup: ${error instanceof Error ? error.message : String(error)}`;
				persistStartupFailure(message);
				const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
				return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
			}
			const acknowledged = waitForRunnerStartup(startupPath, "acknowledged", RUNNER_STARTUP_TIMEOUT_MS, ready.token);
			if (acknowledged.ok === false) {
				persistStartupFailure(acknowledged.error);
				const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
				return { pid: proc.pid, runnerProcessInstanceId, error: acknowledged.error, terminationObserved, startupDidNotProceed: acknowledged.startupDidNotProceed };
			}
			try {
				writeRunnerStartupControl(startupProceedPath, { action: "proceed", token: ready.token });
			} catch (error) {
				const message = `Failed to authorize async runner startup: ${error instanceof Error ? error.message : String(error)}`;
				persistStartupFailure(message);
				const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
				return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
			}
			try {
				fs.rmSync(startupPath, { force: true });
			} catch {
				// Proceed is the commit point; handshake cleanup cannot turn a running revival into a start error.
			}
		}
		return { pid: proc.pid, runnerProcessInstanceId };
	} catch (error) {
		closeFd(stdoutFd);
		closeFd(stderrFd);
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function formatAsyncStartError(mode: SubagentRunMode, message: string): AsyncExecutionResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		details: { mode, results: [] },
	};
}

const UNAVAILABLE_SUBAGENT_SKILL_ERROR = "Skills not found: pi-subagents";

/**
 * Execute a single agent asynchronously
 */
export function workflowAwaitedAsyncResultPath(asyncDir: string): string {
	return path.join(asyncDir, "workflow-result.json");
}

export function executeAsyncSingle(
	id: string,
	params: AsyncSingleParams,
): AsyncExecutionResult {
	const {
		agent,
		agentConfig,
		ctx,
		cwd,
		maxOutput,
		artifactsDir,
		artifactConfig,
		shareEnabled,
		sessionRoot,
		sessionFile,
		maxSubagentDepth,
		worktreeSetupHook,
		worktreeSetupHookTimeoutMs,
		worktreeBaseDir,
		controlConfig,
		controlIntercomTarget,
		childIntercomTarget,
		nestedRoute,
	} = params;
	let lane: WorkflowLaneMetadata | undefined;
	try {
		lane = normalizeWorkflowLaneMetadata(params.lane, "lane");
		assertWorkflowLaneKey(lane, params.workflowKey, "lane");
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const task = params.task ?? "";
	let extensionBindings: ExtensionBindings | undefined;
	try {
		extensionBindings = normalizeExtensionBindings(params.extensionBindings)?.value;
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const acceptanceErrors = params.acceptanceIsPersisted || params.acceptanceIsRuntimeMerged
		? validatePersistedAcceptanceInput(params.acceptance)
		: validateAcceptanceInput(params.acceptance);
	if (acceptanceErrors.length > 0) return formatAsyncStartError("single", acceptanceErrors.join(" "));
	const externalRunner = agentConfig.runner?.type === "external-cli" || agentConfig.runner?.type === "external-job";
	const externalRunnerType = agentConfig.runner?.type;
	const permissionRules = resolvePermissionRules(ctx.permissions, agentConfig.permissions);
	if (externalRunner) {
		const unsupported: string[] = [];
		if (params.modelOverride !== undefined) unsupported.push("model override");
		if ((params.fast ?? agentConfig.fast) === true) unsupported.push("fast mode");
		if (params.thinkingOverride !== undefined) unsupported.push("thinking override");
		if (params.structuredOutputSchema !== undefined) unsupported.push("structured output");
		if (params.acceptance !== undefined || params.agentContract !== undefined) unsupported.push("acceptance/agent contract");
		if (params.toolBudget !== undefined || agentConfig.toolBudget !== undefined || params.configToolBudget !== undefined) unsupported.push("tool budget");
		if (params.context === "fork") unsupported.push("fork context");
		if ((params.skills?.length ?? 0) > 0) unsupported.push("skills");
		if (permissionRules) unsupported.push("native Pi child permissions");
		if (extensionBindings !== undefined) unsupported.push("extension bindings");
		if (unsupported.length > 0) return formatAsyncStartError("single", `Agent '${agentConfig.name}' uses runner.type='${externalRunnerType}' and does not support: ${unsupported.join(", ")}.`);
	}
	const capabilityCeiling = intersectSubagentCapabilityCeilings(params.capabilityCeiling ?? resolveCurrentSubagentCapabilityCeiling(ctx.currentSessionId), decodeSubagentCapabilityCeiling(process.env[SUBAGENT_CAPABILITY_CEILING_ENV]));
	try {
		assertAgentAllowedByCapabilityCeiling(agentConfig.name, capabilityCeiling);
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const runnerCwd = resolveChildCwd(ctx.cwd, cwd);
	const instructionCwd = params.worktree === true
		? resolveExpectedWorktreeAgentCwd(runnerCwd, `${id}-s0`, 0, worktreeBaseDir)
		: runnerCwd;
	const readExistenceCwd = params.worktree === true ? runnerCwd : instructionCwd;
	const skillNames = params.skills ?? agentConfig.skills ?? [];
	const availableModels = params.availableModels;
	const { resolved: resolvedSkills, missing: missingSkills } = resolveSkillsWithFallback(
		skillNames,
		runnerCwd,
		ctx.cwd,
		agentConfig.skillPath,
		agentConfig.filePath ? path.dirname(agentConfig.filePath) : runnerCwd,
	);
	if (missingSkills.includes("pi-subagents")) return formatAsyncStartError("single", UNAVAILABLE_SUBAGENT_SKILL_ERROR);
	let systemPrompt = agentConfig.systemPrompt?.trim() ?? "";
	if (resolvedSkills.length > 0) {
		const injection = buildSkillInjection(resolvedSkills);
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${injection}` : injection;
	}
	const memoryInjection = buildAgentMemoryInjection(agentConfig, runnerCwd);
	if (memoryInjection) {
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${memoryInjection}` : memoryInjection;
	}

	const inheritedNestedRoute = resolveInheritedNestedRouteFromEnv();
	const nestedAddress = inheritedNestedRoute ? resolveNestedParentAddressFromEnv() : undefined;
	const asyncDir = inheritedNestedRoute
		? path.join(TEMP_ROOT_DIR, "nested-subagent-runs", inheritedNestedRoute.rootRunId, id)
		: path.join(DIRS.async, id);
	let runFanoutBudget: RunFanoutBudgetDescriptor;
	try {
		runFanoutBudget = params.runFanoutBudget ?? createRunFanoutBudget(id, 64);
		ensurePrivateDirectory(asyncDir, { privateRoot: TEMP_ROOT_DIR });
		writeRunFanoutBudgetDescriptor(asyncDir, runFanoutBudget);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to create async run directory '${asyncDir}': ${message}` }],
			isError: true,
			details: { mode: "single" as const, results: [] },
		};
	}

	const effectiveOutput = normalizeSingleOutputOverride(params.output, agentConfig.output);
	const outputPath = resolveSingleOutputPath(effectiveOutput, ctx.cwd, instructionCwd, params.outputBaseDir ?? (artifactsDir ? path.join(artifactsDir, "outputs", id) : undefined));
	const managedOutput = typeof effectiveOutput === "string" && !path.isAbsolute(effectiveOutput);
	systemPrompt = injectOutputPathSystemPrompt(systemPrompt, outputPath, agentConfig);
	const outputMode = params.outputMode ?? agentConfig.outputMode ?? "inline";
	const validationError = validateFileOnlyOutputMode(outputMode, outputPath, `Async single run (${agent})`);
	if (validationError) return formatAsyncStartError("single", validationError);
	const taskWithOutputInstruction = injectSingleOutputInstruction(task, outputPath, agentConfig);
	// Reads: caller override > agent defaultReads > none. `~`/`~/` expand to home;
	// absolute paths pass through; relative paths resolve against the child cwd.
	const reads = params.reads !== undefined ? params.reads : agentConfig.defaultReads ?? false;
	const readPaths = Array.isArray(reads) ? resolveExistingReadPaths(reads, readExistenceCwd) : [];
	const readsInstruction = readPaths.length > 0
		? `[Read from: ${readPaths.join(", ")}]\n\n`
		: "";
	const taskText = readsInstruction + taskWithOutputInstruction;
	const modelScopes = resolveModelScopesForAgent(ctx.modelScope, agentConfig.name, ctx.currentModel);
	const primaryModel = externalRunner ? undefined : params.modelOverrideFromParent
		? params.modelOverride
		: resolveSubagentModelOverride(
			params.modelOverride ?? agentConfig.model,
			ctx.currentModel,
			availableModels,
			ctx.currentModelProvider,
			{ scope: modelScopes },
		);
	const effectiveThinking = externalRunner ? undefined : params.thinkingOverride ?? agentConfig.thinking;
	const model = externalRunner ? undefined : applyThinkingSuffix(primaryModel, effectiveThinking, params.thinkingOverride !== undefined);
	const contextLimit = model ? findModelInfo(model, availableModels, agentConfig.modelProvider ?? ctx.currentModelProvider)?.contextWindow : undefined;
	const thinkingCeiling = externalRunner ? undefined : intersectThinkingCeilings(
		params.thinkingCeiling,
		agentConfig.maxThinking,
		decodeThinkingCeiling(process.env[SUBAGENT_THINKING_CEILING_ENV]),
	);
	if (!externalRunner) {
		try {
			assertThinkingWithinCeiling({ model, configThinking: effectiveThinking, ceiling: thinkingCeiling, agent: agentConfig.name, runId: id });
		} catch (error) {
			return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
		}
	}
	const toolBudgetInput = params.toolBudget ?? agentConfig.toolBudget ?? params.configToolBudget;
	const resolvedToolBudget = validateToolBudgetConfig(toolBudgetInput, params.toolBudget ? "toolBudget" : agentConfig.toolBudget ? "agent.toolBudget" : "config.toolBudget");
	if (resolvedToolBudget.error) return formatAsyncStartError("single", resolvedToolBudget.error);
	const durationStartedAt = Date.now();
	const deadlineAt = params.absoluteDeadlineAt ?? (params.timeoutMs !== undefined ? durationStartedAt + params.timeoutMs : undefined);
	const checkpointAt = params.checkpointAt ?? (params.checkpointAfterMs !== undefined ? durationStartedAt + params.checkpointAfterMs : undefined);
	const timeoutMs = params.absoluteDeadlineAt !== undefined && deadlineAt !== undefined
		? deadlineAt - Date.now()
		: params.timeoutMs;
	if (timeoutMs !== undefined && timeoutMs <= 0) return formatAsyncStartError("single", "The source run's absolute deadline expired before recovery could launch.");
	const resolvedToolTimeout = resolveToolTimeoutMs({
		callValue: params.toolTimeoutMs,
		agentValue: agentConfig.defaultToolTimeoutMs,
		configValue: params.configToolTimeoutMs,
		envValue: params.toolTimeoutMsEnv ?? toolTimeoutFromEnv(),
	});
	if (resolvedToolTimeout.error) return formatAsyncStartError("single", resolvedToolTimeout.error);
	const toolTimeoutMs = resolvedToolTimeout.toolTimeoutMs;
	const initialUsageBudget = usageBudgetState(params.usageBudget, undefined);
	const resolvedSessionDir = params.sessionDir ?? (sessionRoot ? path.join(sessionRoot, `async-${id}`) : undefined);
	const structuredOutput = params.structuredOutputSchema
		? createStructuredOutputRuntime(params.structuredOutputSchema, path.join(asyncDir, "structured-output"), { captureAcceptanceReport: params.acceptance !== false })
		: undefined;
	const modelCandidates = externalRunner
		? []
		: buildModelCandidates(primaryModel, agentConfig.fallbackModels, availableModels, agentConfig.modelProvider ?? ctx.currentModelProvider, {
			scope: modelScopes,
			primaryModelFromParent: params.modelOverrideFromParent,
		})
			.flatMap((candidate) => {
				const resolved = applyThinkingSuffix(candidate, effectiveThinking, params.thinkingOverride !== undefined);
				return resolved ? [resolved] : [];
			});
	if (!externalRunner) {
		try {
			for (const candidate of modelCandidates) assertThinkingWithinCeiling({ model: candidate, configThinking: effectiveThinking, ceiling: thinkingCeiling, agent: agentConfig.name, runId: id });
		} catch (error) {
			return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
		}
	}
	const toolPlan = resolvePiLaunchToolPlan({
		tools: agentConfig.tools,
		allowNestedSubagents: agentConfig.allowNestedSubagents,
		extensions: agentConfig.extensions,
		subagentOnlyExtensions: agentConfig.subagentOnlyExtensions,
		mcpDirectTools: agentConfig.mcpDirectTools,
		cwd: runnerCwd,
		requireReadTool: Boolean(resolvedSkills.length),
		structuredOutput: Boolean(params.structuredOutputSchema),
		fast: params.fast ?? agentConfig.fast,
		model,
		modelCandidates,
		capabilityCeiling,
		inheritedCapabilityCeiling: decodeSubagentCapabilityCeiling(process.env[SUBAGENT_CAPABILITY_CEILING_ENV]),
		agentName: agentConfig.name,
		permissionRules: resolvePermissionRules(ctx.permissions, agentConfig.permissions),
		runtimeSnapshotHost: ctx.pi,
	});
	const launchResolvedExtensions = externalRunner ? undefined : projectLaunchResolvedChildExtensions(toolPlan);
	if (!externalRunner) {
		const contractTools = toolPlan.explicitToolAllowlist ? toolPlan.effectiveToolAllowlist : undefined;
		const contractError = validateImplementationToolContract({
			agent: agentConfig.name,
			task: taskText,
			tools: contractTools,
			mcpDirectTools: toolPlan.effectiveMcpTools,
			configuredExtensions: toolPlan.configuredExtensions,
			requestedTools: toolPlan.requestedBuiltinTools,
			acceptanceRole: agentConfig.acceptanceRole,
			completionGuard: agentConfig.completionGuard,
		});
		if (contractError) return formatAsyncStartError("single", contractError);
	}
	const launchContractDigest = launchBindingDigest({
		definitionDigest: agentDefinitionDigest(agentConfig),
		task,
		...(model ? { model } : {}),
		modelCandidates,
		...((params.fast ?? agentConfig.fast) !== undefined ? { fast: params.fast ?? agentConfig.fast } : {}),
		...(resolveEffectiveThinking(model, effectiveThinking) ? { thinking: resolveEffectiveThinking(model, effectiveThinking) } : {}),
		...(thinkingCeiling ? { thinkingCeiling } : {}),
		systemPrompt,
		systemPromptMode: agentConfig.systemPromptMode,
		inheritProjectContext: agentConfig.inheritProjectContext,
		inheritGlobalContext: agentConfig.inheritGlobalContext,
		inheritSkills: agentConfig.inheritSkills,
		skills: resolvedSkills.map((skill) => skill.name),
		tools: toolPlan.effectiveToolAllowlist,
		extensions: toolPlan.extensionArgs,
		mcpDirectTools: toolPlan.effectiveMcpTools,
		...(outputPath ? { outputPath } : {}),
		outputMode,
		...(params.structuredOutputSchema ? { structuredOutputSchema: params.structuredOutputSchema } : {}),
		...(extensionBindings ? { extensionBindings } : {}),
	});
	const resolvedAcceptance = resolveEffectiveAcceptance({
		explicit: params.acceptance,
		agentName: agent,
		acceptanceRole: agentConfig.acceptanceRole,
		task,
		mode: "single",
		async: true,
		agentContract: params.agentContract,
	});
	const persistedAcceptance = persistResolvedAcceptance(resolvedAcceptance);
	const recoveryAgentConfig = params.recoveryAgentConfig ?? agentConfig;
	const recoveryDescriptor: SteeringRecoveryDescriptor = {
		version: 1,
		...(lane ? { lane } : {}),
		launchContractDigest,
		...(params.childProfile ? { childProfile: params.childProfile } : {}),
		...(extensionBindings ? { extensionBindings } : {}),
		runFanoutBudget,
		sourceRunId: id,
		...(params.agentContract ? { agentContract: params.agentContract } : {}),
		agent,
		launchResolvedExtensions,
		...(sessionFile ? { sessionFile } : {}),
		cwd: runnerCwd,
		...(model ? { model } : {}),
		...(params.fast ?? recoveryAgentConfig.fast ? { fast: params.fast ?? recoveryAgentConfig.fast } : {}),
		...(recoveryAgentConfig.modelProvider ? { modelProvider: recoveryAgentConfig.modelProvider } : {}),
		...(params.modelOverrideFromParent ? { modelOverrideFromParent: true } : {}),
		...(recoveryAgentConfig.fallbackModels ? { fallbackModels: [...recoveryAgentConfig.fallbackModels] } : {}),
		...(effectiveThinking ? { thinking: resolveEffectiveThinking(model, effectiveThinking) } : {}),
		...(thinkingCeiling ? { thinkingCeiling } : {}),
		...(recoveryAgentConfig.tools ? { tools: [...recoveryAgentConfig.tools] } : {}),
		...(recoveryAgentConfig.allowNestedSubagents !== undefined ? { allowNestedSubagents: recoveryAgentConfig.allowNestedSubagents } : {}),
		...(recoveryAgentConfig.extensions ? { extensions: [...recoveryAgentConfig.extensions] } : {}),
		...(recoveryAgentConfig.subagentOnlyExtensions ? { subagentOnlyExtensions: [...recoveryAgentConfig.subagentOnlyExtensions] } : {}),
		...(recoveryAgentConfig.mcpDirectTools ? { mcpDirectTools: [...recoveryAgentConfig.mcpDirectTools] } : {}),
		...(recoveryAgentConfig.mutationTools ? { mutationTools: [...recoveryAgentConfig.mutationTools] } : {}),
		...(recoveryAgentConfig.systemPrompt ? { systemPrompt: recoveryAgentConfig.systemPrompt } : {}),
		systemPromptMode: recoveryAgentConfig.systemPromptMode,
		inheritProjectContext: recoveryAgentConfig.inheritProjectContext,
		inheritGlobalContext: recoveryAgentConfig.inheritGlobalContext,
		inheritSkills: recoveryAgentConfig.inheritSkills,
		...(resolvedSkills.length ? { skills: resolvedSkills.map((skill) => skill.name) } : {}),
		...(recoveryAgentConfig.skillPath ? { skillPath: [...recoveryAgentConfig.skillPath] } : {}),
		...(recoveryAgentConfig.filePath ? { agentFilePath: recoveryAgentConfig.filePath } : {}),
		...(recoveryAgentConfig.completionGuard !== undefined ? { completionGuard: recoveryAgentConfig.completionGuard } : {}),
		...(recoveryAgentConfig.memory ? { memory: { ...recoveryAgentConfig.memory } } : {}),
		...(outputPath ? { outputPath } : {}),
		...(managedOutput ? { managedOutput: true, managedOutputRelativePath: effectiveOutput as string } : {}),
		outputMode,
		...(params.structuredOutputSchema ? { structuredOutputSchema: params.structuredOutputSchema } : {}),
		acceptance: persistedAcceptance,
		...(controlConfig ? { controlConfig } : {}),
		...(params.context ? { context: params.context } : {}),
		...(params.intercomBridge !== undefined ? { intercomBridge: params.intercomBridge } : {}),
		...(deadlineAt !== undefined ? { absoluteDeadlineAt: deadlineAt } : {}),
		...(params.checkpointAfterMs !== undefined ? { checkpointAfterMs: params.checkpointAfterMs, checkpointAt } : {}),
		...(resolvedToolBudget.budget ? { initialToolBudget: resolvedToolBudget.budget } : {}),
		maxSubagentDepth: resolveChildMaxSubagentDepth(maxSubagentDepth, recoveryAgentConfig.maxSubagentDepth),
		...(maxOutput ? { maxOutput } : {}),
		share: shareEnabled,
		...(resolvedSessionDir ? { sessionDir: resolvedSessionDir } : {}),
		...(artifactsDir ? { artifactsDir } : {}),
		artifactConfig,
		...(capabilityCeiling ? { capabilityCeiling } : {}),
	};
	if (!externalRunner) {
		try {
			writePrivateAtomicJson(path.join(asyncDir, "recovery-descriptor.json"), recoveryDescriptor);
		} catch (error) {
			return formatAsyncStartError("single", `Failed to persist async recovery descriptor for '${id}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const managedOutputReservation = prepareManagedSingleOutput(effectiveOutput, outputPath);
	let spawnResult: SpawnRunnerResult = {};
	const initialStatusAt = Date.now();
	const initialCompletionOwnerId = ctx.completionOwnerId ?? currentCompletionOwnerId();
	try {
		spawnResult = spawnRunner(
			{
				id,
				steps: [
					{
						parentSessionId: ctx.parentSessionId ?? ctx.currentSessionId,
						permissionRules,
						...(capabilityCeiling ? { capabilityCeiling } : {}),
						agent,
						task: taskText,
						...(agentConfig.runner ? { runner: agentConfig.runner } : {}),
						...(params.externalJobFollowUp ? { externalJobFollowUp: params.externalJobFollowUp } : {}),
						...(params.context ? { context: params.context } : {}),
						cwd: runnerCwd,
						requestedCwd: params.requestedCwd ?? runnerCwd,
						model,
						...(contextLimit !== undefined ? { contextLimit } : {}),
						...(params.fast ?? agentConfig.fast ? { fast: params.fast ?? agentConfig.fast } : {}),
						thinking: resolveEffectiveThinking(model, effectiveThinking),
						...(thinkingCeiling ? { thinkingCeiling } : {}),
						modelCandidates,
						...(params.modelOverrideFromParent ? { skipPrimaryModelVerification: true } : {}),
						...(availableModels && availableModels.length > 0 ? { modelVerificationRegistry: availableModels } : {}),
						tools: agentConfig.tools,
						allowNestedSubagents: agentConfig.allowNestedSubagents,
						extensions: agentConfig.extensions,
						subagentOnlyExtensions: agentConfig.subagentOnlyExtensions,
						mcpDirectTools: agentConfig.mcpDirectTools,
						...(toolPlan.mcpConfig ? { mcpConfig: toolPlan.mcpConfig } : {}),
						...(toolPlan.runtimeServerNames ? { runtimeServerNames: toolPlan.runtimeServerNames } : {}),
						mutationTools: agentConfig.mutationTools,
						completionGuard: agentConfig.completionGuard,
						systemPrompt,
						systemPromptMode: agentConfig.systemPromptMode,
						inheritProjectContext: agentConfig.inheritProjectContext,
						inheritGlobalContext: agentConfig.inheritGlobalContext,
						inheritSkills: agentConfig.inheritSkills,
						skills: resolvedSkills.map((r) => r.name),
						outputPath,
						...(params.outputClaimPath ? { outputClaimPath: params.outputClaimPath } : {}),
						managedOutput,
						...(managedOutputReservation ? { managedOutputReservation } : {}),
						outputMode,
						...(!externalRunner && sessionFile ? { sessionFile } : {}),
						maxSubagentDepth: resolveChildMaxSubagentDepth(maxSubagentDepth, agentConfig.maxSubagentDepth),
						waitToolEnabled: params.waitToolEnabled,
						waitToolDefaultTimeoutMs: params.waitToolDefaultTimeoutMs,
						...(params.agentContract ? { agentContract: params.agentContract } : {}),
						definitionDigest: agentDefinitionDigest(agentConfig),
						launchBindingTask: task,
						launchContractDigest,
						...(params.childProfile ? { childProfile: params.childProfile } : {}),
						...(extensionBindings ? { extensionBindings } : {}),
						launchResolvedExtensions,
						effectiveAcceptance: resolvedAcceptance,
						acceptanceInput: persistedAcceptance,
						...(structuredOutput ? { structuredOutput } : {}),
						...(params.structuredOutputSchema ? { structuredOutputSchema: params.structuredOutputSchema } : {}),
						...(resolvedToolBudget.budget ? { toolBudget: resolvedToolBudget.budget } : {}),
						...(params.worktree === true ? { worktree: true } : {}),
						...(lane ? { lane } : {}),
					},
				],
				resultPath: params.parentWorkflowRunId !== undefined && (params.revivalLease !== undefined || params.workflowAwaitAsync === true)
					? workflowAwaitedAsyncResultPath(asyncDir)
					: inheritedNestedRoute ? nestedResultsPath(inheritedNestedRoute.rootRunId, id) : resultFilePath(DIRS.results, id),
				cwd: runnerCwd,
				placeholder: "{previous}",
				maxOutput,
				artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
				artifactConfig,
				share: shareEnabled,
				sessionDir: resolvedSessionDir,
				asyncDir,
				sessionId: ctx.currentSessionId,
				completionOwnerId: ctx.completionOwnerId ?? currentCompletionOwnerId(),
				...(capabilityCeiling ? { capabilityCeiling } : {}),
				piPackageRoot,
				piArgv1: process.argv[1],
				worktreeSetupHook,
				worktreeSetupHookTimeoutMs,
				worktreeBaseDir,
				controlConfig,
				timeoutMs,
				deadlineAt,
				checkpointAfterMs: params.checkpointAfterMs,
				checkpointAt,
				toolTimeoutMs,
				toolBudget: params.toolBudget,
				usageBudget: params.usageBudget,
				controlIntercomTarget,
				childIntercomTargets: childIntercomTarget ? [childIntercomTarget(agent, 0)] : undefined,
				resultMode: "single",
				launchContractDigest,
				launchResolvedExtensions,
				runFanoutBudget,
				...(params.parentWorkflowRunId ? { parentWorkflowRunId: params.parentWorkflowRunId } : {}),
				...(params.workflowKey ? { workflowKey: params.workflowKey } : {}),
				...(lane ? { lane } : {}),
				...(params.revivalLease ? { revivalLease: params.revivalLease } : {}),
				nestedRoute: nestedRoute ?? inheritedNestedRoute,
				nestedSelf: inheritedNestedRoute && nestedAddress ? {
					parentRunId: nestedAddress.parentRunId,
					parentStepIndex: nestedAddress.parentStepIndex,
					depth: nestedAddress.depth,
					path: nestedAddress.path,
				} : undefined,
			},
			id,
			runnerCwd,
			{
				lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
				runId: id,
				...(ctx.currentSessionId ? { sessionId: ctx.currentSessionId } : {}),
				...(initialCompletionOwnerId ? { completionOwnerId: initialCompletionOwnerId } : {}),
				mode: "single",
				state: "running",
				startedAt: initialStatusAt,
				lastUpdate: initialStatusAt,
				currentStep: 0,
				chainStepCount: 1,
				...(lane ? { lane } : {}),
				steps: [{ agent, status: "pending", acceptanceInput: persistedAcceptance, ...(lane ? { lane } : {}), ...(model ? { model } : {}), ...(contextLimit !== undefined ? { contextLimit } : {}) }],
			},
			path.join(asyncDir, "status.json"),
			(proof) => emitProcessTerminalEvent(ctx, proof),
			params.requestedCwd ?? runnerCwd,
		);
	} catch (error) {
		cleanupManagedSingleOutput(outputPath, managedOutputReservation);
		params.activeAsyncCapacity?.rollback();
		const message = error instanceof Error ? error.message : String(error);
		return formatAsyncStartError("single", `Failed to start async run '${id}': ${message}`);
	}

	if (spawnResult.error) {
		cleanupManagedSingleOutput(outputPath, managedOutputReservation);
		if (!spawnResult.pid || !spawnResult.runnerProcessInstanceId || (spawnResult.startupDidNotProceed && spawnResult.terminationObserved)) params.activeAsyncCapacity?.rollback();
		else params.activeAsyncCapacity?.markStarted(spawnResult.runnerProcessInstanceId);
		return formatAsyncStartError("single", `Failed to start async run '${id}': ${spawnResult.error}`);
	}
	if (!spawnResult.pid || !spawnResult.runnerProcessInstanceId) {
		cleanupManagedSingleOutput(outputPath, managedOutputReservation);
		params.activeAsyncCapacity?.rollback();
		return formatAsyncStartError("single", `Failed to start async run '${id}': runner identity unavailable`);
	}
	params.activeAsyncCapacity?.markStarted(spawnResult.runnerProcessInstanceId);

	if (spawnResult.pid) {
		if (inheritedNestedRoute && nestedAddress) {
			const now = Date.now();
			try {
				writeNestedEvent(inheritedNestedRoute, {
					type: "subagent.nested.started",
					ts: now,
					parentRunId: nestedAddress.parentRunId,
					parentStepIndex: nestedAddress.parentStepIndex,
					child: {
						id,
						parentRunId: nestedAddress.parentRunId,
						parentStepIndex: nestedAddress.parentStepIndex,
						depth: nestedAddress.depth,
						path: nestedAddress.path,
						asyncDir,
						pid: spawnResult.pid,
						ownerIntercomTarget: process.env.PI_SUBAGENT_INTERCOM_SESSION_NAME,
						leafIntercomTarget: childIntercomTarget?.(agent, 0),
						intercomTarget: childIntercomTarget?.(agent, 0),
						ownerState: "live",
						mode: "single",
						state: "running",
						agent,
						agents: [agent],
						chainStepCount: 1,
						...(timeoutMs !== undefined ? { timeoutMs, deadlineAt } : {}),
						startedAt: now,
						lastUpdate: now,
						...(capabilityCeiling ? { capabilityCeiling } : {}),
					},
				});
			} catch (error) {
				console.error("Failed to emit nested async start event:", error);
			}
		}
		ctx.pi.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, {
			lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
			id,
			pid: spawnResult.pid,
			sessionId: ctx.currentSessionId,
			completionOwnerId: ctx.completionOwnerId ?? currentCompletionOwnerId(),
			mode: "single",
			agent,
			task: task?.trim() ? PROMPT_REDACTED : undefined,
			goal: (params.goal ?? task).trim() ? PROMPT_REDACTED : undefined,
			cwd: runnerCwd,
			asyncDir,
			...(sessionRoot ? { sessionRoot } : {}),
			launchContractDigest,
			launchResolvedExtensions,
			...(params.parentWorkflowRunId ? { parentWorkflowRunId: params.parentWorkflowRunId } : {}),
			...(params.workflowKey ? { workflowKey: params.workflowKey } : {}),
			...(timeoutMs !== undefined ? { timeoutMs, deadlineAt } : {}),
			...(initialUsageBudget ? { usageBudget: initialUsageBudget } : {}),
			...(capabilityCeiling ? { capabilityCeiling } : {}),
			nestedRoute,
		});
	}

	return {
		content: [{ type: "text", text: formatAsyncStartedMessage(`Async: ${agent} [${id}]`, ctx.interactive === true) }],
		details: { mode: "single", runId: id, results: [], asyncId: id, asyncDir, launchContractDigest, launchResolvedExtensions, ...(capabilityCeiling ? { capabilityCeiling } : {}), ...(params.context ? { context: params.context } : {}), ...(timeoutMs !== undefined ? { timeoutMs, deadlineAt } : {}), ...(params.toolBudget ? { toolBudget: resolvedToolBudget.budget ?? params.toolBudget } : {}), ...(initialUsageBudget ? { usageBudget: initialUsageBudget } : {}) } as Details,
	};
}
