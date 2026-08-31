# Deep simplification Package 6

Status: implemented and reviewed.

## Ownership

| Lifecycle fact | Authoritative source | Read projection |
| --- | --- | --- |
| Live state and activity | durable `status.json`, mirrored in `SubagentState.asyncJobs` while observed | `AsyncStatusSnapshotNodeV1.state` and `activity` |
| Terminal result | terminal status plus a bounded output artifact reference | terminal state and whether an output path is referenced |
| Process proof | `processTerminal` written by runner settlement or stale-run reconciliation | bounded `processProof` |
| Workflow receipt | `status.workflow.receipt` | receipt state and creation time only |
| Nested children | nested event/status records folded into status and observer state | bounded recursive `children` |

`projectAsyncStatusSnapshot` is pure and bounded by run, child, depth, string, and serialized-byte caps. The effective serialized-byte cap has a named 512-byte minimum so the fixed empty envelope fits; every returned snapshot serializes within its reported effective cap, including callers that request the former 256-byte value. Active siblings precede terminal siblings while source order remains stable within each rank. Projection now ranks and slices before recursively serializing omitted children.

## Migrations

- Inline RPC output, status RPC, compact Fleet, detailed Fleet, status, and transcript paths use the shared lifecycle state or bounded projection.
- Compact and detailed Fleet classify renderer rows through the cheap `projectLifecycleState` seam instead of recursively projecting every tracked job.
- Sanitized public IDs are never used to join back to internal maps. Fleet and RPC retain raw map identity internally and sanitize only public output.
- Removed `SubagentState.fleetJobs` and its renderer-specific retention writer. `asyncJobs` is the sole live observer map.
- RPC v1 reads up to 20 recent terminal runs from the durable terminal index and merges them with the current observer map before building one snapshot.
- `listAsyncRuns(..., { reconcile: false })` and its terminal-index reader perform no index repair. Detailed Fleet and RPC history reads are lifecycle-write-free.
- Missed events still converge through the async tracker's bounded liveness sweep and `reconcileAsyncRun`; native watchers remain the fast path.

Stop, steer, resume, stale-process repair, workflow detach reconciliation, and nested-event folding remain lifecycle writers outside rendering.

## Measurements

Identical 256-run, 100-step fixtures, 100 measured iterations after 10 warmups:

| Path | Mean latency |
| --- | ---: |
| Package 5 full projection | 1.011 ms |
| Package 6 bounded projection | 0.176 ms |
| Package 6 renderer lifecycle classification | 0.002 ms |

Package 6 keeps the 5,000 ms slow reconciliation interval and zero compact-Fleet idle refresh timers. Production TypeScript is 80,989 lines versus 80,958 at Package 5. The reviewed correctness fixes leave a 31-line increase while removing the duplicate lifecycle cache and full renderer projections.

## Validation

Commands run in this checkout:

- `npm run typecheck`: exit 0.
- Focused projection, snapshot, compact Fleet, detailed Fleet, RPC, async status, and tracker tests: 194 passed, 0 failed.
- `git diff --check`: exit 0.

Full suites were not rerun because the review fixes affect only visibility projection, pure index reads, and renderer classification.
