# Deep simplification audit and plan

Status: audit and planning only. This document does not authorize removals or runtime behavior changes.

Audited ref: `5febaef3` (`0.59.0-fork.1`)

## Conclusion

The extension is over-complex for the product identity in `VISION.md`.

The problem is not one bad subsystem. The package currently combines a delegation runtime, workflow engine, durable job supervisor, mission and schedule store, agent authoring system, watchdog, several observation UIs, external-run bridges, and optional terminal integrations. Some of that complexity protects real invariants. Some is optional product surface, duplicated execution policy, or compatibility machinery that remained after its public API was removed.

The v0.59 sanitization was still worthwhile. It corrected authority, evidence, resource, and hot-path behavior. It did not materially reduce the architecture. The current tree has 93,402 production TypeScript lines, compared with 66,658 at v0.45.2. Most growth since v0.45.2 is in `src/runs`, `src/workflows`, `src/shared`, and `src/tui`.

Simplification should delete or move whole capabilities before reorganizing large files. Splitting the existing code into more modules without reducing scope would preserve the same complexity with more indirection.

## Audit method

The audit used current source, package exports, configuration and tool schemas, static import relationships, documentation, and Git history. Test volume was treated as evidence of covered behavior, not evidence that each behavior belongs in the product.

Regenerate the main size numbers from the repository root:

```bash
find src -name '*.ts' -print0 | xargs -0 cat | wc -l
find src -name '*.ts' | wc -l
find test -name '*.ts' -print0 | xargs -0 cat | wc -l
find src -name '*.ts' -print0 | xargs -0 wc -l | sort -nr | head -20
```

To compare with v0.45.2 without changing the checkout:

```bash
tmp=$(mktemp -d)
git archive 7836c0f5 src | tar -x -C "$tmp"
find "$tmp/src" -name '*.ts' -print0 | xargs -0 cat | wc -l
rm -rf "$tmp"
```

Static import counts in this audit include type-only imports. They identify coupling pressure, not runtime cycles by themselves.

## Size and growth

### Production TypeScript

| Ref | Source files | Lines | Change from v0.45.2 |
| --- | ---: | ---: | ---: |
| v0.45.2, `7836c0f5` | 174 | 66,658 | baseline |
| Pre-integration fork, `e3611bb1` | 179 | 68,351 | +1,693 |
| Integrated v0.59, `0073a7ea` | 253 | 92,903 | +26,245 |
| Current, `5febaef3` | 254 | 93,402 | +26,744 |

The v0.59 integration accounts for most of the increase. The sanitization changed important behavior but left the total near 93,000 lines.

### Growth by area since v0.45.2

| Area | v0.45.2 | Current | Change |
| --- | ---: | ---: | ---: |
| `src/runs` | 35,197 | 51,072 | +15,875 |
| `src/workflows` | 683 | 3,386 | +2,703 |
| `src/shared` | 4,753 | 6,976 | +2,223 |
| `src/tui` | 4,129 | 6,089 | +1,960 |
| `src/agents` | 5,631 | 6,767 | +1,136 |
| `src/extension` | 2,668 | 3,643 | +975 |
| `src/inspectors` | 654 | 1,358 | +704 |
| Other areas combined | 12,943 | 14,101 | +1,158 |

This is not only recent feature creep. Missions, watchdogs, profiles, inspectors, and most agent management already existed at v0.45.2. A simplification effort must judge the complete product, not merely revert the v0.59 merge.

### Concentration and coupling

The largest current production files are:

| File | Lines | Static internal imports |
| --- | ---: | ---: |
| `src/runs/foreground/subagent-executor.ts` | 6,942 | 99 |
| `src/runs/background/subagent-runner.ts` | 5,815 | 69 |
| `src/tui/render.ts` | 3,106 | 16 |
| `src/shared/types.ts` | 2,839 | 14 |
| `src/runs/foreground/execution.ts` | 2,495 | 46 |
| `src/agents/agents.ts` | 2,490 | 14 |
| `src/runs/background/async-execution.ts` | 2,040 | 45 |
| `src/workflows/scripted-workflow.ts` | 2,034 | 8 |
| `src/runs/shared/acceptance.ts` | 1,802 | 14 |

