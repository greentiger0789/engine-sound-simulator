# Ticket N — implementation record template

Copy the following structure to `docs/tickets/reports/NNN.md`, replacing the descriptions with evidence. Do not copy this template as a completed report.

## Status

`Status: verified` / `Status: manual-validation-pending` / `Status: blocked` — select one as a plain text line in the resulting report. `verified` requires all mandatory acceptance criteria and reviews complete. A report on a feature branch is not yet a merged dependency.

## Scope

Ticket link, concrete behavior implemented, and implementation commit SHA reviewed (record before a report-only commit; do not attempt a self-referencing SHA).

## Acceptance evidence

Map each mandatory acceptance criterion to the test, observed behavior, or artifact that verifies it. Distinguish optional phase-level listening checks from mandatory requirements.

## Review

Self-review scope and result. Independent reviewer role/model when available, findings, corrections and final recheck. Explain serial fallback if delegation was unavailable. List any unresolved questions separately.

## Verification

Actual Docker commands, success/failure and relevant environment. Put the final PR head SHA and GitHub CI URL in the PR body after pushing. Never write unexecuted commands as successful.

## Limits and next actions

Required manual checks, external blockers, or supported scope. For a fully verified ticket, state that no mandatory checks remain pending. Do not mark the next ticket completed.
