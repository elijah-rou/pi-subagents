# Deep simplification Package 0: evidence ledger and decision gate

Status: complete at source commit `ecf165a1fb99e7a98e4a7e514a371251b897cad8`. No runtime behavior has been removed. Package 1 is blocked on the owner decisions at the end of this document.

This is the authoritative Package 0 inventory for the deletion-oriented simplification described in [deep-simplification-audit.md](deep-simplification-audit.md). It uses three labels:

- **Fact**: demonstrated by source, tests, or the reproducible baseline.
- **Recommendation**: proposed simplification, not approved behavior.
- **Owner decision**: compatibility or product disposition that must be approved before implementation.

`VISION.md` remains the acceptance policy. In particular, lifecycle identity, process-terminal proof, capability ceilings, resource bounds, evidence, recovery, and visible/controllable background work are not deletion targets.

## Reproduce the baseline

Run:

```sh
npm run audit:baseline > docs/deep-simplification-baseline.json
```

The committed raw result is [deep-simplification-baseline.json](deep-simplification-baseline.json). The harness sets both `PI_CODING_AGENT_DIR` and `PI_SUBAGENTS_TEMP_ROOT` to unique temporary roots before importing runtime modules, uses synthetic lifecycle records and a fake extension host, and removes those roots afterward. It does not launch a model or read normal user session/runtime stores.

| Measure | Audited result | Scope |
|---|---:|---|
| Production TypeScript | 254 files, 93,402 LOC | `src/**/*.ts` |
| Registered root-runtime model tools | 3 | `subagent`, `subagent_supervisor`, `subagent_wait` |
| Serialized root-runtime tool schemas | 22,361 bytes total | `20,879 + 245 + 1,237` bytes |
| Root-runtime top-level tool parameters | 81 total | `72 + 4 + 5` |
| Registered child-runtime tools in maximum fixture | 4 | child-safe `subagent`, `subagent_wait`, `contact_supervisor`, conditional `structured_output` |
| Public action allowlist | 56 | `SUBAGENT_ACTIONS` |
| Internal compatibility action | 1 | `append-step`; public boundary rejects it |
| Slash commands | 19 | registration captured from a fake host |
| Package exports | 13 | root plus 12 subpaths |
| Extension config keys | 43 | top-level `ExtensionConfig` fields |
| Import and registration | p50 639.739 ms, p95 647.295 ms | 7 fresh child processes; excludes Node startup |
| Empty headless `session_start` | p50 2.840 ms, p95 3.373 ms | same isolated fake-host processes |
| Direct launch preparation | p50 2.207 ms, p95 2.662 ms | 100 measured `resolveSubagentLaunchContract` calls after one warmup |
| One-active-run refresh | p50 0.043 ms, p95 0.058 ms | 500 measured indexed `listAsyncRuns` calls after one warmup |
| Filesystem calls per active refresh | 7 | 1 exists, 1 lstat, 1 readdir, 1 read, 2 realpath, 1 stat |
| Idle result watcher start | 1 realpath, 1 watch | Linux native-watch path |
| Empty healthy result scan | 3 readdir calls every 60 seconds | no delivery demand, empty result store |

These numbers are regression anchors for this machine, not service-level objectives. The raw JSON records Node, OS, architecture, CPU, sample counts, minima, maxima, and exact probe scope.

## Public and model-facing surface

### Registered tools

Root-runtime tools:

| Tool | Schema bytes / fields | Owner | Default state | Evidence |
|---|---:|---|---|---|
| `subagent` | 20,879 / 72 | launch, workflow, management, and control | registered in root and child-safe forms | `src/extension/index.ts`, `src/extension/schemas.ts` |
| `subagent_supervisor` | 245 / 4 | native supervisor request/reply transport | registered for the parent runtime | `src/intercom/native-supervisor-channel.ts` |
| `subagent_wait` | 1,237 / 5 | blocking/non-blocking background wait | registered; blocking enabled by default | `src/runs/background/wait-tool.ts` |

Child-runtime tools differ from the root surface:

| Tool | Measured schema bytes / fields | Activation | Discriminator |
|---|---:|---|---|
| `subagent` | 20,879 / 72 | registered only when nested fanout is authorized | same public action strings, but the runtime blocks every mutating management action listed below |
| `subagent_wait` | 1,237 / 5 | registered by the child prompt runtime | no action enum |
| `contact_supervisor` | 259 / 3 | registered at child `session_start` only when native supervisor metadata is present | `reason`: `need_decision`, `interview_request`, `progress_update` |
| `structured_output` | 199 / 1 in the representative fixture | registered only when output and schema environment paths are present | schema size varies with the caller-provided output schema |

