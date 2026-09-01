# Compact Commissioning And Handoff

Use this reference when writing a child task or passing evidence between roles.
Keep role selection, model settings, and specialized workflow recipes in
`prompting-and-roles.md`; a routine commission should not load that omnibus.

## Canonical packet

Every child receives one cold-start-complete packet with these fields, in this
order. Omit prose, not fields; use `none` when a field has no items.

```text
Objective/deliverable: <one bounded outcome and expected deliverable>
Repo/cwd/ref: <repository; explicit cwd; target branch, commit, or HEAD>
Authority/edit boundary: <read/write scope; allowed files/actions; one-writer ownership>
Parent-decided seams/constraints: <settled decisions, relevant symbols/files, non-goals>
Observable acceptance: <behavior or evidence that proves completion>
Targeted validation: <checks for this seam, or explicit reason they cannot run>
Output/artifact: <concise result shape; managed or approved durable artifact path, or none>
Stop/escalation: <conditions that return unresolved authority or missing evidence to parent>
```

The authority field must explicitly say whether the child may edit, commit,
push, comment, merge, publish, release, or launch children. Never infer product,
architecture, compatibility, security, publication, merge, or release authority
from the objective. The acceptance field must remain observable: changed files,
command results, findings with evidence, or an explicit blocked state. Checks,
reviews, and child claims are evidence, not parent acceptance.

Keep one coherent implementation seam and its targeted checks in each writer
packet. Give source anchors rather than broad history. Use managed artifact paths
for scratch output and repository-qualified paths only for approved durable
handoffs. Stop when the requested evidence is sufficient; escalate any
unsettled decision that would widen authority or scope.

## Scout evidence and parent synthesis

A scout is read-only unless the packet explicitly says otherwise. Its output is
bounded evidence keyed to the decisions or code seams the parent named:

```text
Evidence:
- <decision-or-seam ID>: <fact>; <file:line-range or command/source>; confidence <high|medium|low>
Conflicts/gaps:
- <ID>: <conflict, missing fact, or none>
Implications:
- <ID>: <decision implication, not an implementation decision>
```

The parent verifies citations, resolves conflicts, owns decisions, and writes a
new canonical worker packet. Do not paste scout transcripts, full research
reports, or broad parent history into the worker task. If evidence is too large,
pass a bounded artifact path plus the specific IDs the worker must consume.

Example scout-to-worker flow:

```text
Scout packet
Objective/deliverable: Locate the parser and tests governing malformed report fields; return seam-keyed evidence.
Repo/cwd/ref: pi-subagents; /repo/pi-subagents; HEAD
Authority/edit boundary: Read-only; may not edit, commit, push, comment, merge, publish, release, or launch children.
Parent-decided seams/constraints: Inspect acceptance parsing only; runtime compatibility is unresolved.
Observable acceptance: Cite parser, prompt, and production-path test seams; name conflicts or gaps.
Targeted validation: Read the cited tests; no suite run required.
Output/artifact: Evidence/Conflicts/Implications format above; none.
Stop/escalation: Stop after the named seams; return any compatibility choice unresolved.

Parent synthesis: malformed fields remain fail-closed; edit parser diagnostics and production-path tests only.

Worker packet
Objective/deliverable: Improve malformed-field diagnostics and add the production-path regression.
Repo/cwd/ref: pi-subagents; /repo/pi-subagents; HEAD
Authority/edit boundary: Sole writer; may edit parser/tests only; may not commit, push, comment, merge, publish, release, or launch children.
Parent-decided seams/constraints: Preserve fail-closed parsing; parser.ts and acceptance.test.ts are the verified seams.
Observable acceptance: `criterion` is rejected precisely and the documented shape succeeds.
Targeted validation: Run the focused acceptance test and typecheck.
Output/artifact: Changed files, exact commands/results, residual risks; none.
Stop/escalation: Stop for a compatibility/API choice or failure outside the named seams.
```

## Review-to-fix handoff

Reviewers return stable finding IDs with severity, affected seams, concrete
source/test/contract evidence, and the evidence that would prove resolution.
The parent checks each finding against current HEAD and records disposition
without dropping severity:

```text
- <ID> [<P0|P1|P2>] <FIX|ESCALATE|BLOCK|DEFER|REJECT>: <reason and evidence obligation>
```

Valid P0/P1 findings may not be deferred: fix, escalate, or report blocked. A
fix worker receives only:

```text
Accepted findings:
- <ID> [<P0|P1>]: <required outcome>; evidence obligation: <proof>; affected seams: <files/symbols/tests>
```

Put that list inside the canonical packet. Do not pass rejected/deferred
findings, reviewer transcripts, or a full review report. A focused re-review
needs the accepted finding IDs, changed diff/ref, evidence obligations, and fix
blast radius only.

## Resume boundary

Resume only when the next instruction depends on the same child's bounded
working state: an interrupted operation, a direct clarification, or a focused
continuation on the same role, seam, repo/cwd/ref, and authority boundary. Check
that the child is reported resumable first.

Launch a fresh child with a canonical packet for a new role, adversarial or
independent review, a different seam or authority boundary, or an unrelated
phase. Fresh context prevents stale conclusions and avoids paying to retain a
large transcript. A fresh replacement after failure starts from the durable
handoff and current ref; it does not pretend to resume hidden state.