`subagent-executor.ts` owns workflow launch, direct launch, mission binding, management dispatch, worktree control, status, steering, resume, stop, refinement, schedule routing, and compatibility execution. `subagent-runner.ts` owns process attempts, child settlement, static and dynamic composition, status/event persistence, artifacts, acceptance, and output aggregation. Their import counts show orchestration concentration, not merely long formatting code.

A simple static import graph also finds one strongly connected component spanning 30 modules across agents, shared types, settings, artifacts, acceptance, launch planning, output handling, and workflow permits. Type-only edges account for part of it, but `src/shared/types.ts` importing feature-level types while 132 modules import `src/shared/types.ts` is a real layering warning.

The test tree contains 111,270 TypeScript lines, 1.19 test lines per production line. This lowers change risk. It does not lower the cost of understanding or keeping policy consistent across execution paths.

## Public and model-facing surface

The primary `subagent` tool schema has 72 top-level parameters in `src/extension/schemas.ts`. One free-form `action` field feeds dispatch code that recognizes 57 management and control names, including retained compatibility routes, across:

- agent management;
- missions;
- schedules;
- watchdog control;
- Herdr inspectors and project panes;
- worktree and lane records;
- refinement;
- status, debug, resume, steer, stop, interrupt, and dismissal;
- guides, diagnostics, validation, and budget grants.

The extension also registers 18 slash commands, a second `subagent_wait` tool, RPC and prompt-template bridges, 12 package subpath exports, and 43 top-level extension configuration fields.

This surface makes the common operation, one parent launching one focused child, compete with administration and optional subsystems in the same model-visible contract. Documentation reduces misuse, but the amount of documentation required is itself evidence that the primary interface has lost focus.

## Runtime architecture

### Core delegation path

The product identity requires these capabilities:

1. discover and resolve one child agent;
2. assemble an authoritative prompt and capability contract;
3. execute a native or honest external child;
4. collect bounded output and evidence;
5. preserve visible background lifecycle state;
6. let the parent inspect, steer, stop, or resume work when supported;
7. compose several children through one workflow primitive.

The current implementation provides all seven. These capabilities should survive simplification.

### Multiple execution generations

The current tree has several overlapping execution models:

- foreground native execution in `src/runs/foreground/execution.ts`;
- background native execution in `src/runs/background/async-execution.ts` and `subagent-runner.ts`;
- `workflowScript` execution in `src/workflows/scripted-workflow.ts` and `subagent-executor.ts`;
- internal chain, parallel, and dynamic-fanout records in `src/shared/settings.ts`, `src/runs/shared/parallel-utils.ts`, and the background runner;
- external CLI and external-job execution under `src/runs/shared`;
- revival and detached-workflow reconciliation layered over foreground and background state.

Public top-level `tasks`, `chain`, and `parallel` inputs are rejected by `src/extension/public-execution.ts`, but their shapes still influence launch planning, mission naming, child profile routing, live status, background execution, append-step handling, saved-chain management, and recovery. This is a compatibility substrate with a large blast radius.

The final v0.59 review found an acceptance bypass because foreground, background, and dynamic paths each carried their own AgentContract exemption. That defect is fixed. Its distribution across four seams demonstrates the continuing cost of duplicated terminal policy.

### Durable state and reconciliation

Background visibility and recovery require durable state. The current implementation persists or reconciles many record families:

- async `status.json`, `events.jsonl`, result payloads, and observer indices;
- process-terminal proof and stale-run repair;
- workflow receipts and detached-child reconciliation;
- nested event records and wait subscriptions;
- worktree handoff manifests and cleanup plans;
- mission records, mission bindings, journals, receipts, decisions, and workflow state;
- schedule definitions, history, and events;
- Herdr pane bindings and Orca view metadata.