The child maximum-fixture measurements are reproducible through the baseline harness. They are reported separately because adding them to the root schemas would double-count `subagent`/`subagent_wait` and imply that conditional tools are always visible.

Child-safe `subagent` sets `allowMutatingManagementActions:false`. The executor blocks `create`, `update`, `delete`, `eject`, `disable`, `enable`, `reset`, `grant-spawn-budget`, `watchdog.configure`, `mission.create`, `mission.update`, `mission.resolve-decision`, `mission.attach-run`, `mission.close`, `inspector.open`, `inspector.close`, `project.open`, `project.close`, `worktree.discard`, `worktree.cleanup`, `lane.recordMerge`, `lane.recordSupersession`, `refine`, `refine.rollback`, `dismiss`, `schedule.create`, `schedule.pause`, `schedule.resume`, `schedule.run`, `schedule.run-due`, and `schedule.delete`. Remaining actions are still subject to the public normalizer, nesting, capability, resource, ownership, and target-specific checks.

The 72 `subagent` fields are `agent`, `task`, `extensionBindings`, `action`, `name`, `id`, `runId`, `dir`, `handoffPath`, `repo`, `laneId`, `merge`, `supersession`, `index`, `childId`, `view`, `lines`, `topic`, `message`, `mode`, `steeringRecovery`, `additional`, `scope`, `target`, `focus`, `thinking`, `at`, `every`, `on`, `timezone`, `overlap`, `catchUp`, `missionId`, `mission`, `missionUpdate`, `missionStatus`, `missionScope`, `runMode`, `runStatus`, `summary`, `config`, `workflowScript`, `workflowScriptPath`, `preflight`, `chatProgress`, `isolation`, `worktree`, `lane`, `context`, `async`, `timeoutMs`, `maxRuntimeMs`, `checkpointAfterMs`, `toolTimeoutMs`, `toolBudget`, `usageBudget`, `agentScope`, `cwd`, `artifacts`, `includeProgress`, `share`, `sessionDir`, `control`, `output`, `outputMode`, `skill`, `model`, `fast`, `outputSchema`, `agentContract`, `acceptance`, and `gate`.

### Actions

The schema intentionally accepts a free-form `action` string. `SUBAGENT_ACTIONS` is the public executor allowlist. Each row below is one exact allowlisted action.

