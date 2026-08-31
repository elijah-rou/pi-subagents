# Deep simplification Phase 3 closeout: Packages 3d and 3e

Status: implemented in the working tree at source commit `69ec9477`. `VISION.md` remains the acceptance policy. Package 0 history and baseline are unchanged.

## Package 3d: provider profile and catalog administration

Package 3d removes the `src/profiles` product and its five slash commands: list profiles, load profile, refresh provider models, generate profiles, and check profile. Core no longer reads or writes saved provider-profile JSON, applies saved profiles to settings, probes provider models, or writes provider catalogs. Existing files under `~/.pi/agent/profiles/pi-subagents/` remain untouched inert unknown artifacts for one published release. Already-applied `subagents` settings remain ordinary current settings; there is no migration, deletion, healing, or rollback.

This disposition does not change action counts. It preserves `context: "profile"`, the child-profile resolver API, child-profile provenance and exports, external CLI agent profiles, static agent model settings and overrides, Pi model registries, and supported human `/subagents` agent administration.

## Package 3e: refinement overlays

Package 3e removes refinement overlays completely: the three trusted `refine`, `refine.show`, and `refine.rollback` actions; `/subagents-refine`; proposal-child execution; evidence and artifact readers; overlay and snapshot writers; and foreground, async-chain, and async-single prompt injection. Existing `.pi/subagents/refinements/` files remain untouched inert unknown artifacts for one published release. Core does not read, write, migrate, delete, or heal them.

Ordinary explicit reviewer workflows, acceptance, prompt-audit redo, static agent discovery, and human `/subagents` authoring remain.

## Evidence

RED coverage changed the trusted-action count to 27, required all three refinement actions to be rejected by public and trusted normalization, required `/subagents-refine` and all five profile commands to be absent, and used a static valid pre-removal refinement v1 artifact to require byte-for-byte preservation with no overlay injection in foreground, async-single, and async-chain prompt assembly. The focused RED run failed at the old trusted-action count. GREEN passed the focused public-normalization, tool-description, profile compatibility, slash registration, and all three execution-path checks. Closeout review clarified that the administration interfaces and counts in the Package 1 report are historical, including the subsequent Package 3a, 3d, and 3e removals.

Fresh final validation on Node v25.9.0, Linux x64:

- Typecheck passed.
- Unit: 2,553 passed, 4 skipped, 0 failed.
- Integration: 877 passed, 6 skipped, 0 failed.
- E2E completed; the real Pi-session case was unavailable because Pi runtime packages were not installed, so zero tests ran.
- `npm pack --dry-run` passed with 275 files.
- `git diff --check`, credential-pattern scan, retired-coupling scan, and empty-production-directory scan passed.

The fresh isolated baseline is `/tmp/phase3-baseline-20260831T0018Z.json`, created at `2026-08-31T00:16:49.759Z`. Production TypeScript is 224 files and 82,408 LOC. Model actions remain 15. Trusted actions are 27. Recognized dispatch actions are 28 including internal `append-step`. Combined root tool schema size remains 18,519 bytes.

## Package 3c baseline delta

| Measure | Package 3c | Phase 3 final | Delta |
|---|---:|---:|---:|
| Production TypeScript files | 226 | 224 | -2 |
| Production TypeScript LOC | 84,041 | 82,408 | -1,633 |
| Model actions | 15 | 15 | 0 |
| Trusted internal actions | 30 | 27 | -3 |
| Recognized executor actions | 31 | 28 | -3 |
| Combined root tool schema bytes | 18,519 | 18,519 | 0 |
| Import/registration p50 | 588.351 ms | 567.053 ms | -21.298 ms |
| Import/registration p95 | 618.622 ms | 588.861 ms | -29.761 ms |
| Empty session start p50 | 2.220 ms | 2.165 ms | -0.055 ms |
| Empty session start p95 | 2.422 ms | 2.215 ms | -0.207 ms |
| Session shutdown p50 | 0.490 ms | 0.468 ms | -0.022 ms |
| Session shutdown p95 | 0.496 ms | 0.492 ms | -0.004 ms |
| Direct preparation p50 | 1.958 ms | 1.916 ms | -0.042 ms |
| Direct preparation p95 | 2.618 ms | 2.485 ms | -0.133 ms |
| One-run refresh p50 | 0.039 ms | 0.038 ms | -0.001 ms |
| One-run refresh p95 | 0.055 ms | 0.061 ms | +0.006 ms |
| Active refresh filesystem calls | 7 | 7 | 0 |
| Idle watcher start | 1 realpath + 1 watch | 1 realpath + 1 watch | 0 |
| Empty healthy scan | 3 readdir / 60 s | 3 readdir / 60 s | 0 |

The combined Package 3d/3e production diff after review closeout is 14 insertions and 1,647 deletions, net -1,633. Timing variation is not an SLO. Both dispositions remove complete optional products while preserving delegation, explicit review, model selection, agent discovery and authoring, evidence, visibility, and control.

## Review P2 closeout

A follow-up review found that rejected `refine`, `refine.show`, and `refine.rollback` requests still received generic guidance pointing at slash commands or RPC bridges, and that packaged administration guidance described the retired provider and Herdr pane products as only absent from the model surface. Public and trusted-host normalization now return distinct retirement guidance for creating, displaying, and rolling back refinement overlays without naming removed routes. Rejection is casing-insensitive while preserving action-specific guidance. Packaged tool and management guidance now states that provider profile/catalog administration and the Herdr inspector/project-pane products are retired.

The retention unit fixture now pins reconciliation-produced logical timestamps and every physical timestamp used by the later retention boundary to its injected clock. This keeps the test deterministic across wall-clock and calendar boundaries without changing production retention semantics.

Fresh follow-up validation passed typecheck; 52 focused unit tests covering normalization, retention, packaged guides, action counts, tool descriptions, and provider profile/settings/catalog artifact compatibility; and 29 focused integration tests covering slash registration plus foreground, async-single, and async-chain inert refinement artifacts. Full validation passed 2,553 unit tests with 4 skipped, 877 integration tests with 6 skipped, and the package dry-run with 275 files. The real Pi-session E2E case remained unavailable because Pi runtime packages were not installed. The integration fixture remained byte-for-byte unchanged and prompts contained no refinement overlay. `git diff --check`, the credential-pattern scan, retired-coupling scan, and empty-production-directory scan passed.
