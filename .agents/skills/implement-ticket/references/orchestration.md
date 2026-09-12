# Cost-conscious orchestration

## Assign work

Keep the user-selected model as orchestrator. Use `gpt-5.6-terra` / `medium` for bounded implementation, and Terra / `high` for independent review. These are available names in this environment; verify availability rather than guessing aliases in another environment.

Typically assign at most two independent writers and reserve the third child slot for review. A small change can stay with the parent. Do not split dependent steps merely to start more agents. Workers cannot spawn children.

Before concurrent edits, give each worker exclusive paths and stable contracts (types, events, API and test entrypoints). Keep lockfiles, package.json, Docker/CI settings and cross-module interfaces with one owner, normally the orchestrator. If changes require the same file, serialize them. Workers share a filesystem; review their diffs and do not blindly overwrite them.

## Invocation

Prefer the configured `ticket-worker` / `ticket-reviewer` roles when the tool accepts custom agent types. If the available spawn tool instead exposes `model`, `reasoning_effort`, and `fork_turns`, use explicit values:

```json
{
  "task_name": "bounded_worker",
  "model": "gpt-5.6-terra",
  "reasoning_effort": "medium",
  "fork_turns": "none",
  "message": "Absolute repository/worktree path; selected ticket and acceptance criteria; owned files; interface contract; verification command; concise expected result. No Git mutations or recursive delegation."
}
```

For the reviewer, use `high`, no writing, and the actual diff plus acceptance requirements. With this tool interface, do not use a full-history fork when overriding the model. If a tool cannot set a model, use configured child defaults and report what is known about the actual selection. Do not pretend a prose instruction guarantees the model used.

If Terra or delegation is unavailable, the parent proceeds serially and records the fallback. Do not silently promote all workers to a more expensive model. The parent takes over ambiguous contracts, numerical stability and unresolved cross-module issues. Escalating a particular subtask is justified by evidence, not the ticket number.

## Keep context small

Pass paths and the relevant acceptance requirements, not the whole conversation or every ticket. Let workers read only needed files. Require a short return: changed files, verified behavior, commands/results, unresolved findings. Avoid duplicate repository-wide research and repeated full CI in each worker. The parent integrates first and prepares the implementation record before final review. During corrections, run affected checks; run the required final full gate after committing the delivery tree, including committed-history secret detection. Repeat the full gate when substantive changes or unresolved failures justify it, not merely because another review step finished. Report-only edits still need relevant formatting/document checks and the final delivery gate.

Use follow-up messages to fix a bounded issue in an existing worker. Use a fresh reviewer for the initial independent assessment; subsequent reviews can focus on corrections and their impact. The parent checks the final diff as a whole. Stop finished workers rather than creating idle agent trees.

Keep successful build/test output concise: retain detailed logs in temporary files when useful, report the exit status and check summary, and inspect relevant failure output. Preserve command failures when redirecting or piping output; a successful log-printing command must not mask a failed check. Do not commit logs or include entire lockfiles and repeated build output in agent handoffs.
