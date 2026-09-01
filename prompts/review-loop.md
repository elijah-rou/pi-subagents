---
description: Review/fix loop until clean
---

Run a parent-orchestrated review loop for the requested work.

Use the `subagent` tool. Keep the parent session as loop controller and final decision-maker. Commission every child with the canonical packet in `skills/pi-subagents/references/commissioning.md`. Children receive bounded role-specific tasks and must not manage the loop or launch children unless that authority is explicit.

Default to a maximum of 3 review rounds unless I specify a different cap. Count a review round each time fresh-context reviewers inspect the current diff after a worker pass. Stop early when reviewers find no P0 findings, no P1 fixes worth doing now, and no approved P2 notes that should be handled in this loop.

For an implementation request, launch one async `worker` for the approved scope; for an existing target diff, start with review. Use an async `workflowScript` for a known sequence or follow-up runs after completion. Do not set `clarify: true` unless requested. Keep one active-worktree writer unless isolated worktrees are requested.

As a conservative orchestration policy, do not set a hard `toolBudget` or tight `usageBudget` on implementation or fix workers. A default tool budget blocks read/search tools rather than mutation tools, and reported usage has no reservation model, so count or usage limits still do not measure delivery safety. Give each writer a narrow delivery slice and an outer elapsed deadline with enough margin. Before that deadline, request a checkpoint after the current tool returns with changed files, build/test state, remaining work, and commit or PR state. An elapsed timeout is not a mutation-safe boundary and must not be the checkpoint trigger.

Each round uses parallel fresh-context `reviewer` agents. They inspect the repository, instructions, and current diff directly, without main-chat history or edits.

Tell reviewers to filter on evidence, not severity. They should report only concrete current issues caused or made reachable by the target diff, with source proof, a test or repro, or a contract contradiction. Ask them to label findings P0/P1/P2 and end with `Merge verdict: BLOCK`, `Merge verdict: OK`, or `Merge verdict: OK with notes`. P0 blocks merge. P1 should be fixed before release. P2 is report-only. Use `blockers only` only for final pre-merge re-checks after P1/P2 findings are already captured, or for explicit emergency hotfix lanes.

Choose angles from the change: correctness/regressions, tests/validation, simplicity/maintainability, or relevant security, performance, docs/API, and user-flow risks. Prefer three strong reviewers over many vague reviewers.

After reviewers return, assign stable finding IDs and synthesize their feedback into:
- P0 blockers or scope/product/architecture decisions that need user approval;
- P1 fixes worth doing now;
- P2 report-only notes or optional improvements;
- feedback to ignore or defer, with a short reason.

Do not blindly apply every reviewer suggestion. If reviewers surface an unapproved product, scope, or architecture decision, pause and ask me before launching a fix worker.

When an async implementation worker completes, treat its handoff as the transition into review, not as final completion, unless I explicitly asked for worker-only work, review-only output, or to stop after implementation.

When fixes are implementation-authorized, launch one fresh async `worker` without hard tool-call caps. Its canonical packet contains only accepted finding IDs, required outcomes, evidence obligations, affected seams, and targeted checks, not reviewer transcripts or full reports. Resume an existing worker only for the same role, seam, repo/cwd/ref, authority boundary, and bounded working state. Use a fresh child for a new role, adversarial review, or unrelated phase. Require changed files, exact command results, validation evidence, surprises, and anything left undone.

After a fix worker returns, run another review round only when it made material changes or addressed non-trivial findings. Do not keep looping for optional polish, speculative improvements, or findings already deferred by the parent.

For a targeted follow-up review, ask only three questions: whether the named finding was resolved, whether the fix introduced a new concrete defect in the fix blast radius, and whether prior P1/P2 notes still stand. End with a fix verdict and the merge verdict.

Stop and summarize when one of these is true:
- reviewers find no P0 blockers or P1 fixes worth doing now;
- remaining feedback is optional, speculative, or intentionally deferred;
- reviewers surface an unapproved decision that needs me;
- the max review-round cap is reached.

On completion, inspect the final diff yourself, run or confirm focused validation where appropriate, and summarize the loop: rounds run, fixes applied, validation, remaining deferred items, and why the loop stopped.

Additional target, implementation request, max-iteration cap, or review focus from the slash command invocation:

$@
