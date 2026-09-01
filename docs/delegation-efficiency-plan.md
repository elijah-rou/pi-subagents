# Delegation efficiency plan

Status: proposed

## Goal

Reduce avoidable context, review, waiting, and accounting overhead without weakening parent control, completion evidence, runtime visibility, or fail-closed behavior.

The package already supports sequence, fanout, branching, and staged lanes through `workflowScript`, `runs.run`, `runs.all`, and `runs.lanes`. Expressiveness is not the main gap. Broad work can still become a series of detached one-child workflows followed by blocking waits because the parent never commits to a whole-program topology.

This plan makes workflow design a separate parent responsibility. The parent maps the complete program before commissioning mutation work, then executes the map as bounded waves. Runtime changes should reinforce that behavior by composing existing primitives, not by restoring the legacy `chain` and `parallel` APIs or adding a project-management layer.

This plan covers only `pi-subagents`. Operator model selection, compaction settings, private workload data, and repository-specific policy are out of scope.

## Design rules

- **Design the program before mutation.** Before initial reconnaissance, record the known phases, owner gates, and unresolved dependencies. After reconnaissance and before the first mutation-capable child, produce one parent-synthesized execution map.
- **Separate the program from its waves.** A whole-program map may require several workflows because product decisions, finding disposition, or operator approval must return to the parent. Do not force the entire program into one script.
- **Use the smallest execution shape.** Launch one bounded child directly. Use one `workflowScript` for one coordinated wave. Use `runs.all` for independent fanout and `runs.lanes` for predeclared stages that do not require parent decisions between them.
- **Treat async as scheduling.** Async execution keeps the parent responsive; it does not define dependencies or useful concurrency. An async singleton followed immediately by a blocking wait is not orchestration.
- **Keep mutation ownership explicit.** Use one writer per checkout or isolate concurrent writers in separate worktrees. Parallelize reconnaissance, review, and validation when their inputs are stable.
- **Commission from synthesized context.** Scouts gather evidence; the parent resolves conflicts and gives the worker one compact implementation packet. Do not make each worker reconstruct the program from broad history.
- **Budget review and validation across the program.** Review coherent implementation slices according to concrete risk. Run targeted checks near the change and full suites at planned checkpoints and final delivery.
- **Return at authority boundaries.** Product, scope, compatibility, security, publication, merge, and unresolved finding decisions stay with the parent or operator.

## Non-goals

- Restore the legacy top-level `chain` or `parallel` execution APIs.
- Require every request to use a staged workflow.
- Turn workflow state into a general issue tracker or project manager.
- Run multiple reviewers or full validation after every edit by default.
- Infer product decisions or mutation authority from a workflow graph.
- Add hot-path runtime work before guidance and existing validation surfaces are measured.

## Delivery order

Implement each workstream as a separate reviewable change. Reproduce runtime behavior on current `main` before changing production code; an older installed revision may not reflect the current implementation.

1. Require whole-program design for broad work.
2. Preview statically declared workflow topology.
3. Make worker acceptance reports reliable.
4. Load only the skill references needed for the active task.
5. Bound commissioning and child handoffs.
6. Bound packaged review and validation recipes.
7. Verify interactive completion wake-up behavior.
8. Define one authoritative parent-plus-child usage surface.
9. Run a matched orchestration benchmark.

## 1. Require whole-program design for broad work

### Problem

`workflowScript` is expressive enough to represent coordinated programs, but it also permits a parent to launch one async child, wait for it, inspect the result, and improvise the next launch. Repeating that pattern serializes independent work, multiplies parent turns, and prevents later read-only stages from starting while the current writer runs.

The top-level skill recommends `runs.lanes` for broad plans, but it does not make the design gate unavoidable or define the minimum program map a parent should produce before commissioning mutation work.

### Required work

- Add a short, high-salience design rule to `skills/pi-subagents/SKILL.md`.
- Add a focused `references/program-orchestration.md` instead of restoring a large always-loaded recipe.
- Route broad, predeclared, or multi-phase requests to that reference before execution details.
- Before reconnaissance, require an intake map containing:
  - user-specified phases and completion conditions;
  - known ordering constraints;
  - unresolved facts and owner decisions;
  - mutation boundaries and likely worktree needs;
  - the first safe reconnaissance wave.