| Action | Owner | State and production route |
|---|---|---|
| `list` | agent management | available; agent inventory reader |
| `get` | agent management | available; effective agent reader |
| `models` | model discovery | available; runtime model reader |
| `children.list` | retained children | available; current-session retained-child reader |
| `guide` | packaged help | available; reads packaged guide topics |
| `validate` | workflow preflight | available; validates without launching |
| `create` | agent authoring | available; writes user/project agent definition |
| `update` | agent authoring | available; rewrites agent definition/override |
| `delete` | agent authoring | available; deletes custom definition/override |
| `eject` | agent authoring | available; copies bundled definition to user scope |
| `disable` | agent authoring | available; writes disabled state |
| `enable` | agent authoring | available; removes disabled state |
| `reset` | agent authoring | available; removes customization |
| `mission.create` | missions | available; writes durable mission |
| `mission.list` | missions | available; project/global-index reader |
| `mission.show` | missions | available; mission reader |
| `mission.update` | missions | available; mission writer |
| `mission.resolve-decision` | missions | available; mission decision writer |
| `mission.attach-run` | missions | available; mission/run binding writer |
| `mission.close` | missions | available; terminal mission writer |
| `worktree.discard` | worktree handoff | available; destructive, authority-controlled |
| `worktree.cleanup` | worktree cleanup | available in `mode:"plan"` only; writes expiring plan, does not apply it |
| `lane.status` | lane evidence | available; handoff reader |
| `lane.recordMerge` | lane evidence | available; writes attested merge evidence, does not merge |
| `lane.recordSupersession` | lane evidence | available; writes attested replacement evidence |
| `refine` | agent refinements | available; launches proposal child and writes overlay |
| `refine.show` | agent refinements | available; overlay reader |
| `refine.rollback` | agent refinements | available; overlay writer |
| `inspector.open` | Herdr inspector | recognized; requires Herdr runtime |
| `inspector.status` | Herdr inspector | recognized; requires binding/runtime |
| `inspector.close` | Herdr inspector | recognized; closes pane, never the run |
| `project.open` | Herdr project pane | recognized; requires Herdr runtime |
| `project.status` | Herdr project pane | recognized; project-pane reader |
| `project.close` | Herdr project pane | recognized; pane lifecycle writer |
| `status` | lifecycle projection | available; fleet/run/transcript status |
| `debug.run` | diagnostics | available; diagnostic run projection |
| `grant-spawn-budget` | resource policy | root interactive parent only; authority-confirmed |
| `interrupt` | run control | available for interrupt-capable foreground/async/nested runs |
| `resume` | recovery | available for retained/recoverable children |
| `steer` | run control | available; direct calls may use bounded revival recovery |
| `stop` | run control | available; authority-controlled |
| `dismiss` | recovered workflows | available only for recovered async workflow state |
| `doctor` | diagnostics | available; bounded runtime/config/resource report |
| `watchdog.status` | watchdog | recognized; watchdog runtime default-off |
| `watchdog.check` | watchdog | recognized; runtime/model/LSP check |
| `watchdog.configure` | watchdog | recognized; session/user/project settings writer |
| `watchdog.recommend-model` | watchdog | recognized; model registry reader |
| `schedule.create` | schedules | schedules enabled by default; authority-controlled writer |
| `schedule.list` | schedules | enabled by default; store reader |
| `schedule.show` | schedules | enabled by default; schedule reader |
| `schedule.history` | schedules | enabled by default; bounded history reader |
| `schedule.pause` | schedules | enabled by default; schedule writer |
| `schedule.resume` | schedules | enabled by default; schedule writer |
| `schedule.run` | schedules | enabled by default; launches scheduled workflow |
| `schedule.run-due` | schedules | enabled by default; timer/manual due-run launcher |
| `schedule.delete` | schedules | enabled by default; destructive store writer |

`append-step` is not in `SUBAGENT_ACTIONS` and is not publicly callable. `normalizePublicSubagentExecution` rejects it before executor dispatch. The internal executor still recognizes it and `src/runs/background/chain-append.ts` still writes append request records. This explains the historical count of 57 recognized dispatch names without misclassifying `append-step` as public.

`subagent_supervisor` has its own six-action interface: `list`, `send`, `ask`, `reply`, `pending`, and `status`. These are parent supervisor-channel actions, not entries in `SUBAGENT_ACTIONS`. `contact_supervisor` uses the three reasons listed above rather than an `action` field. `subagent_wait` and `structured_output` have no action discriminator.

Tests: `test/unit/schemas.test.ts`, `test/unit/public-execution.test.ts`, `test/unit/native-supervisor-channel.test.ts`, subsystem action tests, and integration executor tests. Primary `subagent` dispatch: `src/runs/foreground/subagent-executor.ts`; management fallback: `src/agents/agent-management.ts`.

### Slash commands

| Command | Owner | State |
|---|---|---|
| `/subagents` | agent administration | available |
| `/run` | single child through `workflowScript` | available |
| `/subagent-cost` | usage projection | available |
| `/subagents-doctor` | diagnostics | available |
| `/subagents-inspect-rpc` | host inspection bridge | non-TUI RPC surfaces |
| `/subagents-guide` | packaged help | available |
| `/subagents-refine` | refinements | available |
| `/subagents-fleet` | Fleet inspector | available |
| `/subagents-detach` | foreground lifecycle | available |
| `/subagents-stop` | run/schedule control | available |
| `/subagents-steer` | run control | available |
| `/subagents-models` | model discovery | available |
| `/subagents-profiles` | profile administration | available |
| `/subagents-load-profile` | profile administration | available |
| `/subagents-refresh-provider-models` | provider catalog | available |
| `/subagents-generate-profiles` | profile generation | available |
| `/subagents-check-profile` | profile validation | available |
| `/prompt-workflow` | prompt-file workflow wrapper | available |
| `/subagents-watchdog` | watchdog | command available; watchdog default-off |

Registration owners are `src/slash/slash-commands.ts`, `src/slash/prompt-workflows.ts`, and `src/watchdog/register-main.ts`. The historical audit count of 18 is stale for this checkout.

### Package exports and consumer evidence

The repository has no production self-import through the package name. Tests prove export shape; they do not prove external use. Documentation examples are not production-consumer evidence.

