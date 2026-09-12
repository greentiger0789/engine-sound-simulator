# Review and evidence

## Inputs

The selected ticket is the contract. Compare against the current main merge-base and inspect new, modified and deleted files. Check the working diff as well as committed changes; do not review only the last commit. Independent review receives the raw ticket, diff and relevant evidence, not a suggested verdict.

## Review dimensions

- Acceptance: each mandatory criterion is actually implemented; out-of-scope behavior and placeholders do not mask gaps.
- Correctness: boundaries, invalid inputs, state transitions, concurrency, resource cleanup, determinism and regression risks.
- Audio changes: actual sampleRate/block length, phase wrapping, coincident events, AudioParam shapes, finite output, clicks, allocation in Worklet and controller lifecycle.
- UI changes: keyboard/pointer cancellation, focus, labels, state/errors and browser start/resume restrictions.
- Build/configuration changes: clean Docker build, host-independent dependencies, public asset paths, CI trigger/check names, no secret leakage or weakened protection.
- Documentation: when behavior, commands or supported scope changes, check README and CONTRIBUTING against the implementation; update affected startup instructions, URLs, CI descriptions and implementation status.
- Tests: they exercise observable behavior and failure modes; mocking has not removed the property the acceptance criterion requires. Trace each acceptance claim to the actual assertion and executed path: graph construction is not processor readiness, a harness is not the product loader, and enabling StrictMode is not observing its remount. Distinguish injected failures from native failures.
- Numerical changes: check finite derived values and conversions as well as inputs, reject pathological per-call work, and define what state is preserved after a rejected advance. For sample-driven integration, compare changing-input trajectories across buffer partitions, not only final state under constant input.

Only apply relevant dimensions. Style issues already covered by formatters do not need separate reviewer rounds.

## Dependency and container lifecycle changes

When changing dependency installation, development volumes or container startup, verify the update path as well as a clean start: start development, stop it as a user normally would, update a dependency, then rebuild/restart and confirm the new dependency resolves inside the running service. An image build alone does not prove that mounted dependencies were refreshed. For anonymous `node_modules` volumes, check whether restart preserves old contents; use an appropriate renewal mechanism or a documented reset procedure. Do not impose this scenario on unrelated tickets.

Use an isolated Compose project and temporary fixture/worktree when the scenario needs disposable dependency edits. Preserve user containers and volumes; clean up only resources created for the check. Record the actual scenario and result, or clearly distinguish a code trace from an executed reproduction.

## Findings and corrections

For each finding record path/line, impact, evidence and verification. Distinguish confirmed defects from assumptions. Reproduce or trace it; fix confirmed actionable issues, and record why a finding was not applicable when justified. Do not dismiss real low-severity bugs solely to report zero findings.

After corrections, run the affected tests and review both the correction and possible regressions. Run the complete `make ci` on the implementation/delivery-tree revision. A subsequent evidence-only Markdown commit follows [orchestration.md](orchestration.md): document/catalog and committed-history secret checks locally, plus the required GitHub gate on the final head. Do not claim that final head passed a local full gate unless it actually did. If code changes after the independent review, have the reviewer check the substantive changes; do not keep an obsolete clean verdict. A report-only or formatting-only edit needs proportional verification rather than another full agent audit.

## Completion record

Use the report template. Record implementation revision, reviewer role/model if observable, reviewed scope, findings/fixes, acceptance evidence, actual commands/outcomes and pending manual work. Name the relevant test file/case or artifact for each acceptance claim; successful parsing alone does not prove every preset constant. Refresh counts from the final run, or omit counts that add no evidence. Do not paste private reasoning or full conversation logs.

`Status: verified` means every mandatory acceptance criterion has evidence and there are no unresolved actionable findings in the delivered change. Deferred pre-existing bugs must satisfy [the incidental-bug policy](incidental-bugs.md) and be linked as known limitations. It is not proof of perfect software. Automated PCM/browser checks cannot prove that Windows speakers sounded correct, or that a specific physical device met a latency target. If that is mandatory and unavailable, use `Status: manual-validation-pending`; create/update the Draft PR with the explicit limitation.

A final successful CI run must match the current PR head. If the base changes, review and test the integration. Separate service outages from code failures, and do not manufacture a passing result when the service cannot finish.