No single record is automatically cruft. The combined system has many partial sources of truth and repair paths. Every additional durable writer creates a compatibility obligation and makes lifecycle deletion harder.

### Visibility duplication

Visibility is a core safety requirement. The package currently projects similar state through:

- rich inline tool results;
- the async widget;
- persistent FleetView;
- the full fleet inspector;
- status and transcript actions;
- RPC widgets;
- optional Herdr inspectors and project panes;
- optional Orca observer tabs;
- completion and control notifications.

The event-driven invalidation work improved hot-path behavior. The remaining simplification question is how many render surfaces the core package should own, not whether background work should remain visible.

## Complexity classification

### Retain as core invariants

These areas directly implement `VISION.md` and should not be weakened to reduce line count:

| Capability | Why it stays |
| --- | --- |
| Authoritative global and project instructions | The operator remains the decision maker. |
| Inferred acceptance and explicit opt-outs | Completion must carry evidence or fail closed. |
| Capability ceilings, permissions, read-only/writer identities | External and nested authority must not widen silently. |
| Bounded output, artifacts, concurrency, fanout, and active-run ownership | Resource and ownership limits prevent hidden failure. |
| Background status, stop, steer, and recoverable identity | Work running out of sight must remain controllable. |
| Durable process-terminal proof and stale-owner handling | Recovery must not guess that live work is dead. |
| Direct one-child execution and `workflowScript` composition | These are the smallest honest product primitives. |
| Generic external runner contracts | External agents must declare real capabilities. |
| Event-driven Fleet invalidation and deadline checkpoints | Hot paths must stay bounded and responsive. |

### Keep, but reduce implementation breadth

| Area | Current issue | Simplification direction |
| --- | --- | --- |
| Agent discovery and management | Discovery, authoring, refinement, profiles, runtime registration, and compatibility chains share one area. | Keep discovery core. Make authoring and profile administration human-facing or optional. |
| Worktree isolation | Isolation is useful, but cleanup planning, lane merge evidence, setup hooks, manifests, and lifecycle policy broaden ownership. | Keep child isolation and durable handoff. Reassess lane merge/supersession records and cleanup administration separately. |
| Fleet visibility | The core owns several overlapping renderers. | Keep one compact inline view, one detailed inspector, and one canonical read model. |
| Supervisor coordination | Native parent-child asks are core; external result delivery and adapters add separate contracts. | Keep native supervision. Require consumer evidence for external bridges. |
| Package APIs | Some seams enable other extensions; others have no local production consumers by design. | Retain only with named external consumer or approved platform contract. |

### Candidates for removal from core or extraction

Dedicated files for missions, schedules, watchdogs, inspectors, profiles, and refinement occupy about 10,100 production lines before their cross-cutting call sites and tests. This is footprint, not a safe deletion estimate.