| Export | Contract | Named production consumer evidence | Current commitment |
|---|---|---|---|
| `.` | Pi extension entrypoint | Pi host class, no package name | required |
| `./agents` | runtime agent registry | none found | documented public seam |
| `./background-work` | versioned background provider registry | none found | documented public seam |
| `./capability-ceiling` | versioned capability restriction registry | none found | documented public seam; runtime invariant is required, export retention is undecided |
| `./child-profile-resolver` | session-scoped model/thinking resolver | none found | documented public seam |
| `./control-channel` | portable async control requests | none found | used internally; documented public seam |
| `./delegation` | versioned structured delegation events | none found | documented public seam |
| `./external-job-provider` | versioned external-job provider registry | Surf/`surf-oracle` is named in docs, implementation not in repo | documented adapter seam |
| `./external-runs` | versioned display-only Fleet registry | none found | documented public seam |
| `./intercom-bridge` | intercom target/instruction resolution | `pi-intercom` named as optional installation, no consumer code | documented public seam |
| `./pi-args` | child launch argument planning | none found | documented public seam |
| `./preflight` | side-effect-free launch contract v2 | none found | documented public seam; runtime contract evidence is required, export retention is undecided |
| `./shared-types` | curated shared contracts | none found | documented public seam |

`test/unit/package-manifest.test.ts` imports every export. A missing in-repo consumer is not permission to remove a documented export. Removal requires either consumer evidence plus migration or an explicit decision to end the platform commitment.

## Extension configuration

These are the 43 top-level fields of `ExtensionConfig`, read from `~/.pi/agent/extensions/subagent/config.json`. Nested keys are summarized in the same row. Settings and environment variables documented in `configuration.md` are separate interfaces.

| Top-level key | Owner | Effective default / state |
|---|---|---|
| `artifactConfig` | artifact retention | cleanup after 7 days; nested `cleanupDays` |
| `artifactDir` | artifact placement | `session`; supports `project`, `session`, `temp` |
| `asyncByDefault` | workflow execution | `true` |
| `asyncWidget` | async UI | `true` |
| `authorityPolicy` | destructive/control authority | fixed map; confirm destructive cleanup/discard/grant, auto schedule/stop/steer |
| `capacity` | async capacity recovery | nested `abandonedSlotReleaseAfterMs`, default 20 minutes |
| `chain` | internal dynamic fanout | nested `dynamicFanout.maxItems`; no default bound when required |
| `completionBatch` | result notification | enabled; `150/1000/75/400/2000` ms nested timings |
| `control` | child attention/control | enabled; bounded thresholds and channels |
| `defaultSessionDir` | session storage | derived from parent session |
| `defaultSubagentContext` | context policy | agent/default behavior; accepts `fresh` or `fork` |
| `fleetKeybindings` | full Fleet inspector | per-action arrays; built-in defaults when omitted |
| `fleetView` | persistent Fleet UI | `true` |
| `fleetViewPlacement` | Fleet UI | `belowEditor` |
| `forceTopLevelAsync` | top-level execution | `false` |
| `foregroundDetachShortcut` | foreground UI | unset |
| `forkContext` | fork preparation | nested `mode:"full"`; `model` required for `pruned` |
| `globalConcurrencyLimit` | per-run child concurrency | 20; compatibility name, not global semaphore |
| `inlineToolDisplay` | main chat renderer | `rich` |
| `intercomBridge` | coordination/result bridge | `mode:"always"`, result delivery false |
| `mainWindowRenderer` | main chat renderer | spacing preserved; no compact line cap |
| `maxActiveAsyncRunsPerSession` | active top-level async bound | 4; 0 means unlimited |
| `maxSubagentDepth` | nested delegation | code default 2 unless inherited limit is stricter |
| `maxSubagentSpawnsPerRun` | cumulative run-tree bound | 64 |
| `maxSubagentSpawnsPerSession` | cumulative parent-session bound | unlimited; 0 also unlimited |
| `missions` | mission subsystem | automatic creation enabled; global index enabled; retain 200 terminal |
| `modelExclusions` | model failure cache | nested `defaultTtlMs`, 24 hours |
| `orcaProgressTabs` | optional observer | nested `enabled:false` |
| `parallel` | internal parallel compatibility | nested `maxTasks:8`, `concurrency:4` |
| `permissions` | native child permissions | nested rules; omitted means pass-through |
| `proactiveSkillSubagents` | skill recommendations | optional object or false; no named consumer |
| `resultScanLogging` | watcher diagnostics | `activity` |
| `scheduledRuns` | schedule subsystem | enabled; nested `maxPending:20`, project store by default |
| `singleRunOutputBaseDir` | relative `/run` output | run artifact directory |
| `timeoutMs` | run deadline | built-in 30-minute foreground/plain-single fallback |
| `toolBudget` | child tool budget | unset |
| `toolDescriptionMode` | parent prompt surface | split prompt metadata when omitted; supports full/compact/custom |
| `toolTimeoutMs` | tool deadline | unset; known-fast tools still get five-minute hard default |
| `usageBudget` | reported usage bound | unset |
| `waitTool` | wait behavior | enabled; 30-minute fallback timeout |
| `worktreeBaseDir` | managed worktree root | system temp unless environment/config overrides |
| `worktreeSetupHook` | worktree setup | unset |
| `worktreeSetupHookTimeoutMs` | setup hook bound | 30 seconds |