- After reconnaissance and before mutation, require one parent-synthesized execution map containing:
  - phase and lane dependencies;
  - the serial writer critical path;
  - read-only work that can run in parallel or ahead of the writer;
  - owner and parent authority gates;
  - review allocation by risk;
  - targeted and full-suite validation checkpoints;
  - completion, failure, and revisit triggers.
- Explain that the program map may be executed as several coordinated waves. Parent gates must not be buried inside an autonomous child chain.
- Include a canonical pattern:

```text
intake map
→ parallel reconnaissance
→ parent design and owner decisions
→ serial writer critical path with overlapping read-only preparation
→ targeted validation and risk-bounded review
→ parent finding disposition
→ focused fix when needed
→ checkpoint validation
→ final evidence and acceptance
```

- Name the failure pattern explicitly:

```text
async singleton → blocking wait → status inspection → improvised singleton
```

### Acceptance

- Given a request with several named phases, packaged guidance requires a program map before the first mutation-capable child.
- The map covers every named phase, dependency, authority gate, mutation owner, review allocation, and validation checkpoint.
- Guidance distinguishes the whole program from its individual execution waves.
- A one-child task still uses direct execution without unnecessary planning machinery.
- A staged plan uses `runs.lanes` only when no parent decision is required between adjacent stages.
- Existing parent authority and one-writer constraints remain explicit.

## 2. Preview statically declared workflow topology

### Problem

The legacy declarative workflow surface made a complete plan easy to inspect before launch. `action: "validate"` currently checks workflow syntax and several static invariants, but its result does not give the operator a concise view of the topology it can prove.

A preview should recover that inspection benefit without introducing another execution mode. It must stay bounded and must identify the parts of arbitrary JavaScript that it cannot analyze statically.

### Required work

- First inventory what current validation, `runs.lanes` preflight, workflow traces, and status artifacts already expose.
- If those surfaces cannot provide a useful pre-launch view, extend `action: "validate"` with a bounded static manifest for literal workflow structure.
- For statically provable structure, report:
  - stable step, lane, and stage keys;
  - sequential and parallel relationships;
  - declared child count;
  - maximum parallel width when it can be proven;
  - explicit worktree and cwd claims;
  - host-command gates;
  - dynamic regions that validation cannot resolve.
- Return partial manifests honestly. Mark unknown branches or launch counts instead of estimating them.
- Add advisory diagnostics for a `workflowScript` that wraps one ordinary child without using script control flow or workflow-only features. Recommend direct `{ agent, task }` execution.
- Keep diagnostics advisory unless the script violates an existing safety or correctness invariant.
- Do not add model calls, filesystem scans, agent discovery, or persistent project state to validation.

### Acceptance

- A literal `runs.lanes` workflow produces a stable lane and stage manifest without launching children.
- A sequential `runs.run` followed by parallel `runs.all` reports the provable dependency shape.
- A dynamic workflow returns a bounded partial manifest with explicit unknown regions.
- A trivial one-child wrapper receives an actionable advisory without becoming invalid.
- Validation latency and output size remain bounded and are measured before and after the change.
- No legacy workflow API or separate planning runtime is introduced.

## 3. Make worker acceptance reports reliable

### Problem

A worker can complete its edits and validation but fail acceptance when its report uses `criteriaSatisfied[].criterion` instead of `criteriaSatisfied[].id` or omits each item's `evidence`. The parser accepts `id`, `status`, and `evidence`, as documented by `formatAcceptancePrompt()` in `src/runs/shared/acceptance.ts`.

The current prompt already shows the accepted shape, so relaxing the parser is not the default fix. First determine whether the failing run used stale code, failed to receive the prompt, bypassed structured output, or ignored a visible contract.

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

## 4. Load only the skill references needed for the active task

### Problem

`skills/pi-subagents/SKILL.md` routes readers to domain references, but its rule for broad tasks can still make a parent load several large references before it knows which execution branch it needs. The current skill tree exceeds 100 KB, with most text in `prompting-and-roles.md` and `execution-controls.md`.

Whole-program design needs a focused reference, not a return to one large orchestration manual that every delegation task loads.

### Required work

