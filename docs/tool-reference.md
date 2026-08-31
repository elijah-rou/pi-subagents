# Model-facing tool reference

This reference describes only the `subagent` contract exposed to models. Package administration is not part of this surface.

## Actions

The model-facing actions are exactly:

`list`, `get`, `models`, `children.list`, `guide`, `validate`, `worktree.discard`, `lane.status`, `status`, `debug.run`, `interrupt`, `resume`, `steer`, `stop`, and `doctor`.

Omit `action` for execution. Use `{ agent, task? }` for one direct child, or `workflowScript`/`workflowScriptPath` for orchestration. `validate` accepts a workflow script without launching children.

Agent authoring uses the human `/subagents` interface. Fleet inspection uses `/subagents-fleet`. Trusted RPC clients retain only passive legacy `schedule.list`, `schedule.show`, and `schedule.history` readers for one release.

Package 2a removed mission and goal administration and all new mission writes. Only one-release passive legacy readers and completion merge remain. Lane merge/supersession policy and broad worktree cleanup still have no model-facing access. The provider profile/catalog administration product is retired. The Herdr inspector and project-pane products are retired, including their trusted actions, commands, RPC/package seams, runtime integration, and artifact writers. Models must not attempt removed action names or fields.

`append-step` execution is removed. Old `append-requests/*.json` files are inert, remain untouched, and are not consumed.

## Parameters

The primary schema has exactly these 47 top-level fields:

| Field | Purpose |
|---|---|
| `agent` | Direct child agent, or target for retained discovery actions. |
| `task` | Optional direct-child task. |
| `extensionBindings` | Bounded namespaced metadata delivered to the child runtime. |
| `action` | One of the 15 actions above. |
| `id` | Run identifier or prefix for status/control. |
| `runId` | Explicit run identifier for status/control. Prefer `id`. |
| `dir` | Async run directory for status/control. |
| `handoffPath` | Existing handoff manifest for `worktree.discard` or `lane.status`. |
| `laneId` | Exact handoff run id for `lane.status`. |
| `index` | Zero-based child/transcript index. |
| `childId` | Stable child identity for child-scoped stop. |
| `view` | `fleet` or `transcript` status view. |
| `lines` | Transcript line limit, from 1 through 500. |
| `topic` | Packaged `guide` topic. |
| `message` | Follow-up text for `resume` or guidance for `steer`. |
| `mode` | `steer`, `follow_up`, or `auto`. |
| `steeringRecovery` | Allow bounded steer pause/revival recovery. |
| `workflowScript` | Inline trusted JavaScript workflow statement body. |
| `workflowScriptPath` | Trusted workflow file, resolved from request `cwd`. |
| `preflight` | Bounded display-only workflow lane hints. |
| `chatProgress` | `auto`, `off`, or `live-card`. |
| `isolation` | `none` or `worktree`. |
| `worktree` | Managed child worktree isolation. |
| `lane` | Bounded child lane display metadata. |
| `context` | `fresh`, `fork`, or `profile`. |
| `async` | Background execution selection. |
| `timeoutMs` | Run deadline. |
| `maxRuntimeMs` | Alias for `timeoutMs`. |
| `checkpointAfterMs` | Soft wrap-up checkpoint before the hard deadline. |
| `toolTimeoutMs` | Hard per-tool-call timeout. |
| `toolBudget` | Bounded child tool-call budget. |
| `usageBudget` | Root-only reported token/cost budget. |
| `agentScope` | Agent discovery scope. |
| `cwd` | Execution working directory. |
| `artifacts` | Enable debug artifacts. |
| `includeProgress` | Include full progress in the result. |
| `sessionDir` | Child session-log directory. |
| `control` | Bounded attention/control thresholds and channels. |
| `output` | Child output file binding or disable flag. |
| `outputMode` | `inline` or `file-only`. |
| `skill` | Child skill override. |
| `model` | Child model override, optionally with a thinking suffix. |
| `fast` | Supported native OpenAI-Codex priority tier opt-in. |
| `outputSchema` | Strict object-root JSON Schema for structured output. |
| `agentContract` | Explicit version-1 compatibility behavior. |
| `acceptance` | Evidence and verification contract. |
| `gate` | One host verification command, mutually exclusive with acceptance. |

Removed primary fields are rejected or absent from the provider schema. In particular, models must not use old mission, schedule, watchdog, authoring, pane, lane-policy, broad-cleanup, gist-sharing, or spawn-budget fields.

## Direct execution

```js
{ agent: "worker", task: "Implement the approved change", async: true }
```

Direct execution starts exactly one child. Do not combine `agent`/`task` with an action or workflow script.

External CLI agent profiles use their own fail-closed runner contract. They do not support native Pi child options such as model override, structured output, acceptance contracts, tool budgets, fork context, skills, or native Pi tools unless the runner explicitly implements them.

## Workflow execution

```js
{ workflowScript: `
  const scan = await runs.run("scan", { agent: "scout", task: "Find affected files" });
  const reviews = await runs.all([
    { key: "correctness", agent: "reviewer", task: "Review correctness: " + scan.output },
    { key: "tests", agent: "reviewer", task: "Review tests: " + scan.output }
  ]);
  return reviews.map(result => result.output);
` }
```

Use stable keys. Await every launch directly or through `Promise.all`/`Promise.race`. `runs.all` returns an ordered array, not a key map. `runs.lanes` expresses bounded parallel sequential lanes. `runs.steer` targets a prior workflow key and must be awaited. `runs.host` runs one bounded operator-owned command. Workflow scripts cannot access filesystem, shell, Pi tools, or host globals except through the retained workflow host API.

Use one writer per checkout. Set `worktree:true` for parallel mutation lanes. Preserve explicit acceptance and resource limits. Async work remains visible through status, Fleet, artifacts, and `subagent_wait`.

As a conservative orchestration policy, do not set a hard `toolBudget` or `usageBudget` on mutation-capable workers. The default tool budget blocks read/search tools rather than mutation tools, so it is not a safe completion boundary. An elapsed timeout is not a mutation-safe boundary either. Before a deadline, request a checkpoint after the current tool returns that includes changed files, build/test state, remaining work, and commit or PR state.

## Control and recovery

Use `children.list` before `resume`; resume only rows reported resumable. `status` supports fleet and transcript views. `debug.run` returns bounded lifecycle diagnostics. `interrupt`, `steer`, `resume`, and `stop` retain their existing ownership, identity, acknowledgment, and recovery checks.

`worktree.discard` remains destructive and confirmation-controlled. It requires the existing validated handoff path. Child-safe fanout tools block it. `lane.status` is read-only handoff evidence.

Unknown and removed actions fail before model executor dispatch with an administration/removal message. They never fall through to execution.