Source: `src/shared/types.ts`, `src/extension/config.ts`, and [configuration.md](configuration.md). Config tests are concentrated in `test/unit/pi-coding-agent-dir.test.ts` plus subsystem tests.

## Durable writers and compatibility readers

### Current durable writer families

The family, owner, and format columns are facts. The final column is a VISION-constrained recommendation or an explicit owner-decision marker, not an approved disposition.

| Durable family | Owning writer(s) | Format / role | Recommended or undecided disposition |
|---|---|---|---|
| Async `status.json` | `async-execution.ts`, `subagent-runner.ts`, detached/stale reconciliation | outer envelope is not versioned; embeds versioned proof/contracts | retain core; consolidate writers only with recovery proof |
| Async `events.jsonl` | runner, executor, detached reconciliation, process-terminal | typed append-only events; mixed embedded versions | retain core visibility |
| Pending/public result and result indexes | `result-files.ts`, runner, stale/detached reconciliation | result index v1, atomic pending promotion | retain core delivery |
| Active and terminal run indexes | `active-run-index.ts`, `terminal-run-index.ts` | marker plus terminal v1 entries | retain lifecycle discovery |
| Active async capacity claims/events | `active-async-capacity.ts` | ownership records and process-proof-gated release | retain resource invariant |
| Process-terminal candidate/proof | `process-terminal.ts` | proof v1 plus status/event projection | retain recovery invariant |
| Completion archive/replay | `completion-replay.ts` | v1 bounded archive/replay with expiry | retain while wait/recovery needs it |
| Wait subscriptions | `wait-subscriptions.ts` | v1 session-owned expiring records | retain while non-blocking wait exists |
| Stop/steer/control inbox | `control-channel.ts`, `steering.ts`, foreground steering action | canonical per-request files, claims, acks | retain controllability |
| Native supervisor request/reply channel | `native-supervisor-channel.ts` | per-child `requests/*.json` and `replies/*.json`, atomically written; requests are capped at 64 KiB, replies currently have no size bound | retain while native supervision exists; bound replies in an approved implementation package |
| Fork sessions and child transcripts | Pi session manager, `fork-context.ts`, `child-transcript.ts`, `pruned-fork.ts` | Pi JSONL plus v1 pruning recovery sidecar | retain session identity/recovery |
| Workflow receipt and child summary | `workflow-receipt.ts`, detached reconciliation | receipt v1, child projection v1 | retain detached workflow recovery |
| Workflow host command artifacts | `host-command.ts` | bounded command output/status | retain only with host workflow primitive |
| Nested route/index/registry/events | `nested-events.ts` | route/control files; registry lacks outer version | retain nested visibility; version before migration |
| Run fanout budget | `run-fanout-budget.ts` | v1 descriptor/manifest/claims | retain resource invariant |
| Session lease/private locks | `session-lease.ts`, `private-file-lock.ts` | exclusive owner records | retain authority invariant |
| Parallel handoff | `parallel-handoff.ts` | v1 patches, cleanup, merge/supersession evidence | retain plain handoff; owner decision on policy fields |
| Worktree cleanup plan | `worktree-cleanup-plan.ts` | v1 expiring plan/hash | retain plan-only safety if action remains |
| Generic artifacts/output/transcripts | `artifacts.ts`, `single-output.ts`, prompt runtime | bounded output, metadata, transcript references | retain evidence; document format horizon |
| Acceptance verification cache | `acceptance.ts` | v1 Git/workspace-keyed cache | retain as cache, never authority |
| Foreground history/run history | `foreground-history.ts`, `run-history.ts`, executor | foreground v1 restore record; redacted rotating JSONL | retain recovery; review generic history retention |
| Model exclusions/tool diagnostics | `model-exclusions.ts`, `tool-availability.ts` | exclusions v1; disposable diagnostics | retain bounded safety state |
| External-job bridge | `external-job-bridge.ts`, `external-job-runner.ts` | request/response/claim/result files; mixed versioning | owner decision tied to provider commitment |
| External CLI logs/prompts/results | `external-cli-runner.ts` and adapters | bounded raw logs, prompt files, receipt metadata | retain generic honest adapter path |
| Mission records/index/binding/state | `missions/store.ts`, `lifecycle.ts`, `workflow-state.ts` | schema v1 private records and index | owner decision |
| Schedule definition/history/run/events | `scheduled-runs.ts` | private schedule/run JSON, v1 history/events | owner decision |
| Agent definitions/settings/overrides | `agent-management.ts`, `agents.ts`, `agent-serializer.ts` | canonical Markdown and settings JSON | owner decision on model-facing authoring, retain discovery |
| Chain definitions | no production writer found | `.chain.md`/`.chain.json` readers only | compatibility horizon decision |
| Refinement overlay | `agent-refinements.ts` | v1 project-local Markdown overlay | owner decision |
| Profiles/provider catalogs | `profiles.ts` | user profile/catalog/quota/quality JSON | owner decision |
| Watchdog settings/artifacts | `watchdog/settings.ts` and runtime modules | user/project settings plus runtime diagnostics | owner decision |
| Herdr inspector/project bindings | Herdr action/project-pane modules | schema v1 bindings/indexes | owner decision |
| Orca observer manifest/log/markers | `orca-progress-tabs.ts` | schema v1 passive view plus capped mirror log | owner decision |
| Slash final snapshots | `slash/slash-live-state.ts` | session-visible final snapshots | retain only with slash UI |
| Extension config | `extension/config.ts` | user JSON | retain while config surface exists |

