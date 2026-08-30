# Watchdog removal and migration

The built-in pi-subagents watchdog was removed from core in Package 3a. Main and child watchdog runtimes, automatic model review, `/subagents-watchdog`, the four `watchdog.*` actions, watchdog model selection and settings writers, warning rendering, child tail delays, and the watchdog LSP review loop no longer exist. No watchdog setting can enable this behavior.

Use an explicit reviewer child or `workflowScript` review lane instead. Explicit review keeps the parent in control and uses the ordinary delegation, acceptance, timeout, visibility, and recovery contracts.

## Child tool permissions

Native non-bash child permission rules still support `allow`, `ask`, and `deny` as configuration values:

- `allow` passes the tool call through.
- `deny` blocks the tool call.
- `ask` always denies before tool execution with a deterministic message directing the operator to choose `allow` or `deny`.

There is no model permission arbiter and no permission audit writer. `bash` remains outside this gate and should be governed with pi-guard or an equivalent launch wrapper. External CLI agents remain opaque and cannot use native child tool interception.

## One-release compatibility

For one published Package 3a release, existing `subagents.watchdog` settings, old result/status `watchdog` properties, `subagent.watchdog.status` events, old warning messages, and `PI_SUBAGENT_WATCHDOG_CHILD_CONFIG` are accepted as inert input. They cannot activate review, delay finalization, emit warnings, change outcomes, or widen authority.

Core does not create or mutate watchdog settings. Unrelated settings or profile rewrites may preserve an unknown existing `subagents.watchdog` subtree unchanged. Existing audit files and repository `WATCHDOG.md` files are not modified. This passive compatibility may be removed after one Package 3a release has been published. See [Package 3a](deep-simplification-package-3a.md) for evidence and exact scope.
