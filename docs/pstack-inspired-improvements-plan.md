# Pstack-inspired orchestration improvements

## Status

Implementation plan only. No runtime changes are part of this document.

Repository baseline reviewed: `83b1aca` (`feat: add parent-side child profile routing`). The primary checkout contains a pre-existing untracked `bun.lock`; preserve it and do not include it in any implementation commit.

## Objective

Add the reusable orchestration mechanisms suggested by the pstack audit without importing pstack's task-specific modes, Cursor assumptions, hidden control flow, or cross-skill router. The result should improve independent candidate comparison, model diversity, durable decision evidence, and evidence-backed agent refinement while keeping the parent session in control.

## Existing contracts to preserve

- `workflowScript` remains the only public execution surface.
- `runs.run` and `runs.all` remain the composition primitives. Do not add a special `arena`, `swarm`, or `panel` executor mode.
- The parent owns task decomposition, synthesis, review disposition, and authority decisions.
- Explicit child `model` and `thinking` selections always override routing.
- Review, publication, merge, deployment, destructive cleanup, and release authority do not follow from a child result or receipt.
- One writer per checkout/worktree remains the default.
- Existing child-profile resolver v1 registrations continue to work unchanged.
- Existing schema-version-1 mission records remain readable.
- Refinement changes remain explicit, evidence-backed, bounded, review-generated, and reversible.

## Non-goals

- Port `poteto-mode`, pstack playbooks, model names, or Cursor commands.
- Add task semantics such as prose cleanup, codebase explanation, decision archaeology, blast-radius analysis, or verification-skill generation to the executor. Those remain standalone Pi skills.
- Automatically launch a reviewer because an acceptance contract requests review. The parent must continue to orchestrate the reviewer visibly.
- Automatically apply refinement proposals or rewrite agent/skill files.
- Add recursive child orchestration or raise nesting limits.
- Add automatic mission continuation or replanning.
- Add a generic voting system. Candidate quality is not a majority vote.

## Deliverables

1. A packaged candidate-panel workflow recipe with strict candidate and synthesis schemas.
2. A backward-compatible batch child-profile resolver contract that can enforce diversity across one parallel group.
3. An append-only mission journal for decisions, hypotheses, observations, and results.
4. Optional mission-journal evidence in explicit agent refinement.
5. Documentation, API exports, changelog entries, and focused tests for each deliverable.

## Phase 1: Candidate-panel workflow recipe

### Purpose

Make the useful part of pstack's arena pattern reusable: several independent candidates solve the same bounded decision, then a separate judge selects a base, identifies disagreements, and grafts only compatible strengths. Keep this as a visible workflow recipe over existing primitives.

### Files

- Add `prompts/candidate-panel.md`.
- Update `docs/workflows.md`.
- Update `skills/pi-subagents/references/prompting-and-roles.md`.
- Update `test/unit/prompt-workflows.test.ts`.
- Update `CHANGELOG.md`.

### Recipe contract

The prompt must instruct the parent to:

