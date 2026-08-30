# Schedules

Schedules remain operational for Package 2b and are independent of legacy missions. They launch asynchronous `workflowScript` runs with fresh context and use ordinary async status, events, results, workflow receipts, wait delivery, retention, and native controls.

Schedules are managed by trusted RPC hosts, not the model-facing `subagent` tool. Supported management actions are `schedule.create`, `schedule.list`, `schedule.show`, `schedule.history`, `schedule.pause`, `schedule.resume`, `schedule.run`, `schedule.run-due`, and `schedule.delete` where the host exposes them.

A schedule target is one non-empty `workflowScript`. Direct `agent`/`task`, legacy chain/parallel shapes, fork context, foreground execution, and removed mission fields are rejected at normalization. Fixed intervals use `every` values such as `1h`, `24h`, or `7d`; one-shot schedules use `at`. Current overlap policy is `skip`, with catch-up policy `none` or `latest`.

By default definitions live under `<cwd>/.pi/subagents/schedules/<id>/`. Configure `scheduledRuns.storeRoot` with an absolute or `~/` path to store project-keyed schedules elsewhere. `scheduledRuns.maxPending` bounds pending work and defaults to 20. Set `scheduledRuns.enabled` to `false` to disable schedule management and firing.

A scheduled launch does not pass `mission:false` and never creates a mission record, binding, observer index, detail, or goal notice. Recovery and completion use the same authoritative run artifacts as ordinary workflows.
