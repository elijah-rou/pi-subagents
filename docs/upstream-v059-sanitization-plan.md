# Upstream v0.59 sanitization plan

Status: proposed

## Objective

Retain the upstream v0.46–v0.59 reliability and security work while correcting behavior that conflicts with this fork's acceptance policy in [`VISION.md`](../VISION.md). Reduce optional surface without attempting to reverse the integrated runtime architecture.

This plan covers the integration from pre-upstream branch `e3611bb1` to `0073a7ea`. It does not treat `/subagents-doctor` as new work. `doctor` remains a read-only diagnostic action, not an agent.

## Decisions

Keep these as core behavior:

- async ownership, persistence, recovery, retention, and process cleanup;
- managed output and private runtime hardening;
- status, receipts, inspection, steering, child-stop, and completion evidence;
- direct single-child execution, `workflowScript`, `runs.run`, `runs.all`, workflow validation, and `runs.host`;
- composable acceptance contracts;
- fail-closed model, tool, cwd, MCP, and output validation;
- the 64-child per-run bound;
- read-only reviewer authority and removal of legacy chain execution APIs.

Keep these optional:

- parent-side child-profile routing;
- soft runtime checkpoints;
- `runs.lanes` as a secondary helper for predeclared staged work;
- council mode, watchdog, Orca, Herdr, runtime-agent registration, and external runners.

Change these areas:

- inferred acceptance for mutating work must require evidence;
- authoritative user-global instructions must reach children by default;
- active top-level async runs must have a finite default, while cumulative session launches remain an explicit cost policy;
- the existing `globalConcurrencyLimit` must be documented accurately as a per-run limit;
- Fleet rendering and soft checkpoints must stop polling at fixed short intervals;
- concrete Codex, Claude Code, and Cursor profiles must not appear as core builtins by default;
- speculative cleanup fields and peer-project public API surface must be removed unless an in-fork consumer justifies them.

## Non-goals

- Reverting to upstream v0.45.2 or restoring removed chain/parallel APIs.
- Removing generic external-runner support.
- Removing `doctor`, status, Fleet, missions, schedules, or existing persisted-state readers in this work.
- Adding CI, merge, deployment, release, or general project-management behavior.
- Expanding `runs.lanes`, worktree cleanup, or project-pane behavior while sanitization is underway.

## Work packages

Implement each work package as a separate issue and pull request. Do not combine public API removal, policy defaults, and performance work in one diff.

### 1. Make inferred acceptance enforce the fork's evidence policy

Current problem: `resolveEffectiveAcceptance()` can turn omitted or `auto` acceptance into recommendations while resolving the effective level to `none`. That conflicts with the requirement that completion needs evidence and fails closed when evidence is missing.

Primary files:

- `src/runs/shared/acceptance.ts`
- `src/runs/foreground/execution.ts`
- `src/runs/background/async-execution.ts`
- `test/unit/acceptance.test.ts`
- acceptance integration tests under `test/integration/`

Implementation:

1. Add failing tests for omitted and `auto` acceptance on mutating single-child and workflow launches.
2. Resolve inferred mutating work to a checked report contract with concrete evidence requirements.
3. Keep read-only analysis lightweight and non-mutating.
4. Preserve explicit opt-out through `false` or a reasoned `none` contract and persist that provenance.
5. Preserve explicit verification and review as independent dimensions.
6. Keep legacy persisted contracts readable while emitting only the canonical contract.

Exit criteria:

- A mutating child cannot complete successfully without the inferred evidence report.
- A read-only child does not receive a writer evidence contract.
- Explicit opt-out remains possible and visible in status and receipts.
- Resume, nested revival, schedules, and workflow receipts preserve the same effective contract.

### 2. Restore authoritative global instructions

Current problem: omitted `inheritGlobalContext` defaults to `false`, and prompt rewriting strips user-global `AGENTS.md`, `AGENTS.override.md`, and `CLAUDE.md`. This can remove operator authority and safety policy from children.

Primary files:

- `src/agents/agents.ts`
- `src/agents/runtime-agent-registry.ts`
- `src/runs/shared/subagent-prompt-runtime.ts`
- `src/runs/background/async-resume.ts`
- `test/unit/agent-frontmatter.test.ts`
- `test/unit/subagent-prompt-runtime.test.ts`
- `docs/agents.md`
- `docs/configuration.md`

Implementation:

1. Add a failing test proving that an agent inheriting project context also receives authoritative user-global instruction files when the field is omitted.
2. Restore that behavior as the default.
3. Keep `inheritGlobalContext: false` as the explicit token-saving and isolation control.
4. Continue stripping all inherited context when `inheritProjectContext: false`.
5. Keep old recovery descriptors on their persisted semantics.
6. Document the precedence and the token-cost tradeoff without describing policy files as optional conversational context.

Exit criteria:

- Omitted configuration preserves user and project authority instructions.
- Explicit `false` removes only user-global instruction blocks.
- Resume behavior does not silently reinterpret persisted launches.

### 3. Replace fixed-interval hot-path polling

Current problems:

- `SubagentFleetStatus` refreshes every 500 ms and requests a render for unchanged running state.
- soft checkpoints poll every 25 ms until the checkpoint time and while a tool remains active.

Primary files:

- `src/tui/fleet-status.ts`
- `src/runs/foreground/execution.ts`
- matching background checkpoint delivery code
- `test/unit/fleet-status.test.ts`
- `test/unit/checkpoint.test.ts`
- checkpoint integration tests

Implementation:

1. Capture baseline render counts and checkpoint timer behavior for idle, one-child, ten-child, and bounded large-fleet cases.
2. Make Fleet rendering state-driven. Do not repaint unchanged state merely to animate a spinner.
3. Use a static running glyph unless a later benchmark justifies opt-in animation.
4. Replace the 25 ms checkpoint interval with one timer at `checkpointAt`.
5. When the checkpoint becomes due during a tool call, mark it pending and deliver it from the tool-completion path.
6. Ensure terminal, stop, timeout, and disposal paths cancel pending timers and listeners.

Exit criteria:

- An unchanged running Fleet produces no periodic render requests.
- Idle Fleet status owns no refresh timer.
- Each checkpointed child owns at most one deadline timer.
- A checkpoint due during a tool call is delivered once after that tool finishes.
- Status and checkpoint behavior remain bounded under the 64-child run limit.

### 4. Bound active top-level runs and clarify concurrency scope

Current problem: active top-level async runs are unlimited unless configured. `globalConcurrencyLimit` does not solve that problem: it creates a separate semaphore inside each top-level run, so concurrent runs and other Pi sessions each receive their own allowance. Its name overstates its scope.

Primary files:

- `src/extension/config.ts`
- `src/runs/background/active-async-capacity.ts`
- `src/workflows/scripted-workflow.ts`
- `src/runs/background/subagent-runner.ts`
- `test/unit/active-async-capacity.test.ts`
- `test/unit/scripted-workflow.test.ts`
- `docs/configuration.md`

Decisions:

- default `maxActiveAsyncRunsPerSession` to `4`;
- retain the existing per-run `globalConcurrencyLimit` default of `20` until measurements justify another value;
- retain `maxSubagentSpawnsPerRun: 64`;
- leave `maxSubagentSpawnsPerSession` unlimited by default because it bounds cumulative cost, not simultaneous resource use;
- do not claim a session-wide or machine-wide child concurrency guarantee.

Implementation:

1. Add failing tests for the active top-level async default.
2. Apply the active-run default before creating run artifacts or starting children.
3. Preserve explicit `0` as the documented unlimited override.
4. Keep recovery from double-charging or silently releasing active-run slots.
5. Rename the documentation concept to “per-run child concurrency” while retaining the existing configuration key for compatibility.
6. Report both limits with their exact scopes through status and `doctor`.
7. Treat a true cross-run child semaphore as a separate design requiring measurements and owner approval. It would need cross-process ownership, terminal release proof, stale-owner recovery, and hot-path cost analysis.

Exit criteria:

- A default parent session cannot own more than four active top-level async runs.
- Each top-level run still enforces its own child concurrency and 64-child cumulative limit.
- Status and `doctor` do not describe `globalConcurrencyLimit` as session-wide or machine-wide.
- No new cross-process concurrency state is introduced by this work package.

### 5. Remove concrete vendor profiles from the default builtin list

Current problem: core discovery exposes six vendor-specific agents even when the operator did not choose external CLI delegation. This adds list, documentation, and maintenance surface despite the generic external-runner contract already expressing the capability boundary.

Primary files:

- `agents/codex-exec*.md`
- `agents/claude-code*.md`
- `agents/cursor-agent*.md`
- `src/agents/builtin-names.ts`
- `src/extension/tool-description.ts`
- `docs/agents.md`
- adapter and discovery tests

Implementation:

1. Remove the six profiles from builtin discovery and package agent files.
2. Retain generic external CLI execution and its fail-closed capability metadata.
3. Retain code-owned adapter support only when an explicitly installed package or custom profile selects it.
4. Move example profile definitions to documentation or an optional package rather than adding a new core enablement setting.
5. Remove vendor names from the default model-facing tool description.
6. Keep writer access an explicit profile identity and prevent read-only identities from being widened.

