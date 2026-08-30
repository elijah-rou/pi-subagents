# Deep simplification Package 2a: missions and goals

Status: implemented and follow-up reviewed in the working tree. `VISION.md` remains the acceptance policy.

## Writers stopped

Direct, foreground workflow, async workflow, scheduled workflow, and workflow-child launches do not create or update mission records, `mission.json` bindings, global mission indexes, mission details/content, workflow-child mission ledgers, or goal notices. Mission actions are absent from trusted dispatch and the executor. Removed mission request fields fail public and trusted normalization.

`runs.state.get/set` is workflow-owned. Async state is the unique `workflow-state.json` file in that workflow's async lifecycle directory. Foreground state is a unique `.workflow-state-<uuid>.json` file directly in the existing workflow artifact root. Artifact-enabled files follow normal artifact cleanup. `artifacts:false` removes foreground state at settlement. State retains safe 128-character keys, JSON-only values, a 256 KiB file bound, mode-0600 atomic writes, cross-process locking, and stale/PID-reuse/competing-lock recovery.

## One-release compatibility

`src/missions/store.ts` now contains only location/config validation plus passive schema-v1 parsing, reading, and listing. It has no create/update/prune/global-index writer. `src/missions/lifecycle.ts` reads existing bindings and exposes one narrowly named compatibility writer, `mergeLegacyMissionCompletion`. That writer runs only when an async directory already contains `mission.json` and the referenced schema-v1 record already exists. Under the record lock it validates the known schema, merges completion fields, preserves unknown top-level and nested data, and never creates a record, binding, or index.

Corrupt records and bindings remain untouched. Existing status/Fleet display, mission observer result aliases, and retention references remain so pre-Package-2a results are not lost. The deprecated `missions` config remains only to locate old records. This compatibility seam may be removed no earlier than after one published release containing Package 2a.

## Authoritative recovery

New runs recover from async `status.json`, `events.jsonl`, result files/indexes, process-terminal proof, workflow receipts, workflow-child summaries, wait subscriptions, and native stop/steer/resume controls. Package 2a did not change acceptance, identity, capability/resource ceilings, visibility, schedules, or ordinary retention. Package 2b subsequently removed schedule execution and schedule-based retention.

## Follow-up RED-GREEN evidence

Follow-up tests were restored or added before fixes:

- Legacy completion preservation failed because the generic mission updater dropped unknown top-level data.
- Follow-up matching-run compatibility failed because updating token usage replaced the existing usage object and dropped its unknown nested fields.
- Workflow state ownership tests failed all three cases: the API appended a directory component, cross-process writers produced a directory instead of the owned file, and stale locks were left at the requested path.
- Follow-up path validation failed because filesystem roots passed the tautological basename check.
- Follow-up async settlement failed because terminal workflows retained `workflow-state.json` after status, result, receipt, and event persistence completed. A second RED case showed the same leak when a paused workflow later settled through detached-child reconciliation.
- Guide consistency failed on the shipped claim that workflows may create an enclosing mission.
- The full unit suite reproduced the packaged-worker failure: ambient user settings changed `defaultContext` from `fork` to `fresh`. The test now isolates `PI_CODING_AGENT_DIR` before asserting packaged defaults.
- Legacy result-watcher synchronization initially failed to retain child output artifacts after the narrow completion merge replaced the generic updater.

GREEN evidence:

- TypeScript typecheck passed.
- Unit: 2,766 passed, 5 skipped, 0 failed, 2,771 total.
- Integration: 898 passed, 6 skipped, 0 failed, 904 total.
- Restored `workflow-chat-progress`: all 14 non-mission policy/rendering/intercom/acceptance/terminal-visibility cases pass.
- E2E command passed with zero registered tests; exact reason: `pi runtime packages not available`.
- Baseline was written only to `/tmp/package-2a-followup-baseline.json`. Package 0 baseline was not modified.
- `git diff --check`, source writer searches, and credential-pattern checks passed.

## Package 1 comparison

| Measure | Package 1 | Package 2a follow-up | Delta |
|---|---:|---:|---:|
| Production TypeScript LOC | 93,401 | 92,157 | -1,244 |
| Production TypeScript files | 254 | 252 | -2 |
| Primary schema bytes | 17,037 | 17,037 | 0 |
| Model actions | 15 | 15 | 0 |
| Trusted internal actions | 56 | 49 | -7 |
| Recognized executor actions | 57 | 50 | -7 |
| Import/registration p50 | 625.492 ms | 619.359 ms | -6.133 ms |
| Import/registration p95 | 636.084 ms | 662.071 ms | +25.987 ms |
| Empty session start p50 | 2.746 ms | 2.756 ms | +0.010 ms |
| Empty session start p95 | 3.538 ms | 2.892 ms | -0.646 ms |
| Direct preparation p50 | 1.989 ms | 1.942 ms | -0.047 ms |
| Direct preparation p95 | 2.576 ms | 2.511 ms | -0.065 ms |
| One-run refresh p50 | 0.039 ms | 0.040 ms | +0.001 ms |
| One-run refresh p95 | 0.051 ms | 0.054 ms | +0.003 ms |
| Active refresh filesystem calls | 7 | 7 | 0 |
| Idle watcher start | 1 realpath + 1 watch | 1 realpath + 1 watch | 0 |
| Empty healthy scan | 3 readdir / 60 s | 3 readdir / 60 s | 0 |

Local timing variation is not an SLO. Production code remains materially net-negative while schedules were still intact; Package 2b subsequently removed them from execution.
