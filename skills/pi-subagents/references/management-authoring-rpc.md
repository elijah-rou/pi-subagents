# Pi Subagents: discovery and human administration

Models may use only the Package 1 actions listed in the main skill. For discovery, use `list`, `get`, `models`, and `children.list`. For lifecycle work, use the retained status/control actions.

Do not call agent authoring, refinement, profile, schedule, mission, pane, lane-policy, broad-cleanup, or spawn-budget administration through the model-facing `subagent` tool.

## Named human interfaces

- Agent authoring and enable/disable/reset operations: `/subagents`
- Refinement overlays: `/subagents-refine`
- Profiles and provider catalogs: `/subagents-profiles`, `/subagents-load-profile`, `/subagents-refresh-provider-models`, `/subagents-generate-profiles`, `/subagents-check-profile`
- Fleet inspection: `/subagents-fleet`
- Diagnostics and guides: `/subagents-doctor`, `/subagents-guide`
- Models: `/subagents-models`

Trusted RPC retains only one-release passive `schedule.list`, `schedule.show`, and `schedule.history` compatibility readers. Schedule mutation and execution are removed. RPC spawn still accepts only current direct or workflow execution and rejects removed public execution shapes.

Package 2a removed mission administration and all new mission writes; only bounded legacy reading and completion synchronization remain for one release. Lane merge/supersession policy, broad cleanup, and optional pane administration still have no supported human replacement. Do not invent or recommend a mission slash interface.

`append-step` remains internal executor compatibility only. Model, slash, and RPC normalizers reject it.

## Retained model discovery

```js
{ action: "list" }
{ action: "get", agent: "worker" }
{ action: "models" }
{ action: "children.list" }
```

`children.list` reports explicit resumability. Resume only a child reported resumable; otherwise launch a same-role fallback and label it as fallback. Runtime agent registration through package APIs is a host integration contract, not a model administration action.
