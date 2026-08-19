import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Compile } from "typebox/compile";
import { roleResultContractId, roleResultSchema } from "../../src/contracts/role-contracts.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";

function agent(name: string, source: AgentConfig["source"]): AgentConfig {
	return { name, localName: name, description: name, tools: [], systemPromptMode: "replace", inheritProjectContext: true, inheritSkills: false, systemPrompt: "", source, filePath: `/tmp/${name}.md` };
}

describe("role result contracts", () => {
	it("uses package contracts only for bundled identities and generic for shadows", () => {
		assert.equal(roleResultContractId(agent("worker", "builtin")), "pi-subagents/worker");
		assert.equal(roleResultContractId(agent("reviewer", "project")), "pi-subagents/generic");
		assert.equal(roleResultContractId(agent("custom", "user")), "pi-subagents/generic");
	});

	it("accepts a bounded worker result and rejects extra fields", () => {
		const validator = Compile(roleResultSchema(agent("worker", "builtin")));
		const value = { contract: { id: "pi-subagents/worker", version: 1 }, outcome: "completed", summary: "done", evidence: [], risks: [], data: { changedFiles: [], validation: [], decisionsNeeded: [] } };
		assert.equal(validator.Check(value), true);
		assert.equal(validator.Check({ ...value, extra: true }), false);
	});
});
