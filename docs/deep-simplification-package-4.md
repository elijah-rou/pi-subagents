# Deep simplification Package 4: legacy orchestration writer retirement

Status: implemented in the working tree after `31cb0155`. `VISION.md` remains the acceptance policy. Package 0 history and `docs/deep-simplification-baseline.json` are unchanged.

## Disposition

Direct `{ agent, task }` execution and `workflowScript` are the only launch contracts. The executor now rejects legacy top-level `tasks`, `chain`, `parallel`, `concurrency`, and `chainDir` shapes even at the internal execution boundary. The detached runner also decodes its argv and stdin process inputs as exactly one non-group step with `resultMode: "single"`; it rejects multiple steps, parallel groups, dynamic groups, and legacy result modes before run startup or child spawn. Resume no longer accepts chain attachment. Current workflow children already launch one direct child, while `runs.all` and ordinary JavaScript own parallel and sequential composition.

The append-step writer and reader are removed. Core no longer creates, counts, reads, consumes, or executes `append-requests/*.json`, updates append bookkeeping, or emits append request/acceptance events. Existing append-request files remain untouched inert artifacts. Historical `pendingAppends` status projection remains a passive one-release persisted-status reader.

Saved `.chain.md` and `.chain.json` authoring is removed. Their parsers and discovery remain passive one-release compatibility readers so users can inspect and migrate definitions. `subagent({ action: "doctor" })` and `/subagents-doctor` report every readable legacy definition and compatibility diagnostic with migration guidance; discovery cannot execute a saved chain. The compatibility pass prioritizes project and user artifacts, does not follow directory, package, manifest, or file symlinks, and has aggregate limits of 8 levels per chain root, 256 directories, 4,096 entries, and 256 candidate chain files across package, project, and user roots. Package enumeration shares the directory and entry budgets, and every package manifest, settings file, and candidate chain read is capped at 262,144 bytes. Limit hits produce compatibility diagnostics. The readers must be removed after the published horizon and an artifact evidence check.

The orphaned chain-directory, template, instruction, and parallel-construction utilities are removed. Extension startup no longer scans or deletes historical chain directories, so retained artifacts are passive and byte-preserving. Current workflow execution no longer pre-creates legacy `progress.md` artifacts.

## Preserved behavior

`workflowScript` sequential, parallel, dynamic, resume, host, acceptance, child identity, recovery, status, Fleet visibility, steering, stopping, and result evidence remain on their existing paths. The retired async-chain planner and writer are removed; current workflow composition launches direct children.

## Evidence

Behavior tests require public, slash, and raw internal executor calls to reject append-step without reading a run. A literal valid old `append-requests/*.json` fixture remains present and byte-for-byte unchanged after rejection. Raw internal executor tests also reject top-level tasks, chain, concurrency, and chainDir before child launch. A process-boundary test supplies multiple, parallel, dynamic, raw `importAsyncRoot`, and chain-mode runner configs and verifies that no status artifact or child-spawn marker is created. The same decoder guards argv and stdin startup. Inspection found no sibling runner discriminator bypass: `parallel`, `expand`, `collect`, and `importAsyncRoot` are all rejected before status creation, while non-single modes and step counts fail independently. Compatibility-reader tests cover `.chain.md` and `.chain.json` parsing without any authoring round trip. Boundary tests verify no-follow behavior plus depth, directory, entry, candidate, and byte limits, including symlinked package entries and manifests, oversized package manifests, and package-enumeration exhaustion. Every package, project, and user compatibility root passes through the same ancestor-component symlink assertion before discovery; project `.pi` symlink regression coverage proves the ancestor case. Direct async launch coverage verifies that the exact parent session identity and resolved permission policy reach the child process boundary.

Fresh validation on Node v25.9.0, Linux x64:

- Typecheck passed.
- Unit: 2,538 passed, 4 skipped, 0 failed.
- Integration: 800 passed, 6 skipped, 0 failed.
- Focused compatibility-reader, launch-boundary, and execution tests passed.
- Package dry-run passed with 276 files and no retired append implementation artifact.
- `git diff --check` passed.

Final runner-boundary validation passed: typecheck; 6 async runner unit tests; 8 retained chain-root attachment unit tests; 106 async execution integration tests; all 6 external CLI runner integration tests, including the pre-spawn rejection matrix; package dry-run with 276 files; and `git diff --check`. Post-review hardening validation passed typecheck; 98 agent-discovery and compatibility-reader unit tests, including the project `.pi` ancestor-symlink regression; the raw `importAsyncRoot` pre-spawn rejection; and the fresh isolated baseline measurement. The full unit and integration suites were rerun after both fixes with the counts above. The final scan removed the now-unused background-runner `readStatus` import; the chain-root attachment module and its tests remain active through foreground resume and revival.

The retained append fixture is 307 bytes with SHA-256 `f21de99f471c05d2c3184ed22680a63ecee4642fc3da368ce28adb7b7de3aa5a`.

Production TypeScript is 224 files and 80,812 LOC, down 1,596 LOC from the Phase 3 final baseline of 82,408 LOC. Model actions remain 15, trusted actions remain 27, recognized executor actions fall from 28 to 27, and combined root tool schema remains 18,519 bytes.

The final fresh isolated measurement recorded import/registration p50 572.650 ms and p95 583.578 ms; empty session start p50 2.209 ms and p95 2.481 ms; direct preparation p50 1.849 ms and p95 2.507 ms; and one-run refresh p50 0.039 ms and p95 0.053 ms. Active refresh remains seven filesystem calls. Idle watcher startup remains one realpath plus one watch, and the empty healthy scan remains three readdir calls per 60 seconds. Timing variation is not an SLO.
