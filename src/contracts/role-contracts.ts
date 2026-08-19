import { Type, type TSchema } from "typebox";
import type { AgentConfig } from "../agents/agents.ts";
import type { JsonSchemaObject } from "../shared/types.ts";

export type DirectResultContract = "role" | "text";

const boundedText = (maxLength = 1_000) => Type.String({ minLength: 1, maxLength });
const stringList = (maxItems: number, maxLength = 1_000) => Type.Array(boundedText(maxLength), { maxItems });
const pathText = Type.String({ minLength: 1, maxLength: 4_096 });

const acceptanceReport = Type.Object({
	criteriaSatisfied: Type.Optional(Type.Array(Type.Object({
		id: Type.Optional(boundedText(256)),
		status: Type.Union([Type.Literal("satisfied"), Type.Literal("not-satisfied"), Type.Literal("not-applicable")]),
		evidence: boundedText(4_000),
	}, { additionalProperties: false }), { maxItems: 64 })),
	changedFiles: Type.Optional(stringList(64, 4_096)),
	testsAddedOrUpdated: Type.Optional(stringList(64, 4_096)),
	commandsRun: Type.Optional(Type.Array(Type.Object({
		command: boundedText(2_000),
		result: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("not-run")]),
		summary: boundedText(4_000),
	}, { additionalProperties: false }), { maxItems: 32 })),
	validationOutput: Type.Optional(stringList(64, 4_000)),
	residualRisks: Type.Optional(stringList(32, 4_000)),
	noStagedFiles: Type.Optional(Type.Boolean()),
	diffSummary: Type.Optional(boundedText(4_000)),
	reviewFindings: Type.Optional(stringList(64, 4_000)),
	manualNotes: Type.Optional(Type.String({ maxLength: 4_000 })),
	notes: Type.Optional(Type.String({ maxLength: 4_000 })),
}, { additionalProperties: false });

function envelope(id: string, data: TSchema): JsonSchemaObject {
	return Type.Object({
		contract: Type.Object({ id: Type.Literal(id), version: Type.Literal(1) }, { additionalProperties: false }),
		outcome: Type.Union([Type.Literal("completed"), Type.Literal("partial"), Type.Literal("blocked")]),
		summary: boundedText(4_000),
		evidence: stringList(32),
		risks: stringList(16),
		data,
		acceptanceReport: Type.Optional(acceptanceReport),
	}, { additionalProperties: false }) as unknown as JsonSchemaObject;
}

const generic = envelope("pi-subagents/generic", Type.Object({
	deliverables: Type.Array(Type.Object({ name: boundedText(256), description: boundedText(2_000), path: Type.Optional(pathText) }, { additionalProperties: false }), { maxItems: 64 }),
	decisionsNeeded: stringList(16),
	nextSteps: stringList(32),
}, { additionalProperties: false }));

const contracts: Record<string, JsonSchemaObject> = {
	delegate: generic,
	scout: envelope("pi-subagents/scout", Type.Object({
		answer: boundedText(4_000),
		files: Type.Array(Type.Object({ path: pathText, lines: Type.Optional(boundedText(128)), relevance: boundedText(1_000) }, { additionalProperties: false }), { maxItems: 64 }),
		architecture: boundedText(4_000),
		startHere: boundedText(1_000),
		uncertainties: stringList(32),
	}, { additionalProperties: false })),
	worker: envelope("pi-subagents/worker", Type.Object({
		changedFiles: Type.Array(Type.Object({ path: pathText, change: boundedText(2_000) }, { additionalProperties: false }), { maxItems: 64 }),
		validation: Type.Array(Type.Object({ command: boundedText(2_000), status: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("not-run")]), output: Type.Optional(boundedText(4_000)) }, { additionalProperties: false }), { maxItems: 32 }),
		decisionsNeeded: stringList(16),
		handoff: Type.Optional(boundedText(4_000)),
	}, { additionalProperties: false })),
	reviewer: envelope("pi-subagents/reviewer", Type.Object({
		verdict: Type.Union([Type.Literal("clean"), Type.Literal("changes-requested"), Type.Literal("blocked")]),
		findings: Type.Array(Type.Object({
			severity: Type.Union([Type.Literal("blocker"), Type.Literal("major"), Type.Literal("minor"), Type.Literal("note")]),
			path: Type.Optional(pathText), line: Type.Optional(Type.Integer({ minimum: 1 })),
			problem: boundedText(2_000), evidence: boundedText(2_000), recommendation: boundedText(2_000),
		}, { additionalProperties: false }), { maxItems: 64 }),
	}, { additionalProperties: false })),
	researcher: envelope("pi-subagents/researcher", Type.Object({
		findings: Type.Array(Type.Object({ claim: boundedText(2_000), confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]), sources: Type.Array(Type.Object({ title: Type.Optional(boundedText(512)), url: boundedText(4_096), passage: Type.Optional(boundedText(2_000)) }, { additionalProperties: false }), { maxItems: 16 }) }, { additionalProperties: false }), { maxItems: 64 }),
		retainedSources: stringList(64, 4_096), gaps: stringList(32),
	}, { additionalProperties: false })),
	oracle: envelope("pi-subagents/advisor", Type.Object({ recommendation: boundedText(4_000), alternatives: Type.Array(Type.Object({ option: boundedText(1_000), benefits: stringList(16), costs: stringList(16) }, { additionalProperties: false }), { maxItems: 16 }), assumptions: stringList(32), decisionsNeeded: stringList(16) }, { additionalProperties: false })),
	advisor: envelope("pi-subagents/advisor", Type.Object({ recommendation: boundedText(4_000), alternatives: Type.Array(Type.Object({ option: boundedText(1_000), benefits: stringList(16), costs: stringList(16) }, { additionalProperties: false }), { maxItems: 16 }), assumptions: stringList(32), decisionsNeeded: stringList(16) }, { additionalProperties: false })),
};

export function roleResultSchema(agent: AgentConfig | undefined): JsonSchemaObject {
	if (!agent || agent.source !== "builtin") return generic;
	return contracts[agent.localName ?? agent.name] ?? generic;
}

export function roleResultContractId(agent: AgentConfig | undefined): string {
	const schema = roleResultSchema(agent) as { properties?: { contract?: { properties?: { id?: { const?: unknown } } } } };
	const value = schema.properties?.contract?.properties?.id?.const;
	return typeof value === "string" ? value : "pi-subagents/generic";
}