### Legacy-writer verification

These are facts, not inferred absence claims:

1. **Saved chains:** no production call to `serializeChain` or `serializeJsonChain` exists. Public `chainName` and `config.steps` are rejected; agent management also rejects `config.steps`. Existing `.chain.md` and `.chain.json` files are discovery-only compatibility inputs.
2. **Public `tasks`/`chain`/`parallel`:** `normalizePublicSubagentExecution` rejects `tasks`, `chain`, `parallel`, `concurrency`, and `chainDir` before execution. Prompt-template legacy payloads are also rejected without executor dispatch.
3. **Internal `tasks`/`chain`/`parallel`:** current production executor and background runner still use these shapes and labels internally. Current lifecycle status/results can still record `mode:"chain"` or `mode:"parallel"`. There is no separate legacy artifact family named `tasks`, `chain`, or `parallel`.
4. **Append-step:** public calls are rejected, but the internal executor route is live. `chain-append.ts` writes `append-requests/*.json`, updates status, and appends `subagent.chain.append.requested`. This is a current legacy writer and reader.
5. **Acceptance:** current execution writes canonical persisted `acceptanceInput` and acceptance ledgers/caches. Recovery rejects legacy inferred/reviewed acceptance metadata. No writer for a deprecated acceptance record was found. `agentContract:{version:1}` remains a current, explicit compatibility contract and must not be conflated with deprecated acceptance metadata.
6. **Legacy stop request:** current writers use `stop-requests/*.json`; the reader still accepts `control/stop.json`.
7. **Result index aliases:** current writers use canonical v1 index paths; readers still accept encoded aliases and pending locations.
8. **Legacy agent roots:** writers target canonical managed directories; discovery still reads `.agents` and legacy chain directories.
9. **External adapter variants:** current writers emit current receipts; readers still normalize an older Claude safety shape and legacy Grok/Cursor status.
10. **Removed turn budgets:** new runs do not write `turnBudget`. `AsyncStatus` and async recovery still accept the historical persisted field but do not restore or enforce it (`src/shared/types.ts`, `src/runs/background/async-resume.ts`).
11. **Legacy completion archives:** current archives identify children with `resultIndex`; inspector recovery still accepts pre-`resultIndex` entries by a unique legacy `agent` name and fails closed on duplicates (`src/runs/background/inspect-rpc.ts`).
12. **Legacy MCP capability names:** current MCP selections use canonical names. Launch planning accepts one unambiguous underscore-form tool name for a formerly hyphenated server prefix (`src/runs/shared/pi-args.ts`).
13. **Legacy Herdr session-root arguments:** current inspector launch encodes roots as base64. The decoder still accepts a raw JSON array from cached/manual older runners (`src/inspectors/herdr/session-roots-codec.ts`).
14. **Herdr project-pane model behavior:** the public project-pane manager is strict, while the model action wrapper deliberately sets `legacyToolCompatibility:true` and preserves historical missing/stale/invalid-pane behavior (`src/inspectors/herdr/project-panes.ts`). This is a live behavior compatibility route, not only a file reader.
15. **Legacy child prompt context:** child prompt rewriting strips and scopes both the current XML project-context representation and the historical `# Project Context` header (`src/runs/shared/subagent-prompt-runtime.ts`). Current launch writers use the current prompt form.
16. **Legacy acceptance request syntax:** public and agent configuration still accept legacy acceptance levels/config fields and adapt them to the canonical contract (`src/runs/shared/acceptance.ts`). Current durable execution writes canonical persisted acceptance metadata; recovery rejects legacy inferred/reviewed persisted forms.
17. **Rejected-only legacy requests:** public checkpoint actions, schedule agent/task targets, prompt-template direct/tasks payloads, and public chain/task/parallel forms are recognized only to return migration errors. No current writer emits them.
18. **Source/config compatibility aliases:** `globalConcurrencyLimit`, child-profile `sessionId`, Fleet `refreshMs`, and the old tool-timeout export name remain source/config compatibility contracts. They are not durable artifact readers, but they still block type/config deletion.

