/**
 * Tests launch behavior resolution shared by direct and workflow execution.
 * Uses dynamic imports because settings.ts transitively depends on Pi packages.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryImport } from "../support/helpers.ts";

// Top-level await
const settings = await tryImport<any>("./src/shared/settings.ts");
const skills = await tryImport<any>("./src/agents/skills.ts");
const available = !!(settings && skills);

const resolveStepBehavior = settings?.resolveStepBehavior;
const suppressProgressForReadOnlyTask = settings?.suppressProgressForReadOnlyTask;
const taskDisallowsFileUpdates = settings?.taskDisallowsFileUpdates;
const isParallelStep = settings?.isParallelStep;
const normalizeSkillInput = skills?.normalizeSkillInput;

describe("isParallelStep", { skip: !available ? "pi packages not available" : undefined }, () => {
	it("returns true for parallel steps", () => {
		assert.ok(isParallelStep({ parallel: [{ agent: "a", task: "t" }] }));
	});

	it("returns false for sequential steps", () => {
		assert.ok(!isParallelStep({ agent: "a", task: "t" }));
	});
});

describe("normalizeSkillInput", { skip: !available ? "pi packages not available" : undefined }, () => {
	it("returns undefined for undefined input", () => {
		assert.equal(normalizeSkillInput(undefined), undefined);
	});

	it("returns undefined for true (use default)", () => {
		assert.equal(normalizeSkillInput(true), undefined);
	});

	it("returns false for false (disable)", () => {
		assert.equal(normalizeSkillInput(false), false);
	});

	it("splits comma-separated string", () => {
		assert.deepEqual(normalizeSkillInput("web-search,pdf"), ["web-search", "pdf"]);
	});

	it("passes through array", () => {
		assert.deepEqual(normalizeSkillInput(["a", "b"]), ["a", "b"]);
	});

	it("deduplicates", () => {
		assert.deepEqual(normalizeSkillInput(["a", "b", "a"]), ["a", "b"]);
	});

	it("trims whitespace", () => {
		assert.deepEqual(normalizeSkillInput(" a , b "), ["a", "b"]);
	});

	it("filters empty strings", () => {
		assert.deepEqual(normalizeSkillInput(",a,,b,"), ["a", "b"]);
	});
});

describe("resolveStepBehavior", { skip: !available ? "pi packages not available" : undefined }, () => {
	it("returns agent defaults when no overrides", () => {
		// Uses agentConfig.output, .defaultReads, .defaultProgress
		const config = { name: "test", output: "report.md", defaultProgress: true, defaultReads: ["input.md"] };
		const behavior = resolveStepBehavior(config, {});
		assert.equal(behavior.output, "report.md");
		assert.equal(behavior.progress, true);
		assert.deepEqual(behavior.reads, ["input.md"]);
	});

	it("step overrides take precedence", () => {
		const config = { name: "test", output: "report.md" };
		const behavior = resolveStepBehavior(config, { output: "custom.md" });
		assert.equal(behavior.output, "custom.md");
	});

	it("uses agent outputMode defaults unless a step overrides them", () => {
		const inlineBehavior = resolveStepBehavior({ name: "test", output: "report.md" }, {});
		assert.equal(inlineBehavior.outputMode, "inline");
		assert.equal(resolveStepBehavior({ name: "test", output: "report.md", outputMode: "file-only" }, {}).outputMode, "file-only");

		const stepOverrideBehavior = resolveStepBehavior({ name: "test", output: "report.md", outputMode: "file-only" }, { outputMode: "inline" });
		assert.equal(stepOverrideBehavior.outputMode, "inline");
	});

	it("false disables output", () => {
		const config = { name: "test", output: "report.md" };
		const behavior = resolveStepBehavior(config, { output: false });
		assert.equal(behavior.output, false);
	});

	it("string false disables output defensively", () => {
		const config = { name: "test", output: "report.md" };
		const behavior = resolveStepBehavior(config, { output: "false" });
		assert.equal(behavior.output, false);
	});

	it("ignores boolean and string true output overrides", () => {
		const config = { name: "test", output: "report.md" };
		assert.equal(resolveStepBehavior(config, { output: true }).output, "report.md");
		assert.equal(resolveStepBehavior(config, { output: "true" }).output, "report.md");
		assert.equal(resolveStepBehavior({ name: "test" }, { output: true }).output, false);
		assert.equal(resolveStepBehavior({ name: "test" }, { output: "true" }).output, false);
	});

	it("defaults to false when agent has no config", () => {
		const config = { name: "test" };
		const behavior = resolveStepBehavior(config, {});
		assert.equal(behavior.output, false);
		assert.equal(behavior.reads, false);
		assert.equal(behavior.progress, false);
	});
});

describe("read-only progress suppression", { skip: !available ? "pi packages not available" : undefined }, () => {
	it("suppresses progress for review-only or no-edit tasks", () => {
		const behavior = { reads: undefined, output: false, outputMode: "inline", progress: true, skills: undefined };

		assert.equal(taskDisallowsFileUpdates("Review-only. Do not edit files."), true);
		assert.equal(taskDisallowsFileUpdates("Implement read-only mode for config files."), false);
		assert.equal(taskDisallowsFileUpdates("This task is not read-only; edit files."), false);
		assert.equal(suppressProgressForReadOnlyTask(behavior, "Review-only. Do not edit files.").progress, false);
		assert.equal(suppressProgressForReadOnlyTask(behavior, "{task}", "Review-only. Do not edit files.").progress, false);
		assert.equal(suppressProgressForReadOnlyTask(behavior, "Implement the approved fix.").progress, true);
	});
});
