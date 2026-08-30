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
			read("skills/pi-subagents/references/execution-controls.md"),
			read("skills/pi-subagents/references/management-authoring-rpc.md"),
			read("skills/pi-subagents/references/constraints-and-recipes.md"),
		].join("\n");
		assert.doesNotMatch(modelGuidance, /action\s*:\s*["'](?:create|update|delete|eject|disable|enable|reset|refine(?:\.[\w-]+)?|schedule\.[\w-]+|watchdog\.[\w-]+|mission\.[\w-]+|inspector\.[\w-]+|project\.[\w-]+|lane\.record[\w-]+|worktree\.cleanup|grant-spawn-budget)["']/i);
		assert.doesNotMatch(modelGuidance, /\b(?:missionId|missionUpdate|missionStatus|missionScope|runMode|runStatus|supersession)\s*:/i);
		assert.doesNotMatch(modelGuidance, /\bmission\s*:\s*false\b/i);
		assert.match(modelGuidance, /Mission administration, lane merge\/supersession policy, broad worktree cleanup, and optional pane administration have no supported human replacement/i);
	});
});
