# Deep simplification Package 2b: schedules

Status: implemented in the working tree after `6fa33e6b`. `VISION.md` remains the acceptance policy.

## Writers and execution stopped

Core no longer creates, updates, pauses, resumes, runs, polls, or deletes schedules. It does not restore a schedule manager at startup, arm schedule timers, launch scheduled workflows, attach schedule origin to new runs, observe async completions into schedule history, retain async artifacts through schedule history, or expose schedules through `/subagents-stop`. Direct children, ordinary async execution and recovery, `workflowScript`, results, wait, stop, steer, interrupt, and resume retain their existing paths.

## One-release passive compatibility

Trusted RPC `manage` retains exactly `schedule.list`, `schedule.show`, and `schedule.history` through a dedicated dispatch seam. The general trusted-host executor, model/public execution, fanout, and slash normalization reject every schedule action.

`src/runs/background/scheduled-runs.ts` is now a passive compatibility reader. It selects the same default project path or configured project-keyed `storeRoot`, reads only on request, and performs no writes, directory creation, timer registration, launch, repair, or pointer healing. File reads use bounded descriptors with no-follow where supported, regular-file and inode validation before/after reading, and at most the configured byte bound plus one byte. Directory iteration stops after 256 candidates. Responses return at most 100 definitions or history entries and cap aggregate text and detail bytes. Unknown, corrupt, symlinked, raced, and oversized records remain untouched. The readers may be removed no earlier than after one published Package 2b release.

`scheduledRuns.storeRoot` remains effective only for lookup. `scheduledRuns.enabled`, `scheduledRuns.maxPending`, and `authorityPolicy.scheduleCreate` are accepted but inert for configuration compatibility. Historical `ScheduleOrigin` parsing/rendering remains for old status, result, and notification artifacts; no launch request type accepts it.

## Recovery proof

New runs recover only from ordinary async lifecycle state: status and events, result files and indexes, process-terminal proof, workflow receipts and child summaries, completion replay, wait subscriptions, and native stop/steer/resume controls. Schedule definitions and history neither trigger recovery nor protect retention.

## RED/GREEN evidence

RED: the initial passive-reader suite failed on missing reader exports. Review follow-up RED then failed six cases: trusted actions still contained three schedule reads, trusted normalization still accepted them, RPC lacked a dedicated reader seam, schedule symlinks were followed, directory scans were unbounded, and slash requests still reached trusted execution.

GREEN: TypeScript passed. Unit passed 2,741 with 5 skipped in 36.271 seconds; integration passed 887 with 6 skipped in 84.648 seconds; E2E registered no tests in 0.714 seconds because Pi runtime packages were unavailable. Focused schedule/RPC/slash tests passed 51 cases; focused result-watcher/slash integration passed 79 cases. Tests cover no-follow static reads, replacement races, unknown/corrupt preservation, candidate and aggregate bounds, absent-directory non-creation, mutator rejection, RPC-only dispatch, action counts, slash behavior, historical origin rendering, and ordinary async integration.

## Package 2a baseline delta

The final baseline was written to `/tmp/package-2b-review-baseline.json`; the committed Package 0 baseline was not changed.

| Measure | Package 2a follow-up | Package 2b | Delta |
|---|---:|---:|---:|
| Production TypeScript LOC | 92,157 | 91,401 | -756 |
| Production TypeScript files | 252 | 252 | 0 |
| Trusted internal actions | 49 | 40 | -9 |
| Recognized executor actions | 50 | 41 | -9 |
| Import/registration p50 | 619.359 ms | 589.799 ms | -29.560 ms |
| Import/registration p95 | 662.071 ms | 601.938 ms | -60.133 ms |
| Empty session start p50 | 2.756 ms | 2.482 ms | -0.274 ms |
| Empty session start p95 | 2.892 ms | 2.576 ms | -0.316 ms |
| Direct preparation p50 | 1.942 ms | 1.965 ms | +0.023 ms |
| Direct preparation p95 | 2.511 ms | 2.587 ms | +0.076 ms |
| One-run refresh p50 | 0.040 ms | 0.039 ms | -0.001 ms |
| One-run refresh p95 | 0.054 ms | 0.051 ms | -0.003 ms |
| Active refresh filesystem calls | 7 | 7 | 0 |
| Idle watcher start | 1 realpath + 1 watch | 1 realpath + 1 watch | 0 |
| Empty healthy scan | 3 readdir / 60 s | 3 readdir / 60 s | 0 |

Local timing variation is not an SLO. Production code is materially net-negative and no schedule execution path remains.
