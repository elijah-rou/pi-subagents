# Pi Subagents: Review And Validation

Generic review and delivery guidance for delegated work. This file does not encode private backlog, merge, or release policy.

## Delivery loop

Use the smallest loop that proves the change:

1. Inspect the source, diff, issue, or plan directly.
2. Keep one writer for each cwd or worktree.
3. Run targeted slice checks that can fail for the changed behavior.
4. Use fresh-context read-only review when the review budget below requires it.
5. Re-route to [`commissioning.md`](commissioning.md) and give the fix writer only accepted finding IDs, evidence obligations, and affected seams.
6. After deterministic corrections, re-run affected deterministic gates without broad re-review. Use focused re-review only for unresolved semantics or defects in the fix blast radius.
7. Run checkpoint or full-suite checks after dependent groups, then final validation against the complete delivery.
8. Inspect the final diff and evidence before parent acceptance.

Parent-only inspection is enough for trivial or fully machine-decided changes when the user did not request review.

## Review shape

| Situation | Shape |
| --- | --- |
| Material semantic judgment remains after affected checks | one fresh read-only reviewer |
| Distinct elevated risks, such as security, concurrency, architecture, or high blast radius | two reviewers only, with distinct risk contracts |
| Low-risk, fully machine-decided change, with no user review request | parent-only inspection |
| Explicit user fanout or round cap | honor the requested fanout or cap |
| Possible over-scope or needless complexity | same-writer challenge before fresh review |
| Material design tradeoff | council mode |

User and repository policy own review selection. This table is the fallback when they do not specify it. Reviewer count is a budget, not a quality score. Map it before implementation and revise only for new risk. Default to one broad round; necessary focused finding re-review is outside that budget. An explicit cap counts every review invocation; if it prevents required re-review, report blocked. Reviewers are fresh-context by default. Forked reviewers are for parent-history, drift, or prior-decision evidence.

## Finding disposition

The parent classifies each finding against current HEAD:

- **Valid P0/P1:** concrete failure, repro, security issue, contract mismatch, or source-proven regression. Preserve severity; fix, escalate, or report blocked. Never defer it as optional.
- **Valid P2:** real but non-blocking. Preserve severity; fix or defer with a reason.
- **Stale:** fixed or absent at the reviewed head. Cite current evidence.
- **Invalid:** contradicted by source, tests, docs, or user-approved scope. Cite the contradiction.
- **Out of policy/scope:** needs unapproved product, architecture, authority, release, or public-repo action. Escalate.
- **Speculative:** no contract, repro, or reachable failure. Do not block.

A clean reviewer result is evidence, not publication authority. Never silently skip a known P0 or P1 finding: fix it, escalate the unresolved decision, or report the delivery as blocked.

## Gate-failure triage

When validation fails:

1. Confirm the run belongs to the exact head/ref under judgment.
2. Read the focused failing logs first.
3. Name the failing test, assertion, contract, or thread.
4. Classify cause: current diff, stale test, environment/setup, or existing flake.
5. Reproduce locally when practical with the narrowest command.
6. Patch forward when the current diff caused it.
7. For stale/flaky failures, collect proof before one rerun or residual-risk note.
8. Re-run the affected command or exact-head gate after every fix.

For bot comments, classify each thread as valid, stale, invalid, or out of policy before assigning severity.

## Final checklist

Before reporting delegated work as done, verify the relevant subset:

- final diff contains only intended files
- focused validation covers changed behavior
- substantial or risky changes have fresh-review evidence
- accepted findings are fixed and revalidated
- publication authority exists before push, comment, close, merge, deploy, or release
- external checks are exact-head when used as evidence
- handoff is durable before cleanup
- residual risks, skipped validation, and blocked decisions are explicit

## Public/private boundary

For issue/PR backlogs, releases, merge queues, contributor credit, or repo-specific policy, load the matching user/project skill when available. Keep those rules out of this public package until intentionally released.
