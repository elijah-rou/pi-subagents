import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSubagentGuide, SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";
import { SUBAGENT_ACTIONS } from "../../src/shared/types.ts";

describe("subagent guide", () => {
	it("reads the packaged overview by default", () => {
		const guide = readSubagentGuide();

		assert.match(guide, /# pi-subagents/);
	});

	it("lists valid topics for an unknown topic without changing files", () => {
		const guide = readSubagentGuide("unknown");

		assert.match(guide, /Unknown subagents guide topic 'unknown'/);
		assert.match(guide, /No files were changed\./);
		assert.match(guide, new RegExp(SUBAGENT_GUIDE_TOPICS.join(", ")));
	});

	it("registers the guide action for action recovery", () => {
		assert.ok(SUBAGENT_ACTIONS.includes("guide"));
	});

	it("documents external CLI runner limits in packaged guide topics", () => {
		assert.match(readSubagentGuide("tool-reference"), /External CLI agent profiles[\s\S]*native Pi child options[\s\S]*model override[\s\S]*native Pi tools/);
		assert.match(readSubagentGuide("agents"), /External CLI agents use their own fail-closed capability contract[\s\S]*native Pi child options[\s\S]*one-shot and non-resumable/);
	});

	it("documents worktree cleanup as plan-only", () => {
		const guide = readSubagentGuide("tool-reference");
		assert.match(guide, /worktree\.cleanup`? only builds and persists a read-only plan[\s\S]*never removes worktrees or branches/i);
		assert.match(guide, /future removal\/apply behavior[\s\S]*requires a separate owner-approved design/i);
		assert.doesNotMatch(guide, /cleanup planning\/apply|apply-time Git\/ownership revalidation belong/i);
	});
});
