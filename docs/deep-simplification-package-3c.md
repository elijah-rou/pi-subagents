# Deep simplification Package 3c: Herdr removal

Status: implemented in the working tree at source commit `05a7055b`. `VISION.md` remains the acceptance policy.

Package 3c removes the full Herdr integration from core. The extension no longer launches inspector or project panes, executes a Herdr binary, publishes pane metadata or events, restores or closes panes, exposes the six `inspector.*` and `project.*` trusted actions, or shows pane rows and controls in Fleet. Canonical Fleet, status, transcript, control, recovery, result, and process-terminal lifecycles remain. Native stop, steer, and resume remain available. No retired pane event or field is authority.

## One-release passive compatibility

For one published Package 3c release, old async inspector binding JSON, project-pane bindings and root indexes, Herdr metadata, environment variables, and legacy session-root payloads are unknown inert artifacts or inputs. Core does not read, write, heal, delete, or migrate them. Existing `fleetKeybindings.inspect` arrays remain validated and survive unrelated config updates with their value structure unchanged, but runtime key resolution ignores them. Unknown Herdr fields in old status objects and events are ignored by recovery. Existing mission compatibility is unchanged. Users may remove old artifacts manually after confirming they are no longer needed. This horizon may be removed after one Package 3c release has been published.

## RED and GREEN evidence

RED coverage targeted the six retired trusted actions, startup and shutdown under retired environment variables, old binding and index preservation, old status and event fields, ordinary Fleet rows and controls, and the retired Fleet keybinding compatibility field. The follow-up RED run had 56 passes and 2 failures: config rejected `fleetKeybindings.inspect`, while the Fleet inertness assertion needed to distinguish the ordinary inspector title from an action invocation. GREEN accepts, validates, and preserves that field without adding it to runtime key resolution. All six trusted actions remain absent and rejected, startup and shutdown never invoke `pi.exec`, old artifacts remain byte-for-byte unchanged, old fields cannot override canonical terminal state, and Fleet still renders and controls ordinary work.

GREEN on Node v25.9.0, Linux x64:

- `npm run typecheck`: passed.
- Unit: 2,568 passed, 4 skipped, 0 failed in 28.052 seconds.
- Integration: 874 passed, 6 skipped, 0 failed in 87.585 seconds.
- E2E completed in 0.918 seconds; the real Pi-session case was unavailable because Pi runtime packages were not installed, so zero tests ran.
- `npm pack --dry-run`: passed; 276 files.
- `git diff --check`, credential-pattern scan, and dead production coupling scan passed.

The fresh baseline is `/tmp/package3c-p1-baseline.json`. Model actions remain 15. Trusted actions fall from 36 to 30, and recognized dispatch actions fall from 37 to 31 including internal `append-step`. Combined root schema size remains 18,519 bytes.

## Package 3b baseline delta

| Measure | Package 3b | Package 3c | Delta |
|---|---:|---:|---:|
| Production TypeScript files | 234 | 226 | -8 |
| Production TypeScript LOC | 85,988 | 84,041 | -1,947 |
| Model actions | 15 | 15 | 0 |
| Trusted internal actions | 36 | 30 | -6 |
| Recognized executor actions | 37 | 31 | -6 |
| Combined root tool schema bytes | 18,519 | 18,519 | 0 |
| Import/registration p50 | 614.961 ms | 588.351 ms | -26.610 ms |
| Import/registration p95 | 651.569 ms | 618.622 ms | -32.947 ms |
| Empty session start p50 | 2.533 ms | 2.220 ms | -0.313 ms |
| Empty session start p95 | 2.605 ms | 2.422 ms | -0.183 ms |
| Session shutdown p50 | not recorded | 0.490 ms | n/a |
| Session shutdown p95 | not recorded | 0.496 ms | n/a |
| Direct preparation p50 | 2.014 ms | 1.958 ms | -0.056 ms |
| Direct preparation p95 | 2.661 ms | 2.618 ms | -0.043 ms |
| One-run refresh p50 | 0.039 ms | 0.039 ms | 0 |
| One-run refresh p95 | 0.071 ms | 0.055 ms | -0.016 ms |
| Active refresh filesystem calls | 7 | 7 | 0 |
| Idle watcher start | 1 realpath + 1 watch | 1 realpath + 1 watch | 0 |
| Empty healthy scan | 3 readdir / 60 s | 3 readdir / 60 s | 0 |

The production diff is 22 insertions and 1,969 deletions, net -1,947. Timing variation is not an SLO. Package 3c materially reduces production while preserving the core delegation, visibility, control, evidence, and recovery paths. The committed Package 0 historical report and baseline remain unchanged.
