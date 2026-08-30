#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const startupSampleFlag = "--startup-sample";
const startupSamples = 7;
const preparationSamples = 101;
const refreshSamples = 501;

function percentile(sorted, fraction) {
	if (sorted.length === 0) throw new Error("percentile requires at least one sample");
	const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
	return sorted[index];
}

function summarize(samples) {
	if (samples.length === 0) throw new Error("summary requires at least one sample");
	const sorted = [...samples].sort((left, right) => left - right);
	const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
	return {
		samples: samples.length,
		meanMs: Number(mean.toFixed(3)),
		p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
		p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
		minMs: Number(sorted[0].toFixed(3)),
		maxMs: Number(sorted.at(-1).toFixed(3)),
	};
}

function walkTypeScriptFiles(root) {
	const files = [];
	const pending = [root];
	while (pending.length > 0) {
		const dir = pending.pop();
		if (!dir) throw new Error("directory stack unexpectedly empty");
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const entryPath = path.join(dir, entry.name);
			if (entry.isDirectory()) pending.push(entryPath);
			else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(entryPath);
		}
	}
	return files.sort();
}

function countLines(files) {
	return files.reduce((total, file) => total + fs.readFileSync(file, "utf-8").split("\n").length - 1, 0);
}

function parseStartupSample(stdout) {
	const lines = stdout.trim().split("\n").filter(Boolean);
	if (lines.length === 0) throw new Error("startup sample returned no output");
	return JSON.parse(lines.at(-1));
}

function runStartupSamples(agentDir, isolatedRoot) {
	const samples = [];
	for (let index = 0; index < startupSamples; index += 1) {
		const env = {
			...process.env,
			PI_CODING_AGENT_DIR: agentDir,
			PI_SUBAGENTS_TEMP_ROOT: path.join(isolatedRoot, `startup-runtime-${index}`),
		};
		delete env.PI_SUBAGENT_CHILD;
		delete env.PI_SUBAGENT_FANOUT_CHILD;
		const result = spawnSync(process.execPath, [
			"--experimental-strip-types",
			"--import",
			path.join(projectRoot, "test", "support", "register-loader.mjs"),
			fileURLToPath(import.meta.url),
			startupSampleFlag,
		], {
			cwd: projectRoot,
			env,
			encoding: "utf-8",
			timeout: 30_000,
		});
		if (result.status !== 0) {
			throw new Error(`startup sample ${index + 1} failed (${result.status}): ${result.stderr || result.stdout}`);
		}
		samples.push(parseStartupSample(result.stdout));
	}
	return samples;
}

function createEventBus() {
	return {
		on() { return () => {}; },
		emit() {},
	};
}

