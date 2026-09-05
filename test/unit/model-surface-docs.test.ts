import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";
import { SubagentParams } from "../../src/extension/schemas.ts";
import { SUBAGENT_ACTIONS } from "../../src/shared/types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const expectedActions = [
	"list", "get", "models", "children.list", "guide", "validate", "worktree.discard", "lane.status",
	"status", "debug.run", "interrupt", "resume", "steer", "stop", "doctor",
];
const expectedFields = Object.keys((SubagentParams as unknown as { properties: Record<string, unknown> }).properties);

function read(relativePath: string): string {
	return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

function skillRoutes(skill: string): Map<string, string[]> {
	const routes = new Map<string, string[]>();
	for (const match of skill.matchAll(/^\| `([^`]+)` \| [^|]+ \| `([^`]+)` \|$/gm)) {
		assert.equal(routes.has(match[1]), false, `duplicate skill route: ${match[1]}`);
		routes.set(match[1], [match[2]]);
	}
	return routes;
}

function loadedBytes(paths: string[]): number {
	return paths.reduce((total, relativePath) => total + Buffer.byteLength(read(relativePath)), 0);
}

describe("model-facing docs and skill contract", () => {
	it("routes broad work through one whole-program design contract", () => {
		const skill = read("skills/pi-subagents/SKILL.md");
		const programReference = "references/program-orchestration.md";
		const routeRows = [...skill.matchAll(/^\| `([^`]+)` \| ([^|]+) \| `([^`]+)` \|$/gm)]
			.filter((match) => match[3] === programReference);
		assert.equal(routeRows.length, 1);
		assert.match(routeRows[0]?.[2] ?? "", /broad.*predeclared.*multi-phase/i);

		const programPath = path.join(root, "skills/pi-subagents", programReference);
		assert.equal(fs.existsSync(programPath), true);
		const program = fs.readFileSync(programPath, "utf-8");
		const intakeOffset = program.indexOf("## Inspect before mapping");
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

	it("loads exactly one branch reference and preserves top-level controls", () => {
		const skillPath = "skills/pi-subagents/SKILL.md";
		const skill = read(skillPath);
		const routes = skillRoutes(skill);
		const scenarios = new Map([
			["one-child-review", "references/review-and-validation.md"],
			["basic-async", "references/execution-controls.md"],
			["management", "references/management-authoring-rpc.md"],
			["broad-intake", "references/program-orchestration.md"],
		]);
		for (const [scenario, expectedReference] of scenarios) {
			assert.deepEqual(routes.get(scenario), [expectedReference], `${scenario} must load no unrelated reference`);
		}

		const routedReferences = [...routes.values()].flat();
		assert.equal(new Set(routedReferences).size, routedReferences.length);
		for (const reference of routedReferences) {
			assert.equal(fs.existsSync(path.join(root, "skills/pi-subagents", reference)), true, `missing routed reference: ${reference}`);
		}

		for (const invariant of [
			/parent.*(?:owns|authority)/i,
			/one writer per (?:checkout|cwd\/worktree)/i,
			/capability ceilings/i,
			/cross-(?:codebase|repository)/i,
			/evidence,\s+not authority/i,
			/escalate\s+unresolved/i,
		]) assert.match(skill, invariant);

		const baselineBytes = new Map([
			["one-child-review", 10_753],
			["basic-async", 11_064],
			["management", 9_173],
			["broad-intake", 14_126],
		]);
		const measurements = read("docs/delegation-efficiency-plan.md");
		for (const [scenario, reference] of scenarios) {
			const after = loadedBytes([skillPath, `skills/pi-subagents/${reference}`]);
			assert.ok(after < (baselineBytes.get(scenario) ?? 0), `${scenario} loaded bytes must decrease`);
			assert.match(measurements, new RegExp(`\\| ${scenario} \\| ${baselineBytes.get(scenario)} \\| ${after} \\|`));
		}
	});

	it("uses one compact commissioning and handoff contract", () => {
		const skillPath = "skills/pi-subagents/SKILL.md";
		const contractPath = "skills/pi-subagents/references/commissioning.md";
		const skill = read(skillPath);
		const contract = read(contractPath);
		const routes = skillRoutes(skill);
		assert.deepEqual(routes.get("commissioning"), ["references/commissioning.md"]);
		assert.match(skill, /detailed scout synthesis, review-to-fix, resume, or other role handoffs/i);
		const packetFields = [
			"Objective/deliverable", "Repo/cwd/ref", "Authority/edit boundary", "Parent-decided seams/constraints",
			"Observable acceptance", "Targeted validation", "Output/artifact", "Stop/escalation",
		];
		for (const field of packetFields) assert.ok(skill.includes(`\`${field}\``), `top-level skill missing packet field: ${field}`);
		assert.match(skill, /authority field explicitly[\s\S]*edit, commit, push, comment, merge, publish,[\s\S]*release, or launch children/i);
		assert.ok(Buffer.byteLength(skill) < 36_877);

		const packetMatch = contract.match(/```text\nObjective\/deliverable:[\s\S]*?\n```/);
		assert.ok(packetMatch);
		assert.deepEqual(
			[...packetMatch[0].matchAll(/^([^\n:]+):/gm)].map((match) => match[1]),
			[
				"Objective/deliverable",
				"Repo/cwd/ref",
				"Authority/edit boundary",
				"Parent-decided seams/constraints",
				"Observable acceptance",
				"Targeted validation",
				"Output/artifact",
				"Stop/escalation",
			],
		);
		assert.match(contract, /evidence keyed to the decisions or code seams/i);
		assert.match(contract, /parent verifies citations, resolves conflicts, owns decisions, and writes a\s+new canonical worker packet/i);
		assert.match(contract, /Do not paste scout transcripts, full research\s+reports, or broad parent history/i);
		assert.match(contract, /- <ID> \[<P0\|P1\|P2>\] <FIX\|ESCALATE\|BLOCK\|DEFER\|REJECT>:/);
		assert.match(contract, /Valid P0\/P1 findings may not be deferred/i);
		assert.match(contract, /only:\n\n```text\nAccepted findings:\n- <ID> \[<P0\|P1>\]:[\s\S]*evidence obligation:[\s\S]*affected seams:/);
		const exampleAuthorities = contract.match(/Authority\/edit boundary: (?:Read-only|Sole writer)[^\n]+/g) ?? [];
		assert.equal(exampleAuthorities.length, 2);
		for (const example of exampleAuthorities) {
			for (const action of ["edit", "commit", "push", "comment", "merge", "publish", "release", "launch children"]) assert.match(example, new RegExp(`\\b${action}\\b`));
		}
		assert.match(contract, /Resume only when[\s\S]*same child's bounded\s+working state/i);
		assert.match(contract, /Launch a fresh child[\s\S]*new role, adversarial or\s+independent review[\s\S]*unrelated\s+phase/i);

		for (const promptPath of [
			"prompts/gather-context-and-clarify.md",
			"prompts/parallel-research.md",
			"prompts/parallel-review.md",
			"prompts/review-loop.md",
		]) assert.match(read(promptPath), /skills\/pi-subagents\/references\/commissioning\.md/);
		for (const referencePath of [
			"skills/pi-subagents/references/program-orchestration.md",
			"skills/pi-subagents/references/prompting-and-roles.md",
			"skills/pi-subagents/references/review-and-validation.md",
		]) assert.match(read(referencePath), /\[`commissioning\.md`\]\(commissioning\.md\)/);

		const gather = read("prompts/gather-context-and-clarify.md");
		assert.match(gather, /bounded evidence keyed to named\s+decisions or seams/i);
		assert.match(gather, /parent synthesis, never copied child output or parent history/i);
		const reviewLoop = read("prompts/review-loop.md");
		assert.match(reviewLoop, /accepted finding IDs, severity, required outcomes, evidence obligations, affected seams/i);
		assert.match(reviewLoop, /not reviewer transcripts or full reports/i);
		assert.match(reviewLoop, /Resume an existing worker only for the same role, seam, repo\/cwd\/ref, authority boundary, and bounded working state/i);
		assert.match(reviewLoop, /fresh child for a new role, adversarial review, or unrelated phase/i);

		const measurements = read("docs/delegation-efficiency-plan.md");
		for (const row of [
			`| commissioning initial context | 36877 | ${Buffer.byteLength(skill)} |`,
			`| scout synthesis prompt | 756 | ${Buffer.byteLength(gather)} |`,
			`| review-to-fix prompt | 5275 | ${Buffer.byteLength(reviewLoop)} |`,
		]) assert.ok(measurements.includes(row), `missing measurement: ${row}`);
	});

	it("documents the exact action and field inventories", () => {
		assert.deepEqual(SUBAGENT_ACTIONS, expectedActions);
		const reference = read("docs/tool-reference.md");
		const documentedFields = [...reference.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
		assert.deepEqual(documentedFields, expectedFields);
		for (const action of expectedActions) assert.match(reference, new RegExp(`\\b${action.replace(".", "\\.")}\\b`));
		assert.match(reference, new RegExp(`primary schema has exactly these ${expectedFields.length} top-level fields`, "i"));
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
