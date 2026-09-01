---
name: pi-subagents
description: |
  Delegate to builtin or custom subagents for focused execution, review, async
  work, management, and coordinated workflows while the parent stays in control.
---

# Pi Subagents

The parent owns orchestration, decisions, acceptance, and delegation authority.
Children do not spawn subagents unless the parent explicitly delegates fanout
and their resolved tools allow `subagent`.

## Whole-program design gate

For broad, predeclared, or multi-phase work, map the whole program before
reconnaissance, then synthesize one execution map before any implementation
mutation or mutation-capable child. Execute the map in bounded waves and return
to the parent at authority gates. Small one-child tasks skip this machinery.

## Route before acting

Choose the single current branch below and read exactly its reference. Do not
preload adjacent branches. Re-route only when the task reaches a new gate. In
particular, broad intake loads only program design; execution, lanes, and review
remain unloaded until the mapped program reaches them.

| Branch key | Current task | Read now |
| --- | --- | --- |
| `broad-intake` | Design broad, predeclared, or multi-phase work before reconnaissance or mutation | `references/program-orchestration.md` |
| `one-child-review` | Review one child or diff, validate, triage a gate, or prepare delivery | `references/review-and-validation.md` |
| `basic-async` | Launch or control direct, scripted, async, stateful, forked, oracle, or intercom execution | `references/execution-controls.md` |
| `independent-lanes` | Coordinate independent worktree, repository, or writer lanes | `references/multi-lane-orchestration.md` |
| `management` | List, inspect, create, edit, disable, eject, or expose agents or RPC | `references/management-authoring-rpc.md` |
| `commissioning` | Commission a child or hand evidence between roles | `references/commissioning.md` |
| `roles-and-recipes` | Choose roles, models, slash commands, or specialized prompt recipes | `references/prompting-and-roles.md` |
| `constraints` | Diagnose safety constraints, error handling, or a packaged recipe | `references/constraints-and-recipes.md` |

A task with several named phases starts at `broad-intake`, even when later phases
include implementation or review. A bounded review starts at `one-child-review`;
it does not load orchestration or execution recipes. Basic async launch starts at
`basic-async`. Human/model agent administration starts at `management`.

## Always-on controls

- Keep planning, product/API/security decisions, finding disposition,
  acceptance, publication, and merge/release authority with the parent. Escalate
  unresolved choices to the parent or operator; never infer authority from a
  child, workflow, receipt, check, or review.
- Keep one writer per checkout or cwd/worktree. Isolate concurrent mutation in
  separate worktrees with disjoint ownership. Do not launch overlapping writers
  while ownership is uncertain.
- Preserve capability ceilings: child tool limits, allowed-agent restrictions,
  permissions, isolation, and external-runner capability declarations. A child
  may use only capabilities its resolved contract actually supplies.
- For cross-codebase or cross-repository work, record each repository, explicit
  `cwd`, target ref, authority boundary, shared contract, and expected output
  before launch.
- Require observable completion evidence: concrete outputs, changed files when
  mutation was expected, validation results, and residual risks or an explicit
  blocked state. Child claims, CI, review bots, and receipts are evidence, not authority.
  Fail closed when required evidence is absent.
- Keep background work bounded and visible through status, Fleet, events,
  artifacts, and completion delivery. Use ownership-controlled steering,
  interruption, stop, and cleanup; destructive operations retain operator gates.
- Return to the parent when scope, architecture, compatibility, security,
  publication, merge/release, destructive action, or required evidence is
  unresolved. Do not bury an authority gate inside an autonomous workflow.
- For backlog maintenance, releases, merge queues, or other public-repository
  policy, load the matching user/project skill. This package defines delegation
  primitives, not repository policy.

As a conservative orchestration policy, do not pass a hard `toolBudget` or tight
`usageBudget` to mutation-capable workers. The default tool budget blocks read/search tools rather than mutation tools.
If interrupted after a tool call starts, checkpoint after the current tool returns with changed files, build/test state, and commit or PR state.