- Make the top-level skill a strict router to the smallest useful reference set.
- Keep always-on safety, authority, and one-writer constraints in the top-level skill.
- Route broad program design to `program-orchestration.md` before detailed execution or review material.
- Point one-child review work to `review-and-validation.md`, basic async launch work to `execution-controls.md`, and independent repository lanes to `multi-lane-orchestration.md`.
- Load review guidance when the program reaches a review gate, not automatically at intake.
- Move or retain detailed material under domain references without duplicating it across branches.
- Add runtime support only if guidance and package structure cannot enforce selective loading reliably.

### Acceptance

- A one-child review task needs the top-level skill plus only the review reference.
- A basic async launch needs the top-level skill plus only the execution reference.
- A broad multi-phase request needs the top-level skill plus the program reference for its intake map; later branches load execution, lane, or review references only when needed.
- Management and authoring work does not require review or orchestration recipes.
- Cross-references resolve, and no safety or control requirement becomes branch-dependent by accident.
- Record before-and-after byte counts for the references loaded by representative review, async, management, and multi-phase tasks.

### Workstream 4 measurement record

Counts are repository-file UTF-8 bytes (`Buffer.byteLength`), so they do not
include absolute paths, filesystem metadata, or other machine-specific data.
Each scenario includes the top-level skill and exactly the routed reference.
The baseline is commit `94b27239`.

| Scenario | Before | After |
| --- | ---: | ---: |
| one-child-review | 10753 | 8012 |
| basic-async | 11064 | 8323 |
| management | 9173 | 6432 |
| broad-intake | 14126 | 11385 |
| top-level skill | 7316 | 4575 |
| full skill tree | 69926 | 67185 |

## 5. Bound commissioning and child handoffs

### Problem

A scout does not reduce context if the worker must still rediscover the same code, reconstruct parent decisions, or consume the scout's full transcript. Resuming a large child session for a loosely related stage can cost more than launching a fresh child with a compact packet.

Broad prompts also blur responsibility. One worker should not simultaneously own discovery, architecture, implementation, documentation, security review, benchmarking, full-suite validation, and final acceptance unless the task is genuinely small.

### Required work

- Define one compact commissioning contract for each child:
  - objective and expected deliverable;
  - repository, cwd, and target ref;
  - edit and authority boundaries;
  - parent-decided constraints and relevant code seams;
  - observable acceptance criteria;
  - targeted validation;
  - output shape and artifact path when needed;
  - stop and escalation conditions.
- Have scouts return bounded, structured evidence keyed to decisions or code seams.
- Require the parent to resolve conflicts and synthesize scout results before commissioning the writer.
- Give workers the synthesized implementation packet rather than copied transcripts or broad parent history.
- Keep each worker on one coherent implementation seam plus its targeted checks.
- Use `resume` only when the next instruction needs the same child's bounded working state. Prefer a fresh child with a compact packet for a new role, adversarial review, or unrelated phase.
- After review, send one writer only the accepted findings, required fixes, affected seams, and validation obligations.
- Avoid copying full review reports into focused re-review prompts when finding identifiers and the changed diff are sufficient.

### Acceptance

- Packaged examples use the same compact commissioning fields.
- A scout-to-worker recipe passes a parent synthesis, not an unfiltered transcript.
- A review-to-fix recipe includes only accepted findings and their evidence requirements.
- Guidance explains when `resume` is cheaper and more reliable than a fresh child, and when it is not.
- Representative child initial-context and prompt byte counts decrease without omitting authority or acceptance requirements.
- No child receives product, publication, merge, or unresolved architecture authority implicitly.

## 6. Bound packaged review and validation recipes

### Problem

`prompts/review-loop.md` defaults to as many as three review rounds and says to prefer three reviewers. That is too broad for an ordinary coherent diff and can trigger repeated broad review after deterministic corrections. Repeating full validation after every small stage can create the same problem with tools and wall time.

Review and validation should be budgeted across the complete program rather than commissioned independently by every substage.

### Required work

- Keep explicit user-requested multi-round and multi-reviewer workflows available.
- Default an ordinary coherent behavioral change to one fresh high-quality reviewer.
- Use two reviewers only for distinct elevated risks such as security, concurrency, architecture, or high blast radius.
- Allow parent-only inspection for trivial or fully machine-decided changes when the user did not explicitly request review.
- Allocate reviewers in the program map before implementation, then revise the allocation only when new risk appears.
- After a fix pass, use deterministic gates for machine-decidable corrections and focused re-review only for unresolved semantics or the fix blast radius.
- Define targeted checks for each implementation slice and full-suite checkpoints for groups of dependent changes and final delivery.
- Remove guidance that treats reviewer count, broad re-review, or repeated full suites as quality by default.
- Never skip disposition of a known P0 or P1 finding.

