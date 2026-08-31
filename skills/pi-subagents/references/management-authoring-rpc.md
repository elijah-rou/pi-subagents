# Pi Subagents: discovery and human administration

Models may use only the Package 1 actions listed in the main skill. For discovery, use `list`, `get`, `models`, and `children.list`. For lifecycle work, use the retained status/control actions.

Do not call agent authoring, schedule, mission, lane-policy, broad-cleanup, or spawn-budget administration through the model-facing `subagent` tool. Provider profile/catalog administration and the Herdr inspector/project-pane products are retired, not hidden behind trusted slash, RPC, or package routes. Refinement overlays are retired.

## Named human interfaces

- Agent authoring and enable/disable/reset operations: `/subagents`
- Fleet inspection: `/subagents-fleet`
- Diagnostics and guides: `/subagents-doctor`, `/subagents-guide`
- Models: `/subagents-models`

Trusted RPC retains only one-release passive `schedule.list`, `schedule.show`, and `schedule.history` compatibility readers. Schedule mutation and execution are removed. RPC spawn still accepts only current direct or workflow execution and rejects removed public execution shapes.

Package 2a removed mission administration and all new mission writes; only bounded legacy reading and completion synchronization remain for one release. Lane merge/supersession policy and broad cleanup still have no supported human replacement. Do not invent or recommend mission, provider profile/catalog, or Herdr pane administration interfaces.

`append-step` remains internal executor compatibility only. Model, slash, and RPC normalizers reject it.

## Retained model discovery

```js
{ action: "list" }
{ action: "get", agent: "worker" }
{ action: "models" }
{ action: "children.list" }
```

`children.list` reports explicit resumability. Resume only a child reported resumable; otherwise launch a same-role fallback and label it as fallback. Runtime agent registration through package APIs is a host integration contract, not a model administration action.
