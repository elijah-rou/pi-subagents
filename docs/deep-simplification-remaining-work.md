# Deep simplification: remaining work

This file is the handoff for completing Packages 5–8. `VISION.md` remains the acceptance policy. `docs/deep-simplification-audit.md` defines package scope and stop conditions.

## Resume here

Work only in:

```text
/home/elijahrou/piw-worktrees/pi-subagents/deep-simplification-audit-8af2702b
```

Branch:

```text
pi/pi-subagents/deep-simplification-audit-8af2702b
```

Do not edit the primary checkout. Do not push. Preserve unrelated changes and the Package 0 baseline.

`HEAD` is `ec9c0d57 refactor: retire legacy orchestration writers`. Packages 0–4 are committed. Package 5 is partially implemented and uncommitted. No subagent workflow is running.

Fresh checks against the current partial Package 5 tree:

- `npm run typecheck`: passed.
- `test/unit/terminal-decision.test.ts`: 18 passed.
- `git diff --check`: passed.
- Full unit, integration, and E2E suites have not run against the partial Package 5 tree.

The Package 4 baseline at `ec9c0d57` is 224 production TypeScript files, 80,812 lines, 15 model actions, 27 trusted actions, 27 recognized executor actions, and 18,519 combined schema bytes.

## Completed packages

| Package | Commit | Result |
| --- | --- | --- |
| 0 | `4b4c1df7` | Established the executable baseline and ownership ledgers. |
| 1 | `9363c60a` | Contracted the model-facing surface. |
| 2a | `6fa33e6b` | Removed active mission runtime. |
| 2b | `9b8447c8` | Removed schedule execution. |
| 3a | `85e41c90` | Removed watchdog review runtime. |
| 3b | `05a7055b` | Removed Orca observer integration. |
| 3c | `69ec9477` | Removed Herdr integration. |
| 3d/3e | `31cb0155` | Removed provider-profile administration and refinement overlays. |
| 4 | `ec9c0d57` | Retired legacy orchestration writers and hidden execution paths. |

Do not reopen these packages unless a remaining-package test proves a regression in a retained contract.

## Package 5 is partially implemented

The current working tree introduces a shared terminal policy and starts migrating foreground and background settlement.

New files:

- `src/runs/shared/terminal-decision.ts`
- `test/fixtures/terminal-decision-cases.ts`
- `test/unit/terminal-decision.test.ts`

Primary migrations:

- `src/runs/shared/agent-contract.ts`
- `src/runs/foreground/execution.ts`
- `src/runs/background/subagent-runner.ts`
- `test/integration/single-execution.test.ts`
- `test/integration/async-execution.test.ts`

The tree also changes schemas, settings, acceptance helpers, dynamic fanout, shared types, slash adapters, and workflow progress tests. Each ancillary change must be justified by Package 5. Revert changes that belong to Package 7 or are no longer needed.

### Finish Package 5

1. Inventory every remaining terminal classification with:

   ```bash
   rg -n 'settleChildResult|decideChildTerminal|acceptanceBlocksRun|acceptanceFailureMessage|exitCode === 0|status = .*complete|status = .*failed' src/runs src/workflows
   ```

2. Keep `decideChildTerminal` pure. Its inputs are execution facts, acceptance status, mutation/effect evidence, timeout, stop, interrupt, and detach. Process control, persistence, rendering, and filesystem access stay outside the module.
3. Confirm precedence with one shared fixture table:
   - detach remains detached;
   - stop remains stopped;
   - timeout fails;
   - interrupt remains paused;
   - an execution failure remains the primary diagnostic;
   - rejected or incomplete required acceptance fails closed;
   - missing or blocked required effects fail closed;
   - callers cannot turn a failed decision back into success.
4. Complete migration for foreground direct execution, background direct execution, `runs.run`, `runs.all`, and dynamic children.
5. Delete the replaced per-runner classification branches in the same change.
6. Inspect the current diff for accidental Package 7 work, especially removed schema/config fields and acceptance options.
7. Add `docs/deep-simplification-package-5.md` with the final decision table, migrated call sites, test results, and fresh baseline.
8. Run the Package 5 full gate:

   ```bash
   npm run typecheck
   npm run test:unit
   npm run test:integration
   npm run test:e2e
   npm pack --dry-run
   git diff --check
   ```

   Isolate `PI_CODING_AGENT_DIR` and `PI_SUBAGENTS_TEMP_ROOT` for the baseline. Record real Pi E2E as unavailable if the runtime packages are absent.