Focused verification passed 241 tests across public execution, agent management/frontmatter, async resume/retention, and acceptance. The compatibility search used `rg` over `legacy`, `compatibility`, version checks, aliases, and migration comments in all production TypeScript. The implementation package that removes a compatibility reader must first stop its writer, assign a release or time horizon, test migration, and preserve unknown records until that horizon expires.

## Optional subsystem ledger

Footprint, activation, and coupling are facts. The `VISION fit` column is an audit recommendation used to frame the unresolved owner decisions. Dedicated LOC counts overlap only where stated; cross-cutting hooks add further cost.

| Subsystem | Dedicated footprint | Default activation | Core coupling | VISION fit |
|---|---:|---|---|---|
| Missions and goal continuation | 1,927 LOC | automatic missions enabled | launch, result watcher, retention, `agent_end`, workflows, inspector | weak; general project-state behavior |
| Scheduled runs | 908 LOC in background package | enabled | startup manager, actions, RPC, result observation, retention | conditional; scheduling is not delegation |
| Watchdog | 4,514 LOC | main and child behavior default-off | root/child startup, settings, prompt runtime, LSP/review | weak-to-conditional; duplicate review/control layer |
| Herdr inspector/project panes | 1,358 LOC | runtime-gated | startup/shutdown, actions, Fleet, durable bindings | weak for peer project panes; conditional passive status |
| Herdr passive status bridge | 400 LOC | `HERDR_ENV=1` | lifecycle event projection | conditional observer |
| Orca progress tabs | 499 LOC | opt-in | foreground/async launch hooks, manifests/logs | weak; duplicates Fleet |
| Profiles/provider catalogs | 662 LOC plus slash handlers | command-driven | user settings/model catalogs | conditional administration, not delegation |
| Refinement overlays | 723 LOC plus prompt hooks | action-driven | proposal child, foreground/async prompts | weak; model-facing authoring |
| Lane merge/supersession and cleanup policy | 1,644 LOC across handoff/cleanup plus lane metadata | action/worktree-driven | receipts, status, TUI, worktree lifecycle | isolation fits; merge policy does not |
| Agent model-facing authoring | part of 6,767 LOC in `src/agents` | actions and `/subagents` | discovery/settings/serialization | conditional; discovery is core, authoring is administration |
| RPC and structured delegation bridges | 802 LOC RPC plus delegation bridge | registered | executor/status/control | platform commitment; consumer evidence incomplete |
| External/provider registries | 1,328 LOC in `src/api` total | registered/inert until provider use | Fleet, wait, external runner | platform commitment; Surf named for external jobs |

