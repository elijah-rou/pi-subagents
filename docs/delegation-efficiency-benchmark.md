# Matched orchestration benchmark

This deterministic benchmark executes one repository-neutral stateful workload under two orchestration strategies. It does not call a live model or inspect a real repository.

```sh
npm run benchmark:orchestration
```

The command writes the normalized result to [`delegation-efficiency-benchmark-summary.json`](delegation-efficiency-benchmark-summary.json) and raw JSONL to ignored `tmp/orchestration-benchmark/raw-evidence.jsonl`.

## Matched design

Both runs use runtime policy `pi-subagents@0.59.0-fork.1/workstream-9`, deterministic mock model policy `deterministic-mock-policy-v2`, seed `delegation-efficiency-workstream-9-seed-1`, executable workload SHA-256 `c2507d3d8f04d617612d3fbde3d2e47801510146d8860805c2bf477995083486`, a 180,000 ms timeout, concurrency limit 2, and the successful `final-parent-acceptance` event as cutoff. Only the strategy and its guidance packet differ.

The executor maintains a program map, owner-selected default, artifact, read-only preparation evidence, validation outcomes, and finding lifecycle. The owner decision gates mutation. One identified writer applies both slices and the repair. Slice B deterministically writes an `open` access value that conflicts with the selected `owner-only` default. Ordinary review detects that P1 from artifact state. Accepted disposition, repair, linked focused re-review, checkpoint validation, and final parent acceptance then close it. Every operation emits its duration and calculated mock usage. Summary values are derived from emitted call, wrapper, wait, poll, launch, resume, review, validation, owner-decision, finding, usage, operation, acceptance, and cutoff events.

## Observed deterministic result

| Metric | Baseline | Proposed | Delta |
| --- | ---: | ---: | ---: |
| Owner-excluded virtual wall time (ms) | 133 | 91 | -42 |
| Top-level execution calls | 13 | 4 | -9 |
| Singleton workflow wrappers | 13 | 0 | -13 |
| Blocking waits | 6 | 1 | -5 |
| Status polls | 6 | 0 | -6 |
| Child launches / resumes | 4 / 2 | 4 / 2 | 0 / 0 |
| Review rounds | 2 | 2 | 0 |
| Parent context bytes | 17,114 | 16,451 | -663 |
| Child context bytes | 53,828 | 52,502 | -1,326 |
| Combined known processed tokens | 28,360 | 20,260 | -8,100 |
| Combined known reported cost (USD) | 0.11344 | 0.08104 | -0.03240 |
| Targeted / checkpoint / final validations | 2 / 1 / 1 | 2 / 1 / 1 | parity |
| Detected / accepted / fixed / verified findings | 1 / 1 / 1 / 1 | 1 / 1 / 1 / 1 | parity |
| Unresolved accepted findings | 0 | 0 | parity |
| Final parent acceptance | accepted | accepted | parity |

The successful-cutoff wall-time partition is non-overlapping and exhaustive:

| Partition (ms) | Baseline | Proposed |
| --- | ---: | ---: |
| Owner | 10 | 10 |
| Parent | 38 | 16 |
| Child | 71 | 61 |
| Tool | 12 | 12 |
| Wait | 12 | 2 |
| Idle | 0 | 0 |
| **Wall total** | **143** | **101** |

Intervals in the same category are unioned. A positive-duration overlap between different categories is rejected rather than assigned by precedence. Idle is the uncovered remainder of `[0, successful cutoff]`, and the partition sum must equal wall time exactly.

Review evidence also fails closed: the trace must contain exactly one ordinary finding review and one focused verified review, with the expected review, finding, prior-review, and repair IDs. Matching ordinary-review, repair, and focused-re-review operations and the detected, accepted, fixed, and verified finding events must carry the corresponding links.

Usage is deduplicated by model attempt ID. Parent and child totals remain separate before `combinedKnown` sums them. External usage is unknown and excluded.

## Limits

Durations and token/cost calculations are synthetic outputs of one deterministic mock executor. This verifies workload invariants, trace accounting, and the observed strategies under this fixture. It does not establish causation, provider behavior, statistical significance, or generality to live models or other tasks.