9. Commit Package 5 separately:

   ```text
   refactor: unify child terminal policy
   ```

Package 5 is complete only when foreground and background contract tests consume the same fixtures and no migrated caller reclassifies the shared result.

## Package 6: consolidate lifecycle visibility

Do not start Package 6 until Package 5 is committed and clean.

1. Identify authoritative fields for live state, terminal result, process proof, workflow receipt, and nested children.
2. Define one bounded read projection for inline output, Fleet, detailed status/transcript, and RPC.
3. Migrate one visibility surface at a time to the projection.
4. Delete renderer-specific repair, duplicate cached job maps, and redundant observer metadata after their final reader moves.
5. Keep one slow, bounded reconciliation path for missed filesystem events.
6. Prove that renderers never write lifecycle truth and that stop, steer, resume, stale-process recovery, and nested workflows still converge.
7. Add `docs/deep-simplification-package-6.md`.
8. Run typecheck and focused lifecycle, reconciliation, Fleet, status, transcript, RPC, render, active-refresh, and idle-scan checks. Run full suites only if focused failures show cross-runner impact.
9. Commit:

   ```text
   refactor: consolidate lifecycle visibility
   ```

## Package 7: reduce public APIs and configuration

Do not start Package 7 until Package 6 is committed and clean.

1. Inventory every package export, configuration key, action, slash command, and RPC seam.
2. Require a named owner, consumer, and contract test for each retained seam.
3. Preserve root delegation, capability ceilings, child-profile resolution, and named external/Surf contracts.
4. Remove aliases and configuration keys for deleted or fixed features. During the support horizon, return one bounded migration diagnostic where compatibility requires it.
5. Keep the 15-action model contract unless a narrower change is demonstrably compatible and explicitly approved.
6. Verify that `npm pack --dry-run` contains no retired implementation module.
7. Add `docs/deep-simplification-package-7.md`.
8. Run typecheck and focused export/import, config load/update/migration, schema, action, slash, RPC, package, security, and baseline checks.
9. Commit:

   ```text
   refactor: reduce public APIs and configuration
   ```

## Package 8: decompose the remaining core

Do not start Package 8 until Package 7 is committed and clean. Delete first; split only the code that remains.

Current large modules include:

| File | Current lines in the partial Package 5 tree |
| --- | ---: |
| `src/runs/foreground/subagent-executor.ts` | 6,262 |
| `src/runs/background/subagent-runner.ts` | 5,606 |
| `src/tui/render.ts` | 3,102 |
| `src/agents/agents.ts` | 2,871 |
| `src/shared/types.ts` | 2,798 |
| `src/runs/foreground/execution.ts` | 2,387 |
| `src/workflows/scripted-workflow.ts` | 2,034 |
| `src/runs/shared/acceptance.ts` | 1,786 |

Use these ownership boundaries:

- extension registration and lifecycle wiring;
- management dispatch;
- workflow host orchestration;
- child launch planning;
- process attempt execution;
- terminal decision;
- durable lifecycle storage;
- rendering.

Reject an extraction that only renames a block or adds a pass-through layer. Shared contracts must not import higher-level agent, workflow, or rendering code. Remove cycles and compatibility aliases exposed by the split. Production lines must remain net-negative.

Add `docs/deep-simplification-package-8.md`, then run the final gate:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm pack --dry-run
git diff --check
```

Also run the isolated baseline, import-cycle scan, largest-module measurement, credential scan, active-refresh measurement, and idle-scan measurement. Commit:

```text
refactor: decompose core orchestration
```

## Required invariants

Stop and return to design if a change would weaken any of these:

- one controlling parent;
- direct execution for one child and `workflowScript` for composition;
- fail-closed acceptance and capability ceilings;
- durable child identity, completion evidence, and recovery proof;
- background visibility and stop/steer/resume behavior;
- bounded timeouts, concurrency, reads, reconciliation, and compatibility;
- passive, write-free treatment of retained legacy artifacts;
- named external API consumers and Surf commitments;
- unchanged Package 0 history and baseline.

## Execution cadence

Do not use another broad agent fleet for this work.

For each package:

1. Use one writer.
2. Run the package checks.
3. Use one focused read-only review.
4. Apply at most one coherent P0/P1 fix pass.
5. Rerun only checks affected by that fix.
6. Commit and continue.

Run full suites only at Package 5 and Package 8, unless a concrete failure requires another full gate. Do not repeat planning scouts, broad review waves, or fresh baseline runs before the package implementation is stable.