| Area | VISION fit | Default/runtime coupling | Preliminary disposition |
| --- | --- | --- | --- |
| Missions and goal continuation | Weak. The project refuses to become a general project manager. | Missions are automatic by default and touch launch, result watching, retention, workflow state, inspectors, and `agent_end`. | Highest-priority owner decision. Prefer explicit opt-in or a separate package unless cross-session recovery use proves core value. |
| Scheduled runs | Conditional. User-requested delegation can be scheduled, but scheduling is not the delegation layer itself. | The manager is initialized with the extension and exposes nine tool actions. | Move outside the primary model-facing contract; retain only if concrete use justifies core ownership. |
| Watchdog | Weak-to-conditional. It is an opt-in background reviewer, which `VISION.md` explicitly excludes from default identity. | Registered at startup, exposed through tool and slash actions, and injected into child runtime. | Strong extraction candidate into its own Pi extension. Preserve ordinary explicit reviewer workflows. |
| Herdr project panes and inspectors | Weak. Passive observation can help, but peer-project lifecycle is not core delegation. | Optional dependency, six tool actions, bindings, Fleet integration, and mission coupling. | Keep passive integration only if used; otherwise extract. Do not restore the removed public project-pane API. |
| Orca observer tabs | Weak-to-conditional. A second observer duplicates Fleet surfaces. | Experimental and opt-in, but adds launch hooks and metadata. | Remove or extract unless it serves a distinct measured need. |
| Profile catalog commands | Conditional. Model selection is core; provider catalog administration is not. | Six slash commands and a profile subsystem. | Keep simple model overrides; move catalog generation/loading to a companion tool or human-only script. |
| Agent refinement overlays | Weak. Agent authoring is administration, not delegation. | Three model actions plus a slash command and proposal-child execution. | Human-only or separate package unless repeated use proves model-facing value. |
| Lane merge and supersession evidence | Weak. The project does not own merge policy. | Three actions and handoff-manifest coupling. | Preserve plain handoff evidence; remove policy-shaped lane records unless an external consumer is named. |

### Compatibility retirement candidates

These are not immediate deletions. Each needs a writer/reader inventory and an artifact horizon.

- top-level `tasks`, `chain`, `parallel`, `concurrency`, and `chainDir` plumbing;
- internal `append-step` execution;
- saved chain authoring and `.chain.md` management;
- historical turn-budget fields;
- legacy prompt-template payload adapters;
- deprecated acceptance spellings and legacy/canonical dual parsing;
- AgentContract v1 compatibility behavior once callers can migrate;
- old status, receipt, external-run, and inspector record variants.

The rule is: stop current writers first, provide a bounded migration path where necessary, retain pure readers for an explicit horizon, then remove readers after evidence shows no supported artifact still requires them.

## Simplification principles

1. **Delete scope before refactoring structure.** A package that only moves code is not a simplification package.
2. **One capability decision per package.** Do not combine mission removal, runner convergence, and UI changes.
3. **Require consumer evidence.** Public exports, bridges, and optional integrations need a named production consumer or an owner-approved platform role.
4. **Preserve compatibility readers intentionally.** Readers need an artifact version and retirement date, not permanent accidental retention.
5. **Keep every package net-negative in production code.** Temporary migration code is allowed only with a committed removal package and bounded lifetime.
6. **No new execution modes.** Direct execution and `workflowScript` are the target primitives.
7. **No hot-path regressions.** Measure startup, direct launch preparation, status refresh, and idle filesystem work before changing lifecycle or visibility code.
8. **Keep fail-closed behavior.** Simplification must not turn missing evidence, unknown ownership, or unsupported capability into success.
9. **Validate behavior, not symbol absence.** Tests should cover supported contracts and migrations rather than grep for deleted names.
10. **Split monoliths last.** Stable ownership boundaries become clear after optional and legacy branches are gone.

## Delivery plan

### Package 0: Establish the evidence ledger

Goal: replace intuition with a decision record for every non-core surface.

Actions:

- inventory every model action, slash command, package export, configuration key, durable record writer, and compatibility reader;
- record the owning subsystem, default state, production callers, external consumers, persisted artifact versions, tests, and approximate dedicated footprint;
- inspect local or release usage only through an owner-approved, privacy-preserving method;
- define a support horizon for v0.59 artifacts before any reader is removed;
- record direct-launch and workflow launch latency, extension startup time, idle filesystem activity, and model-visible schema bytes.

Exit criteria:

- every candidate has `retain`, `extract`, `deprecate`, or `undecided` status;
- every `retain` decision cites a user need or product invariant;
- every public seam has a named consumer or an explicit decision to deprecate;
- baseline measurements are reproducible.

### Package 1: Contract the primary tool surface

Goal: make the common model-facing contract describe delegation rather than package administration.

Actions:

