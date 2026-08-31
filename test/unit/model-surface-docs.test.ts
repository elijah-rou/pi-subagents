import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";
import { SUBAGENT_ACTIONS } from "../../src/shared/types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const expectedActions = [
	"list", "get", "models", "children.list", "guide", "validate", "worktree.discard", "lane.status",
	"status", "debug.run", "interrupt", "resume", "steer", "stop", "doctor",
];
const expectedFields = [
	"agent", "task", "extensionBindings", "action", "id", "runId", "dir", "handoffPath", "laneId", "index", "childId", "view", "lines", "topic", "message", "mode", "steeringRecovery", "workflowScript", "workflowScriptPath", "preflight", "chatProgress", "isolation", "worktree", "lane", "context", "async", "timeoutMs", "maxRuntimeMs", "checkpointAfterMs", "toolTimeoutMs", "toolBudget", "usageBudget", "agentScope", "cwd", "artifacts", "includeProgress", "sessionDir", "control", "output", "outputMode", "skill", "model", "fast", "outputSchema", "agentContract", "acceptance", "gate",
];

function read(relativePath: string): string {
	return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

describe("model-facing docs and skill contract", () => {
	it("routes broad work through one whole-program design contract", () => {
		const skill = read("skills/pi-subagents/SKILL.md");
		const programReference = "references/program-orchestration.md";
		const routeRows = [...skill.matchAll(/^\| ([^|]+) \| `([^`]+)` \|$/gm)]
			.filter((match) => match[2] === programReference);
		assert.equal(routeRows.length, 1);
		assert.match(routeRows[0]?.[1] ?? "", /broad.*predeclared.*multi-phase/i);

		const programPath = path.join(root, "skills/pi-subagents", programReference);
		assert.equal(fs.existsSync(programPath), true);
		const program = fs.readFileSync(programPath, "utf-8");
		const intakeOffset = program.indexOf("## Map intake before reconnaissance");
		const executionOffset = program.indexOf("## Synthesize the execution map before mutation");
		assert.ok(intakeOffset >= 0);
		assert.ok(executionOffset > intakeOffset);
		const intake = program.slice(intakeOffset, executionOffset);
		assert.deepEqual([...intake.matchAll(/^- \*\*([^*]+):\*\*/gm)].map((match) => match[1]), [
			"Phases", "Ordering", "Unknowns", "Mutation", "First wave",
		]);
		const executionFields = [...program.matchAll(/^\| ([^|]+) \| [^|]+ \|$/gm)]
			.map((match) => match[1])
			.filter((field) => field !== "Concern" && field !== "---");
		assert.deepEqual(executionFields, [
			"Dependencies", "Serial mutation path", "Read-only overlap", "Authority gates", "Validation", "Review", "Triggers",
		]);
		for (const shape of ["Direct execution", "Workflow script", "Parallel fanout", "Staged lanes"]) {
			assert.equal(program.includes(`**${shape}:**`), true);
		}
		for (const primitive of ["`workflowScript`", "`runs.all([...])`", "`runs.lanes([...])`"]) {
			assert.equal(program.includes(primitive), true);
		}
		assert.match(program, /Async is a scheduling choice, not workflow topology\./);
		assert.match(program, /async singleton → blocking wait → status inspection → improvised singleton/);
		assert.doesNotMatch(program, /top-level [`'"](?:chain|parallel)[`'"] execution/i);
	});

	it("documents the exact action and field inventories", () => {
		assert.deepEqual(SUBAGENT_ACTIONS, expectedActions);
		const reference = read("docs/tool-reference.md");
		const documentedFields = [...reference.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
		assert.deepEqual(documentedFields, expectedFields);
		for (const action of expectedActions) assert.match(reference, new RegExp(`\\b${action.replace(".", "\\.")}\\b`));
		assert.match(reference, /primary schema has exactly these 47 top-level fields/i);
	});

	it("does not instruct models to call removed administration", () => {
		const guideFiles = SUBAGENT_GUIDE_TOPICS.map((topic) => topic === "overview" ? "README.md" : `docs/${topic}.md`);
		const modelGuidance = [
			...guideFiles.map(read),
			read("skills/pi-subagents/references/program-orchestration.md"),
			read("skills/pi-subagents/references/execution-controls.md"),
			read("skills/pi-subagents/references/management-authoring-rpc.md"),
			read("skills/pi-subagents/references/constraints-and-recipes.md"),
		].join("\n");
		assert.doesNotMatch(modelGuidance, /action\s*:\s*["'](?:create|update|delete|eject|disable|enable|reset|refine(?:\.[\w-]+)?|schedule\.[\w-]+|watchdog\.[\w-]+|mission\.[\w-]+|inspector\.[\w-]+|project\.[\w-]+|lane\.record[\w-]+|worktree\.cleanup|grant-spawn-budget)["']/i);
		assert.doesNotMatch(modelGuidance, /\b(?:missionId|missionUpdate|missionStatus|missionScope|runMode|runStatus|supersession)\s*:/i);
		assert.doesNotMatch(modelGuidance, /\bmission\s*:\s*false\b/i);
		assert.match(modelGuidance, /Package 2a removed mission(?: and goal|\/goal)? administration and all new mission writes/i);
	});
});
