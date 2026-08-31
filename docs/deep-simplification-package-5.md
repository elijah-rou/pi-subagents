# Deep simplification Package 5: unified child terminal policy

Status: complete.

## Decision contract

`src/runs/shared/terminal-decision.ts` is the single pure policy seam. It accepts only execution facts, acceptance facts, effect evidence, and lifecycle flags. It does not drive processes, read or write files, persist records, or render output.

| Precedence | Facts | Public status | Success | Diagnostic rule |
| ---: | --- | --- | --- | --- |
| 1 | detached | `detached` | false | Preserve detach classification. |
| 2 | stopped | `stopped` | false | Preserve stop classification and use a nonzero public exit code. |
| 3 | timed out | `failed` | false | Timeout wins over interrupt and uses a nonzero public exit code. |
| 4 | interrupted | `paused` | false | Preserve pause classification. |
| 5 | execution error or nonzero exit | `failed` | false | Keep the execution diagnostic primary. |
| 6 | required acceptance rejected or incomplete | `failed` | false | Fail closed; append the acceptance diagnostic only after successful execution. |
| 7 | required mutation/output missing or blocked | `failed` | false | Fail closed; append the effect diagnostic only after successful execution. |
| 8 | successful execution and no required policy failure | `completed` | true | No failure diagnostic. |

Acceptance configured with `onFailure: "warn"` remains non-blocking. The policy still reports its acceptance outcome as rejected. Missing or blocked mutation evidence blocks only when mutation or required output was expected.

The shared fixture table proves combined precedence, not only isolated states: detach includes stop, timeout, and interrupt facts; stop includes timeout and interrupt facts; timeout includes interrupt. It also proves execution-failure diagnostic precedence, rejected and pending acceptance failures, missing and blocked effects, warning acceptance, and repeat settlement of a rejected result. A non-mutating `SingleResult` adapter preserves `onFailure: "warn"` as non-blocking before every projection; focused regressions exercise foreground nested status and detached result reconstruction.

## Migrated call sites

- Foreground direct settlement: `src/runs/foreground/execution.ts` through `settleChildResult`.
- Background direct settlement: `runSingleStepInner` in `src/runs/background/subagent-runner.ts`.
- `runs.run`, `runs.all`, static parallel, and dynamic children: shared child and group decisions in `src/runs/background/subagent-runner.ts`.
- Foreground nested status, workflow graph projection, detached workflow settlement, detached result reconstruction, and worktree handoff status now consume the same terminal policy.
- AgentContract execution/review/effect projections are attached after the shared decision. Execution remains a projection of process execution, while public success also includes required acceptance and effects.
- Prompt-template and intercom adapters consume the already-settled public exit/status instead of independently overriding acceptance failures.

The replaced foreground acceptance exit-code branch, background acceptance branches, chain/parallel/dynamic `gateOn` settlement branches, and adapter acceptance overrides were deleted. The `gateOn` schema and types remain intact for Package 7 compatibility review; callers cannot use the field to override a failed Package 5 terminal decision.

## Shared contract fixtures

`test/fixtures/terminal-decision-cases.ts` is imported by:

- `test/unit/terminal-decision.test.ts`, which exercises the pure policy table, mutation adapter, and actual warning-policy projection callers;
- `test/integration/single-execution.test.ts`, covering foreground direct plus `runs.run`, `runs.all`, and dynamic construction;
- `test/integration/async-execution.test.ts`, covering background direct settlement.

## Fresh baseline

Isolated command:

```bash
PI_CODING_AGENT_DIR="$(mktemp -d)" PI_SUBAGENTS_TEMP_ROOT="$(mktemp -d)" npm run audit:baseline
```

Compared with the Package 4 baseline:

| Measure | Package 4 | Package 5 |
| --- | ---: | ---: |
| Production TypeScript files | 224 | 225 |
| Production TypeScript LOC | 80,812 | 80,958 |
| Combined schema bytes | 18,519 | 18,519 |
| Model actions | 15 | 15 |
| Trusted/recognized executor actions | 27 | 27 |
| Extension configuration keys | 42 | 42 |

Package 5 adds one policy module while deleting distributed policy branches. Public schema, actions, exports, and configuration remain unchanged. The final isolated baseline measured extension import and registration at 1,684.075 ms mean, direct launch preparation at 2.381 ms mean, active refresh at 0.059 ms mean, and the unchanged 60,000 ms healthy idle scan interval.

## Validation

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed, exit 0 |
| `npm run test:unit` | passed after review fix: 2,563 passed, 4 skipped, exit 0 |
| `npm run test:integration` | passed after review fix: 801 passed, 6 skipped, exit 0 |
| `npm run test:e2e` | exit 0; real Pi-session E2E unavailable because Pi runtime packages are absent |
| `npm pack --dry-run` | passed, 279 files, 1.1 MB packed / 4.4 MB unpacked, exit 0 |
| `git diff --check` | passed, exit 0 |
| `node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/terminal-decision.test.ts` | passed after review fix: 26 passed, exit 0 |
| `PI_CODING_AGENT_DIR="$(mktemp -d)" PI_SUBAGENTS_TEMP_ROOT="$(mktemp -d)" npm run audit:baseline` | passed after review fix, exit 0 |