The full production directory context is: `src/runs/background` 21,108 LOC, `src/runs/shared` 19,090, `src/tui` 6,089, `src/agents` 6,767, `src/watchdog` 4,514, `src/extension` 3,643, `src/slash` 3,800, `src/missions` 1,927, `src/intercom` 1,426, `src/inspectors/herdr` 1,358, and `src/api` 1,328.

## Recommendations

These recommendations are intentionally deletion-oriented and remain unapproved:

1. Keep the canonical direct child path, `workflowScript`, `runs.run`/`runs.all`/`runs.lanes`/`runs.host`, truthful external adapters, lifecycle identity, process proof, resource/capability ceilings, worktree isolation, plain handoff evidence, wait, Fleet, and recovery.
2. Stop automatic mission creation, then extract or remove mission/goal management after a v1 artifact horizon.
3. Move schedules, watchdog, profiles/catalogs, refinement authoring, and Herdr peer panes out of the core extension. Disabled optional features must not load on startup or child launch.
4. Retain only passive Herdr status if an explicit platform commitment or consumer justifies it. Remove Orca unless measured use demonstrates distinct value over Fleet.
5. Keep agent discovery and static configuration. Move model-facing agent authoring to a human-only command or companion.
6. Keep worktree isolation and plain patch/handoff facts. Remove merge/supersession policy actions and any cleanup authority beyond plan-only evidence unless the owner explicitly commits to them.
7. Remove the internal append-step writer before deleting its reader. Migrate remaining internal `tasks`/`chain`/`parallel` execution to one workflow primitive before removing those types and branches.
8. Keep pure compatibility readers only for an explicit horizon. Do not retain them indefinitely without a writer, consumer, or published support window.
9. Keep public exports only through named consumer evidence or an explicit platform commitment. Deprecate before removal.
10. Require every implementation package to report LOC, schema bytes/counts, startup, direct preparation, active refresh, and idle filesystem deltas against the committed baseline.

## Owner decisions blocking Package 1

### Decision A: optional product subsystems

Choose the target disposition for missions, schedules, watchdog, Herdr peer panes/inspectors, Orca, profiles/catalogs, refinements, and model-facing agent authoring:

- **Recommended:** extract/remove all from core; retain only static agent discovery and passive Herdr status if separately justified.
- **Conservative:** make all explicit opt-in and lazy-loaded in core, then reassess with usage evidence.
- **Selective:** name exact subsystems that remain core and accept their public/config/persistence contracts.

### Decision B: lane and cleanup policy

Choose whether core retains only worktree isolation plus plain handoff evidence, or also owns `lane.recordMerge`, `lane.recordSupersession`, `worktree.cleanup`, and `worktree.discard` policy surfaces.

Recommended: retain isolation/plain handoff and safe explicit discard; remove merge/supersession policy and broad cleanup planning.

### Decision C: legacy orchestration

Choose whether Package 1 may stop and remove the internal append-step writer and migrate internal `tasks`/`chain`/`parallel` execution shapes to `workflowScript` primitives.

Recommended: approve both. Public callers already receive hard rejection, while the internal writer is the remaining blocker.

### Decision D: compatibility horizons

Assign a horizon to reader-only or behavior compatibility for saved `.chain.*`, `control/stop.json`, result index aliases, legacy `.agents` roots, old adapter variants, removed turn budgets, pre-`resultIndex` completion archives, underscore MCP names, raw Herdr session roots, Herdr legacy model behavior, historical prompt-context headers, legacy acceptance request syntax, and source/config aliases.

Recommended: one published release after writer removal for user-authored files and persisted run artifacts; immediate removal only for shapes that were never public or durable. Preserve unknown files without rewriting them during the horizon.

### Decision E: package platform commitment

Choose one:

- **Recommended:** retain `.` plus safety/core seams (`capability-ceiling`, `preflight`, and control contracts), retain `external-job-provider` while Surf is supported, and require named consumer evidence for every other subpath before committing to it long-term.
- **Platform commitment:** retain all 13 exports as supported extension APIs despite missing consumer evidence.
- **Core-only:** deprecate every non-root export not required by internal operation or a named consumer.

### Decision F: management and slash surface

Choose whether model-facing management and all 19 slash commands remain core.

Recommended: retain read-only discovery/status/guide/control and `/run`/Fleet; move authoring, profiles, refinement, schedules, watchdog, and optional observer administration out with their subsystems.

Package 1 must not begin until these decisions are recorded. No Package 0 finding is waived by silence.