### Acceptance

- Packaged prompts and references describe the same commissioning rule.
- `/review-loop` still honors an explicit round cap or requested review fanout.
- The default recipe cannot silently skip a known P0 or P1 finding.
- A deterministic correction does not trigger another broad review by default.
- Program examples distinguish targeted phase checks from checkpoint and final validation.
- Tests cover the packaged prompt contract without encoding operator-specific policy.

## 7. Verify interactive completion wake-up

### Problem

The package documents that an interactive parent may yield after an async launch and wake on completion without calling `subagent_wait()`. Headless run-to-completion flows correctly require waiting or auto-drain. This behavior must be proven before changing runtime or strengthening the async-yield guidance.

### Required work

- Add or run a deterministic interactive-session reproduction that launches one async child, ends the parent turn, and observes one completion wake-up.
- Cover completion, failure, and `needs_attention` delivery.
- Confirm that notification batching and deduplication do not suppress the wake-up.
- Confirm that headless auto-drain and explicit blocking waits remain separate paths.
- Make no runtime change if current behavior passes.
- State in execution guidance that async controls scheduling, not workflow topology.
- State that an interactive parent should yield or do independent work after launch instead of immediately blocking when no same-turn result is required.

### Acceptance

- Interactive completion wakes the owning parent exactly once without polling.
- A non-blocking subscription wakes only for its resolved run or timeout.
- Headless execution does not depend on a future interactive turn.
- Completion remains visible through status and durable artifacts even when delivery fails.
- Packaged examples do not pair a detached singleton launch with an immediate blocking wait unless they name the same-turn requirement.

## 8. Define authoritative usage accounting

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

## 9. Run a matched orchestration benchmark

### Problem

Prompt and workflow changes can appear more efficient while merely moving cost between the parent, children, tools, and notification paths. The package needs a matched evaluation that measures orchestration behavior and preserves quality evidence.

### Required work

- Define a repository-neutral, multi-phase workload with:
  - one owner decision gate;
  - a serial mutation critical path;
  - independent read-only work that can run ahead;
  - targeted and checkpoint validation;
  - one ordinary review and one conditional focused re-review;
  - final parent acceptance.
- Run the baseline and proposed guidance with the same model policy, runtime revision, task, and measurement cutoff.
- Separate wall time, owner wait, parent generation, child execution, tools, and explicit subagent waits. Do not add overlapping durations.
- Count unique parent and child attempts without copying notification or helper-session usage into the total twice.
- Compare:
  - top-level execution calls;
  - singleton workflow wrappers;
  - blocking waits and status polls;
  - child launches, resumes, and review rounds;
  - parent and child context sizes;
  - processed tokens and reported cost;
  - targeted and full-suite validation calls;
  - findings detected, accepted, fixed, and left unresolved;
  - total wall time excluding owner-controlled gates.
- Retain raw evidence outside public package documentation when it contains machine, account, or private repository information.

### Acceptance

- The proposed run produces a program map before mutation and follows it or records why it changed.
- Coordinated waves replace avoidable singleton workflow wrappers and immediate blocking waits.
- Read-only work begins before it blocks the writer critical path when its inputs are stable.
- Workers and reviewers receive smaller task-relevant contexts.
- Owner gates, independent review, deterministic validation, completion evidence, and fail-closed behavior remain intact.
- Every accepted material finding is fixed, escalated, or reported as blocked.
- Results state residual uncertainty and do not claim causation from one workload.

## Validation

For each workstream:

1. Run the narrow unit, integration, prompt-contract, or documentation test that reproduces the behavior.
2. Run `npm run typecheck` when source or typed fixtures change.
3. Run the affected unit and integration suites.
4. Run `npm run test:all` before treating a runtime workstream as complete.
5. Inspect hot-path effects on launch setup, validation, status refresh, result watching, and prompt size where the change can affect them.
6. Inspect rendered Markdown, headings, links, paths, examples, and terminology for documentation changes.
7. Record residual risks and any behavior that remains intentionally partial.

A workstream is complete only when its behavior is observable through the production path or packaged guidance, its deterministic tests fail without the change where applicable, and the change remains within the delegation layer defined by `VISION.md`.
