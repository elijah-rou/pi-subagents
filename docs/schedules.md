# Legacy schedules

Package 2b stopped scheduling in core. Startup does not scan schedule records, arm timers, poll due work, launch scheduled workflows, observe completions into schedule history, or protect async artifacts because they appear in schedule history. `/subagents-stop` controls only live foreground and async runs.

For one-release read compatibility, trusted RPC `manage` retains only `schedule.list`, `schedule.show`, and `schedule.history`. These passive readers inspect existing schema-v1 records under the selected project directory. They are lazy, stop directory iteration after 256 candidates, return at most 100 definitions or history entries within aggregate byte bounds, and use no-follow bounded descriptor reads with replacement checks. They never create directories, write, or heal records, and leave unknown, corrupt, symlinked, raced, or oversized files untouched. Model/public execution rejects every schedule action. `schedule.create`, `schedule.pause`, `schedule.resume`, `schedule.run`, `schedule.run-due`, and `schedule.delete` are removed.

The default legacy location remains `<cwd>/.pi/subagents/schedules/<id>/`. If `scheduledRuns.storeRoot` is configured, lookup preserves the prior project identity: the first 20 hexadecimal characters of SHA-256 over the resolved project working directory. `scheduledRuns.enabled` and `scheduledRuns.maxPending` are accepted but inert during the compatibility release. `authorityPolicy.scheduleCreate` is also accepted but inert. `scheduledRuns.storeRoot` is the only schedule setting that affects runtime behavior, and only by locating legacy records.

`ScheduleOrigin` remains readable in pre-Package-2b status, result, and notification artifacts so historical attribution still renders. New direct, async, and workflow launches cannot emit schedule origin.

The three readers and retained configuration/artifact parsing may be removed no earlier than after one published release containing Package 2b. Export or inspect records before that horizon ends; there is no execution or mutation migration path in core.
