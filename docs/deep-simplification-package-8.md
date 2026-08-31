# Deep simplification Package 8

Status: finalized in the working tree after `135a16bd` following one major review.

## Direction and boundaries

The review exposed three viable paths:

1. Accept cycle removal alone. Rejected because the retired composite engines remained in production after their input boundaries had become unconditional failures.
2. Preserve the rejection boundaries, narrow execution to direct single-child shapes, and delete the unreachable foreground chain/parallel and detached chain/parallel/dynamic engines. Chosen because it is the smallest VISION-aligned correction: it removes uncallable orchestration without changing workflow, lifecycle, persistence, or external-runner contracts.
3. Rewrite the foreground and detached runners around new interfaces. Rejected because it would widen lifecycle and persistence risk without a retained product invariant requiring it.

The final implementation establishes these ownership boundaries:

- `src/shared/core-contracts.ts` owns dependency-free contracts used to break import cycles.
- `src/agents/agent-contract.ts` owns resolved agent and passive legacy-chain definition shapes.
- `src/agents/project-root.ts` owns project-root candidate discovery.
- `src/shared/config-paths.ts` owns Pi user/project configuration path resolution.
- `src/shared/path-resolution.ts` owns child cwd resolution.
- `src/shared/workflow-child-permit-contract.ts` owns the opaque workflow child permit shape.
- `src/workflows/scripted-workflow.ts` remains the composite workflow host.
- `src/runs/foreground/subagent-executor.ts` now dispatches management, workflow hosting, or one direct child after rejecting retired composite fields.
- `src/runs/background/subagent-runner.ts` decodes exactly one direct step and contains no chain, parallel-group, or dynamic-fanout planner/executor.

## Deletions and extractions

- Deleted foreground task/chain canonicalization, validation, spawn accounting, fork preparation, and execution dispatch after the unconditional legacy-composite rejection.
- Added a direct execution shape immediately after the foreground rejection and management boundaries.
- Deleted detached parallel and dynamic status planning and execution. Runner configuration remains a tuple containing exactly one non-group step.
- Deleted inactive mission result fields from the shared tool-result shape.
- Moved foundational contracts and path resolution below feature code, eliminating the prior 24-module strongly connected component.
- Preserved `workflowScript` sequential, parallel, dynamic, resume, and host-gate behavior. Workflow composition continues through direct child launches rather than the retired engines.

No Package 7 configuration alias changed. `globalConcurrencyLimit`, `chain.dynamicFanout.maxItems`, and passive `scheduledRuns` retain their one-published-release behavior. Package 2b schedule readers and passive artifact horizons remain intact.

## Import-cycle evidence

The initial production TypeScript graph contained one strongly connected component spanning 24 modules. The final scan parses every production TypeScript import, resolves relative edges including type-only imports, and runs Tarjan strongly connected components.

Result: **0 production import cycles across 227 production TypeScript files**.

## Largest modules and measurements

| File | Package 7 | Package 8 | Change |
| --- | ---: | ---: | ---: |
| `src/runs/foreground/subagent-executor.ts` | 6,271 | 5,905 | -366 |
| `src/runs/background/subagent-runner.ts` | 5,620 | 4,415 | -1,205 |
| `src/tui/render.ts` | 3,102 | 3,102 | 0 |
| `src/shared/types.ts` | 2,789 | 2,801 | +12 |
| `src/agents/agents.ts` | 2,871 | 2,673 | -198 |
| `src/runs/foreground/execution.ts` | 2,387 | 2,388 | +1 |
| `src/workflows/scripted-workflow.ts` | 2,034 | 2,034 | 0 |
| `src/runs/shared/acceptance.ts` | 1,786 | 1,777 | -9 |

Production TypeScript moved from 221 files / 80,985 lines to 227 files / 79,377 lines: six ownership modules added and **1,608 net production lines deleted**. The complete diff is also net-negative by 1,776 lines (1,205 additions / 2,981 deletions).

The foreground executor has 97 import declarations, down from 98 at review. The detached runner has 70, down from 72, with composite planner domains removed. These files remain large because they retain direct lifecycle, visibility, persistence, control, and external-runner policy; further interface rewrites were intentionally excluded from this correction.

The isolated final pre-integration baseline measured extension import/registration p50 at 612.940 ms, direct launch preparation p50 at 1.790 ms, and active refresh p50 at 0.038 ms. Active refresh retained the same seven filesystem calls. Idle scanning retained the 60,000 ms healthy interval and three `readdirSync` calls per empty scan.

The final pre-integration pass records 7 package exports, 15 model actions, 25 trusted/recognized actions, 12 slash commands, 44 configuration fields, and 18,526 combined schema bytes. The two added config fields restore promised inert one-release compatibility for `missions` and `orcaProgressTabs`; `fleetKeybindings.inspect` remains nested under its existing top-level field.

## Validation

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed, exit 0 |
| `npm run test:unit` | passed: 2,566 passed, 4 skipped, exit 0 |
| `npm run test:integration` | passed: 800 passed, 6 skipped, exit 0 |
| `npm run test:e2e` | exit 0; real Pi-session E2E unavailable because Pi runtime packages are absent |
| `npm pack --dry-run --json` | passed: 284 files; package contents inspected; exit 0 |
| `git diff --check` | passed, exit 0 |
| isolated `npm run audit:baseline` | passed, exit 0 |
| production TypeScript Tarjan import-cycle scan | 0 cycles across 227 files, exit 0 |
| credential-pattern scan over the diff | no credential patterns, exit 0 |

## Residual risks

- `src/shared/core-contracts.ts` remains a broad dependency leaf. Splitting it into domain-specific leaf contracts and removing owning-module re-export aliases is the review's P2 follow-up, not part of this P1 correction.
- The foreground executor and detached runner remain large. Their retired composite engines are gone, but further extraction would require a separately reviewed lifecycle/interface change rather than block this bounded deletion.
- Real Pi-session E2E could not run in this checkout because the Pi runtime packages are unavailable; deterministic unit and integration coverage exercised direct, async, and scripted workflow paths.