- retain direct execution, `workflowScript`, list/status/children, stop/steer/resume/interrupt, and essential diagnostics;
- move human administration to existing slash commands where practical;
- remove mission, schedule, watchdog, profile/refinement, pane, lane-policy, and destructive cleanup fields from the primary schema only after their disposition is approved;
- use action-specific validation internally rather than sharing unrelated top-level fields;
- measure schema byte and token reduction.

Exit criteria:

- one-child and workflow prompts no longer expose unrelated administration fields;
- no supported management behavior becomes less safe;
- the package still supports human administration through an approved surface;
- production code decreases; schema reduction alone is insufficient.

### Package 2: Decide missions and schedules

Goal: resolve the largest product-identity conflict before touching runner internals.

Decision options:

1. remove automatic missions and keep explicit mission records in a companion package;
2. keep a minimal recovery record in core and move goals, journals, decisions, receipts, and schedules out;
3. retain the subsystem only with concrete cross-session recovery evidence and a narrower contract.

Recommended starting position: option 2. Async status and workflow receipts already provide much of the run recovery identity. Prove which mission fields add unique value before retaining them.

Exit criteria:

- ordinary launches have one authoritative recovery story;
- `agent_end`, result watching, retention, and workflow state no longer depend on general project-management records unless approved;
- old mission and schedule artifacts remain readable or receive an explicit migration command;
- no CI, merge, deployment, or release authority moves into core.

### Package 3: Extract optional review and observer systems

Goal: keep delegation usable without loading unrelated review or terminal products.

Evaluate independently:

- watchdog;
- Herdr inspectors and project panes;
- Orca observer tabs;
- profile catalog commands;
- agent refinement overlays.

For each subsystem:

- prove a distinct need not met by explicit reviewer workflows, Fleet, normal model overrides, or Pi package composition;
- if retained, register it lazily and keep it out of the primary tool schema;
- if extracted, define a narrow versioned API from core instead of importing internal state;
- if unused, deprecate before removal.

Exit criteria:

- core startup and child runtime do not import optional subsystem code when disabled;
- Fleet and direct delegation operate without optional packages;
- extracted packages cannot widen child authority or mutate core lifecycle records.

### Package 4: Retire legacy orchestration writers

Implementation evidence: [Deep simplification Package 4](deep-simplification-package-4.md).

Goal: make direct execution and `workflowScript` the only newly written execution contracts.

Actions:

- prove which production paths still construct `tasks`, `chain`, or dynamic chain records;
- separate current internal workflow planning from legacy public record shapes;
- stop new `.chain.md`, append-step, and removed top-level orchestration writes;
- migrate saved user definitions to workflow scripts only when users still rely on them;
- keep bounded readers for supported async artifacts through the declared horizon;
- delete readers after the horizon and evidence check.

Exit criteria:

- no current launch constructs a legacy top-level orchestration request;
- saved legacy records cannot silently execute through a hidden path;
- current workflows do not depend on legacy naming or serializer types;
- recovery of supported old artifacts remains explicit and tested.

### Package 5: Unify child terminal policy

Goal: make one policy seam decide whether a child succeeded.

Create one pure terminal-decision contract that consumes execution facts and returns:

- execution outcome;
- acceptance outcome;
- mutation/effect outcome;
- timeout, stop, interrupt, and detach classification;
- public success/failure status and diagnostic.

Migrate foreground single, background single, workflow child, static parallel, and dynamic child settlement one path at a time. Keep process driving, UI, and persistence outside this policy module.

Exit criteria:

- inferred acceptance, explicit v1 acceptance, completion effects, timeout, stop, and detach have one shared decision table;
- foreground and background contract tests use the same fixtures;
- no caller can reclassify a rejected terminal decision as success;
- the old per-runner branches are deleted in the same package that adopts the shared seam.

This package is high risk. It follows scope reduction and legacy retirement so it does not have to unify behavior that is about to disappear.

### Package 6: Consolidate lifecycle records and visibility

Goal: keep work visible through one canonical read model.

Actions:

