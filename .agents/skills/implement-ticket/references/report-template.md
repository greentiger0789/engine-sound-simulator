# Ticket N — implementation record template

Copy the following structure to `docs/tickets/reports/NNN.md`, replacing the descriptions with evidence. Do not copy this template as a completed report.

## Status

`Status: verified` / `Status: manual-validation-pending` / `Status: blocked` — select one as a plain text line in the resulting report. `verified` requires all mandatory acceptance criteria and reviews complete. A report on a feature branch is not yet a merged dependency.

## Scope

Ticket link, concrete behavior implemented, and implementation commit SHA reviewed (record before a report-only commit; do not attempt a self-referencing SHA).

## Acceptance evidence

Map each mandatory acceptance criterion to the named test file/case and assertion, observed behavior, or artifact that verifies it. Distinguish code inspection, harness tests, product E2E and physical listening; none substitutes for another without checking the required contract. Distinguish optional phase-level listening checks from mandatory requirements.

For manual checks in this owner-driven hobby project, an explicit owner report is evidence for the behavior actually reported. Record its date, scope, and any missing browser/device/measurement details. Never invent absent values or expand a general report into a precise latency, duration, sample-rate, or cross-browser claim. If the owner explicitly narrows or defers a manual criterion, link the corresponding ticket/plan change and assess `verified` against the revised contract.

## Review

Self-review scope and result. Independent reviewer role/model when available, findings, corrections and final recheck. Explain serial fallback if delegation was unavailable. List any unresolved questions separately.

## Verification

Actual Docker commands, success/failure and relevant environment. Put the final PR head SHA and GitHub CI URL in the PR body after pushing. Never write unexecuted commands as successful.

## Limits and next actions

Required manual checks, external blockers, or supported scope. For a fully verified ticket, state that no mandatory checks remain pending. Do not mark the next ticket completed.
