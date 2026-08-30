import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { handleList } from "../../src/agents/agent-management.ts";
import { discoverAgents } from "../../src/agents/agents.ts";
import { resultFilesForSession } from "../../src/runs/background/result-files.ts";
import { TEMP_ROOT_DIR } from "../../src/shared/types.ts";
import { writeNodeCommand } from "../support/node-command.ts";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	const progressDir = path.join(TEMP_ROOT_DIR, "orca-progress");
	if (fs.existsSync(progressDir)) {
		for (const name of fs.readdirSync(progressDir)) {
			if (name.startsWith("orca-observer-external-")) fs.rmSync(path.join(progressDir, name), { force: true });
		}
	}
});

async function waitForFile(file: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!fs.existsSync(file)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

function runProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<number | null> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: "inherit", shell: false, env });
		child.once("error", reject);
		child.once("close", resolve);
	});
}

describe("external CLI async lifecycle", () => {
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

	it("mirrors a child into Orca without replacing its configured runner", { skip: process.platform === "win32" ? "Orca progress tabs are not supported on Windows" : undefined }, async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-orca-observer-"));
		tempDirs.push(dir);
		const asyncDir = path.join(dir, "async");
		const agentDir = path.join(dir, "agent-dir");
		const capture = path.join(dir, "orca-args.json");
		const fakeOrca = writeNodeCommand(dir, "orca", "require('fs').writeFileSync(process.env.ORCA_TEST_CAPTURE, JSON.stringify(process.argv.slice(2)))");
		fs.mkdirSync(asyncDir);
		fs.mkdirSync(path.join(agentDir, "extensions", "subagent"), { recursive: true });
		fs.writeFileSync(path.join(agentDir, "extensions", "subagent", "config.json"), JSON.stringify({ orcaProgressTabs: { enabled: true } }));
		const resultPath = path.join(dir, "result.json");
		const configPath = path.join(dir, "config.json");
		fs.writeFileSync(configPath, JSON.stringify({
			id: "orca-observer-external",
			sessionId: "session-orca-external",
			steps: [{
				agent: "external",
				task: "Task text",
				runner: { type: "external-cli", command: process.execPath, args: ["-e", "process.stdout.write('native runner output')"] },
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
		const exitCode = await runProcess(
			process.execPath,
			[path.join(repo, "node_modules/jiti/lib/jiti-cli.mjs"), path.join(repo, "src/runs/background/subagent-runner.ts"), configPath],
			repo,
			{ ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_SUBAGENT_ORCA_BINARY: fakeOrca, ORCA_TEST_CAPTURE: capture },
		);
		assert.equal(exitCode, 0);
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(result.results[0].runner.type, "external-cli");
		assert.match(result.results[0].output, /native runner output/);
		await waitForFile(capture);
		const args = JSON.parse(fs.readFileSync(capture, "utf-8")) as string[];
		assert.deepEqual(args.slice(0, 2), ["terminal", "create"]);
		assert.equal(args[args.indexOf("--worktree") + 1], `path:${path.resolve(dir)}`);
		assert.match(args[args.indexOf("--title") + 1], /subagents · external/);
	});
});
