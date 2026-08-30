# Legacy mission compatibility

Package 2a removed mission and goal management from new delegation. Direct runs, workflows, workflow children, and schedules do not create mission records, bindings, indexes, details, content, or goal notices. Former mission actions and request fields are rejected on model and trusted-host surfaces.

Existing records remain passively readable by status, Fleet, and Herdr. Async directories that already contain a schema-v1 `mission.json` binding retain completion synchronization so in-flight pre-Package-2a results are not lost. No current launch creates that binding or a mission observer index. Unknown artifacts are preserved without rewriting.

The `missions` configuration key is deprecated and retained only to locate legacy records. This compatibility reader/writer may be removed no earlier than after one published release containing Package 2a.

Use `status`, `debug.run`, Fleet, `subagent_wait`, async status/events/results, process-terminal proof, workflow receipts, and workflow-child summaries for recovery. Use native `steer`, `interrupt`, `resume`, and `stop` controls where supported. `runs.state.get/set` is workflow-owned and writes bounded atomic state under the workflow lifecycle or artifact root.

Schedules remain operational and independent of missions.
