# Deep simplification Package 3b: Orca observer removal

Status: implemented in the working tree at source commit `85e41c90`. `VISION.md` remains the acceptance policy.

Package 3b removes the optional Orca progress-tab observer from core. No foreground, background, native, or external execution path discovers or invokes Orca, mirrors stdout/stderr or lifecycle events, spawns observer or cleanup processes, or creates manifests, temporary mirrors, logs, counters, markers, locks, or cleanup work. Native and external runners retain their existing output, lifecycle, Fleet, status, result, control, and recovery paths.

## One-release inert configuration

For one published Package 3b release, an existing `orcaProgressTabs` key is tolerated as unknown inert configuration regardless of its shape. Configuration loading and unrelated rewrites preserve it without validation. No value can activate observer behavior. The environment variable formerly used to select a binary has no behavior.

Existing `.pi/subagents/views/orca` manifests and old temporary files are unknown user artifacts. Core does not read, create, mutate, migrate, or delete them. Users may remove them manually after confirming they are no longer needed.

## RED and GREEN evidence

RED tests demonstrated that malformed retired configuration was rejected and enabled configuration still invoked an observer during external execution. GREEN tests cover inert configuration preservation and ordinary foreground native, background native, and background external execution. They assert preserved outputs, no observer invocation, and non-destructive handling of existing artifacts.

GREEN on Node v25.9.0, Linux x64:

- TypeScript passed.
- Unit: 2,610 passed, 4 skipped, 0 failed in 25.101 seconds.
- Integration: the fresh sequential full rerun passed 874, skipped 6, and failed 0 in 80.664 seconds. Earlier load-concurrent runs exceeded the 30-second status wait in `classifies a timed-out dirty child with a missing requested report as recovery-needed`; that case passed alone in 1.406 seconds and in the fresh full rerun. Package 3b focused external coverage passed 23 cases, including raw-log flush, output bounds, stderr results, process lifecycle, and native/external inert-config execution.
- E2E completed in 0.322 seconds; the real Pi-session case was unavailable because Pi runtime packages were not installed, so zero tests ran.
- `npm pack --dry-run` passed: 284 files, 1.1 MB packed, 4.6 MB unpacked.
- `git diff --check`, credential-pattern scan, and dead Orca production coupling scan passed.

The fresh baseline is `/tmp/package-3b-followup-baseline.json`. Compared with Package 3a, production TypeScript falls from 235 files and 86,563 lines to 234 files and 85,988 lines, a net reduction of 575 lines. The production diff is 1 insertion and 576 deletions. Model actions remain 15, trusted actions remain 36, recognized dispatch actions remain 37, and combined root schema size remains 18,519 bytes. Import/registration measured p50 614.961 ms and p95 651.569 ms; empty session start p50 2.533 ms and p95 2.605 ms; direct preparation p50 2.014 ms and p95 2.661 ms; one-run refresh p50 0.039 ms and p95 0.071 ms. Active refresh remains seven filesystem calls, idle watcher startup remains one realpath plus one watch, and the empty healthy scan remains three directory reads per 60 seconds. Timing variation is not an SLO. The committed Package 0 historical facts and baseline remain unchanged.