function summarizeToolDefinitions(tools) {
	return tools
		.map((tool) => {
			const parameters = tool.parameters ?? {};
			return {
				name: tool.name,
				schemaBytes: Buffer.byteLength(JSON.stringify(parameters), "utf-8"),
				topLevelParameters: Object.keys(parameters.properties ?? {}).length,
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

async function measureChildRuntimeTools(isolatedRoot) {
	const schemaPath = path.join(isolatedRoot, "structured-output-schema.json");
	const outputPath = path.join(isolatedRoot, "structured-output.json");
	const channelDir = path.join(isolatedRoot, "supervisor-channel");
	fs.writeFileSync(schemaPath, JSON.stringify({ type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }), "utf-8");
	const environment = {
		PI_SUBAGENT_CHILD: "1",
		PI_SUBAGENT_FANOUT_CHILD: "1",
		PI_SUBAGENT_RUN_ID: "baseline-child",
		PI_SUBAGENT_CHILD_AGENT: "worker",
		PI_SUBAGENT_CHILD_INDEX: "0",
		PI_SUBAGENT_ORCHESTRATOR_SESSION_ID: "baseline-session",
		PI_SUBAGENT_SUPERVISOR_CHANNEL_DIR: channelDir,
		PI_SUBAGENT_STRUCTURED_OUTPUT_SCHEMA: schemaPath,
		PI_SUBAGENT_STRUCTURED_OUTPUT_CAPTURE: outputPath,
	};
	const previous = Object.fromEntries(Object.keys(environment).map((name) => [name, process.env[name]]));
	Object.assign(process.env, environment);
	try {
		const tools = [];
		const handlers = new Map();
		const pi = new Proxy({
			events: createEventBus(),
			on(name, handler) { handlers.set(name, handler); },
			registerTool(tool) { tools.push(tool); },
			getAllTools() { return tools; },
		}, {
			get(target, property) {
				return property in target ? target[property] : () => undefined;
			},
		});
		const [runtime, fanoutChild] = await Promise.all([
			import("../src/runs/shared/subagent-prompt-runtime.ts"),
			import("../src/extension/fanout-child.ts"),
		]);
		runtime.default(pi);
		fanoutChild.default(pi);
		await Promise.resolve(handlers.get("session_start")?.({ reason: "startup" }, {
			hasUI: false,
			sessionManager: {
				getSessionFile() { return null; },
				getSessionId() { return "baseline-child-session"; },
			},
		}));
		return summarizeToolDefinitions(tools);
	} finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

async function runStartupSample() {
	const commands = [];
	const tools = [];
	const handlers = new Map();
	const events = createEventBus();
	const pi = new Proxy({
		events,
		on(name, handler) { handlers.set(name, handler); },
		registerCommand(name) { commands.push(name); },
		registerTool(tool) { tools.push(tool); },
		registerShortcut() {},
		registerMessageRenderer() {},
		sendMessage() {},
		getSessionName() { return undefined; },
	}, {
		get(target, property) {
			return property in target ? target[property] : () => undefined;
		},
	});
	const startedAt = performance.now();
	const extension = await import("../index.ts");
	extension.default(pi);
	const importAndRegistrationMs = performance.now() - startedAt;
	const sessionManager = {
		getSessionId() { return "baseline-session"; },
		getSessionFile() { return null; },
		getEntries() { return []; },
		getLeafId() { return null; },
	};
	const ui = new Proxy({
		setWidget() {},
		requestRender() {},
		notify() {},
		getEditorText() { return ""; },
	}, {
		get(target, property) {
			return property in target ? target[property] : () => undefined;
		},
	});
	const context = new Proxy({
		cwd: projectRoot,
		hasUI: false,
		sessionManager,
		modelRegistry: { getAvailable() { return []; }, find() { return undefined; } },
		ui,
	}, {
		get(target, property) {
			return property in target ? target[property] : undefined;
		},
	});
	const sessionStartAt = performance.now();
	await Promise.resolve(handlers.get("session_start")?.({ reason: "startup" }, context));
	const sessionStartMs = performance.now() - sessionStartAt;
	const sessionShutdownAt = performance.now();
	await Promise.resolve(handlers.get("session_shutdown")?.({}, context));
	const sessionShutdownMs = performance.now() - sessionShutdownAt;
	process.stdout.write(`${JSON.stringify({ importAndRegistrationMs, sessionStartMs, sessionShutdownMs, commands: commands.sort(), tools: summarizeToolDefinitions(tools), lifecycleHandlers: [...handlers.keys()].sort() })}\n`);
}

function createFsCounter() {
	const methodNames = [
		"closeSync", "existsSync", "fstatSync", "lstatSync", "mkdirSync", "openSync", "readFileSync",
		"readSync", "readdirSync", "realpathSync", "renameSync", "rmSync", "rmdirSync", "statSync",
		"unlinkSync", "watch", "writeFileSync",
	];
	const originals = new Map();
	const counts = {};
	for (const name of methodNames) {
		const original = fs[name];
		if (typeof original !== "function") continue;
		originals.set(name, original);
		const wrapped = function (...args) {
			counts[name] = (counts[name] ?? 0) + 1;
			return original.apply(fs, args);
		};
		if (name === "realpathSync" && typeof original.native === "function") {
			wrapped.native = function (...args) {
				counts.realpathSyncNative = (counts.realpathSyncNative ?? 0) + 1;
				return original.native.apply(original, args);
			};
		}
		fs[name] = wrapped;
	}
	syncBuiltinESMExports();
	return {
		counts,
		reset() {
			for (const key of Object.keys(counts)) delete counts[key];
		},
		restore() {
			for (const [name, original] of originals) fs[name] = original;
			syncBuiltinESMExports();
		},
	};
}

function sortedNonzeroCounts(counts) {
	return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0).sort(([left], [right]) => left.localeCompare(right)));
}

function extensionConfigKeys() {
	const source = fs.readFileSync(path.join(projectRoot, "src", "shared", "types.ts"), "utf-8");
	const match = source.match(/export interface ExtensionConfig \{([\s\S]*?)\n\}/);
	if (!match) throw new Error("could not locate ExtensionConfig");
	return [...match[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\?:/gm)].map((entry) => entry[1]);
}

function gitOutput(...args) {
	const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf-8", timeout: 10_000 });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	return result.stdout.trim();
}

async function main() {
	const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-deep-baseline-"));
	const agentDir = path.join(isolatedRoot, "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_SUBAGENTS_TEMP_ROOT = path.join(isolatedRoot, "main-runtime");
	delete process.env.PI_SUBAGENT_CHILD;
	delete process.env.PI_SUBAGENT_FANOUT_CHILD;

	try {
		const startup = runStartupSamples(agentDir, isolatedRoot);
		const [{ SubagentParams, SubagentWaitParams }, { SUBAGENT_ACTIONS }, packageJson, { resolveSubagentLaunchContract }, { listAsyncRuns }, { updateActiveRunIndex }, { createResultWatcher }] = await Promise.all([
			import("../src/extension/schemas.ts"),
			import("../src/shared/types.ts"),
			Promise.resolve(JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"))),
			import("../src/api/preflight.ts"),
			import("../src/runs/background/async-status.ts"),
			import("../src/runs/background/active-run-index.ts"),
			import("../src/runs/background/result-watcher.ts"),
		]);

		const preparationDurations = [];
		let preparedAgent;
		for (let index = 0; index < preparationSamples; index += 1) {
			const startedAt = performance.now();
			const result = await resolveSubagentLaunchContract({
				agent: "worker",
				cwd: projectRoot,
				task: "Inspect the repository without editing files.",
				context: "fresh",
				artifacts: false,
				availableModels: [{ provider: "baseline", id: "worker", fullId: "baseline/worker" }],
			});
			preparationDurations.push(performance.now() - startedAt);
			if (!result.ok) throw new Error(`direct launch preparation failed: ${result.code}: ${result.message}`);
			preparedAgent = result.contract.agent.name;
		}

		const asyncRoot = path.join(isolatedRoot, "async");
		const runDir = path.join(asyncRoot, "baseline-active-run");
		fs.mkdirSync(runDir, { recursive: true });
		fs.writeFileSync(path.join(runDir, "status.json"), JSON.stringify({
			lifecycleArtifactVersion: 1,
			runId: "baseline-active-run",
			mode: "single",
			state: "running",
			startedAt: 1,
			lastUpdate: 2,
			pid: process.pid,
			steps: [{ agent: "worker", status: "running" }],
		}), "utf-8");
		updateActiveRunIndex(runDir, "running");
		const refreshDurations = [];
		let refreshRows = 0;
		for (let index = 0; index < refreshSamples; index += 1) {
			const startedAt = performance.now();
			const rows = listAsyncRuns(asyncRoot, { states: ["running"], reconcile: false, includeNested: false });
			refreshDurations.push(performance.now() - startedAt);
			refreshRows = rows.length;
		}
		const refreshCounter = createFsCounter();
		try {
			refreshCounter.reset();
			listAsyncRuns(asyncRoot, { states: ["running"], reconcile: false, includeNested: false });
		} finally {
			refreshCounter.restore();
		}

		const resultsDir = path.join(isolatedRoot, "results");
		fs.mkdirSync(resultsDir, { recursive: true });
		const intervals = [];
		const watcherState = {
			baseCwd: projectRoot,
			currentSessionId: "baseline-session",
			completionOwnerId: "baseline-owner",
			asyncJobs: new Map(),
			foregroundControls: new Map(),
			lastForegroundControlId: null,
			cleanupTimers: new Map(),
			lastUiContext: null,
			poller: null,
			completionSeen: new Map(),
			watcher: null,
			watcherRestartTimer: null,
			resultFileCoalescer: { schedule: () => false, clear() {} },
		};
		const fakeFsWatcher = { on() { return fakeFsWatcher; }, close() {}, unref() {} };
		const watcherFsCounter = createFsCounter();
		let watcher;
		let watcherStartCalls;
		let emptyHealthyScanCalls;
		try {
			watcher = createResultWatcher({ events: createEventBus() }, watcherState, resultsDir, 60_000, {
				platform: "linux",
				hasDeliveryDemand: () => false,
				fs: {
					...fs,
					watch() {
						watcherFsCounter.counts.watch = (watcherFsCounter.counts.watch ?? 0) + 1;
						return fakeFsWatcher;
					},
				},
				timers: {
					setTimeout,
					clearTimeout,
					setInterval(handler, delay) {
						const token = { handler, delay, unref() {} };
						intervals.push(token);
						return token;
					},
					clearInterval() {},
				},
			});
			watcherFsCounter.reset();
			watcher.startResultWatcher();
			watcherStartCalls = sortedNonzeroCounts(watcherFsCounter.counts);
			const healthyScan = intervals.find((entry) => entry.delay === 60_000);
			if (!healthyScan) throw new Error("result watcher did not register its 60-second safety scan");
			watcherFsCounter.reset();
			healthyScan.handler();
			emptyHealthyScanCalls = sortedNonzeroCounts(watcherFsCounter.counts);
		} finally {
			watcher?.stopResultWatcher();
			watcherFsCounter.restore();
		}
		const healthyScan = intervals.find((entry) => entry.delay === 60_000);
		if (!healthyScan) throw new Error("result watcher safety scan disappeared");

		const productionFiles = walkTypeScriptFiles(path.join(projectRoot, "src"));
		const schemaBytes = Buffer.byteLength(JSON.stringify(SubagentParams), "utf-8");
		const waitSchemaBytes = Buffer.byteLength(JSON.stringify(SubagentWaitParams), "utf-8");
		const startupRegistration = startup[0];
		const childRuntimeTools = await measureChildRuntimeTools(isolatedRoot);
		const registeredSchemaBytes = Object.fromEntries(startupRegistration.tools.map((tool) => [tool.name, tool.schemaBytes]));
		const registeredParameterCounts = Object.fromEntries(startupRegistration.tools.map((tool) => [tool.name, tool.topLevelParameters]));
		if (registeredSchemaBytes.subagent !== schemaBytes) throw new Error("registered subagent schema differs from exported SubagentParams");
		if (registeredSchemaBytes.subagent_wait !== waitSchemaBytes) throw new Error("registered subagent_wait schema differs from exported SubagentWaitParams");
		const report = {
			baselineVersion: 1,
			commit: gitOutput("rev-parse", "HEAD"),
			createdAt: new Date().toISOString(),
			environment: {
				node: process.version,
				platform: process.platform,
				arch: process.arch,
				cpu: os.cpus()[0]?.model ?? "unknown",
			},
			production: {
				typeScriptFiles: productionFiles.length,
				typeScriptLoc: countLines(productionFiles),
			},
			publicSurface: {
				rootRuntimeToolCount: startupRegistration.tools.length,
				toolSchemaBytes: {
					...registeredSchemaBytes,
					combined: Object.values(registeredSchemaBytes).reduce((total, bytes) => total + bytes, 0),
				},
				toolParameters: {
					...registeredParameterCounts,
					combined: Object.values(registeredParameterCounts).reduce((total, count) => total + count, 0),
				},
				actionNames: [...SUBAGENT_ACTIONS],
				actionNameCount: SUBAGENT_ACTIONS.length,
				compatibilityActionNames: ["append-step"],
				recognizedActionNameCount: SUBAGENT_ACTIONS.length + 1,
				slashCommands: startupRegistration.commands,
				slashCommandCount: startupRegistration.commands.length,
				rootRuntimeTools: startupRegistration.tools.map((tool) => tool.name),
				childRuntimeTools,
				childRuntimeToolCount: childRuntimeTools.length,
				childRuntimeScope: "maximum fixture: nested fanout authorized, native supervisor metadata present, and representative structured output enabled; structured_output schema bytes vary with caller schema",
				packageExports: Object.keys(packageJson.exports ?? {}).sort(),
				packageExportCount: Object.keys(packageJson.exports ?? {}).length,
				extensionConfigurationKeys: extensionConfigKeys().sort(),
				extensionConfigurationKeyCount: extensionConfigKeys().length,
			},
			performance: {
				extensionImportAndRegistration: {
					...summarize(startup.map((sample) => sample.importAndRegistrationMs)),
					scope: "cold child process; timer covers dynamic import of index.ts and fake-host registration, not Node process startup",
				},
				sessionStart: {
					...summarize(startup.map((sample) => sample.sessionStartMs)),
					scope: "session_start callback in the same isolated fake-host processes; headless context, empty stores, no session file",
				},
				sessionShutdown: {
					...summarize(startup.map((sample) => sample.sessionShutdownMs)),
					scope: "session_shutdown callback after the measured fake-host session_start",
				},
				directLaunchPreparation: {
					...summarize(preparationDurations.slice(1)),
					warmupSamplesDiscarded: 1,
					preparedAgent,
					scope: "resolveSubagentLaunchContract for packaged worker, fresh context, artifacts disabled, fixed available-model registry",
				},
				activeRefresh: {
					...summarize(refreshDurations.slice(1)),
					warmupSamplesDiscarded: 1,
					rows: refreshRows,
					filesystemCallsPerRefresh: sortedNonzeroCounts(refreshCounter.counts),
					scope: "listAsyncRuns for one indexed running status with reconciliation and nested projection disabled",
				},
				idleFilesystem: {
					resultWatcherStartCalls: watcherStartCalls,
					healthyScanIntervalMs: healthyScan.delay,
					emptyHealthyScanCalls,
					scope: "Linux result-delivery watcher with no delivery demand and an empty isolated result store; one scheduled safety scan invoked synchronously",
				},
			},
		};
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} finally {
		fs.rmSync(isolatedRoot, { recursive: true, force: true });
	}
}

if (process.argv.includes(startupSampleFlag)) await runStartupSample();
else await main();
