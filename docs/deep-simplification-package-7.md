# Deep simplification Package 7

Status: implemented in the working tree after `30d94818`. Package 6 was committed and the checkout was clean before this package began.

## Ownership ledger

### Package exports

| Export | Owner | Named consumer | Contract test |
| --- | --- | --- | --- |
| `.` | root extension registration and delegation | Pi extension host | `package-manifest.test.ts`, `index-child-registration.test.ts` |
| `delegation` | structured extension delegation | prompt-template bridge | `delegation-api.test.ts`, `slash-bridge.test.ts` |
| `capability-ceiling` | authority restriction | parent policy extensions | `capability-ceiling.test.ts` |
| `child-profile-resolver` | model/thinking selection | cooperating parent extensions | `child-profile-resolver.test.ts` |
| `preflight` | side-effect-free launch resolution | launch-policy extensions | `preflight-api.test.ts` |
| `control-channel` | durable async stop requests | host control integrations | `control-channel.test.ts`, RPC tests |
| `external-job-provider` | honest external-job execution | Surf `surf-oracle` | `external-job-provider.test.ts`, external-job runner tests |

`agents`, `background-work`, `external-runs`, `intercom-bridge`, `pi-args`, and `shared-types` had no named production consumer. Their package subpaths and API wrappers are removed. Runtime-owned background-work and external-run projections moved below private implementation namespaces; this preserves core wait/Fleet behavior without publishing those registries.

### Model actions

The compatible 15-action model contract is unchanged. Root delegation owns `list`, `get`, `models`, `children.list`, `guide`, `validate`, `worktree.discard`, `lane.status`, `status`, `debug.run`, `interrupt`, `resume`, `steer`, `stop`, and `doctor`. The model is the consumer. `public-execution.test.ts`, `schemas.test.ts`, and focused action tests cover validation and dispatch.

Trusted host administration additionally owns `create`, `update`, `delete`, `eject`, `disable`, `enable`, `reset`, `worktree.cleanup`, `grant-spawn-budget`, and `dismiss`. These compose agent administration, bounded cleanup, resource grants, and recovered-workflow disposal for operator/host consumers. Together with the 15 model actions they form the 25 trusted actions covered by agent-management, worktree, authority, lifecycle, and public-execution tests. `lane.recordMerge` and `lane.recordSupersession` are retired and fail trusted normalization. There is no internal compatibility action.

### Slash commands

| Commands | Owner and consumer | Contract test |
| --- | --- | --- |
| `/run`, `/prompt-workflow` | operator workflow launch | `slash-bridge.test.ts`, prompt-workflow tests |
| `/subagents`, `/subagents-models` | operator agent discovery/administration | slash and agent-management tests |
| `/subagent-cost`, `/subagents-doctor`, `/subagents-guide` | operator diagnostics | cost, doctor, and guide tests |
| `/subagents-fleet`, `/subagents-inspect-rpc` | operator/host visibility | Fleet and inspect-RPC tests |
| `/subagents-detach`, `/subagents-stop`, `/subagents-steer` | operator lifecycle control | foreground-control, stop, and steering tests |

All 12 commands change retained behavior. No retired mission, schedule, observer, profile, refinement, or watchdog command remains.

### RPC

The root extension owns the versioned in-process RPC seam for Pi host integrations. `ping`, `status`, `spawn`, `steer`, `interrupt`, `stop`, and `resume` are retained and covered by `rpc.test.ts`; lifecycle projection is also covered by the Package 6 snapshot tests. RPC `manage` retains only bounded, read-only `schedule.list`, `schedule.show`, and `schedule.history` until the already committed one-published-release Package 2b horizon ends. `/subagents-inspect-rpc` remains the non-TUI correlated inspection response seam and is covered by `inspect-rpc.test.ts`.

### Configuration

Every retained key has a runtime owner and operator consumer:

| Owner | Keys | Focused contract tests |
| --- | --- | --- |
| launch/context | `asyncByDefault`, `defaultSubagentContext`, `forkContext`, `forceTopLevelAsync`, `defaultSessionDir`, `singleRunOutputBaseDir`, `timeoutMs`, `toolTimeoutMs` | config-dir, execution, fork, timeout tests |
| workflow/resource bounds | `perRunConcurrencyLimit`, `workflowDynamicFanoutMaxItems`, `maxSubagentDepth`, `maxSubagentSpawnsPerSession`, `maxSubagentSpawnsPerRun`, `maxActiveAsyncRunsPerSession`, `capacity`, `toolBudget`, `usageBudget`, `waitTool` | config-dir, workflow, fanout-budget, capacity, wait tests |
| visibility | `fleetView`, `fleetViewPlacement`, `fleetKeybindings`, `asyncWidget`, `inlineToolDisplay`, `mainWindowRenderer`, `resultScanLogging`, `completionBatch`, `foregroundDetachShortcut` | Fleet, renderer, watcher, completion, config-dir tests |
| authority and child runtime | `authorityPolicy`, `permissions`, `control`, `intercomBridge`, `proactiveSkillSubagents`, `toolDescriptionMode` | authority, permissions, control, bridge, schema tests |
| storage and isolation | `artifactDir`, `artifactConfig`, `worktreeBaseDir`, `worktreeSetupHook`, `worktreeSetupHookTimeoutMs` | artifact, worktree, config-dir tests |
| passive artifact compatibility | `missions`, `orcaProgressTabs`, `scheduledRuns.enabled`, `scheduledRuns.maxPending`, `scheduledRuns.storeRoot` | Package 2a/2b/3b one-release compatibility and legacy record locations | config-dir, mission compatibility, scheduled-run, and scheduled-store-root tests |
| model failure policy | `modelExclusions` | config-dir and model-exclusion tests |

`globalConcurrencyLimit` and `chain.dynamicFanout.maxItems` are read-only aliases for one published release. They normalize to `perRunConcurrencyLimit` and `workflowDynamicFanoutMaxItems`, emit one bounded migration warning per load, reject conflicting old/new values, and are never written back. The canonical spellings name the actual scope directly; a nested `workflow.dynamicFanout` object was rejected because it adds a pass-through layer for one bound.

`missions`, `orcaProgressTabs`, and `fleetKeybindings.inspect` remain one-release compatibility fields. `missions` is validated only by the legacy mission-store location contract; `orcaProgressTabs` accepts any JSON shape inertly; `fleetKeybindings.inspect` requires a non-empty string array and is ignored by runtime key resolution. All survive unrelated config updates and none can reactivate retired behavior or writers. `parallel` remains a bounded migration error. Package 2b's promised horizon still accepts and preserves `scheduledRuns.enabled` and `scheduledRuns.maxPending` inertly; `scheduledRuns.storeRoot` remains lookup-only. None can reactivate schedule execution or writers.

## Review disposition

For Package 2b config, the viable choices were immediate rejection or inert acceptance through the promised horizon. Inert acceptance preserves the published compatibility invariant without restoring schedule execution, writers, or retention, so Package 7 keeps all three `scheduledRuns` fields until that horizon ends. For retained internal tests, recreating the removed `agents` wrapper would widen the approved seven-export disposition; importing the owning private runtime-agent modules preserves the tested behavior without restoring a public seam. The review's registry-projection P2 is intentionally deferred because this fix pass is limited to accepted P0/P1 findings.

## Migrations

- Import retained contracts from the seven exports above. Consumers of a removed subpath must move to a retained versioned contract or own their registry privately.
- Replace `globalConcurrencyLimit` with `perRunConcurrencyLimit`.
- Replace `chain.dynamicFanout.maxItems` with `workflowDynamicFanoutMaxItems`.
- Remove `parallel` immediately. Plan removal of `missions`, `orcaProgressTabs`, and `fleetKeybindings.inspect` after their promised one-release compatibility horizons.
- RPC clients may use only the three passive schedule reads under `manage` during the Package 2b horizon. There is no schedule execution replacement in core.

## Baseline and validation

The Package 7 baseline records 221 production TypeScript files and 80,985 lines, down from Package 6's 80,989 lines. It records 7 package exports, 15 model actions, 12 slash commands, 42 configuration fields including the two one-release aliases and passive `scheduledRuns`, and unchanged combined root schema size of 18,519 bytes. Import/registration p50 was 569.009 ms, direct preparation p50 1.854 ms, active refresh p50 0.039 ms with the same seven filesystem calls, and idle scanning remained three `readdir` calls per 60 seconds.

The final pre-integration baseline after Package 8 and reviewer fixes records 44 top-level configuration fields, including restored `missions` and `orcaProgressTabs` compatibility. `fleetKeybindings.inspect` remains nested and does not change that count.

Validation: `npm run typecheck`; 218 focused config, schema, action, slash, RPC, export/import, external/Surf, and security tests, followed by 24 focused config tests after alias-shape hardening and 1 focused status integration test. Review follow-up reran 33 config/runtime-registration unit tests and 30 slash integration tests. `npm pack --dry-run --json` contained 277 files and no removed API wrapper; the final isolated baseline, credential-pattern scan, and `git diff --check` also completed with exit 0.
