# Delegation efficiency plan

Status: proposed

## Goal

Reduce avoidable context, review, waiting, and accounting overhead without weakening parent control, completion evidence, runtime visibility, or fail-closed behavior.

This plan covers only `pi-subagents`. Operator model selection, compaction settings, private workload data, and repository-specific policy are out of scope.

## Delivery order

Implement each workstream as a separate reviewable change. Reproduce the behavior on current `main` before changing runtime code; an older installed revision may not reflect the current implementation.

1. Make worker acceptance reports reliable.
2. Load only the skill references needed for the active task.
3. Bound packaged review recipes by risk and remaining uncertainty.
4. Verify interactive completion wake-up behavior.
5. Define one authoritative parent-plus-child usage surface.

## 1. Make worker acceptance reports reliable

### Problem

A representative worker run completed its edits and validation but failed acceptance because the generated report used `criteriaSatisfied[].criterion` and omitted each item's `evidence`. The parser accepts `id`, `status`, and `evidence`, as documented by `formatAcceptancePrompt()` in `src/runs/shared/acceptance.ts`.

The current prompt already shows the accepted shape, so do not assume that relaxing the parser is the right fix. First determine whether the failing run used stale code, failed to receive the prompt, bypassed structured output, or ignored a visible contract.

### Required work

- Reproduce the failure through the production worker acceptance path on current `main`.
- Trace the report contract from acceptance resolution through child prompting, structured or fenced output capture, parsing, and terminal status.
- Keep malformed or incomplete evidence fail-closed.
- If current `main` already avoids the failure, add the missing regression and make no runtime compatibility change.
- If a runtime change is required, keep one canonical report shape across prompts, schemas, examples, types, and parsers.

### Acceptance

- A production-path fixture submits the documented report shape and completes successfully.
- A report with `criterion` instead of `id` is either prevented before submission or rejected with a precise actionable error.
- Missing required per-criterion evidence remains rejected.
- Foreground, async, resumed, fenced-output, and structured-output paths use the same contract where applicable.

## 2. Load only the references needed for the active task

### Problem

`skills/pi-subagents/SKILL.md` routes readers to domain references, but broad-task guidance can still lead a parent to load several large references before it knows which execution branch it needs. The current skill tree exceeds 100 KB, with most text in `prompting-and-roles.md` and `execution-controls.md`.

### Required work

- Make the top-level skill a strict router to the smallest useful reference set.
- Keep always-on safety constraints in the top-level skill.
- Move or retain detailed material under domain references without duplicating it across branches.
- Point review work to `review-and-validation.md` and independent-lane work to `multi-lane-orchestration.md` before broader references.
- Add runtime support only if guidance and package structure cannot enforce selective loading reliably.

### Acceptance

- A one-child review task needs the top-level skill plus only the review reference.
- A basic async launch needs the top-level skill plus only the execution reference.
- Management and authoring work does not require review or orchestration recipes.
- Cross-references resolve, and no safety or control requirement becomes branch-dependent by accident.
- Record before-and-after byte counts for the references loaded by representative review, async, management, and multi-lane tasks.

## 3. Bound packaged review recipes

### Problem

`prompts/review-loop.md` defaults to as many as three review rounds and says to prefer three reviewers. That is too broad for an ordinary coherent diff and can trigger repeated review after deterministic corrections.

### Required work

- Keep explicit user-requested multi-round and multi-reviewer workflows available.
- Default an ordinary coherent behavioral change to one fresh high-quality reviewer.
- Use two reviewers only for distinct elevated risks such as security, concurrency, architecture, or high blast radius.
- Allow parent-only inspection for trivial or fully machine-decided changes when the user did not explicitly request review.
- After a fix pass, use deterministic gates for machine-decidable corrections and focused re-review only for unresolved semantics or the fix blast radius.
- Remove guidance that treats reviewer count or repeated broad rounds as quality by default.

### Acceptance

- Packaged prompts and references describe the same commissioning rule.
- `/review-loop` still honors an explicit round cap or requested review fanout.
- The default recipe cannot silently skip a known P0 or P1 finding.
- Tests cover the packaged prompt contract without encoding operator-specific policy.

## 4. Verify interactive completion wake-up

### Problem

The package documents that an interactive parent may yield after an async launch and wake on completion without calling `subagent_wait()`. Headless run-to-completion flows correctly require waiting or auto-drain. This behavior must be proven before changing the runtime.

### Required work

- Add or run a deterministic interactive-session reproduction that launches one async child, ends the parent turn, and observes one completion wake-up.
- Cover completion, failure, and `needs_attention` delivery.
- Confirm that notification batching and deduplication do not suppress the wake-up.
- Confirm that headless auto-drain and explicit blocking waits remain separate paths.
- Make no runtime change if current behavior passes.

### Acceptance

- Interactive completion wakes the owning parent exactly once without polling.
- A non-blocking subscription wakes only for its resolved run or timeout.
- Headless execution does not depend on a future interactive turn.
- Completion remains visible through status and durable artifacts even when delivery fails.

## 5. Define authoritative usage accounting

### Problem

Usage appears in child results, workflow totals, async status, persisted session files, nested summaries, and `/subagent-cost`. Without a stated identity and aggregation rule, retries, resumptions, compactions, nested runs, and notification work can be omitted or counted twice.

### Required work

- Define the accounting identity for a model attempt and the ownership boundary for each aggregate.
- Choose one authoritative parent-plus-child surface; other views must derive from it or state why they are partial.
- Include direct children, nested children, retries, fallbacks, resumptions, and child-session compactions exactly once.
- Include external-run usage only when the adapter reports it; expose unknown usage instead of estimating it.
- Keep parent-session usage separate from child totals while presenting a combined total explicitly.
- Document whether package-generated notifications incur model usage. Do not attribute usage from external notification systems to `pi-subagents`.

### Acceptance

- One fixture covers a direct child, nested child, failed attempt followed by fallback, resumption, and compaction.
- The fixture proves exact equality between unique attempt/session records and the authoritative aggregate.
- Re-reading persisted status or receiving duplicate completion events does not increase totals.
- Missing external usage is reported as unknown, not zero.
- Foreground, async, workflow, status, and `/subagent-cost` views agree for the same completed run.

## Validation

For each workstream:

1. Run the narrow unit or integration test that reproduces the behavior.
2. Run `npm run typecheck`.
3. Run the affected unit and integration suites.
4. Run `npm run test:all` before treating the workstream as complete.
5. Inspect hot-path effects on launch setup, status refresh, result watching, and prompt size where the change can affect them.
6. Record residual risks and any behavior that remains intentionally partial.

A workstream is complete only when its behavior is observable through the production path, its tests fail without the fix, and the change remains within the delegation layer defined by `VISION.md`.
