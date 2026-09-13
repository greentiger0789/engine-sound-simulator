# Repository instructions

## Numbered ticket requests

When the user says `チケット1を対応して`, `チケット N を実装して`, or requests work on a numbered implementation ticket, read and follow [.agents/skills/implement-ticket/SKILL.md](.agents/skills/implement-ticket/SKILL.md). This repository skill is the entrypoint even if it is absent from the current skill picker. Resolve numbers using [docs/tickets/index.json](docs/tickets/index.json); they are local ticket IDs, not GitHub Issue or PR numbers.

A ticket request authorizes a new feature branch, implementation, relevant Docker checks, self-review and fixes, commits, push, and a **Draft PR** to this repository. Stop at the Draft PR; do not merge, mark ready, deploy, or start unrelated tickets. Do not ask again for these already requested steps. Actual tool permissions still apply.

Ticket PR descriptions must be derived explicitly from [.github/pull_request_template.md](.github/pull_request_template.md) and completed in Japanese; the implementation-ticket skill defines the required evidence and creation/update procedure.

For a resumed PR that a human already marked ready, preserve that state unless the user explicitly requests Draft again; report the existing state instead of creating a duplicate PR. Newly created PRs are always Draft.

Read the selected ticket and its referenced plan sections, not every ticket. A dependency must be verified and merged into `origin/main`. If it is missing, report the exact prerequisite; do not silently implement multiple tickets. Resume an existing ticket branch/PR when present rather than duplicating it.

## Delegation and quality

The user requests cost-conscious subagents. Use `gpt-5.6-terra` with `medium` effort for bounded workers; use a fresh Terra reviewer with `high` effort for substantive implementation. Delegate independent work only, normally at most two writers with non-overlapping ownership, reserving a slot for review. The orchestrator owns Git, shared configuration, integration, and the final review. See the skill for model fallback and tool-specific invocation.

Workers must not delegate recursively or commit/push/create PRs. Pass only the task, acceptance criteria, owned paths, and required contracts. Do not fork the entire conversation when selecting a lower-cost model.

Continue the review → fix → relevant tests loop until no actionable findings remain in the delivered change. For incidental pre-existing bugs, follow [the skill policy](.agents/skills/implement-ticket/references/incidental-bugs.md): include small verified fixes, or commit larger out-of-scope bug records and disclose them; never defer current regressions or bypass acceptance/CI blockers. Record untestable requirements as pending; never claim defect-free software or fabricate listening/performance evidence.

## Project invariants

- Development, builds, lint and tests run in Docker. Host Git / GitHub CLI are used for repository operations.
- Preserve the existing `Repository checks` CI gate and main rules. Do not skip failing tests or weaken rules to finish.
- Audio synthesis derives from rotation and combustion events. No prerecorded engine loops. DSP must stay independent of React, and audio time drives the simulation.
- Maintain user changes. Only the orchestrator stages task-owned files; never use a destructive reset or force push to prepare a ticket.
- `.codex/config.toml`, `.codex/agents/`, and `.agents/skills/implement-ticket/` are reviewed repository configuration. Do not store tokens, session logs, or machine-specific settings there.
