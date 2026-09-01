import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { discoverPromptWorkflows, registerPromptWorkflowCommands } from "../../src/slash/prompt-workflows.ts";
import { runWorkflowScript } from "../../src/workflows/scripted-workflow.ts";
import type { SubagentParamsLike } from "../../src/runs/foreground/subagent-executor.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function writePrompt(dir: string, name: string, content: string): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${name}.md`), content, "utf-8");
}

function makeCtx(cwd: string) {
	return {
		cwd,
		hasUI: true,
		ui: {
			notifications: [] as Array<{ message: string; level: string }>,
			notify(message: string, level: string) {
				this.notifications.push({ message, level });
			},
		},
	} as never;
}

describe("prompt workflows", () => {
	let tempDir = "";
	let agentDir = "";
	let cwd = "";

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-workflows-"));
		agentDir = path.join(tempDir, "agent");
		cwd = path.join(tempDir, "repo");
		fs.mkdirSync(cwd, { recursive: true });
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("discovers project workflows over user workflows", () => {
		writePrompt(path.join(agentDir, "prompts"), "native-test", `---
description: User version
subagent: reviewer
---
User body
`);
		writePrompt(path.join(cwd, ".pi", "prompts"), "native-test", `---
description: Project version
subagent: worker
model: openai/gpt-5-mini
---
Project body $1
`);

		const workflow = discoverPromptWorkflows(cwd).find((entry) => entry.name === "native-test");

		assert.equal(workflow?.description, "Project version");
		assert.equal(workflow?.agent, "worker");
		assert.equal(workflow?.model, "openai/gpt-5-mini");
	});

	it("keeps parent-orchestrated templates out of the child prompt-workflow wrapper", async () => {
		writePrompt(path.join(cwd, ".pi", "prompts"), "parent-panel", `---
description: Parent panel
parent-only: true
---
Orchestrate from the parent.
`);
		const commands = new Map<string, { handler: (args: string, ctx: never) => Promise<void> }>();
		const runs: SubagentParamsLike[] = [];
		registerPromptWorkflowCommands({
			pi: {
				registerCommand: (name: string, command: { handler: (args: string, ctx: never) => Promise<void> }) => commands.set(name, command),
				sendMessage: () => {},
			} as never,
			run: async (params) => { runs.push(params); },
		});
		const ctx = makeCtx(cwd);
		const notifications = (ctx as unknown as { ui: { notifications: Array<{ message: string; level: string }> } }).ui.notifications;

		await commands.get("prompt-workflow")!.handler("parent-panel", ctx);

		assert.deepEqual(runs, []);
		assert.deepEqual(notifications, [{ message: "Prompt 'parent-panel' orchestrates from the parent session; invoke /parent-panel directly.", level: "error" }]);
	});

	it("packages a bounded parent-only candidate panel without provider-specific policy", () => {
		const candidatePath = path.join(process.cwd(), "prompts", "candidate-panel.md");
		assert.equal(fs.existsSync(candidatePath), true);
		const candidate = discoverPromptWorkflows(cwd).find((entry) => entry.name === "candidate-panel");
		assert.equal(candidate?.parentOnly, true);
		assert.match(candidate?.body ?? "", /2–3 candidates/);
		assert.match(candidate?.body ?? "", /remain the final decision maker/i);
		assert.match(candidate?.body ?? "", /maxItems/);
		assert.match(candidate?.body ?? "", /maxLength/);
		assert.doesNotMatch(candidate?.body ?? "", /pstack|cursor|claude|gpt-/i);
	});

	it("packages bounded review and validation contracts", () => {
		const readPackageFile = (relativePath: string): string => fs.readFileSync(path.join(process.cwd(), relativePath), "utf-8");
		const reviewLoop = readPackageFile("prompts/review-loop.md");
		const parallelReview = readPackageFile("prompts/parallel-review.md");
		const parallelCleanup = readPackageFile("prompts/parallel-cleanup.md");
		const reviewReference = readPackageFile("skills/pi-subagents/references/review-and-validation.md");
		const programReference = readPackageFile("skills/pi-subagents/references/program-orchestration.md");
		const rolesReference = readPackageFile("skills/pi-subagents/references/prompting-and-roles.md");
		const boundedDefaults = [reviewLoop, reviewReference, programReference, rolesReference];

		assert.ok(Buffer.byteLength(reviewLoop) < 5_275, "review-to-fix prompt must remain below its Workstream 5 baseline");
		for (const contract of boundedDefaults) {
			assert.match(contract, /one fresh (?:high-quality |high quality )?`?reviewer/i);
			assert.match(contract, /two (?:reviewers )?only/i);
			assert.match(contract, /distinct elevated[- ]risks?/i);
			assert.match(contract, /security, concurrency, architecture, or high blast radius/i);
			assert.match(contract, /parent-only inspection/i);
			assert.match(contract, /deterministic (?:corrections|fixes|gates)/i);
			assert.match(contract, /broad re-review/i);
			assert.match(contract, /focused re-review only for unresolved semantics or [^.;\n]*fix blast radius/i);
			assert.match(contract, /never silently skip[^.\n]*known P0 or P1/i);
		}

		assert.match(reviewLoop, /one broad review round by default/i);
		assert.match(reviewLoop, /focused finding re-review is outside that default broad-round budget/i);
		assert.match(reviewLoop, /specify a cap, honor it as a ceiling and count every broad or focused review invocation/i);
		assert.match(reviewLoop, /cap prevents required focused re-review[^.]*report blocked/i);
		assert.match(reviewLoop, /explicitly request parallel review or a reviewer count, honor that fanout/i);
		assert.match(reviewLoop, /targeted checks for each changed slice/i);
		assert.match(reviewLoop, /checkpoint or full-suite checks after dependent groups/i);
		assert.match(reviewLoop, /final validation against the complete delivery/i);
		assert.match(parallelReview, /explicit fanout request/i);
		assert.match(parallelReview, /two reviewers when I provide no count/i);
		assert.match(parallelReview, /preserve severity in every disposition/i);
		assert.doesNotMatch(parallelReview, /fourth reviewer/i);
		assert.match(parallelCleanup, /explicitly requests the two specialized reviewers/i);
		assert.match(parallelCleanup, /skills\/pi-subagents\/references\/commissioning\.md/);
		assert.match(reviewReference, /Valid P0\/P1:[^\n]*Preserve severity[^\n]*fix, escalate, or report blocked/i);
		assert.doesNotMatch([reviewLoop, parallelReview, rolesReference].join("\n"), /prefer three reviewers|default to (?:a maximum of )?3 review rounds/i);
	});

	it("runs a named workflow through native subagent execution", async () => {
		writePrompt(path.join(cwd, ".pi", "prompts"), "native-run", `---
description: Run native prompt
subagent: reviewer
model: anthropic/claude-sonnet-4
skill: deslop,typescript-code
---
Review $1 with $ARGUMENTS
`);
		const commands = new Map<string, { handler: (args: string, ctx: never) => Promise<void> }>();
		const sent: unknown[] = [];
		const runs: SubagentParamsLike[] = [];
		registerPromptWorkflowCommands({
			pi: {
				registerCommand: (name: string, command: { handler: (args: string, ctx: never) => Promise<void> }) => commands.set(name, command),
				sendMessage: (message: unknown) => sent.push(message),
			} as never,
			run: async (params) => { runs.push(params); },
		});

		await commands.get("prompt-workflow")!.handler('native-run target --fork', makeCtx(cwd));

		assert.equal(sent.length, 0);
		assert.equal(runs.length, 1);
		const params = runs[0];
		assert.equal(params?.agent, undefined);
		assert.equal(params?.task, undefined);
		assert.equal(params?.clarify, undefined);
		assert.equal(params?.model, undefined);
		assert.equal(params?.skill, undefined);
		assert.equal(params?.context, undefined);
		assert.equal(params?.agentScope, "both");
		assert.equal(params?.async, false);
		const script = params?.workflowScript ?? "";
		assert.match(script, /runs\.run\("prompt-1-native-run"/);
		assert.match(script, /"agent":"reviewer"/);
		assert.match(script, /"model":"anthropic\/claude-sonnet-4"/);
		assert.match(script, /"skill":\["deslop","typescript-code"\]/);
		assert.match(script, /"context":"fork"/);
		assert.match(script, /Review target with target/);
	});

	it("runs declared prompt sequences through workflowScript", async () => {
		writePrompt(path.join(cwd, ".pi", "prompts"), "native-analyze", `---
description: Analyze
subagent: scout
chain: native-analyze -> native-fix
---
Analyze $@
`);
		writePrompt(path.join(cwd, ".pi", "prompts"), "native-fix", `---
description: Fix
subagent: worker
---
Fix from {previous}: $@
`);
		const commands = new Map<string, { handler: (args: string, ctx: never) => Promise<void> }>();
		const runs: SubagentParamsLike[] = [];
		registerPromptWorkflowCommands({
			pi: {
				registerCommand: (name: string, command: { handler: (args: string, ctx: never) => Promise<void> }) => commands.set(name, command),
				sendMessage: () => {},
			} as never,
			run: async (params) => { runs.push(params); },
		});

		await commands.get("prompt-workflow")!.handler("native-analyze bug report", makeCtx(cwd));

		assert.equal(runs.length, 1);
		const params = runs[0];
		assert.equal(params?.agent, undefined);
		assert.equal(params?.task, undefined);
		assert.equal(params?.clarify, undefined);
		assert.equal(params?.agentScope, "both");
		assert.equal(params?.async, false);
		const script = params?.workflowScript ?? "";
		assert.match(script, /runs\.run\("prompt-1-native-analyze"/);
		assert.match(script, /runs\.run\("prompt-2-native-fix"/);
		assert.match(script, /replaceAll\("\{previous\}"/);
		assert.equal(commands.has("chain-prompts"), false);

		const launches: Array<{ key: string; task: unknown }> = [];
		const executed = await runWorkflowScript({
			script,
			async launch(key, childParams) {
				launches.push({ key, task: childParams.task });
				return { key, ok: true, output: key === "prompt-1-native-analyze" ? "analysis output" : "fixed output", artifactPaths: [] };
			},
			async status(key) { return { key, ok: true, output: "ok", artifactPaths: [] }; },
		});
		assert.deepEqual(launches, [
			{ key: "prompt-1-native-analyze", task: "Analyze bug report" },
			{ key: "prompt-2-native-fix", task: "Fix from analysis output: bug report" },
		]);
		assert.equal(executed.value, "fixed output");
	});
});
