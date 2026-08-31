# Whole-Program Orchestration

Use this reference when a request is broad, predeclares several phases, or needs
multiple coordinated implementation and evidence stages. Do not use it for one
bounded child, an isolated review, or unrelated management, status, and
inspection work.

Designing the program chooses dependencies, authority boundaries, and evidence
before execution details. It does not add a runtime mode or restore legacy
`chain` or `parallel` APIs. Load the execution, lane, prompting, or review
reference only when the active wave needs that material.

## Intake map before reconnaissance

Before reconnaissance, the parent records what the request already establishes.
Do not delay this map until scouts have started, and do not ask a child to infer
it from conversation history.

| Field | Record |
| --- | --- |
| Phases and completion | Every user-specified phase and its observable completion condition. |
| Ordering | Known dependencies, required sequence, and work that appears independent. |
| Unknowns and owner decisions | Facts reconnaissance can resolve, plus product, compatibility, security, scope, or other decisions that require the operator. |
| Mutation boundaries | Likely writers, repositories and cwd values, claimed source seams, and whether isolation or worktrees may be needed. |
| First reconnaissance wave | The smallest safe read-only wave that can resolve the named unknowns without crossing a mutation or authority boundary. |

The intake map covers the whole request, not only the first ready phase. Give
reconnaissance children compact cold-start packets with a distinct question,
source seam, output, and stop condition. Their reports are evidence for the
parent, not competing program designs.

## Execution map before mutation

After reconnaissance, the parent resolves conflicting evidence and synthesizes
one execution map before the first mutation-capable child. Do not delegate this
synthesis to a worker. The map must account for every named phase, including
phases that cannot start until an owner decision or later finding returns.

| Field | Record |
| --- | --- |
| Dependencies | Phase and lane dependencies, including inputs each wave consumes and produces. |
| Serial writer critical path | Ordered mutation stages, the sole writer for each cwd or worktree, and handoff points. |
| Independent read-only work | Reconnaissance, preparation, review, or validation that can run in parallel or ahead because its inputs are stable. |
| Authority gates | Operator decisions and parent-only synthesis, finding-disposition, acceptance, publication, merge, and release gates. |
| Review allocation | Review timing and angle chosen from concrete risk, plus the condition that would require focused re-review. |
| Validation checkpoints | Targeted checks beside each mutation stage and affected or full-suite checks at explicit program checkpoints. |
| Completion, failure, and revisit triggers | Evidence that closes each phase, conditions that fail or block it, and events that reopen the map. |

If reconnaissance changes the apparent phase structure, revise the complete map
and record why before commissioning mutation. Unknown ownership, unresolved
high-impact decisions, or an unproven dependency blocks the affected wave.

## Program versus execution waves

The **program** is the complete map from intake through final evidence. A
**wave** is one directly launched child or one coordinated `workflowScript`
whose work can proceed without a parent or operator decision between its steps.
A program may require several waves.

Return to the parent between waves for owner decisions, design synthesis,
review-finding disposition, scope changes, and final acceptance. Do not hide
these gates inside an autonomous script or force the whole program into one
`workflowScript`. When an adjacent stage needs a parent decision, end the wave,
resolve the gate, and launch the next wave with a compact updated packet.

## Choose the execution shape

Use the smallest shape that honestly represents the active wave.

| Need | Use |
| --- | --- |
| One bounded child with no workflow-only coordination | Direct execution with `{ agent, task }`. |
| One coordinated wave needing stable keys, sequence, branching, retry, resume, or aggregation | One `workflowScript`; use `runs.run` for a keyed child or dependent step. |
| Independent children whose results belong to the same wave | `runs.all` inside that `workflowScript`. |
| Predeclared lane stages whose adjacent stages require no parent decision | `runs.lanes` inside that `workflowScript`. |
| Rolling or data-dependent work that cannot be predeclared | Ordinary JavaScript with `runs.run` and `runs.all`, not `runs.lanes`. |

`runs.lanes` expresses predeclared execution stages, not the whole-program design.
A parent or operator gate between stages requires separate waves. Independent
repository or worktree lanes also need the ownership board in
`references/multi-lane-orchestration.md`; launch and lifecycle details remain in
`references/execution-controls.md`.

## Async schedules work; it does not design it

Async keeps the parent responsive. It does not establish dependencies, define
lanes, or make singleton launches concurrent. Choose the program topology and
wave shape first, then choose async or blocking execution from the scheduling
need.

Use async when the parent can do safe independent work or yield until completion.
Block only when the current turn genuinely requires the result, such as a named
same-turn artifact or headless contract. Repeating this pattern for broad work is
a workflow-design failure, not orchestration:

```text
async singleton → blocking wait → status inspection → improvised singleton
```

A singleton is still correct for one bounded task. The failure is discovering a
known multi-phase program one child and one blocking wait at a time.

## Authority, ownership, and gates

The parent owns program synthesis, child commissioning, finding disposition,
and acceptance. Children provide bounded evidence or execute an approved seam.
The operator retains unresolved product, compatibility, security, scope, public
contract, publication, merge, and release decisions. A workflow graph, child
report, receipt, CI result, or reviewer recommendation cannot grant that
authority.

Keep one writer per cwd or worktree. Serial mutation is the default critical
path. Concurrent writers require intentionally isolated worktrees with distinct
ownership and handoffs. Read-only work may overlap a writer only when its inputs
are stable and it cannot mutate source, generated state, or the writer's
validation environment.

Each wave names its writer or read-only owner, allowed actions, input evidence,
completion evidence, stop conditions, and the gate that follows. When ownership
or authority is uncertain, do not launch mutation.

## Canonical efficient pattern

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

This is a control-flow pattern, not a requirement that every program launch all
of these as one workflow. Skip a step only when the map records why it is not
needed for the request.

## Completion, failure, and revisit

Complete the program only when every named phase is terminal, required owner and
parent gates are resolved, mutation ownership is accounted for, accepted
material findings are fixed or explicitly blocked, planned validation has fresh
results, and final evidence satisfies the user's completion conditions.

Fail closed when a child result, artifact, validation result, ownership claim, or
authority decision is missing or ambiguous. Report the blocked state and named
next event instead of inferring success.

Revisit the execution map when reconnaissance invalidates an assumption, an
owner changes scope, a child exposes a new dependency, a writer or worktree
handoff becomes uncertain, validation fails, review finds material risk, or a
completion condition lacks evidence. Revise only the affected waves, but check
the whole program for downstream consequences before resuming mutation.
