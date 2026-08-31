import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { handleList } from "../../src/agents/agent-management.ts";
import { discoverAgents } from "../../src/agents/agents.ts";
import { resultFilesForSession } from "../../src/runs/background/result-files.ts";
import { writeNodeCommand } from "../support/node-command.ts";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function runProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<number | null> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: "inherit", shell: false, env });
		child.once("error", reject);
		child.once("close", resolve);
	});
}

describe("external CLI async lifecycle", () => {
	it("rejects legacy orchestration configs before spawning a child", async () => {
		const repo = path.resolve(import.meta.dirname, "../..");
		const runnerArgs = [path.join(repo, "node_modules/jiti/lib/jiti-cli.mjs"), path.join(repo, "src/runs/background/subagent-runner.ts")];
		const cases = [
			{ name: "multiple", steps: (step: object) => [step, step], resultMode: "single" },
			{ name: "parallel", steps: (step: object) => [{ parallel: [step] }], resultMode: "single" },
			{ name: "dynamic", steps: (step: object) => [{ expand: { from: "output" }, parallel: step, collect: { as: "items" } }], resultMode: "single" },
			{ name: "import-async-root", steps: (step: object) => [{ ...step, importAsyncRoot: { runId: "legacy", asyncDir: "/tmp/legacy", resultPath: "/tmp/legacy-result.json", index: 0 } }], resultMode: "single" },
			{ name: "chain-result-mode", steps: (step: object) => [step], resultMode: "chain" },
			{ name: "chain-mode", steps: (step: object) => [step], resultMode: "single", mode: "chain" },
		] as const;

		for (const testCase of cases) {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-subagents-runner-reject-${testCase.name}-`));
			tempDirs.push(dir);
			const markerPath = path.join(dir, "child-spawned");
			const command = writeNodeCommand(dir, "legacy-child", `require("fs").writeFileSync(${JSON.stringify(markerPath)}, "spawned")`);
			const step = {
				agent: "external",
				task: "Must not run",
				runner: { type: "external-cli", command },
				inheritProjectContext: false,
				inheritGlobalContext: false,
				inheritSkills: false,
			};
			const asyncDir = path.join(dir, "async");
			fs.mkdirSync(asyncDir);
			const configPath = path.join(dir, "config.json");
			fs.writeFileSync(configPath, JSON.stringify({
				id: `reject-${testCase.name}`,
				steps: testCase.steps(step),
				resultPath: path.join(dir, "result.json"),
				cwd: dir,
				placeholder: "{previous}",
				artifactConfig: { enabled: false },
				asyncDir,
				resultMode: testCase.resultMode,
				...("mode" in testCase ? { mode: testCase.mode } : {}),
			}));

			const exitCode = await runProcess(process.execPath, [...runnerArgs, configPath], repo);
			assert.equal(exitCode, 1, testCase.name);
			assert.equal(fs.existsSync(markerPath), false, `${testCase.name} must be rejected before child spawn`);
			assert.equal(fs.existsSync(path.join(asyncDir, "status.json")), false, `${testCase.name} must be rejected before run startup`);
		}
	});

	it("discovers and lists an explicit custom profile without probing it, then executes it", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-explicit-external-"));
		tempDirs.push(dir);
		const probeMarker = path.join(dir, "cli-started");
		const command = writeNodeCommand(dir, "explicit-external", `require("fs").writeFileSync(${JSON.stringify(probeMarker)}, "started"); let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write("CUSTOM:" + input));`);
		const agentsDir = path.join(dir, ".pi", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(path.join(agentsDir, "explicit-external.md"), `---\nname: explicit-external\ndescription: Explicit custom external profile\nrunner:\n  type: external-cli\n  command: ${JSON.stringify(command)}\n---\nRun the handoff.\n`);

		const agents = discoverAgents(dir, "project").agents;
		const externalProfiles = agents.filter((candidate) => candidate.runner?.type === "external-cli");
		assert.deepEqual(externalProfiles.map((candidate) => candidate.name), ["explicit-external"]);
		const discovered = externalProfiles[0];
		assert.ok(discovered?.runner?.type === "external-cli");
		const listed = handleList({ agentScope: "project" }, { cwd: dir, modelRegistry: { getAvailable: () => [] } });
		assert.equal(listed.isError, false);
		assert.match(listed.content[0]?.type === "text" ? listed.content[0].text : "", /explicit-external/);
		assert.equal(fs.existsSync(probeMarker), false, "discovery/list must not execute the external CLI");

		const asyncDir = path.join(dir, "async");
		fs.mkdirSync(asyncDir);
		const resultPath = path.join(dir, "result.json");
		const configPath = path.join(dir, "config.json");
		fs.writeFileSync(configPath, JSON.stringify({
			id: "explicit-external",
			sessionId: "session-explicit-external",
			steps: [{ agent: discovered.name, task: "Task text", runner: discovered.runner, systemPrompt: discovered.systemPrompt, systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false }],
			resultPath,
			cwd: dir,
			placeholder: "{previous}",
			artifactConfig: { enabled: false },
			asyncDir,
			resultMode: "single",
		}));
		const repo = path.resolve(import.meta.dirname, "../..");
		const exitCode = await runProcess(process.execPath, [path.join(repo, "node_modules/jiti/lib/jiti-cli.mjs"), path.join(repo, "src/runs/background/subagent-runner.ts"), configPath], repo);
		assert.equal(exitCode, 0);
		assert.equal(fs.existsSync(probeMarker), true);
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(result.success, true);
		assert.match(result.results[0].output, /CUSTOM:/);
		assert.equal(result.results[0].runner.type, "external-cli");
	});

	it("writes status, events, result, output, and external process logs", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-external-lifecycle-"));
		tempDirs.push(dir);
		const asyncDir = path.join(dir, "async");
		fs.mkdirSync(asyncDir);
		const resultPath = path.join(dir, "result.json");
		const configPath = path.join(dir, "config.json");
		fs.writeFileSync(configPath, JSON.stringify({
			id: "external-lifecycle",
			sessionId: "session-external",
			steps: [{
				agent: "external",
				task: "Task text",
				runner: { type: "external-cli", command: process.execPath, args: ["-e", "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write('RESULT:'+s))"] },
				systemPrompt: "System text",
				systemPromptMode: "replace",
				inheritProjectContext: false,
				inheritSkills: false,
			}],
			resultPath,
			cwd: dir,
			placeholder: "{previous}",
			artifactConfig: { enabled: false },
			asyncDir,
			resultMode: "single",
		}));
		const repo = path.resolve(import.meta.dirname, "../..");
		const exitCode = await runProcess(process.execPath, [path.join(repo, "node_modules/jiti/lib/jiti-cli.mjs"), path.join(repo, "src/runs/background/subagent-runner.ts"), configPath], repo);
		assert.equal(exitCode, 0);
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf-8"));
		assert.equal(status.state, "complete");
		assert.equal(status.steps[0].runner.type, "external-cli");
		assert.equal(status.steps[0].externalProcess.exitCode, 0);
		assert.ok(fs.existsSync(status.steps[0].externalProcess.stdoutPath));
		assert.ok(fs.existsSync(status.steps[0].externalProcess.stderrPath));
		assert.match(fs.readFileSync(path.join(asyncDir, "output-0.log"), "utf-8"), /<System instructions>[\s\S]*System text[\s\S]*<Task>[\s\S]*Task text/);
		assert.match(fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf-8"), /subagent\.step\.completed/);
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(result.success, true);
		assert.equal(result.results[0].runner.type, "external-cli");
	});

	it("keeps terminal status recoverable when public result publish fails", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-external-pending-result-"));
		tempDirs.push(dir);
		const asyncDir = path.join(dir, "async");
		fs.mkdirSync(asyncDir);
		const resultPath = path.join(dir, "result.json");
		fs.mkdirSync(resultPath);
		const configPath = path.join(dir, "config.json");
		const childProfile = { profile: "recovery", source: "test-router", confidence: 84 };
		fs.writeFileSync(configPath, JSON.stringify({
			id: "external-pending-result",
			sessionId: "session-external",
			steps: [{
				agent: "external",
				task: "Task text",
				childProfile,
				runner: { type: "external-cli", command: process.execPath, args: ["-e", "process.stderr.write('failed'); process.exit(1)"] },
				inheritProjectContext: false,
				inheritSkills: false,
			}],
			resultPath,
			cwd: dir,
			placeholder: "{previous}",
			artifactConfig: { enabled: false },
			asyncDir,
			resultMode: "single",
		}));
		const repo = path.resolve(import.meta.dirname, "../..");
		const exitCode = await runProcess(process.execPath, [path.join(repo, "node_modules/jiti/lib/jiti-cli.mjs"), path.join(repo, "src/runs/background/subagent-runner.ts"), configPath], repo);
		assert.equal(exitCode, 0);
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf-8"));
		assert.equal(status.state, "failed");
		assert.deepEqual(status.steps[0].childProfile, childProfile);

		fs.rmSync(resultPath, { recursive: true, force: true });
		assert.deepEqual(resultFilesForSession(dir, "session-external"), ["result.json"]);
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(result.success, false);
		assert.equal(result.results[0].success, false);
		assert.deepEqual(result.results[0].childProfile, childProfile);
	});

	it("keeps retired observer config inert during native background execution", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-retired-observer-native-"));
		tempDirs.push(dir);
		const asyncDir = path.join(dir, "async");
		const agentDir = path.join(dir, "agent-dir");
		const invocationMarker = path.join(dir, "observer-invoked");
		const fakeObserver = writeNodeCommand(dir, "orca", `require('fs').writeFileSync(${JSON.stringify(invocationMarker)}, 'invoked')`);
		const childEvents = [
			{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "native Pi result" }], stopReason: "stop", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } },
			{ type: "agent_settled" },
		];
		const fakePi = writeNodeCommand(dir, "pi", `for (const event of ${JSON.stringify(childEvents)}) process.stdout.write(JSON.stringify(event)+'\\n')`);
		fs.mkdirSync(asyncDir);
		fs.mkdirSync(path.join(agentDir, "extensions", "subagent"), { recursive: true });
		fs.writeFileSync(path.join(agentDir, "extensions", "subagent", "config.json"), JSON.stringify({ orcaProgressTabs: { enabled: true } }));
		const resultPath = path.join(dir, "result.json");
		const configPath = path.join(dir, "config.json");
		fs.writeFileSync(configPath, JSON.stringify({
			id: "retired-observer-native", sessionId: "session-native",
			steps: [{ agent: "worker", task: "Read", systemPrompt: "Use native Pi", systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false }],
			resultPath, cwd: dir, placeholder: "{previous}", artifactConfig: { enabled: false }, asyncDir, resultMode: "single",
		}));
		const repo = path.resolve(import.meta.dirname, "../..");
		const exitCode = await runProcess(process.execPath, [path.join(repo, "node_modules/jiti/lib/jiti-cli.mjs"), path.join(repo, "src/runs/background/subagent-runner.ts"), configPath], repo, {
			...process.env, PI_CODING_AGENT_DIR: agentDir, PI_SUBAGENT_ORCA_BINARY: fakeObserver, PI_SUBAGENT_PI_BINARY: fakePi,
		});
		assert.equal(exitCode, 0);
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(result.success, true);
		assert.match(result.results[0].output, /native Pi result/);
		assert.equal(fs.existsSync(invocationMarker), false);
	});

	it("keeps retired observer config inert during external execution", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-retired-observer-"));
		tempDirs.push(dir);
		const asyncDir = path.join(dir, "async");
		const agentDir = path.join(dir, "agent-dir");
		const invocationMarker = path.join(dir, "observer-invoked");
		const fakeObserver = writeNodeCommand(dir, "orca", `require('fs').writeFileSync(${JSON.stringify(invocationMarker)}, 'invoked')`);
		const legacyArtifacts = path.join(dir, ".pi", "subagents", "views", "orca");
		fs.mkdirSync(asyncDir);
		fs.mkdirSync(path.join(agentDir, "extensions", "subagent"), { recursive: true });
		fs.mkdirSync(legacyArtifacts, { recursive: true });
		fs.writeFileSync(path.join(legacyArtifacts, "existing.json"), "legacy artifact\n");
		fs.writeFileSync(path.join(agentDir, "extensions", "subagent", "config.json"), JSON.stringify({ orcaProgressTabs: { enabled: true } }));
		const resultPath = path.join(dir, "result.json");
		const configPath = path.join(dir, "config.json");
		fs.writeFileSync(configPath, JSON.stringify({
			id: "retired-observer-external",
			sessionId: "session-external",
			steps: [{ agent: "external", task: "Task text", runner: { type: "external-cli", command: process.execPath, args: ["-e", "process.stdout.write('native runner output')"] }, inheritProjectContext: false, inheritSkills: false }],
			resultPath, cwd: dir, placeholder: "{previous}", artifactConfig: { enabled: false }, asyncDir, resultMode: "single",
		}));
		const repo = path.resolve(import.meta.dirname, "../..");
		const exitCode = await runProcess(process.execPath, [path.join(repo, "node_modules/jiti/lib/jiti-cli.mjs"), path.join(repo, "src/runs/background/subagent-runner.ts"), configPath], repo, {
			...process.env, PI_CODING_AGENT_DIR: agentDir, PI_SUBAGENT_ORCA_BINARY: fakeObserver,
		});
		assert.equal(exitCode, 0);
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(result.results[0].runner.type, "external-cli");
		assert.match(result.results[0].output, /native runner output/);
		assert.equal(fs.existsSync(invocationMarker), false);
		assert.equal(fs.readFileSync(path.join(legacyArtifacts, "existing.json"), "utf-8"), "legacy artifact\n");
		assert.deepEqual(fs.readdirSync(legacyArtifacts), ["existing.json"]);
	});
});