1. Define one decision, shared constraints, and acceptance criteria before launching candidates.
2. Use two or three fresh-context, read-only candidates by default. Four is the hard recipe maximum unless the user explicitly requests more and the configured spawn ceiling permits it.
3. Give every candidate the same decision and evidence boundary while assigning a distinct perspective only when perspectives are substantively different.
4. Pass this bounded JSON Schema as each candidate's `outputSchema`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["proposal", "assumptions", "evidence", "risks", "validation", "unknowns"],
  "properties": {
    "proposal": { "type": "string", "minLength": 1, "maxLength": 8000 },
    "assumptions": { "type": "array", "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 1000 } },
    "evidence": { "type": "array", "maxItems": 32, "items": { "type": "object", "additionalProperties": false, "required": ["claim", "refs"], "properties": { "claim": { "type": "string", "minLength": 1, "maxLength": 2000 }, "refs": { "type": "array", "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 2048 } } } } },
    "risks": { "type": "array", "maxItems": 16, "items": { "type": "object", "additionalProperties": false, "required": ["risk", "likelihood", "impact"], "properties": { "risk": { "type": "string", "minLength": 1, "maxLength": 2000 }, "likelihood": { "type": "string", "enum": ["low", "medium", "high"] }, "impact": { "type": "string", "enum": ["low", "medium", "high"] } } } },
    "validation": { "type": "array", "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 2000 } },
    "unknowns": { "type": "array", "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 2000 } }
  }
}
```

5. Launch a separate fresh-context reviewer after all candidates finish. The reviewer receives an array of `{ key, candidate: result.structuredOutput }` plus the original decision contract, not freeform `.output` text or private candidate transcripts.
6. Pass this bounded JSON Schema as the reviewer's `outputSchema`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["status", "selectedCandidate", "decision", "grafts", "disagreements", "rejected", "evidenceGaps", "requiredValidation"],
  "properties": {
    "status": { "type": "string", "enum": ["selected", "unresolved"] },
    "selectedCandidate": { "anyOf": [{ "type": "string", "minLength": 1, "maxLength": 128 }, { "type": "null" }] },
    "decision": { "type": "string", "minLength": 1, "maxLength": 8000 },
    "grafts": { "type": "array", "maxItems": 16, "items": { "type": "object", "additionalProperties": false, "required": ["fromCandidate", "idea", "compatibility"], "properties": { "fromCandidate": { "type": "string", "minLength": 1, "maxLength": 128 }, "idea": { "type": "string", "minLength": 1, "maxLength": 2000 }, "compatibility": { "type": "string", "minLength": 1, "maxLength": 2000 } } } },
    "disagreements": { "type": "array", "maxItems": 16, "items": { "type": "object", "additionalProperties": false, "required": ["topic", "positions", "resolution"], "properties": { "topic": { "type": "string", "minLength": 1, "maxLength": 1000 }, "positions": { "type": "array", "maxItems": 8, "items": { "type": "object", "additionalProperties": false, "required": ["candidate", "position"], "properties": { "candidate": { "type": "string", "minLength": 1, "maxLength": 128 }, "position": { "type": "string", "minLength": 1, "maxLength": 2000 } } } }, "resolution": { "type": "string", "minLength": 1, "maxLength": 2000 } } } },
    "rejected": { "type": "array", "maxItems": 16, "items": { "type": "object", "additionalProperties": false, "required": ["candidate", "reason"], "properties": { "candidate": { "type": "string", "minLength": 1, "maxLength": 128 }, "reason": { "type": "string", "minLength": 1, "maxLength": 2000 } } } },
    "evidenceGaps": { "type": "array", "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 2000 } },
    "requiredValidation": { "type": "array", "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 2000 } }
  },
  "allOf": [
    { "if": { "properties": { "status": { "const": "selected" } }, "required": ["status"] }, "then": { "properties": { "selectedCandidate": { "type": "string", "minLength": 1, "maxLength": 128 } } } },
    { "if": { "properties": { "status": { "const": "unresolved" } }, "required": ["status"] }, "then": { "properties": { "selectedCandidate": { "type": "null" } } } }
  ]
}
```

7. Use the conditional schema branches above to enforce a non-null `selectedCandidate` when `status` is `selected` and null when `status` is `unresolved`; do not rely on prose-only validation.
8. Return unresolved product, architecture, safety, cost, or authority choices to the parent. The judge cannot silently settle them or fabricate a winning candidate.

The example must use ordinary `runs.all` followed by `runs.run`, stable keys, the schemas above, and a maximum of four candidates. Candidate and judge tasks have no mutation authority; use a non-mutating role/toolset where available rather than assuming the builtin `reviewer` lacks write tools.

### Invocation

Pi exposes the packaged prompt directly as `/candidate-panel`. The prompt runs in the parent and tells the parent to launch the visible workflow. Do not route it through `/prompt-workflow`, which wraps a prompt in one child and cannot own nested orchestration with the default delegate contract. Also document the equivalent direct `workflowScript` shape.

### Tests

- The packaged prompt is discovered with the other prompt templates and is directly invocable as `/candidate-panel`.
- The prompt contains the exact bounded candidate and synthesis schemas.
- The prompt consumes keyed `structuredOutput`, preserves attribution, and supports an unresolved verdict with no selected candidate.
- The prompt requires fresh, non-mutating candidates and a separate judge.
- The prompt contains no pstack, Cursor, provider-specific model, auto-merge, or automatic publication language.

### Completion criterion

A parent can invoke `/candidate-panel` or reproduce it with `workflowScript` without a new executor mode, and every candidate and disagreement remains attributable in the final decision.

## Phase 2: Batch child-profile routing for diversity

### Purpose

The v1 resolver sees children independently. It cannot reliably assign diverse providers or model families across one panel because it lacks stable group and sibling context. Add an optional batch contract while preserving v1 behavior.

### API decision

Add resolver version 2 alongside version 1. Do not mutate the v1 request or registry key.

Suggested public types in `src/runs/shared/child-profile-resolver.ts` or a sibling v2 module:

```ts
interface SubagentChildProfileBatchItem {
  key: string;
  agent: string;
  task: string;
  cwd: string;
  context?: "fresh" | "fork";
  model?: string;
  thinking?: string | false;
  explicitModel: boolean;
  explicitThinking: boolean;
}

interface SubagentChildProfileBatchRequest {
  groupKey: string;
  parallel: true;
  parentModel?: { provider: string; id: string };
  items: SubagentChildProfileBatchItem[];
}

interface SubagentChildProfileBatchSelection {
  key: string;
  profile: string;
  model: string;
  thinking?: string;
  confidence: number;
}

interface ResolvedSubagentChildProfileBatchSelection extends SubagentChildProfileBatchSelection {
  source: string;
}

type SubagentChildProfileBatchResolver = (
  request: SubagentChildProfileBatchRequest
) => Promise<SubagentChildProfileBatchSelection[] | null> | SubagentChildProfileBatchSelection[] | null;

interface RegisterSubagentChildProfileBatchResolverOptions {
  sessionId: string;
  source: string;
  resolve: SubagentChildProfileBatchResolver;
}

interface ResolveSubagentChildProfileBatchResult {
  selections: ResolvedSubagentChildProfileBatchSelection[];
  warnings: string[];
}
```

Export `SUBAGENT_CHILD_PROFILE_RESOLVER_VERSION_2`, `SUBAGENT_CHILD_PROFILE_RESOLVER_REGISTRY_KEY_2`, `registerSubagentChildProfileBatchResolver`, `resolveSubagentChildProfileBatch`, the resolver/request/selection/resolved/result types above, and a v2 handle equivalent to the v1 update/dispose handle. Use registry key `pi-subagents.child-profile-resolver.v2`. Keep the existing unversioned package export path `./child-profile-resolver`; add the v2 symbols there alongside v1 rather than creating a new package subpath.

### Runtime behavior

- Batch routing applies only to one validated `runs.all` parallel group containing new `agent` launches. If any sibling uses retained `resume`, skip v2 for the whole group and preserve the current retained-session contract plus v1/static routing for new siblings. Do not attempt to infer or alter a resumed child's stored model.
- Add one internal batch-preparation host message or callback carrying the stable group key, every validated child key, and every child launch parameter. Pre-route once, then preserve the existing per-child host launch, result ordering, and failure semantics. Do not change the public `workflowScript` API.
- Update both foreground and async workflow host adapters; both currently launch children independently.
- The runtime supplies stable child keys and one stable group key. Never derive identity from array position alone.
- Build every batch item from effective child parameters after `prepareWorkflowLaunchParams` merges workflow defaults with the raw `runs.all` item. Use the effective `cwd`, `context`, `model`, and `thinking`, not raw item fields.
- Treat any effective model or thinking value from either child fields or workflow-level defaults as fixed: set the matching explicit flag, include the actual value, and exclude that field from v2 override exactly as v1 routing does today. A v2-produced selection is applied after this merge and must not be passed through v1 routing again.
- Send all siblings to the resolver, including explicit fixed choices. Explicit model or thinking fields bypass routing for that item, and their actual values remain visible so the resolver can diversify the eligible siblings.
- A v2 batch resolver returns zero or one selection per eligible key. A selection object with a missing key, a duplicate or unknown key, or a key for an ineligible fixed item invalidates the v2 result and falls back to v1/static routing with one warning.
- Omitted eligible keys form a valid partial result. Apply returned selections to matching children and route omitted eligible children through v1/static fallback.
- Validate every returned model, thinking level, profile, and confidence with the existing v1 limits.
- Cap one v2 resolver input at 32 siblings. When a group is larger, route the excess siblings with current v1/static behavior; do not add workflow throttling or change the existing launch concurrency semantics.
- Keep the six-second resolver deadline for the whole batch, not per child.
- On no v2 registration or a null v2 result, apply current v1 routing independently.
- Resolver failures remain warnings and never block child launch.
- Do not infer a panel purpose from task text or require provider diversity in the runtime. The resolver may choose diversity; the executor only provides sibling context and validates the response.

### Files

Inspect and update at least:

- `src/runs/shared/child-profile-resolver.ts` or a new versioned sibling module;
- `src/runs/shared/child-profile-routing.ts`;
- the workflow group host contract in `src/workflows/scripted-workflow.ts` and both foreground and async executor adapters;
- the existing unversioned package subpath implementation in `src/api/child-profile-resolver.ts`; export both v1 and v2 symbols there and keep root `index.ts` unchanged;
- `docs/extension-api.md`, `docs/models.md`, and `docs/workflows.md`;
- `test/unit/child-profile-routing.test.ts` plus resolver/API tests;
- `CHANGELOG.md`.

Trace the actual workflow child launch before editing. Do not assume the legacy `tasks`/`chain` pre-routing path is also the `workflowScript` path.

### Tests

Cover:

- v1-only registrations preserve exact current behavior;
- one v2 call receives all eligible siblings with stable keys;
- mixed explicit and routed models preserve explicit choices and expose their values as fixed constraints;
- invalid selection objects, duplicate keys, unknown keys, and selections for fixed children fail open with one warning;
- timeout and thrown resolver errors fail open;
- omitted eligible keys are valid and use v1/static fallback while matching partial selections apply;
- one `runs.all` group makes one v2 resolver call before its existing per-child launches in both foreground and async execution;
- groups containing one or more retained `resume` items skip v2 and preserve stored resumed-child contracts;
- serial children still use v1 routing;
- batch input and output bounds;
- public API type/export compatibility.

### Completion criterion

A candidate-panel workflow can request a diverse profile through one resolver decision across the group, while existing users and explicit model selections observe no behavior change.

## Phase 3: Append-only mission journal

### Purpose

Missions currently preserve runs, open/resolved decisions, artifacts, receipts, and state. Add a bounded evidence trail for decisions already made and for hypothesis-driven work without treating journal entries as authority or workflow state.

### Data model

Add:

```ts
type MissionJournalKind = "decision" | "hypothesis" | "observation" | "result";

interface MissionJournalEntry {
  id: string;
  kind: MissionJournalKind;
  title: string;
  body?: string;
  evidence?: string[];
  runId?: string;
  createdAt: string;
}
```

Add `journal: MissionJournalEntry[]` to the normalized `MissionRecord` and `journal` append input to `mission.update`.

### Compatibility and bounds

- Continue writing `schemaVersion: 1` because this is an optional backward-compatible field. Missing `journal` parses as `[]`.
- Parsing an older record and updating it must preserve all existing fields and add `journal` without data loss.
- Journal entries are append-only through public actions. No update/delete action is added.
- Add a bounded cross-process lock around the complete mission-record read-modify-write operation. Extract or generalize the stale-lock behavior currently private to `src/missions/workflow-state.ts`; atomic JSON replacement prevents torn files but does not prevent lost concurrent appends.
- Use a mission-record-specific lock path and release it immediately after the atomic write. A lock timeout must fail the update rather than write from a stale read.
- Cap a mission at 256 journal entries.
- Cap `title` at 256 characters, `body` at 4 KiB, evidence at 16 entries, and each evidence string at 2 KiB.
- Reject duplicate journal entry IDs inside one record.
- Generate IDs and timestamps in the store, not from model-supplied values.
- Evidence strings are references or concise observations, not arbitrary file contents.
- A journal entry does not resolve an open decision, authorize an action, or change mission status.

### Files

- `src/missions/types.ts`;
- `src/missions/actions.ts`;
- `src/missions/store.ts`;
- `src/missions/workflow-state.ts` plus a new shared lock helper if extraction is the cleanest way to avoid duplicate lock code;
- mission schemas in `src/extension/schemas.ts`; do not create a new public mission API subpath without a separate API decision;
- mission rendering/status details where records are shown;
- `docs/missions.md`, `docs/tool-reference.md`, and the packaged skill mission guidance;
- mission unit/integration tests;
- `CHANGELOG.md`.

### Tests

Cover parsing records without a journal, bounded append, generated IDs/timestamps, duplicate rejection, unknown kind rejection, length limits, lock timeout and stale-lock recovery, a two-process lost-update regression proving concurrent appends are preserved, list/show behavior, and terminal mission retention.

### Completion criterion

A mission can retain a compact, attributable decision and experiment trail that survives compaction and restart without replacing state, artifacts, receipts, or open decisions.

## Phase 4: Journal evidence for explicit refinement

### Purpose

Reuse the mission journal as an additional bounded evidence source for `/subagents-refine`. Do not turn reflection into automatic self-modification.

### Behavior

- Extend `RefinementEvidenceSource` with `mission-journal` and add `role: "support" | "context"` to refinement evidence items. Mark all existing `live-state`, `artifact-metadata`, and `artifact-output` items as `support` to preserve current refinement eligibility; the new distinction limits journal context rather than retroactively changing existing behavior.
- Add this optional canonical payload to `RefinementEvidenceItem`:

```ts
journal?: {
  missionId: string;
  entryId: string;
  kind: MissionJournalKind;
  title: string;
  body?: string;
  evidence: string[];
}
```

- For a journal item, set `id` to `mission:<missionId>:journal:<entryId>`, `source` to `mission-journal`, `runId` from the entry, `at` from `createdAt`, `agent` from the exact linked mission run, `refs` to the mission record path plus the entry's evidence strings, and `journal` to the payload above. Do not copy journal text into `outputTail`.
- Preserve the mission field limits, then truncate the optional body and evidence list further as needed so the serialized `RefinementEvidenceItem` obeys the existing 2-KiB item bound. Ranking uses `journal.kind`, not keyword inspection of title/body.
- During explicit `refine`, locate recent project missions linked to runs for the target agent. Extend `RefinementActionContext` with the resolved mission store configuration and agent directory needed by `resolveMissionStoreLocation`; pass `deps.config.missions` and the executor's agent directory from `src/runs/foreground/subagent-executor.ts`. Never assume the default mission directory when a configured directory is active.
- Include a journal entry only when its `runId` exactly matches a mission run link whose non-empty `agent` equals the refinement target. Defer parent-workflow and mission-level inference; do not inspect transcripts or guess from journal prose.
- Mark `observation` and `result` entries as support. Mark `decision` and `hypothesis` entries as context.
- Reject a proposed refinement edit when all cited evidence has role `context`; every accepted edit needs at least one cited support item.
- Give journal evidence stable IDs of `mission:<missionId>:journal:<entryId>`.
- Collect bounded candidates from every source before applying the final packet cap. Rank acceptance failures, review findings, errors, residual risks, and concrete journal results ahead of output tails and context-only entries.
- Apply the existing age, eight-item, per-item, and 16-KiB packet bounds to the combined ranked set.
- Keep the existing snapshot `evidenceIds` field for backward compatibility and add an optional `evidenceRoles: Record<string, "support" | "context">`. New snapshots write both. Old v1 snapshots without `evidenceRoles` parse unchanged and treat their existing evidence IDs as support.
- Keep the existing read-only reviewer proposal child, policy validation, explicit write, and rollback behavior.

### Files

- `src/agents/agent-refinements.ts`;
- mission lookup helpers using `resolveMissionStoreLocation`, including configured mission directory and agent-directory handling, without duplicating store path logic;
- `src/runs/foreground/subagent-executor.ts` to pass mission-store configuration into `RefinementActionContext`;
- `test/unit/agent-refinements.test.ts`;
- `docs/agents.md`, `docs/missions.md`, and packaged skill management guidance;
- `CHANGELOG.md`.

### Tests

Cover exact linked-agent filtering, exclusion when `MissionRunLink.agent` is absent, context-only proof rejection, existing-source support defaults, canonical journal payload mapping and 2-KiB truncation, journal support/context kind mapping, priority before mixed-source bounds, configured non-default mission directories, missing/corrupt mission records, stable evidence IDs, old snapshot parsing without role metadata, new snapshot role persistence, rejection of policy-overriding proposals, and rollback.

### Completion criterion

Explicit refinement can cite durable mission outcomes without increasing automatic authority or accepting unreviewed journal text as instructions.

## Phase 5: Documentation-only review lenses

Do not add a lens registry in this implementation. Existing mechanisms are sufficient:

- public child launches accept `skill` with one name or an array of names for reviewed skill perspectives;
- packaged workflows can inline a bounded rubric;
- watchdog configuration supports project guidance through its existing prompt path.

Document one example showing a fresh reviewer launched with `skill` and one watchdog example using `guidance.watchdogMd` or `guidance.systemPromptPath`. Update `docs/workflows.md`, `docs/watchdog.md`, and `skills/pi-subagents/references/prompting-and-roles.md`. Keep skill discovery and prompt loading explicit. Revisit a runtime registry only after at least three independent workflows require identical validated lens metadata.

## Validation

Run the repository's current required checks from `package.json` and CI. At minimum:

```bash
npm run typecheck
npm run test:all
```

If script names differ at implementation time, inspect `package.json` and use the authoritative equivalents. Also run focused tests for every touched subsystem before the full suite.

Review the final diff for:

- no Cursor or pstack runtime assumptions;
- no provider-specific default model names;
- no hidden reviewer launch or automatic refinement;
- no weakened authority, worktree, acceptance, or child-safety policy;
- no inclusion or deletion of the pre-existing untracked `bun.lock`;
- bounded arrays, strings, resolver calls, and persisted journal growth;
- backward compatibility for resolver v1 and mission schema-version-1 records.

## Implementation sequence and commits

Use one writer and implement in this order:

1. Candidate-panel prompt recipe and tests.
2. Batch resolver v2 and routing tests.
3. Mission journal and tests.
4. Refinement journal evidence and tests.
5. Documentation reconciliation and full validation.

Keep separate commits for these concerns. Do not push, open a PR, publish, merge, or release unless separately authorized.

## Stop conditions

Stop and ask the parent or user if:

- the actual `workflowScript` launch path cannot expose stable sibling keys without changing the public script contract;
- batch routing requires breaking resolver v1;
- mission journal append cannot be made atomic after adding the planned bounded mission-record lock;
- journal evidence would require injecting untrusted text directly into an agent system prompt;
- a required change would add hidden orchestration or weaken an authority boundary;
- repository tests reveal an unrelated baseline failure that prevents trustworthy validation.

## Definition of done

- Every deliverable above is implemented or explicitly deferred with a concrete blocker.
- Focused and full validation pass freshly.
- Resolver v1 and existing mission records remain compatible.
- Candidate synthesis retains source attribution and unresolved disagreements.
- Mission journals are append-only and bounded.
- Refinements remain explicit, evidence-backed, validated, and reversible.
- Documentation describes the actual runtime rather than the intended design.
