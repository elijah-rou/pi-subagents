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

	it("registers the guide action and migration topic for action recovery", () => {
		assert.ok(SUBAGENT_ACTIONS.includes("guide"));
		assert.ok(SUBAGENT_GUIDE_TOPICS.includes("migration-v059"));
	});

	it("documents external CLI runner limits in packaged guide topics", () => {
		assert.match(readSubagentGuide("tool-reference"), /External CLI agent profiles[\s\S]*native Pi child options[\s\S]*model override[\s\S]*native Pi tools/);
		assert.match(readSubagentGuide("agents"), /External CLI agents use their own fail-closed capability contract[\s\S]*native Pi child options[\s\S]*one-shot and non-resumable/);
	});

	it("documents worktree cleanup as requiring explicit plan mode", () => {
		const guide = readSubagentGuide("tool-reference");
		assert.match(guide, /worktree\.cleanup`? rejects an omitted mode[\s\S]*only builds and persists a read-only plan[\s\S]*never removes worktrees or branches/i);
		assert.match(guide, /worktree\.cleanup`? requires explicit `mode: "plan"`/i);
		assert.match(guide, /future removal\/apply behavior[\s\S]*requires a separate owner-approved design/i);
		assert.doesNotMatch(guide, /cleanup planning\/apply|apply-time Git\/ownership revalidation belong|mode may be omitted|or omit it/i);
	});

	it("packages the complete pre-v0.59 migration inventory", () => {
		const guide = readSubagentGuide("migration-v059");
		for (const required of [
			/acceptance: false[\s\S]*level: \"none\"/,
			/inheritGlobalContext: false/,
			/maxActiveAsyncRunsPerSession` now means `4`/,
			/\{ "maxActiveAsyncRunsPerSession": 0 \}/,
			/globalConcurrencyLimit` \| `20`/,
			/maxSubagentSpawnsPerRun` \| `64`/,
			/maxSubagentSpawnsPerSession` \| unlimited/,
			/codex-exec`[\s\S]*claude-code`[\s\S]*cursor-agent`/,
			/turnBudget` and `maxTurns`/,
			/\.pi-subagents\/[\s\S]*\.pi\/subagents\//,
			/reviewer` has only `read`, `grep`, `find`, and `ls`/,
			/Explicit or configured native model selections must resolve[\s\S]*already-running parent session model is intentionally trusted[\s\S]*gateway and proxy sessions[\s\S]*final filtered registry[\s\S]*External CLI profile metadata/,
			/worktree\.cleanup` is plan-only[\s\S]*must include `mode: "plan"`[\s\S]*omitting `mode` is rejected[\s\S]*caller-supplied `planId`[\s\S]*no cleanup `apply` mode/,
			/package export `pi-subagents\/project-panes` was removed/,
			/reload Pi[\s\S]*restart/,
		]) assert.match(guide, required);
	});

	it("keeps the tool reference aligned with packaged topics and profile context", () => {
		const guide = readSubagentGuide("tool-reference");
		assert.ok(guide.includes("| `topic` | `overview \\| workflows \\| agents \\| missions \\| observability \\| tool-reference \\| configuration \\| models \\| watchdog \\| extension-api \\| migration-v059` |"));
		assert.ok(guide.includes("| `context` | `fresh \\| fork \\| profile` |"));
		assert.match(guide, /`profile` requires the selected agent's declared `defaultContext`/);
	});

	it("uses current direct and workflowScript launch terminology in the extension API", () => {
		const guide = readSubagentGuide("extension-api");
		assert.match(guide, /New direct and `workflowScript` child launches/);
		assert.match(guide, /Main execution routing for direct and `workflowScript` launches/);
		assert.doesNotMatch(guide, /\bchain (?:launch|launches|children)\b/i);
	});

	it("keeps agent discovery, management, and diagnostics distinct", () => {
		const guide = readSubagentGuide("migration-v059");
		assert.match(guide, /read-only diagnostic command[\s\S]*action: \"doctor\"/);
		assert.match(guide, /action: \"list\"[\s\S]*do not expect `doctor` to appear there/);
		assert.doesNotMatch(guide, /doctor (?:agent|subagent)|(?:agent|subagent) doctor/i);
	});
});