- designate authoritative fields for live state, terminal result, process proof, workflow receipt, and nested children;
- make inline rendering, FleetView, the detailed inspector, status, and RPC consume the same bounded projection;
- reduce duplicate cached job maps and renderer-specific repair logic;
- retain one slow bounded reconciliation mechanism for missed filesystem events;
- remove redundant observer metadata after optional integrations are extracted or removed.

Exit criteria:

- one fixture can drive every retained visibility surface;
- no renderer writes lifecycle truth;
- idle and active filesystem work are measured and do not regress;
- a missed event still converges to the correct terminal state.

### Package 7: Reduce public APIs and configuration

Goal: make supported extension seams intentional and versioned.

Actions:

- audit all 12 package exports for external consumers;
- keep delegation, capability ceilings, child profile resolution, and external-provider seams only where named integrations exist;
- merge or remove aliases that expose the same lifecycle data;
- remove configuration keys whose feature was removed or whose default is now fixed;
- publish migrations for supported users before changing package exports.

Exit criteria:

- each export has an owner, version, consumer, and contract test;
- each configuration key changes a retained behavior;
- removed keys fail with one actionable migration message during the support horizon;
- package dry-run contains no retired implementation modules.

### Package 8: Decompose remaining orchestration modules

Goal: improve maintainability after deletion has exposed stable boundaries.

Target ownership:

- extension registration and lifecycle wiring;
- management dispatch;
- workflow host orchestration;
- child launch planning;
- process attempt execution;
- terminal decision;
- durable lifecycle storage;
- rendering.

Actions:

- split `subagent-executor.ts`, `subagent-runner.ts`, `extension/index.ts`, and `shared/types.ts` by the ownership boundaries above;
- move leaf contracts below feature code so shared modules do not import agents, missions, workflows, or inspectors;
- remove pass-through modules and compatibility aliases revealed by the split;
- reject any extraction that only renames a block without reducing coupling or hiding a meaningful decision.

Exit criteria:

- no orchestration file imports dozens of unrelated feature domains;
- shared contract modules are acyclic in the static import graph;
- each module has one reason to change;
- production lines remain net-negative after the split.

## Validation matrix

Every package selects the relevant rows. Final simplification validation runs all rows.

| Contract | Required evidence |
| --- | --- |
| Direct native child | foreground and async observable behavior |
| `workflowScript` | sequential, parallel, dynamic, retained resume, and host gate behavior |
| Evidence | inferred writer/read-only acceptance, explicit opt-out, explicit v1 compatibility |
| Authority | global/project instruction inheritance, capability ceilings, permissions |
| Lifecycle | timeout, stop, interrupt, steer, detach, process crash, stale recovery |
| Persistence | current artifacts plus every supported old artifact version |
| Visibility | inline, status, retained detailed inspector, completion wake |
| Isolation | one writer, managed worktree handoff, preserved dirty work |
| External runners | read-only/writer identity, unsupported capability failures, reattach identity |
| Performance | startup, launch preparation, active refresh, idle scan rate |
| Packaging | typecheck, full unit/integration suites, E2E where Pi runtime exists, package dry-run, diff check |

## Stop conditions

Stop a package and return to design when:

- a proposed deletion lacks production-consumer evidence;
- old artifact ownership or migration behavior is unknown;
- a change would weaken evidence, authority, identity, or recovery invariants;
- a hot-path cost is unmeasured;
- the package requires a new execution mode or general framework;
- production code grows without a bounded migration deletion in the same approved sequence;
- several product decisions become coupled in one diff.

## Expected result

This plan does not set an arbitrary line-count target. The first objective is fewer product responsibilities and fewer execution contracts. Line count should then fall as a consequence.

A successful simplification leaves one clear product:

- one parent delegates to focused children;
- direct execution handles one child;
- `workflowScript` composes several children;
- evidence closes work;
- background work remains visible and controllable;
- optional project-management, review automation, provider administration, and terminal integrations compose around the core instead of living inside it.
