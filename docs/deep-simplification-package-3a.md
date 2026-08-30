# Deep simplification Package 3a: watchdog removal

Status: implemented in the working tree. `VISION.md` remains the acceptance policy.

Package 3a removes the optional main and child model-review watchdog from core. Core no longer registers watchdog startup, turn, tool, or `agent_end` hooks; launches reviewer children automatically; runs the watchdog LSP review loop; selects watchdog models; writes watchdog settings or permission audit logs; exposes `/subagents-watchdog`; or recognizes the four `watchdog.*` actions. The model action surface remains 15 actions. Trusted hosts expose 36 actions, while the executor recognizes 37 including its internal append-step compatibility seam.

Explicit reviewer agents and `workflowScript` review fanout remain the supported review mechanism. Acceptance review gates, completion guards, execution and tool timeouts, checkpoints, child attention and control, ordinary diagnostics outside the removed review loop, visibility and recovery, and capability ceilings are unchanged.

## Permission authority

Native child `allow` and `deny` rules retain their ordinary behavior. An explicit `ask` rule always fails closed before tool execution with this deterministic guidance: the tool requires approval, delegated child approval is unavailable, and the operator must change the rule to `allow` or `deny`. Missing, malformed, cancelled, or delayed former arbiter state cannot approve a call. No model permission arbiter, permission request preview, permission audit environment variable, or permission audit writer remains. Capability ceilings still bound the available tools independently.

## One-release passive compatibility

For one published release beginning with Package 3a:

- Existing `subagents.watchdog` user or project settings are inert. No key can activate behavior. No current path creates or mutates watchdog settings; an unrelated settings or profile rewrite may preserve the unknown subtree unchanged.
- Old result and status objects may contain a `watchdog` property. Readers ignore it and do not project it into current status.
- Old `subagent.watchdog.status` JSONL events parse as unknown diagnostic events and never delay finalization, block completion, revive work, warn, or change an outcome.
- Old `subagent_watchdog_warning` transcript messages are ignored when inherited by a child.
- `PI_SUBAGENT_WATCHDOG_CHILD_CONFIG` is ignored and is never emitted by current launch code.

These allowances may be removed after one Package 3a release has been published. Existing audit files and repository `WATCHDOG.md` files remain untouched as user artifacts. `docs/watchdog.md` is now only a removal and migration stub.

## RED and GREEN evidence

RED: the new permission authority test initially failed because an `ask` rule still returned the former built-in watchdog-arbiter denial. Expected was the deterministic neutral fail-closed message directing the operator to choose `allow` or `deny`; actual was `Watchdog permission arbiter is unavailable because the child watchdog is disabled.` The implementation then removed the arbiter and made the neutral child permission gate deny directly. Static pre-Package-3a foreground and async event fixtures are compatibility characterization tests; the async test required no further production change because event handling was already inert after removal.

GREEN on Node v25.9.0, Linux x64:

- `npm run typecheck`: passed.
- Unit: 2,624 passed, 5 skipped, 0 failed in 36.617 seconds.
- Integration: 875 passed, 6 skipped, 0 failed in 80.743 seconds. This includes static foreground and async pre-Package-3a event finalization coverage.
- E2E: command completed in 0.291 seconds; the real Pi-session case was unavailable because Pi runtime packages were not installed, so zero tests ran.
- `npm pack --dry-run`: passed; 284 files, 1.1 MB packed, 4.6 MB unpacked.
- `git diff --check`, hardcoded-secret scan, removed permission audit writer/environment scan, and dead watchdog coupling scan passed.

The fresh baseline is `/tmp/package-3a-review-baseline.json`. The committed Package 0 baseline and Package 0 historical report were not modified.

## Package 2b baseline delta

| Measure | Package 2b review | Package 3a | Delta |
|---|---:|---:|---:|
| Production TypeScript files | 252 | 235 | -17 |
| Production TypeScript LOC | 91,401 | 86,563 | -4,838 |
| Model actions | 15 | 15 | 0 |
| Trusted internal actions | 40 | 36 | -4 |
| Recognized executor actions | 41 | 37 | -4 |
| Combined root tool schema bytes | 18,519 | 18,519 | 0 |
| Import/registration p50 | 589.799 ms | 612.270 ms | +22.471 ms |
| Import/registration p95 | 601.938 ms | 636.953 ms | +35.015 ms |
| Empty session start p50 | 2.482 ms | 2.458 ms | -0.024 ms |
| Empty session start p95 | 2.576 ms | 3.032 ms | +0.456 ms |
| Direct preparation p50 | 1.965 ms | 1.973 ms | +0.008 ms |
| Direct preparation p95 | 2.587 ms | 2.705 ms | +0.118 ms |
| One-run refresh p50 | 0.039 ms | 0.039 ms | 0 |
| One-run refresh p95 | 0.051 ms | 0.053 ms | +0.002 ms |
| Active refresh filesystem calls | 7 | 7 | 0 |
| Idle watcher start | 1 realpath + 1 watch | 1 realpath + 1 watch | 0 |
| Empty healthy scan | 3 readdir / 60 s | 3 readdir / 60 s | 0 |

The full working-tree diff is 151 insertions and 8,904 deletions, net -8,753. Production TypeScript is 18 insertions and 4,856 deletions, net -4,838. Local timing variation is not an SLO; Package 3a materially reduces production while preserving the core delegation paths.
