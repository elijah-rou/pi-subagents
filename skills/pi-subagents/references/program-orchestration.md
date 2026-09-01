# Whole-Program Orchestration

Use this reference for broad, predeclared, or multi-phase work: requests with
several named phases, more than one implementation or validation stage, owner
decision gates, or work that could otherwise become a sequence of improvised
child launches. Do not load it for one bounded child task, one review, a basic
async launch, status or control work, or agent management.

The parent designs and owns the complete program. A program is the full path
from intake through acceptance. A wave is one bounded set of launches whose
inputs and authority are already settled. One program may need several waves
because findings, owner decisions, or changing evidence must return to the
parent between them. Do not hide those gates inside an autonomous child chain.

## Map intake before reconnaissance

Before reconnaissance, record an intake map covering:

- **Phases:** every user-specified phase and its observable completion condition;
- **Ordering:** known dependencies and ordering constraints;
- **Unknowns:** unresolved facts and decisions, with the parent or owner
  responsible for each;
- **Mutation:** boundaries, likely checkout or worktree ownership, and shared
  contracts;
- **First wave:** the first safe read-only reconnaissance wave and the evidence
  it must return.

If the request names a later phase, include it even when its implementation is
not yet known. Mark unknowns instead of silently dropping phases or inventing
answers. Reconnaissance may refine the map, not replace it.

Keep reconnaissance read-only when possible. Run independent questions together,
then have the parent resolve conflicting evidence and make or escalate the
required decisions. Children report evidence; they do not inherit product,
compatibility, security, publication, merge, or release authority.

## Synthesize the execution map before mutation

After reconnaissance and before any implementation mutation or
mutation-capable child, the parent produces one execution map for the whole
program. Record:

| Concern | Required decision |
| --- | --- |
| Dependencies | Phase and lane ordering, including inputs that make each stage ready |
| Serial mutation path | The writer critical path and the one writer that owns each checkout or isolated worktree |
| Read-only overlap | Research, preparation, review, and validation that can run in parallel or ahead once inputs are stable |
| Authority gates | Owner decisions and parent finding-disposition or acceptance points that stop autonomous progress |
| Validation | Targeted checks near each change and checkpoint or full-suite checks after coherent groups and at final delivery |
| Review | Reviewer count and focus justified by concrete risk and remaining uncertainty |
| Triggers | Completion evidence, failure or blocked conditions, and the event that revisits each deferred phase or lane |

Every named phase must appear. Identify mutation ownership before commissioning
the first writer. Keep one writer per checkout; isolate concurrent mutation
lanes in separate worktrees with disjoint ownership. If ownership, authority, or
required evidence is ambiguous, stop before mutation and resolve it.

Update the execution map when evidence changes a dependency, risk, or authority
boundary. Record the change and its reason. Do not improvise a new launch that
bypasses the parent synthesis.

## Select execution shapes by topology

Choose the smallest shape that honestly represents the next wave:

- **Direct execution:** one bounded child with no workflow control flow or
  coordinated sibling. Do not wrap it in `workflowScript` for appearance.
- **Workflow script:** one coordinated wave using `workflowScript` for sequence,
  fanout, branching, retries, aggregation, or staged lanes. Use stable keys and
  keep parent gates outside the script.
- **Parallel fanout:** `runs.all([...])` for independent children in the same wave
  whose inputs are ready and whose outputs can be synthesized after all settle.
  Fanout is not a substitute for dependency design.
- **Staged lanes:** `runs.lanes([...])` for bounded parallel sequential lanes
  whose stages are predeclared and need no parent decision between adjacent
  stages. Use it only inside `workflowScript`. Use `runs.run(...)` and
  `runs.all(...)` directly for conditional or rolling flows that contain no
  parent gate. End the current wave at a parent gate; the parent commissions the
  next wave after resolving it.

Async is a scheduling choice, not workflow topology. It controls whether the
parent remains responsive while a child or wave runs; it does not establish
sequence, independence, or useful parallelism. In an interactive session, do
independent work or yield after an async launch unless a same-turn result is
required. In a headless run-to-completion flow, wait only because that delivery
contract requires it.

## Preserve gates and fail closed

The parent remains responsible for program design, scout synthesis, owner
escalation, finding disposition, acceptance, and the decision to start each
mutation wave. The operator retains any explicit approval, publication, merge,
release, destructive-operation, or security gate. A workflow receipt, child
claim, review, or passing check is evidence, not authority.

Before starting a wave, confirm that its inputs are stable, its children have
bounded authority, mutation ownership is exclusive, and its next parent or
operator gate is named. At commissioning, re-route to
[`commissioning.md`](commissioning.md) and give each child that canonical packet. When a child fails, evidence is missing, a finding is
unresolved, or a gate cannot be evaluated, mark the lane blocked and return to
the parent. Do not infer success or launch the next mutation stage.

Completion requires the mapped phases to be terminal or explicitly blocked,
with changed files or outputs, required validation, review dispositions,
residual risks, and the next owner decision recorded. A deferred lane must name
the event that will revisit it. Background work remains visible through status,
artifacts, and completion delivery.

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

Avoid this failure pattern unless each same-turn wait is explicitly required:

```text
async singleton → blocking wait → status inspection → improvised singleton
```

It serializes work without defining dependencies, spends parent turns on
mechanical supervision, and delays independent read-only work. Replace it with a
whole-program map executed as the fewest bounded waves that preserve authority,
ownership, evidence, and fail-closed behavior.
