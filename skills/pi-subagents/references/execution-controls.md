# Pi Subagents: model execution controls

This reference describes only the model-facing Package 1 contract.

## Surface

Actions are exactly `list`, `get`, `models`, `children.list`, `guide`, `validate`, `worktree.discard`, `lane.status`, `status`, `debug.run`, `interrupt`, `resume`, `steer`, `stop`, and `doctor`.

Omit `action` for execution. Use one direct `{ agent, task? }` call for one child. Use one `workflowScript` call for multi-step or parallel orchestration. Never call removed administration actions or pass removed administration fields.

Agent authoring is human-only through `/subagents`. Refinement uses `/subagents-refine`. Watchdog administration uses `/subagents-watchdog`. Profile administration uses `/subagents-profiles`, `/subagents-load-profile`, `/subagents-refresh-provider-models`, `/subagents-generate-profiles`, and `/subagents-check-profile`. Fleet inspection uses `/subagents-fleet`. Trusted RPC clients retain the existing schedule-management RPC methods.

Missions, lane merge/supersession policy, broad worktree cleanup, and optional pane administration do not have a supported human replacement in Package 1. Their runtime remains temporarily retained, but primary access is removed pending Packages 2 and 3. Do not invent a slash command for them.

`append-step` is internal executor compatibility. Models, slash commands, and RPC calls cannot use it.

## Discovery and direct execution

Call `{ action: "list" }` before launch and select only an executable, non-disabled agent. Call `{ action: "models" }` before supplying an explicit provider/model id.

```js
{ agent: "worker", task: "Implement the approved change", async: true }
```

Use `context:"fresh"` for isolated work or `context:"fork"` only when inherited parent context is required and available. External runners expose only capabilities their runner contract declares.

## Workflow execution

```js
{ workflowScript: `
  const scan = await runs.run("scan", { agent: "scout", task: "Find affected files" });
  const results = await runs.all([
    { key: "correctness", agent: "reviewer", task: "Review correctness: " + scan.output },
    { key: "tests", agent: "reviewer", task: "Review tests: " + scan.output }
  ]);
  return results.map(result => result.output);
` }
```

Use stable keys. Await every `runs.run`, `runs.all`, `runs.steer`, and retained promise. `runs.all` resolves to an ordered array. Use `runs.lanes` for bounded parallel sequential lanes and `runs.host` for one bounded operator-owned command. Scripts cannot access filesystem, shell, arbitrary Pi tools, or host globals.

Keep one writer per checkout. Use managed `worktree:true` isolation for parallel mutation lanes. Preserve capability ceilings, permissions, acceptance, timeouts, tool budgets, usage budgets, and fanout bounds.

## Status and control

Use `status` and `debug.run` for bounded lifecycle views. Use `children.list` before `resume` and resume only rows reported resumable. `steer` is acknowledged delivery; it is not proof of compliance. `interrupt` pauses current work when supported. `stop` remains ownership-controlled. Use `subagent_wait` rather than sleep or status polling when the current turn must consume async completion.

Background work remains visible through Fleet, status, events, artifacts, and completion notifications.

## Worktrees and handoff

`lane.status` reads handoff evidence. `worktree.discard` remains destructive, confirmation-controlled, and path-validated. It is blocked in child-safe fanout mode. Models do not control lane merge/supersession policy or broad cleanup.

## Evidence

Omit acceptance only when inherited or inferred behavior is correct. Mutation work must report changed files, validation, and residual risks. Use explicit checked/verified contracts when the caller needs stronger evidence. A child saying it is done is not sufficient without the requested evidence.