Exit criteria:

- A default `subagent({ action: "list" })` contains only native core roles.
- Installing or defining an external profile makes only that profile discoverable.
- External receipts still state the real adapter, access, unsupported capabilities, and non-resumability.
- No external CLI is probed during discovery or listing.

### 6. Reduce speculative and peer-project surface

Current problems:

- `worktree.cleanup` exposes `planId` and `mode: "apply"` even though apply is unsupported.
- `pi-subagents/project-panes` creates a public peer-session lifecycle API that is outside the focused parent-child delegation contract unless another in-fork component requires it.
- lane metadata now spans schemas, status, receipts, TUI, and Herdr; further expansion would increase hot-path and persistence cost.

Primary files:

- `src/extension/schemas.ts`
- `src/runs/shared/worktree-cleanup-plan.ts`
- `src/api/project-panes.ts`
- `src/inspectors/herdr/project-panes.ts`
- `package.json`
- `src/runs/shared/lane-metadata.ts`
- `src/workflows/scripted-workflow.ts`
- package-manifest, workflow, cleanup, status, and Herdr tests

Implementation:

1. Inventory all in-repository callers and persisted fields before removal.
2. Remove `planId` and unsupported cleanup `apply` mode from newly emitted schemas and guidance.
3. Continue reading old persisted cleanup metadata only when required for safe recovery.
4. Remove the `./project-panes` package export if no current in-fork consumer requires it.
5. Retain passive Herdr observation and existing operator-facing project actions only if they remain host-selected and do not claim parent control over peer-session children.
6. Keep `runs.lanes` as a bounded composition helper, but stop adding merge, CI, cleanup, or release-policy semantics to lane metadata.
7. Require a separate owner-approved design before any future cleanup apply mode, remote gate monitor, or peer-project lifecycle expansion.

Exit criteria:

- Public schemas advertise only implemented operations.
- No current package test or in-repository import depends on `pi-subagents/project-panes` before its export is removed.
- Existing run and handoff artifacts remain readable.
- Lane status remains bounded and display-oriented.

### 7. Align terminology and migration documentation

Implementation:

1. Use “doctor action” or “diagnostic command” everywhere; never call `doctor` an agent.
2. Add one migration section covering:
   - global instruction inheritance;
   - the active-run default and per-run concurrency scope;
   - external profiles no longer being builtins;
   - removed turn budgets and legacy workflow APIs;
   - `.pi-subagents/` to `.pi/subagents/` storage;
   - read-only reviewer behavior;
   - stricter model and tool validation.
3. Update `CHANGELOG.md` with behavior and compatibility changes from each work package.
4. Remove guidance for capabilities that are no longer shipped or enabled by default.

Exit criteria:

- Agent lists, management actions, and diagnostics use distinct terminology.
- A user upgrading from the pre-integration fork can identify every required configuration change from one document section.

## Delivery order

Use this order because later scope reduction depends on corrected contracts and measured runtime behavior:

1. acceptance policy;
2. global instruction inheritance;
3. polling removal and measurements;
4. active-run default and concurrency-scope clarification;
5. vendor-profile unbundling;
6. speculative and peer-project surface reduction;
7. final terminology and migration audit.

Do not start package/API removals until the first four work packages are independently green. Do not combine vendor-profile removal with generic external-runner changes.

## Validation

Each pull request must run its focused unit and integration tests. Before declaring the sanitization complete, run fresh checks from the final tree:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
```

Also inspect these observable paths manually:

1. list agents and confirm `doctor` is absent and optional vendor profiles are absent;
2. launch read-only and mutating children with omitted acceptance;
3. launch with and without global-context inheritance;
4. hold a child inside a tool call across `checkpointAfterMs`;
5. exercise session, run, concurrency, and active-async limits;
6. reload and resume a persisted workflow;
7. inspect Fleet while state is unchanged and verify that it does not repaint periodically;
8. read old status, receipt, recovery, and cleanup fixtures.

The final review must compare the resulting behavior against every section of `VISION.md`, not merely confirm that tests pass.

## Stop conditions

Stop a work package and request an owner decision if it would:

- remove the ability to read existing run or recovery state;
- widen child authority or silently drop user/project instructions;
- add a new public launch, persistence, project, CI, merge, or cleanup lifecycle;
- add unmeasured work to status, watcher, Fleet, or workflow hot paths;
- require a compatibility framework larger than the surface being removed.
