---
description: Review/fix loop until clean
---

Run a parent-orchestrated review loop for the requested work.

Use the `subagent` tool. The parent controls the loop, dispositions, and final decision. Commission each child with the canonical packet in `skills/pi-subagents/references/commissioning.md`; children get bounded role tasks and no implicit loop or child-launch authority.

Use one broad review round by default. Necessary focused finding re-review is outside that default broad-round budget. If I specify a cap, honor it as a ceiling and count every broad or focused review invocation. Stop early when no P0, P1, or approved in-loop P2 remains.

For implementation, launch one async `worker` for the approved scope; for an existing diff, start with review. Use async `workflowScript` only for a known sequence or follow-up. Do not set `clarify: true` unless requested. Keep one writer per active worktree unless isolated worktrees are requested.

As a conservative orchestration policy, do not set a hard `toolBudget` or tight `usageBudget` on implementation or fix workers. A default tool budget blocks read/search tools rather than mutation tools, so count limits do not measure delivery safety. Bound the delivery slice and elapsed deadline. Before it, request a checkpoint after the current tool returns with changed files, build/test state, remaining work, and commit or PR state; elapsed timeout is not the checkpoint trigger.

For an ordinary coherent behavioral change, use one fresh high-quality `reviewer`. Use two only for distinct elevated risks such as security, concurrency, architecture, or high blast radius. Parent-only inspection is enough for trivial or fully machine-decided changes when I did not request review. If I explicitly request parallel review or a reviewer count, honor that fanout. Give multiple reviewers distinct contracts. Reviewers inspect the repo, instructions, and diff directly without main-chat history or edits.

Require concrete current issues caused or made reachable by the diff, supported by source proof, a repro/test, or a contract contradiction. Label findings P0/P1/P2 and end with `Merge verdict: BLOCK`, `Merge verdict: OK`, or `Merge verdict: OK with notes`. P0 blocks; P1 must be fixed before release; P2 is report-only. Reserve `blockers only` for final checks after P1/P2 are recorded or explicit emergency hotfix lanes.

Assign stable finding IDs and preserve severity in every disposition:
- P0/P1: fix, escalate, or report blocked;
- P2: fix or defer with reason;
- invalid/stale feedback: reject with reason.

Do not apply suggestions blindly. Ask me before fixing an unapproved product, scope, or architecture decision. An implementation worker handoff transitions into review, not final completion, unless I requested worker-only, review-only, or implementation-only work.

For authorized fixes, launch one fresh async `worker` without hard tool-call caps. Its canonical packet contains only accepted finding IDs, severity, required outcomes, evidence obligations, affected seams, and targeted checks, not reviewer transcripts or full reports. Resume an existing worker only for the same role, seam, repo/cwd/ref, authority boundary, and bounded working state. Use a fresh child for a new role, adversarial review, or unrelated phase. Require changed files, exact command results, validation evidence, surprises, and unfinished work.

After fixes, rerun affected deterministic gates. Do not trigger broad re-review for machine-decidable corrections. Use focused re-review only for unresolved semantics or the fix blast radius. Ask whether the named finding is resolved, the fix introduced a concrete defect in that radius, and recorded P1/P2 notes still stand.

Never silently skip a known P0 or P1. Fix it, escalate the decision, or report delivery blocked. If a cap prevents required focused re-review or leaves known P0/P1, report blocked, not clean. Otherwise stop when no P0/P1 remains, only P2/invalid/stale feedback remains, or an unapproved decision needs me.

Budget validation across the work: run targeted checks for each changed slice, checkpoint or full-suite checks after dependent groups, and final validation against the complete delivery. Inspect the final diff and summarize rounds, fixes, targeted/checkpoint/final validation, deferred items, and stop reason.

Additional target, implementation request, max-iteration cap, or review focus:

$@
