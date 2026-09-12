# Incidental bugs in earlier work

Apply this policy to bugs discovered while implementing the selected ticket; do not proactively audit unrelated features. Confirm the bug with a reproduction or code trace and check whether it predates the current change. Regressions introduced by the current work must be fixed, not deferred under this policy.

## Fix in the current PR

Include a pre-existing fix when the cause is understood, the change is localized and low risk, and relevant verification fits the current task. Judge simplicity by behavior and validation, not line count. Do not bundle architectural changes, public contract changes, migrations or a separate planned feature. If investigation reveals wider impact, stop expanding the fix and record the bug instead.

Keep the incidental fix identifiable in its own commit when practical. Include its evidence, verification and rationale in the implementation report and PR body, and include its diff in independent review. Coordinate path ownership with any active workers before editing.

## Record larger out-of-scope bugs

Search existing records in `docs/bugs/` before creating one; update a matching record instead of duplicating it. Create `docs/bugs/BUG-YYYYMMDD-short-slug.md` with a descriptive unique slug and use its filename stem as the stable ID. These records are separate from numbered implementation tickets: do not renumber or append them to `docs/tickets/index.json`, and do not assume GitHub Issue creation is requested.

Each record includes:

- Status (`open`, `blocked` or `resolved`) and a concise title.
- Discovery ticket/PR and affected earlier ticket when known; do not guess attribution.
- Affected revision, paths and environment.
- Reproduction steps, expected and actual behavior, or a concrete code trace when reproduction is unavailable; label uncertainties.
- Impact and priority with rationale, plus any known workaround.
- Why it is deferred, whether it blocks the current ticket, and proposed investigation or fix boundaries.
- Observable acceptance criteria and verification for a future fix.

Commit the record in the current branch and link it from the implementation report and PR body. Record creation does not resolve the bug. A later fix updates the record to `resolved` with the fix revision/PR and verification evidence.

## Completion boundary

A deferred pre-existing bug may coexist with a verified ticket only if it does not invalidate the ticket's mandatory acceptance, required CI, or the behavior changed by this PR. Disclose it as a known pre-existing limitation; do not claim the repository has no known defects. If it blocks those conditions and cannot be fixed within the bounded scope, commit the evidence, leave the ticket pending/blocked and deliver the Draft PR with the exact blocker. Never suppress a failing check or relabel a current regression as pre-existing to finish.
