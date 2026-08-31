# Migrating from the pre-v0.59 fork

This is the upgrade checklist for users moving from the fork before the v0.46–v0.59 integration to `0.59.0-fork.1` or later. Complete the common actions first, then review the behavior changes below.

## Common upgrade actions

1. **Reload Pi after installing the new package.** Settings and agent/profile files are loaded into the live runtime; after editing either, reload Pi again. Existing running or persisted launches retain their saved contracts rather than being reinterpreted with new defaults.
2. **Move retained project-scoped state you still need** from `<project>/.pi-subagents/` to `<project>/.pi/subagents/` before relying on it. Project artifacts, views, cleanup plans, and workflow artifacts configured with `artifactDir: "project"` use `.pi/subagents/`. Package 2b no longer creates schedules; passive readers inspect only existing records at `.pi/subagents/schedules/`. Package 3e no longer reads or writes refinement overlays; existing `.pi/subagents/refinements/` files remain untouched inert unknown artifacts for one published release. There is no general automatic migration from `.pi-subagents/`.
3. **Review concurrency settings.** Omitted `maxActiveAsyncRunsPerSession` now means `4`. To retain the old unlimited active top-level async behavior, set this exact compatibility override in the extension config and reload Pi:

   ```json
   { "maxActiveAsyncRunsPerSession": 0 }
   ```

4. **Review custom agent isolation.** When `inheritProjectContext` resolves to `true`, omitted `inheritGlobalContext` now also resolves to `true`. Set `inheritGlobalContext: false` explicitly only for an agent that must exclude operator-global instructions.
5. **Replace removed launch shapes and vendor builtins.** Rewrite legacy multi-child inputs as `workflowScript`; define or install every external CLI profile you intend to use.
6. **Remove retired Orca configuration.** Package 3b no longer discovers or invokes Orca. `orcaProgressTabs` is tolerated inertly for one published Package 3b release, and existing `.pi/subagents/views/orca` or temporary mirror artifacts are left untouched.
7. **Run the read-only diagnostic command** `/subagents-doctor` (the same report is available through `subagent({ action: "doctor" })`). Agent listing, management actions, and diagnostics are separate: use `subagent({ action: "list" })` to list agents, and do not expect `doctor` to appear there.

## Acceptance is enforced when inferred

Omitting `acceptance`, or setting it to `"auto"`, now installs an enforced report contract. Mutating work must return checked writer evidence; explicitly read-only work receives a lightweight attested report without writer evidence. A missing or rejected required report blocks successful completion, including when `agentContract: { version: 1 }` is used. The v1 separate/non-blocking acceptance projection applies only to explicitly supplied acceptance; omitted and `"auto"` acceptance remain inferred and fail closed.

To opt out deliberately, use `acceptance: false`. The legacy compatibility object `{ level: "none", reason: "..." }` remains readable; include a concrete reason so the opt-out is visible in status and receipts. New composed contracts should use the canonical `report`, `verify`, `review`, and `onFailure` dimensions. Old persisted acceptance contracts remain readable, while new runs emit the canonical contract.

