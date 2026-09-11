# Review and evidence

## Inputs

The selected ticket is the contract. Compare against the current main merge-base and inspect new, modified and deleted files. Check the working diff as well as committed changes; do not review only the last commit. Independent review receives the raw ticket, diff and relevant evidence, not a suggested verdict.

## Review dimensions

- Acceptance: each mandatory criterion is actually implemented; out-of-scope behavior and placeholders do not mask gaps.
- Correctness: boundaries, invalid inputs, state transitions, concurrency, resource cleanup, determinism and regression risks.
- Audio changes: actual sampleRate/block length, phase wrapping, coincident events, AudioParam shapes, finite output, clicks, allocation in Worklet and controller lifecycle.
- UI changes: keyboard/pointer cancellation, focus, labels, state/errors and browser start/resume restrictions.
- Build/configuration changes: clean Docker build, host-independent dependencies, public asset paths, CI trigger/check names, no secret leakage or weakened protection.
- Tests: they exercise observable behavior and failure modes; mocking has not removed the property the acceptance criterion requires.

Only apply relevant dimensions. Style issues already covered by formatters do not need separate reviewer rounds.

## Findings and corrections

For each finding record path/line, impact, evidence and verification. Distinguish confirmed defects from assumptions. Reproduce or trace it; fix confirmed actionable issues, and record why a finding was not applicable when justified. Do not dismiss real low-severity bugs solely to report zero findings.

After corrections, run the affected tests and review both the correction and possible regressions. Run the complete `make ci` before delivery. If code changes after the independent review, have the reviewer check the substantive changes; do not keep an obsolete clean verdict. A report-only or formatting-only edit needs proportional verification rather than another full agent audit.

## Completion record

Use the report template. Record implementation revision, reviewer role/model if observable, reviewed scope, findings/fixes, acceptance evidence, actual commands/outcomes and pending manual work. Do not paste private reasoning or full conversation logs.

`Status: verified` means every mandatory acceptance criterion has evidence and there are no known unresolved actionable findings. It is not proof of perfect software. Automated PCM/browser checks cannot prove that Windows speakers sounded correct, or that a specific physical device met a latency target. If that is mandatory and unavailable, use `Status: manual-validation-pending`; create/update the Draft PR with the explicit limitation.

A final successful CI run must match the current PR head. If the base changes, review and test the integration. Separate service outages from code failures, and do not manufacture a passing result when the service cannot finish.
