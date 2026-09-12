---
name: implement-ticket
description: Implement one numbered engine-sound-simulator ticket from a request such as チケット1を対応して, including a feature branch, delegated implementation, self-review and fixes, Docker verification, and a Draft PR. Use to resume the same ticket as well.
---

# Implement one ticket

This repository's ticket request includes implementation, commits, push and Draft PR creation; continue through these steps without a second permission question. It does not include merging, marking ready, deploying, or implementing another ticket. Respect actual tool permissions and any newer user constraints.

## Resolve and prepare

1. Resolve the local ID in `docs/tickets/index.json` (`make ticket TICKET=1` shows it). Read that ticket, `CONTRIBUTING.md`, and only the referenced plan sections. GitHub Issue numbers do not identify these tickets.
2. Inspect `git status --short --branch`, remotes, `git worktree list`, and existing PRs for the deterministic head `feat/ticket-NNN-<slug>`. Use `gh pr list --repo greentiger0789/engine-sound-simulator --head <head> --state all --json number,state,isDraft,url,headRefName,baseRefName`. Fetch `origin/main` before checking dependencies.
3. Verify this workflow and the selected ticket exist on `origin/main`. If this setup PR is not yet merged, report that prerequisite instead of creating a branch that lacks its instructions. Each dependency needs a `Status: verified` report at `origin/main:docs/tickets/reports/NNN.md` plus the corresponding implementation. Use the report’s scope and acceptance evidence to locate the implemented paths on `origin/main`; confirm that the cited contracts still exist. If the report and code disagree, investigate before treating the dependency as ready. Do not treat a Draft/open PR, a plan, or a closed Issue as completion.
4. For a new ticket with a clean tree, use `git switch --no-track -c <head> origin/main`. If the head exists locally or remotely, inspect and resume it without resetting it. If the PR is already merged and the report is verified, return its result rather than duplicating it. A closed unmerged PR requires explaining its history before reopening/replacing; do not reopen a deliberately cancelled change automatically.
5. Preserve unrelated edits and branches. With unrelated uncommitted edits, use a separate worktree rather than switching or editing in that dirty tree. Use a unique directory under `/tmp` or another authorized writable location and do all task commands there. If the existing ticket branch is already checked out elsewhere, resume that worktree only if it is clean or its edits are confirmed to belong to this ticket and no other session is using it; otherwise report the conflict instead of attaching a second writer. Do not stash/reset user changes, delete worktrees, or force push. Check whether a branch is already checked out in another worktree before using it.

## Implement and verify

- Translate acceptance criteria into a short working checklist. Choose the smallest useful split and follow [orchestration.md](references/orchestration.md). The orchestrator owns shared configuration, interfaces and repository mutations.
- Implement the selected scope. Add tests that distinguish correct behavior from plausible failures; do not write tests that only mirror implementation details. Use the ticket's Docker commands, adding missing commands only if this ticket defines them.
- No placeholder test success, ignored failures, relaxed main protection, fabricated manual results, or unrelated redesign to complete a ticket.
- Maintain a concise implementation record at `docs/tickets/reports/NNN.md` using [report-template.md](references/report-template.md). Prepare the record before independent review so missing deliverables are reviewed alongside code; leave unexecuted checks explicitly pending and update their results after execution. Record unavailable manual checks explicitly. `Status: verified` requires all mandatory acceptance criteria satisfied; otherwise use `manual-validation-pending` or `blocked`.

## Incidental bugs in earlier work

Follow [incidental-bugs.md](references/incidental-bugs.md) when a confirmed pre-existing bug is discovered during the selected ticket. Small, bounded fixes and committed bug records are authorized within the current PR; this is not permission to implement another planned ticket.

## Review → fix → verify

Use [review.md](references/review.md). Review the entire task diff yourself. For substantive changes, request an independent reviewer with the ticket, diff/base, relevant contracts and evidence; do not supply your conclusion as the expected answer. Address every confirmed actionable finding, repeat affected tests and review the changes for regressions. Finish with no unresolved actionable defects in the delivered change and successful relevant verification. Pre-existing out-of-scope bugs may remain only under the incidental-bug policy, with explicit records and no impact on mandatory acceptance or the required CI gate. If a requirement cannot be checked in this environment, it remains pending.

Do not stop merely because a fixed number of review rounds has elapsed. If the same cause remains after three attempted corrections, change the approach and diagnose it; when further progress requires external input, record the exact blocker and report it instead of retrying indefinitely or claiming success.

## Deliver the Draft PR

1. Stage only task-owned changes, inspect the staged diff and `git diff --cached --check`, then commit. Keep unrelated changes out. Retain review evidence for the implementation revision; a report-only commit does not invalidate code review.
2. Run `make ci` on the committed implementation/delivery-tree revision, including committed-history secret detection. If a later commit changes only Markdown evidence, require local document/catalog and committed-history secret checks plus final-head GitHub CI as specified in [orchestration.md](references/orchestration.md). Identify both revisions; do not claim a final-head local full-gate run that did not occur. Re-run relevant acceptance checks when final edits affected them. If `origin/main` moved, merge it into the feature branch, resolve conflicts, review the integration diff and repeat affected validation; do not rewrite published history.
3. Push with `git push -u origin <head>`. Create with `gh pr create --repo greentiger0789/engine-sound-simulator --base main --head <head> --draft --title 'feat: ... (ticket N)' --body-file <temporary-file>`. Use a unique temporary file and actual newlines. If a PR already exists, update it with `gh pr edit --body-file`; do not create duplicates. Check the command exit status. If an older gh version fails with the deprecated `projectCards` GraphQL error, update the same PR via `gh api --method PATCH repos/greentiger0789/engine-sound-simulator/pulls/<number> --input <payload.json>`, where the JSON file contains the exact Markdown in its `body` field. Verify the returned body; do not treat a subsequent successful read as proof the failed edit worked. For an existing ready PR, preserve its state unless the user explicitly asks to return it to Draft; report this as resuming an existing ready PR, not creating a new Draft. Do not make a duplicate PR to satisfy the default Draft state.
4. The body must include the problem/result, local ticket link, acceptance evidence, self/independent review results, commands and results, limitations/manual checks, and implementation report link. Do not use `Closes #N` for a local ticket ID. This is a draft delivery even when tests pass.
5. Identify the CI run for the current head SHA (not an older successful run). Wait for `Repository checks` to complete successfully, checking at roughly 30-second intervals with progress updates at least once per minute. Allow up to 20 minutes of unchanged queued/running external state per pushed revision; if it still cannot complete, report external CI as pending and leave the PR unmerged rather than wait indefinitely. Do not trigger duplicate runs just because one is queued. Investigate failures, fix, review and push again. Recheck head SHA, required check result, Draft state, base and mergeability. A merge conflict or out-of-date strict base is not a clean delivery. A missing, cancelled, skipped, queued, or failed check is not success.
6. Update the PR body with the final head SHA and CI link without making a commit just to record its own hash. Return the Draft PR URL, ticket ID, completed checks, and remaining limits. If external CI is unavailable, leave the PR Draft and clearly report that verification is incomplete.

Never merge, enable auto-merge, or start the next ticket at the end of this skill.
