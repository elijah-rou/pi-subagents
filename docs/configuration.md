# Configuration

Upgrading from the fork before v0.59? Review the [changed defaults, exact compatibility keys, and reload requirements](migration-v059.md).

`pi-subagents` reads optional JSON config from `~/.pi/agent/extensions/subagent/config.json`. This page lists every key, plus the environment variables and the settings-file keys that affect config resolution.

Settings-level keys (`subagents.defaultModel`, `defaultProvider`, `defaultThinking`, `defaultExtensions`, `agentOverrides`, `modelScope`, `disableThinking`, `disableBuiltins`) live in Pi settings files, not this config file. `modelScope.agents.<name>` adds per-agent restrictions, and `allow: ["inherit"]` permits the current parent model. Agent inheritance fields use the same frontmatter/settings precedence as other agent fields; when `inheritGlobalContext` is omitted, it follows the resolved `inheritProjectContext` value. See [models.md](models.md), [agents.md](agents.md#prompt-assembly), and [watchdog.md](watchdog.md).

## Project root resolution (settings)

By default, project settings resolve from the nearest parent directory that contains `.pi` or `.agents`, preserving existing nested-project behavior. In monorepos or git worktrees where an incidental nested `.pi` directory should not shadow the repository-level config, set this in the repository root `.pi/settings.json`:

```json
{
  "subagents": {
    "projectRootResolution": "git-root"
  }
}
```

`"git-root"` keeps package discovery, project agents, legacy-chain compatibility inspection, and `agentOverrides` anchored to the git worktree root when that root also has Pi project config. A nested project can still opt back into nearest-root behavior by setting `"projectRootResolution": "nearest"` in its own `.pi/settings.json`.

## `modelExclusions`

```json
{
  "modelExclusions": {
    "defaultTtlMs": 300000
  }
}
```

Controls the duration, in milliseconds, for model exclusions. The default is `86400000` (24 hours), and the maximum is `8000000000000000` so generated expiry timestamps remain valid JavaScript dates. The extension applies this value when it starts or reloads. A lower configured value shortens active cached exclusions from their original `recordedAt`; it never extends an existing expiry. Launches also warn when a candidate is skipped, including the cached reason and expiry. `PI_MODEL_EXCLUSIONS_PATH` changes the exclusion-store path but does not change this TTL.

## `toolDescriptionMode`

```json
{ "toolDescriptionMode": "compact" }
```

Controls the parent-facing `subagent` tool description registered at startup. The default registers split prompt metadata: a short tool description plus `promptSnippet` and `promptGuidelines`. Set `"full"` to register the complete description as one tool description, or `"compact"` to keep the execution modes, async/`subagent_wait` guidance, child-safety boundary, management/action split, one-writer review guidance, and artifact/status essentials with less prompt bloat.

`custom` reads `subagent-tool-description.md` from the project config directory, then from `~/.pi/agent/subagent-tool-description.md`. Missing, empty, unreadable, or oversized custom files fall back to the full description. Custom templates may use `{{fullDescription}}`, `{{compactDescription}}`, `{{safetyGuidance}}`, `{{agentDir}}`, and `{{projectConfigDir}}`; the safety guidance is always present so custom prose cannot remove the runtime guardrails. Restart Pi after changing the mode or custom file.

## `inlineToolDisplay`

```json
{ "inlineToolDisplay": "summary" }
```

Controls the `subagent` tool result shown inline in chat. The default, `"rich"`, shows live child activity and expands to detailed output. `"summary"` keeps the inline result at one stable row for running, completed, failed, stopped, and paused runs; it does not animate, show elapsed time, preview child output, or change when Pi's expand key is pressed. FleetView remains available for live progress and detailed inspection.

## `mainWindowRenderer`

```json
{
  "mainWindowRenderer": {
    "horizontalSpacing": 0,
    "compactResultMaxLines": 4
  }
}
```

Controls only the main chat `subagent` call/result renderer. It does not change child execution, orchestration, FleetView, artifacts, transcripts, or model-facing content.

`horizontalSpacing` is an integer from `0` to `4`. The default preserves current spacing. Set it to `0` to remove the extra spaces before compact result details and between parts of the call row.

`compactResultMaxLines` is a positive integer. It caps only collapsed rich-result rows and adds an expand hint when rows are hidden. Expanded output remains uncapped.

With `"summary"`, a tool result looks like this:

```text
✓ reviewer · completed
```

## `foregroundDetachShortcut`

```json
{ "foregroundDetachShortcut": "ctrl+b" }
```

Optionally binds a shortcut that detaches the active foreground single-subagent run without terminating it. The running foreground card shows the configured shortcut beside its live-detail hint. The default is unset, so pi-subagents does not reserve a global key.

Pi binds `Ctrl+B` to editor cursor-left by default. The extension shortcut takes precedence, but Pi reports the conflict at startup. To reserve the key without that warning, override the editor action in `~/.pi/agent/keybindings.json`:

```json
{
  "tui.editor.cursorLeft": "left"
}
```

## Retired provider profiles and catalogs

Package 3d removed provider profile/catalog administration and its model probes. Existing files under `~/.pi/agent/profiles/pi-subagents/` remain untouched unknown artifacts for one published release. Core does not read, write, migrate, or delete them. Already-applied `subagents` values in `~/.pi/agent/settings.json` remain ordinary settings and continue through the normal settings precedence described above.

## Retired `orcaProgressTabs` key

The Orca observer was removed in Package 3b. The `orcaProgressTabs` key is accepted as inert unknown configuration for one published Package 3b release, regardless of its value. It cannot launch a process or create, update, or delete observer artifacts. Remove the key from current configuration. Existing `.pi/subagents/views/orca` files and old temporary files are left untouched as unknown user artifacts.

## `asyncByDefault`

```json
{ "asyncByDefault": false }
```

WorkflowScript calls use background execution when the request omits `async`. Set `asyncByDefault` to `false` to restore foreground-by-default behavior for tool launches that still use the internal single-run primitive. Callers can still force foreground with `async: false` unless `forceTopLevelAsync` is enabled.

## `defaultSubagentContext`

```json
{ "defaultSubagentContext": "fresh" }
```

Sets `fresh` or `fork` for every subagent launch that omits `context`. This global preference replaces each agent-level `defaultContext`. Explicit `context: "fresh"` or `context: "fork"` still wins.

With `"fork"`, the setting uses the existing implicit-fork behavior. A launch starts fresh when the parent session file or current leaf is not available. `"fresh"` starts fresh even when the selected agent defaults to fork. A runner or provider that does not support fork context keeps its existing rejection behavior.

## `forkContext`

```json
{
  "forkContext": {
    "mode": "pruned",
    "model": "openai-codex/gpt-5.6-luna:max"
  }
}
```

Controls how resolved fork launches prepare the inherited session. The default `"full"` mode keeps the complete fork. `"pruned"` mode keeps inherited context exact while it fits the code-owned 64 KiB session budget. On overflow, the required `model` returns short JSON summaries keyed by stable item ids. Tool results spill first, then older assistant and tool context, and user text only when required. It applies to explicit `context: "fork"`, global and agent fork defaults, and `context: "profile"` when the selected profile resolves to fork.

Child-visible spilled items contain only the model summary and a stable `{ batchId, itemId }` recovery ref. Raw bodies and their digests, source entry ids, labels, sizes, and tool metadata go to a private `0600` sidecar next to the child session. This release does not add a recovery command or expose that payload to the child model.

Pruned forks keep the normal `parentSession` link, child cwd alignment, and fork thinking-block sanitization. Missing model or auth, invalid or incomplete summary JSON, budget overflow, recovery validation failure, and raw overflow leakage all stop the launch before child spawn. The extension never falls back to a full fork or refs-only context after a prune failure.

## `fleetView`

```json
{ "fleetView": false }
```

Controls the persistent, navigable FleetView. The default is `true`. Set it to `false` to hide FleetView without disabling status tracking, completion notifications, `/subagents-fleet`, or lifecycle events.

## `fleetViewPlacement`

```json
{ "fleetViewPlacement": "aboveEditor" }
```

Places the persistent FleetView either `"belowEditor"` or `"aboveEditor"`. The default is `"belowEditor"`; invalid values fall back to `"belowEditor"`.

## `fleetKeybindings`

```json
{
  "fleetKeybindings": {
    "pageUp": ["u"],
    "pageDown": ["d"],
    "selectFirst": ["g"],
    "selectLast": ["G"]
  }
}
```

Customizes only the full Fleet inspector opened by `/subagents-fleet` or FleetView inspection. It does not change Pi's global keybindings or the compact persistent FleetView.

Each action accepts a non-empty array of key strings. Configured actions replace their defaults. Unset actions keep the defaults: `selectUp` is `up`/`k`, `selectDown` is `down`/`j`, `scrollUp` is `K`, `scrollDown` is `J`, `pageUp` is `pageUp`, `pageDown` is `pageDown`, `selectFirst` is `home`, `selectLast` is `end`, `toggleTools` is `x`/`X`/`ctrl+o`, `refresh` is `r`/`R`, `steer` is `s`, `stop` is `D`, and `close` is `escape`/`ctrl+c`/`q`.

For one published Package 3c release, an existing `fleetKeybindings.inspect` array remains valid and is preserved by unrelated config updates. It is inert: it has no default, runtime action, or help entry. Malformed values still fail config validation.

Prompt modes keep their fixed keys. For example, `Esc` still cancels steer text or stop confirmation even when the Fleet-level close binding is changed.

## `asyncWidget`

```json
{ "asyncWidget": true }
```

Controls the under-editor widget for active background runs. It defaults to `true`, including when FleetView is enabled, so active work remains visible after reload. Set it to `false` to hide this widget while keeping FleetView available.

## `waitTool`

```json
{ "waitTool": { "enabled": true, "defaultTimeoutMs": 120000 } }
```

`defaultTimeoutMs` sets the blocking window used when a `subagent_wait` call omits `timeoutMs`; explicit call values win, followed by this setting, then the 30-minute fallback. When the window elapses, the tool returns a non-error `window_elapsed` result with the still-active work identities, and that work keeps running. Set `enabled` to `false` to keep the tool registered while making direct calls return immediately instead of blocking. The default is enabled. You can also set `"waitTool": false`; set `PI_SUBAGENT_WAIT_TOOL_ENABLED=false` (or `0`, `off`, `disabled`) to override config for one process. The effective enabled and default-timeout values are passed explicitly to child runtimes. Headless `agent_end` auto-drain retains its own strict deadline and fails if required work remains unresolved. Invalid config or environment values fail instead of being coerced.

Blocking `subagent_wait({ id: "..." })` keeps the current tool call open until that run changes. By default it returns when a run needs attention. Use `subagent_wait({ stopOnAttention: false })` only for run-to-completion flows that should wait through idle or long-thinking attention; supervisor/contact requests still stop the wait. In a long-lived interactive parent session, `subagent_wait({ id: "...", nonBlocking: true })` instead resolves the prefix once, persists the exact run identity, returns a subscription token immediately, and wakes that session on completion, failure, attention, reconciliation failure, or timeout. Armed subscriptions appear in ordinary `subagent({ action: "status" })` output and are not counted as active child work.

This is different from `waitTool.enabled=false`, which returns immediately without registering any future wake. Provider items remain available only to blocking fleet-wide waits; non-blocking subscriptions require one async or remembered detached foreground run id.

## `resultScanLogging`

```json
{ "resultScanLogging": "activity" }
```

Controls how slow result-index scans are logged. Defaults to `"activity"`; valid values are `"all"`, `"activity"`, and `"off"`.

The watcher logs `Subagent result scan inspected … scheduled …` through `console.error` whenever a result-index scan passes the slow threshold (500ms). With `"activity"` (default), it logs only scans that inspected or scheduled actual work. Use `"all"` to log every slow scan, including the periodic healthy rescan that inspects zero files while no async runs are pending, or `"off"` to silence slow-scan logging entirely. `"off"` does not disable result delivery or the watcher itself, only its slow-scan log line.

## `forceTopLevelAsync`

```json
{ "forceTopLevelAsync": true }
```

Forces depth-0 direct and `workflowScript` runs into background mode and bypasses launch UI by forcing `clarify: false`. Nested calls keep their own inherited settings.

## `timeoutMs`

```json
{ "timeoutMs": 3600000 }
```

Global default runtime deadline, in milliseconds, for subagent runs. It replaces the built-in 30-minute backstop for foreground direct and `workflowScript` launches and plain single-agent async runs whenever no call-level `timeoutMs`/`maxRuntimeMs` applies. For single-agent launches, selected agent frontmatter `timeoutMs` still wins. This only moves the *default*.

Use it when foreground orchestration or an async direct run needs a longer default than 30 minutes. Scripted workflows stay unbounded at the top level by design; their direct children are bounded individually by their own agent or runner defaults. This value therefore does not cap a whole async `workflowScript`. Must be a positive integer no greater than `2147483647` (the largest delay a Node.js timer can honor, roughly 24.8 days); invalid or out-of-range values are ignored and the built-in defaults apply.

## `toolTimeoutMs`

```json
{ "toolTimeoutMs": 600000 }
```

Optional hard per-tool-call deadline in milliseconds. When configured, a child that emits `tool_execution_start` but not `tool_execution_end` is terminated with `timedOut: true` and a tool-specific error. The effective value is resolved per child: explicit `subagent` call value, then agent frontmatter, then this config value, then `PI_SUBAGENT_TOOL_TIMEOUT_MS`.

Without a configured value, Pi still applies a five-minute hard timeout to known-fast built-in tools: `read`, `grep`, `find`, `ls`, `edit`, `write`, and `structured_output`. Long-running tools such as `bash`, custom tools, and MCP tools do not get a hard default. They get the normal open-tool attention notice after `activeNoticeAfterMs` and remain bounded by the run-level deadline.

The tool timer tracks each active `toolCallId` separately and never extends the run-level deadline: when the remaining run budget is shorter, the ordinary run-level timeout wins. `contact_supervisor`, `intercom`, and `subagent_wait` are exempt because their legitimate purpose can be to wait for a human, supervisor, or child run. Use hard tool timeouts only for wedge protection; an elapsed timeout is not a mutation-safe boundary. Configured values must be positive integers no greater than `2147483647`; invalid or out-of-range values are rejected with a visible error rather than silently ignored.

## Per-run child concurrency (`globalConcurrencyLimit`)

```json
{ "globalConcurrencyLimit": 20 }
```

Caps simultaneously running children inside each top-level `workflowScript` launch through `runs.run`/`runs.all`. The key name is retained for compatibility; this is not a cross-run, parent-session-wide, machine-wide, or cross-process semaphore. Every top-level run receives its own allowance. Queued workflow children retain their stable keys and begin when a running sibling in that run releases capacity. The default remains `20`.

## `maxSubagentSpawnsPerSession`

```json
{ "maxSubagentSpawnsPerSession": 100 }
```

Optionally caps the total number of direct child launches during one parent session, including completed and failed children launched directly or by `workflowScript`. Sessions are unlimited by default. Set this value to `0` to disable a configured cap. `PI_SUBAGENT_MAX_SPAWNS_PER_SESSION` overrides the config for a process and follows the same positive-cap/zero-unlimited semantics.

`subagent({ action: "status" })`, Fleet status, and `subagent({ action: "doctor" })` expose used, effective limit, remaining capacity, and retained grant state. Package 1 removed spawn-budget grants from the model surface and provides no replacement command. Configure the session cap before launch and start a new parent session when a different cap is required. Compaction remains part of the same logical parent session and does not reset usage.

## `maxSubagentSpawnsPerRun`

```json
{ "maxSubagentSpawnsPerRun": 64 }
```

Caps cumulative logical child admissions in one top-level run tree. The default is `64`. `PI_SUBAGENT_MAX_SPAWNS_PER_RUN` overrides the config when it is a positive integer. Invalid, zero, or missing values fall back to the configured positive value or `64`.

The budget counts direct launches, `workflowScript` children, and nested child calls. A `runs.all` batch is admitted atomically. Startup retries, model fallback, and retained-child resume reuse the original logical child claim. Claims are never released or refunded. This cap is independent from the session-wide cumulative spawn budget and `globalConcurrencyLimit`.

## `maxActiveAsyncRunsPerSession`

```json
{ "maxActiveAsyncRunsPerSession": 4 }
```

Caps concurrently active top-level async runs owned by one parent session. The default is `4`. Set it explicitly to `0` to make active top-level async runs unlimited. A positive integer reserves one slot before an async direct or `workflowScript` run creates artifacts or starts children. Its exact scope is top-level async runs in the current parent session; foreground and nested/workflow children are excluded.

Queued, running, paused, and needs-attention runs retain capacity. Runner-backed slots release only after terminal logical state and matching observed process-terminal proof from #1030. Missing, malformed, or unknown cleanup proof retains the slot. A terminal async workflow releases after its controller is gone and every launched child is accounted for: awaited foreground children are covered by workflow settlement, while actual background children still require observed process-terminal proof. Resume transfers the source slot without a second charge. Dismissal and history cleanup do not release capacity.

When the runner is gone but process cleanup proof remains unknown, configure a bounded policy reclaim under `capacity.abandonedSlotReleaseAfterMs`:

```json
{ "maxActiveAsyncRunsPerSession": 4, "capacity": { "abandonedSlotReleaseAfterMs": 1200000 } }
```

The default is `1200000` milliseconds (20 minutes). The policy releases only a failed terminal run whose runner PID is dead and whose last activity is older than the threshold. A live or unknown PID, a non-failed terminal state, a recent run, or missing activity timestamp retains the slot. Set the value to `false` to keep strict retention. Valid configured durations range from 5 minutes through 24 hours. Policy release is reported as `abandoned-timeout` with `processProof: unknown`; it is not observed process-terminal proof and may reclaim capacity while an orphan child still exists.

This limit bounds current top-level async load. It is separate from cumulative `maxSubagentSpawnsPerSession`, the default-`64` cumulative `maxSubagentSpawnsPerRun`, and per-run child concurrency (`globalConcurrencyLimit`, default `20`). `maxSubagentSpawnsPerSession` remains unlimited by default.

`subagent({ action: "status" })`, fleet status, and the `subagent({ action: "doctor" })` doctor action expose used and effective top-level async capacity for the current parent session, explicitly excluding foreground and nested/workflow children. Status and the doctor action also identify `globalConcurrencyLimit` as per-run child concurrency and state that it is not shared across runs, parent sessions, or machines. A `workflowScript` `runs.all` batch fails before starting partial work when its declared capacity cannot fit. Later retries are not guaranteed by that preflight.

### Migration: retaining unlimited active async runs

Before this release, omitting `maxActiveAsyncRunsPerSession` left top-level async runs unlimited. The omitted default is now `4`. Users who intentionally need the old unlimited active-run behavior must set:

```json
{ "maxActiveAsyncRunsPerSession": 0 }
```

This override affects only active top-level async runs in one parent session. It does not change the per-run child concurrency default (`globalConcurrencyLimit: 20`), the cumulative per-run child limit (`maxSubagentSpawnsPerRun: 64`), or the unlimited-by-default cumulative session spawn policy.

## `scheduledRuns`

Package 2b accepts this object only for one-release legacy read compatibility. `storeRoot` locates existing project-keyed schedule records and must be absolute or start with `~/`. `enabled` and `maxPending` are accepted but inert. No key enables scheduling, timers, writes, launches, or retention. When `storeRoot` is omitted, passive lookup uses `<cwd>/.pi/subagents/schedules`. See [Legacy schedules](schedules.md).

## `defaultSessionDir`

```json
{ "defaultSessionDir": "~/.pi/agent/sessions/subagent/" }
```

Session directory precedence is: `params.sessionDir`, then `config.defaultSessionDir`, then a directory derived from the parent session. Sessions are always enabled.

## `singleRunOutputBaseDir`

```json
{ "singleRunOutputBaseDir": "~/.pi/subagent-outputs" }
```

Routes relative `output` paths for single-agent `/run` calls under this directory. Absolute per-call or agent output paths are still used as-is. When unset, relative single-run outputs go under the run's output artifact directory instead of the project root.

## `maxSubagentDepth`

```json
{ "maxSubagentDepth": 1 }
```

Controls nested delegation when no inherited `PI_SUBAGENT_MAX_DEPTH` is already in effect. Per-agent `maxSubagentDepth` can tighten the limit for that agent's child runs, but cannot relax an inherited stricter limit. This applies even to children that explicitly declare `tools: subagent` or `allowNestedSubagents: true`; at the cap, execution fanout is blocked instead of silently hiding nested work.

## `PI_SUBAGENT_PI_BINARY`

```bash
export PI_SUBAGENT_PI_BINARY=/path/to/pi-or-wrapper
```

Overrides the command used to launch child Pi processes. Package wrappers can set this to their own `pi`/agent binary so subagents inherit wrapper flags, environment setup, and bundled resources without relying on `PATH` ordering. Empty or whitespace-only values are ignored.

## `PI_SUBAGENT_TASK_DELIVERY`

```bash
export PI_SUBAGENT_TASK_DELIVERY=file   # auto | file (default: auto)
```

Controls how the task text reaches the child Pi process. `auto` (default) passes short tasks as an inline argv token and writes tasks longer than 8000 characters to a temp `task.md` referenced as `@<path>`. `file` always uses a temp file, keeping the task out of argv entirely.

Use `file` on hosts where endpoint protection (EDR) pre-execution scanning denies child processes whose command line embeds a long natural-language task — that denial surfaces as an immediate zero-activity `SIGKILL`. Independently of this setting, startup retries automatically escalate to file delivery after an unexplained zero-activity `SIGKILL`. Empty, whitespace-only, or unrecognized values fall back to `auto`.

## `intercomBridge`

```json
{
  "intercomBridge": {
    "mode": "always",
    "instructionFile": "./intercom-bridge.md",
    "resultDelivery": true
  }
}
```

Controls whether subagents receive runtime coordination instructions and whether `contact_supervisor` is auto-added to their tool allowlist when needed.

Fields:

- `mode`: default `always`; use `fork-only` to inject only for forked runs, or `off` to disable the bridge.
- `instructionFile`: optional Markdown template replacing the default bridge instructions. `{orchestratorTarget}` is interpolated. Relative paths resolve from `~/.pi/agent/extensions/subagent/`.
- `resultDelivery`: default `false`; set `true` only when an external listener consumes `subagent:result-intercom` and acknowledges the grouped completion payload. This is optional external result delivery, not native supervisor messaging. Enabled delivery waits for acknowledgement and reports acknowledgement failures. It does not change supervisor asks or progress updates.

Bridge activation requires a targetable current parent session id, which `pi-subagents` passes to children automatically. Native supervisor messaging does not require an external `pi-intercom` installation or per-agent extension allowlists: children use `contact_supervisor`, and parents use `subagent_supervisor` to inspect or reply. Agents can still use an external `intercom` tool when they explicitly request a provider that supplies it.

The default injected guidance tells children to use `contact_supervisor` with `reason: "need_decision"` when blocked or needing a decision, `reason: "progress_update"` only for meaningful blocked/progress updates, and avoid routine completion handoffs.

## `worktreeBaseDir`

```json
{ "worktreeBaseDir": "/Users/matt/code/.worktrees/pi-subagents" }
```

Sets the base directory for `worktree: true` runs. Relative paths resolve from the repository root, `~/...` expands to your home directory, and `PI_SUBAGENTS_WORKTREE_DIR` is used when config is unset. The default remains the system temp directory.

## `worktreeSetupHook`

```json
{
  "worktreeSetupHook": "./scripts/setup-worktree.mjs",
  "worktreeSetupHookTimeoutMs": 45000
}
```

The hook runs once per created worktree. Paths must be absolute, `~/...`, or repo-relative; bare command names are rejected.

stdin is a JSON object with `repoRoot`, `worktreePath`, `agentCwd`, `branch`, `index`, `runId`, and `baseCommit`. stdout must be one JSON object, for example:

```json
{ "syntheticPaths": [".venv", ".env.local"] }
```

`syntheticPaths` must be relative to the worktree root. They are removed before diff capture so helper files do not pollute patches. Tracked files are never excluded; marking a tracked path as synthetic fails setup. Default timeout is `30000` ms.

## `missions`

```json
{
  "missions": {
    "enabled": true,
    "globalIndex": true,
    "retainTerminal": 200
  }
}
```

Deprecated compatibility setting. Package 2a stopped mission creation and mission actions. Only `directory` changes where passive Fleet/status readers look for records created before Package 2a. Remove the setting after old runs are no longer needed. Compatibility may be removed no earlier than after one published release containing Package 2a; see [Package 2a](deep-simplification-package-2a.md).

- Legacy mission records default to a project-keyed directory under pi's agent directory (`~/.pi/agent/missions/projects/<project-hash>/`). This keeps the project worktree clean.
- `directory` may be absolute, `~/...`, or project-relative. It is only a passive lookup location for existing records.
- The legacy `enabled`, `globalIndex`, `globalIndexDir`, and `retainTerminal` config shapes remain accepted but inert.
- Persisted legacy bindings may also contain `writeGlobalIndex` and `retainTerminal`. They are accepted for schema-v1 compatibility and do not enable writes.
- Compatibility readers never prune records, heal pointers, or write global indexes.

## `authorityPolicy`

```json
{
  "authorityPolicy": {
    "discardWorktree": "confirm",
    "destructiveCleanup": "confirm",
    "spawnBudgetGrant": "confirm",
    "scheduleCreate": "auto",
    "stopRun": "auto",
    "steerRun": "auto"
  }
}
```

Each fixed action resolves to `"auto"`, `"confirm"`, or `"forbid"`. This is intentionally a small action map, not a generic policy language. Confirm-required control actions fail closed without an interactive UI. `scheduleCreate` is accepted but inert after Package 2b.

## `artifactDir`

```json
{ "artifactDir": "session" }
```

Controls where subagent artifact files (inputs, outputs, transcripts, metadata) are stored:

- `"project"`: writes to `<cwd>/.pi/subagents/artifacts/`.
- `"session"` (default): stores artifacts under pi's session directory (`~/.pi/agent/sessions/<session>/subagent-artifacts/`), keeping the working directory clean. It falls back to the OS temp directory when no session file exists.
- `"temp"`: uses the OS temp directory.

This preference applies equally to direct runs and scripted workflows. The `"session"` option uses the same directory that `cleanupAllArtifactDirs` scans for age-based cleanup. Historical `chain-runs` directories are passive compatibility artifacts and are not age-scanned or deleted at startup.

When a project-scoped launch runs from an npm package directory, pi-subagents warns if package settings can include `.pi/subagents/` in the published package. Add `.pi/subagents/` to `.npmignore` (or `.gitignore` when no `.npmignore` exists), use a `files` allowlist that does not include `.pi/subagents/`, or select `"session"` or `"temp"`.

## `completionBatch`

```json
{
  "completionBatch": {
    "enabled": true,
    "debounceMs": 150,
    "maxWaitMs": 1000,
    "stragglerDebounceMs": 75,
    "stragglerMaxWaitMs": 400,
    "stragglerWindowMs": 2000
  }
}
```

Controls smart batching of async-completion notifications. When several background subagents finish within a short window, their successful completions are held briefly and delivered as a single quiet grouped completion instead of separate completions.

- A hard `maxWaitMs` cap (measured from the first completion in a group) guarantees nothing is held indefinitely.
- Late-finishing siblings that arrive within `stragglerWindowMs` of a group emit join a shorter straggler group governed by `stragglerDebounceMs` and `stragglerMaxWaitMs`.
- Failed and paused completions bypass batching and fire immediately, flushing any held successes first, so failure and needs-attention signals are never delayed.
- Set `enabled` to `false` to restore the original one-notification-per-completion behavior. Changes apply on the next session start.

## `permissions`

Native child tool permission rules. `allow` and `deny` retain their native behavior. `ask` fails closed in delegated children with an actionable deterministic error because core has no interactive or model permission arbiter. Historical `subagents.watchdog` settings are inert for one Package 3a release; do not configure them. See the [watchdog removal and migration stub](watchdog.md).

## `PI_SUBAGENT_FS_RETRY_MAX_TOTAL_MS`

Caps the total time a single retried filesystem operation may sleep, in milliseconds. Environment-only; there is no config key.

Atomic status and result writes retry on `EACCES`, `EBUSY`, and `EPERM`, which on Windows are usually a scanner or a sibling process holding the destination of a rename for a moment. The retry ladder sleeps up to about 7.9s in total, and it sleeps *synchronously* — `Atomics.wait` parks the calling thread rather than spinning.

That is the right trade-off for a CLI. It is the wrong one for a long-lived process that loads `pi-subagents` in-process and runs those writers on its event loop: one contended rename stalls everything it serves for the length of the ladder, and because the thread is parked rather than busy, it presents as an unresponsive process sitting at 0% CPU. A wide fanout makes contention on a single `status.json` likely.

Set this to bound that stall. The ladder keeps its number of attempts and only the sleeps shrink, because `run-fanout-budget` and workflow state locking use the ladder's length as their attempt budget:

```text
PI_SUBAGENT_FS_RETRY_MAX_TOTAL_MS=1000
```

Unset by default, so behaviour is unchanged unless you opt in. Opting in trades lock-wait tolerance for responsiveness: entries clamped to `0` return immediately, so contention that would previously have been waited out surfaces as an error sooner. Values that are not a non-negative integer fail instead of being coerced.
