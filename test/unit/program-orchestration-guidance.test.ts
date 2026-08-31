import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

const projectRoot = process.cwd();
const skillPath = join(projectRoot, "skills", "pi-subagents", "SKILL.md");
const programReferencePath = join(projectRoot, "skills", "pi-subagents", "references", "program-orchestration.md");

function tableRows(markdown: string): string[][] {
	return markdown
		.split("\n")
		.filter((line) => /^\|.*\|$/.test(line) && !/^\|(?:\s*:?-+:?\s*\|)+$/.test(line))
		.map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
}

function section(markdown: string, heading: string): string {
	const startMarker = `## ${heading}`;
	const start = markdown.indexOf(startMarker);
	assert.notEqual(start, -1, `missing section: ${heading}`);
	const bodyStart = start + startMarker.length;
	const next = markdown.indexOf("\n## ", bodyStart);
	return markdown.slice(bodyStart, next === -1 ? markdown.length : next);
}

function rowLabels(markdown: string): string[] {
	return tableRows(markdown).slice(1).map((row) => row[0] ?? "");
}

describe("whole-program orchestration guidance", () => {
	it("routes only broad program design through the focused reference", () => {
		const skill = readFileSync(skillPath, "utf-8");
		const routingSection = section(skill, "Read the reference for the branch");
		const rows = tableRows(routingSection);
		const broadRoute = rows.find(([branch]) => /broad|predeclared|multi-phase/i.test(branch ?? ""));
		const programRoutes = rows.filter((row) => row.some((cell) => /program-orchestration\.md/.test(cell)));
		const boundedRoute = tableRows(section(skill, "Launch shape")).find(([need]) => /one bounded task/i.test(need ?? ""));

		assert.ok(broadRoute, "broad, predeclared, or multi-phase work needs an explicit route");
		assert.deepEqual(programRoutes, [broadRoute], "unrelated router branches must not load whole-program guidance");
		assert.ok(boundedRoute, "one-child direct execution must remain explicit");
		assert.match(boundedRoute[1] ?? "", /direct `\{ agent, task \}`/);
		assert.doesNotMatch(boundedRoute[1] ?? "", /program-orchestration/);
		assert.match(routingSection, /do not load[\s\S]*one bounded child[\s\S]*unrelated review,\s+management,\s+status[\s\S]*inspection/i);
	});

	it("places both parent design gates at their required boundaries", () => {
		const skill = readFileSync(skillPath, "utf-8");
		const gateStart = skill.indexOf("**Whole-program design gate:**");
		const gateEnd = skill.indexOf("\n## Launch shape", gateStart);
		assert.notEqual(gateStart, -1);
		assert.notEqual(gateEnd, -1);
		const gate = skill.slice(gateStart, gateEnd);
		const reference = readFileSync(programReferencePath, "utf-8");

		assert.match(gate, /program-orchestration\.md` before reconnaissance/i);
		assert.match(gate, /intake\s+map[\s\S]*after reconnaissance[\s\S]*before the first mutation-capable child/i);
		assert.match(section(reference, "Intake map before reconnaissance"), /before reconnaissance, the parent records/i);
		assert.match(section(reference, "Execution map before mutation"), /after reconnaissance[\s\S]*before the first mutation-capable child/i);
	});

	it("keeps the two required maps and execution-shape decisions structurally complete", () => {
		assert.equal(existsSync(programReferencePath), true, "program orchestration reference must exist");
		const reference = readFileSync(programReferencePath, "utf-8");

		assert.deepEqual(rowLabels(section(reference, "Intake map before reconnaissance")), [
			"Phases and completion",
			"Ordering",
			"Unknowns and owner decisions",
			"Mutation boundaries",
			"First reconnaissance wave",
		]);
		assert.deepEqual(rowLabels(section(reference, "Execution map before mutation")), [
			"Dependencies",
			"Serial writer critical path",
			"Independent read-only work",
			"Authority gates",
			"Review allocation",
			"Validation checkpoints",
			"Completion, failure, and revisit triggers",
		]);

		const shapeRows = tableRows(section(reference, "Choose the execution shape"));
		const shapeText = shapeRows.map((row) => row.join(" ")).join("\n");
		assert.match(shapeText, /one bounded child.*direct execution/i);
		assert.match(shapeText, /coordinated wave.*`workflowScript`/i);
		assert.match(shapeText, /independent.*`runs\.all`/i);
		assert.match(shapeText, /predeclared.*`runs\.lanes`/i);
	});

	it("separates the program, execution waves, scheduling, and authority boundaries", () => {
		const reference = readFileSync(programReferencePath, "utf-8");
		const waveSection = section(reference, "Program versus execution waves");
		const asyncSection = section(reference, "Async schedules work; it does not design it");
		const authoritySection = section(reference, "Authority, ownership, and gates");
		const completionSection = section(reference, "Completion, failure, and revisit");
		const textBlocks = [...reference.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]!);

		assert.match(waveSection, /program.*complete map/is);
		assert.match(waveSection, /wave.*without a parent or operator decision/is);
		assert.match(asyncSection, /scheduling\s+need/i);
		assert.ok(textBlocks.includes("async singleton → blocking wait → status inspection → improvised singleton"));
		assert.ok(textBlocks.some((block) => block.startsWith("intake map\n→ parallel reconnaissance") && block.endsWith("final evidence and acceptance")));
		assert.match(authoritySection, /parent owns program synthesis/i);
		assert.match(authoritySection, /operator retains unresolved product, compatibility, security, scope/i);
		assert.match(authoritySection, /one writer per cwd or worktree/i);
		assert.match(completionSection, /fail closed/i);
	});

	it("keeps every routed local Markdown reference resolvable", () => {
		const documents = [readFileSync(skillPath, "utf-8"), readFileSync(programReferencePath, "utf-8")];
		const referencePattern = /`((?:references\/|\.\.\/)[^`#]+\.(?:md|MD))(?:#[^`]*)?`/g;
		const references = documents.flatMap((document) => [...document.matchAll(referencePattern)].map((match) => match[1]!));

		assert.ok(references.length > 0);
		for (const reference of references) {
			assert.equal(existsSync(resolve(dirname(skillPath), reference)), true, `missing local reference: ${reference}`);
		}
	});
});
