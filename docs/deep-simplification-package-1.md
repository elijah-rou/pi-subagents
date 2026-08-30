# Deep simplification Package 1: primary tool contraction

Status: implemented in the working tree. The owner approved every Package 0 recommendation. `VISION.md` remains the acceptance policy.

## Approved behavior

The model-facing `subagent` action surface is exactly: `list`, `get`, `models`, `children.list`, `guide`, `validate`, `worktree.discard`, `lane.status`, `status`, `debug.run`, `interrupt`, `resume`, `steer`, `stop`, and `doctor`.

The executor retains a separate trusted-host dispatch list containing all 56 pre-Package-1 actions. Internal `append-step` compatibility remains executable only through the executor's internal `execute` entrypoint; model, slash, and RPC normalizers reject it. Public normalization rejects every non-model action. Supported administration is limited to `/subagents`, `/subagents-refine`, `/subagents-watchdog`, the profile slash commands, `/subagents-fleet`, and current RPC schedule management. Slash and RPC hosts use a distinct trusted normalization and executor entrypoint. The root and fanout model tools use only the public entrypoint.

This is a surface contraction, not subsystem removal. Agent authoring uses `/subagents`; refinement uses `/subagents-refine`; watchdog administration uses `/subagents-watchdog`; profile administration uses the existing profile slash commands; Fleet inspection uses `/subagents-fleet`; and existing RPC schedule management remains supported. At Package 1, missions, lane merge/supersession policy, broad cleanup, and optional pane administration had no supported human replacement. Package 2a subsequently removed new mission/goal runtime writes while retaining one-release legacy readers and completion synchronization. Existing RPC spawn requests still pass public execution normalization, so legacy public orchestration shapes remain rejected.

## Schema delta

The primary schema changed from 72 to 47 top-level fields. It removed exactly: `name`, `repo`, `merge`, `supersession`, `additional`, `scope`, `target`, `focus`, `thinking`, `at`, `every`, `on`, `timezone`, `overlap`, `catchUp`, `missionId`, `mission`, `missionUpdate`, `missionStatus`, `missionScope`, `runMode`, `runStatus`, `summary`, `config`, and `share`.

`mode` now accepts only `steer`, `follow_up`, and `auto`. `lane`, `handoffPath`, and `laneId` remain. Stale mission schema helpers and descriptions for removed administration fields were deleted.

The isolated measurement reported 17,037 bytes for the primary schema, down 3,842 bytes (18.4%) from 20,879. The model action count changed from 56 to 15. The internal trusted dispatch count remains 56, plus internal `append-step` compatibility, for 57 recognized executor dispatch actions.

## Preserved contracts

Direct and `workflowScript` execution, acceptance, capability and resource ceilings, child-safe mutation restrictions, lifecycle identity and recovery, background visibility, worktree isolation, and handoff metadata remain unchanged. `worktree.discard` continues through the existing confirmation and path-validation implementation.

## Migration

Models must use only the 15 retained actions. The supported human/RPC interfaces are exactly those named above. Package 2a subsequently removed mission administration and all new mission writes. Lane merge/supersession, broad cleanup, and panes still have no supported replacement pending Package 3. Do not route trusted execution through root or child model tools.

Current tool reference and execution-control skill guidance now distinguish the model surface from trusted temporary administration. Package 0 evidence and the committed baseline were not rewritten.

## Validation and baseline comparison

The baseline harness was written to a temporary file and removed. The committed `docs/deep-simplification-baseline.json` was not overwritten.

| Measure | Package 0 | Package 1 | Delta |
|---|---:|---:|---:|
| Production TypeScript LOC | 93,402 | 93,401 | -1 |
| Primary schema bytes | 20,879 | 17,037 | -3,842 |
| Model actions | 56 | 15 | -41 |
| Trusted internal actions | 56 | 56 | 0 |
| Recognized executor dispatch actions | 57 | 57 | 0 |
| Import/registration p50 | 639.739 ms | 625.492 ms | -14.247 ms |
| Import/registration p95 | 647.295 ms | 636.084 ms | -11.211 ms |
| Empty session start p50 | 2.840 ms | 2.746 ms | -0.094 ms |
| Empty session start p95 | 3.373 ms | 3.538 ms | +0.165 ms |
| Direct preparation p50 | 2.207 ms | 1.989 ms | -0.218 ms |
| Direct preparation p95 | 2.662 ms | 2.576 ms | -0.086 ms |
| One-run refresh p50 | 0.043 ms | 0.039 ms | -0.004 ms |
| One-run refresh p95 | 0.058 ms | 0.051 ms | -0.007 ms |
| Active refresh filesystem calls | 7 | 7 | 0 |
| Idle watcher start | 1 realpath + 1 watch | 1 realpath + 1 watch | 0 |
| Empty healthy scan | 3 readdir / 60 s | 3 readdir / 60 s | 0 |

The fresh isolated run showed lower startup, direct-preparation, and refresh percentiles than Package 0. Empty session-start p95 varied upward by 0.165 ms while its p50 improved. Idle filesystem work remained unchanged. These local timings are regression anchors, not service-level objectives.

Validation passed TypeScript typecheck and `npm run test:all`: 2,789 unit tests passed with 5 skipped, and 899 integration tests passed with 6 skipped. The real Pi-session E2E suite registered no tests because the Pi runtime packages were unavailable. Focused tests additionally cover every model-readable guide topic, schema shape, public/trusted normalization, trusted slash administration, RPC schedule administration and public spawn rejection, model descriptions, and root/child registration.
