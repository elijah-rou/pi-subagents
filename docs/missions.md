# Missions: Package 1 access and migration status

Mission runtime and persisted records are temporarily retained for compatibility and recovery while simplification Packages 2 and 3 decide their final disposition.

Package 1 removed mission actions and mission launch fields from the model-facing `subagent` schema. Models cannot create, list, show, update, attach, resolve, close, disable, or explicitly bind missions. There is no supported slash-command, RPC, or other human replacement for mission administration in Package 1. Do not invent one.

Ordinary delegation may still interact with automatic mission runtime behavior internally. Existing mission records, links, journals, decisions, receipts, workflow state, and recovery readers remain implementation details during this transition. Their presence does not make their former action names or fields callable.

For current model-visible recovery, use retained lifecycle surfaces:

- `status` and `debug.run` for bounded run state and diagnostics;
- `children.list` before `resume`;
- `steer`, `interrupt`, `resume`, and `stop` for supported run control;
- Fleet and `subagent_wait` for background visibility and completion.

Do not pass former mission fields in direct or workflow requests. Do not call former mission or schedule actions through the model tool. Existing trusted RPC schedule management is separate and does not expose mission administration.

Packages 2 and 3 must define any artifact horizon, migration command, extraction, or replacement before mission runtime or readers are removed. Until then, preserve existing records and avoid rewriting unknown artifacts.