See [Acceptance gates](tool-reference.md#acceptance-gates).

## Global instructions are authoritative by default

For an agent that inherits project context, omitted `inheritGlobalContext` now preserves operator-global `AGENTS.md`, `AGENTS.override.md`, and `CLAUDE.md` files from the Pi config agent directory as well as project instructions. This restores the same authority boundary for child sessions.

Use `inheritGlobalContext: false` for explicit global-policy isolation or token savings. Use `inheritProjectContext: false` for complete inherited-context isolation; in that case the global setting has no effect because all inherited context is removed. Reload Pi after changing agent frontmatter or `agentOverrides`. Recovery descriptors already on disk retain their recorded inheritance values.

See [Prompt assembly](agents.md#prompt-assembly).

## Concurrency and child totals have distinct scopes

These defaults are independent:

| Setting | Default | Exact scope |
|---|---:|---|
| `maxActiveAsyncRunsPerSession` | `4` | Concurrent active top-level async runs owned by the current parent session. |
| `globalConcurrencyLimit` | `20` | Simultaneously running children inside each top-level run. The key is retained for compatibility; it is not session-wide or machine-wide. |
| `maxSubagentSpawnsPerRun` | `64` | Cumulative logical child admissions in one top-level run tree. |
| `maxSubagentSpawnsPerSession` | unlimited | Cumulative child launches in one parent session; configure a positive value to cap it. |

Only `maxActiveAsyncRunsPerSession: 0` restores unlimited active top-level async runs. It does not alter the other three limits. Reload Pi after editing the extension config; existing active runs continue under their admitted state.

See [Per-run child concurrency](configuration.md#per-run-child-concurrency-globalconcurrencylimit) and [`maxActiveAsyncRunsPerSession`](configuration.md#maxactiveasyncrunspersession).

## Provider profile/catalog administration was removed

The five provider administration commands for listing, loading, refreshing, generating, and checking saved profiles are no longer registered. Move current model assignments into user or project `subagents` settings or agent frontmatter. No automatic migration runs: existing `~/.pi/agent/profiles/pi-subagents/` JSON remains untouched for one published release, and settings already applied from an old saved profile remain ordinary current settings.

This does not affect explicit external CLI agent profiles, their adapters, child-profile routing, `context: "profile"`, or static model selection.

## Vendor profiles must be defined or installed

`codex-exec`, `codex-exec-writer`, `claude-code`, `claude-code-writer`, `cursor-agent`, and `cursor-agent-writer` are no longer builtin agents and do not appear in the default list. Their code-owned adapters remain available only when an explicitly defined custom profile or installed package selects one.

Copy the appropriate read-only or writer profile from [External CLI runner data boundary](agents.md#external-cli-runner-data-boundary) into a user or project agent `.md` file, or install a package that declares an agent directory through `pi-subagents.agents` or `pi.subagents.agents`. Install and authenticate the matching local CLI, then reload Pi and confirm only the intended profile appears with `subagent({ action: "list" })`. Listing parses metadata only; adapter-specific executable/version/help checks occur at launch.

Read-only adapter identities cannot be widened into writers. Select the distinct `*-writer` adapter identity explicitly when mutation is intended.

## Turn budgets and legacy workflow APIs were removed

Assistant turn-budget launch configuration, including `turnBudget` and `maxTurns`, no longer controls new runs. Use a narrow task plus `timeoutMs` or `maxRuntimeMs`; use `checkpointAfterMs` or `steer` when a child should prepare a handoff before the deadline. Historical status and receipt fields may still be read and displayed for compatibility, but they are not current launch configuration.

Legacy top-level `chain`, `tasks`, `parallel`, and `chainDir` inputs; `/chain`, `/parallel`, `/run-chain`, and `/chain-prompts`; durable `.chain.md` execution; and the `append-step`, `approve-checkpoint`, and `reject-checkpoint` controls are no longer public execution APIs. Use direct `{ agent, task }` for one child. Use `workflowScript` with `runs.run(...)`, `runs.all(...)`, and ordinary JavaScript for sequence and parallelism. Saved chain records and legacy path templates remain inspection or migration material only.

See [Migrating old chain shapes](workflows.md#migrating-old-chain-shapes).

## Reviewer and advisor roles are read-only

The bundled `reviewer` has only `read`, `grep`, `find`, and `ls`; `oracle` and its `advisor` alias are advisory and do not edit by default. Review-only/no-edit instructions take precedence over artifact-writing or progress-writing requests. Choose `worker` for native Pi implementation, or an explicitly named external writer profile for external CLI mutation. Do not rely on a reviewer/advisor name plus a mutating task to widen its tools.

See [Builtin agents](agents.md#builtin-agents) and [Budget guidance for writers](tool-reference.md#budget-guidance-for-writers).

## Launch validation is stricter

Explicit or configured native model selections must resolve in the active host model registry before child startup; use `subagent({ action: "models" })` or `/subagents-models` to inspect the live mapping. The already-running parent session model is intentionally trusted when it is inherited, even if that model is absent from the registry, so gateway and proxy sessions remain compatible; this exception does not soften validation for an explicit concrete per-run, agent, fallback, or configured default selection. Explicit tool names are checked against the child runtime's final filtered registry, and a missing provider fails the run instead of silently dropping the requested tool. Load a tool provider through `extensions` or `subagentOnlyExtensions` and include the exact registered tool name.

External CLI profile metadata must declare a supported runner shape and a non-empty command. Code-owned adapters enforce fixed argv and access contracts; unsupported native Pi options fail rather than being pretended. Launch preflight also fails when the configured executable is absent or its adapter-specific version/help contract is not satisfied. Reload Pi after changing model settings, tool extensions, MCP connections, or profile files; a newly connected direct MCP server specifically requires a restart because its metadata is cached at startup.

See [Models](models.md), [Tool and extension selection](agents.md#tool-and-extension-selection), and [External CLI agent profiles](tool-reference.md#external-cli-agent-profiles).

## Package 1 cleanup and pane access

Package 1 removed broad worktree cleanup and project/inspector pane actions from the model surface. Neither area has a supported replacement command or package API. `worktree.discard` remains the only destructive model action and keeps confirmation plus handoff-path validation. Use `/subagents-fleet`, status, and transcripts. Package 3c removed passive pane observation and all inspector/project-pane seams. For one published release, old binding JSON, project-pane root indexes, metadata, environment variables, and legacy session-root payloads are unknown inert inputs or artifacts: core does not read, write, heal, delete, or migrate them. Existing `fleetKeybindings.inspect` arrays are also accepted, validated, and preserved by unrelated config updates during this horizon, but cannot activate a Fleet action. Do not replace removed exports with internal source imports.

## Package 3a watchdog removal

The built-in watchdog, `/subagents-watchdog`, and all `watchdog.*` actions are removed. Replace automatic review with an explicit reviewer child or `workflowScript` review lane. Child permission rules must now use explicit `allow` or `deny`; `ask` deterministically denies. Existing watchdog settings and persisted watchdog status fields/events are inert for one published Package 3a release and may be removed after that release.
