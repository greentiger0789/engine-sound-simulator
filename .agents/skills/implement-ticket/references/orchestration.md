# Cost-conscious orchestration

## Assign work

Keep the user-selected model as orchestrator. Choose a child model for each bounded subtask from its uncertainty, impact and required reasoning, not just the task label or number of files:

| Scope                                                              | Model / effort             | Examples                                                                  |
| ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------- |
| Explicit, local, low-impact change with a known expected result    | `gpt-6-luna` / `medium`    | Typo, formatting, a straightforward test case, or a known type fix        |
| Bounded work where prior results favor Terra                       | `gpt-5.6-terra` / `medium` | Use when measured quality, latency, or availability favors it             |
| Contract discovery, interaction across modules, or unclear failure | `gpt-6-sol` / `medium`     | Multi-file behavior, DSP timing, an unexplained bug, or architecture work |
| Independent review of substantive implementation                   | `gpt-6-sol` / `high`       | Acceptance, regressions, numerical and concurrency behavior               |

Do not assume all type fixes or CRUD changes are simple: inspect their contracts and effects first. If a Luna task exposes ambiguity or broader impact, stop that worker and reassign the remaining work to Sol or the parent. Keep final integration and review with the parent. Verify model availability rather than guessing aliases in another environment.

Typically assign at most two independent writers and reserve the third child slot for review. A small change can stay with the parent. Do not split dependent steps merely to start more agents. Workers cannot spawn children.

Before concurrent edits, give each worker exclusive paths and stable contracts (types, events, API and test entrypoints). Keep lockfiles, package.json, Docker/CI settings and cross-module interfaces with one owner, normally the orchestrator. If changes require the same file, serialize them. Workers share a filesystem; review their diffs and do not blindly overwrite them.

## Invocation

Prefer the configured `ticket-worker-luna`, `ticket-worker-terra`, `ticket-worker`, or `ticket-reviewer` role when the tool accepts custom agent types. If the available spawn tool instead exposes `model`, `reasoning_effort`, and `fork_turns`, use the selected model and explicit values:

```json
{
  "task_name": "bounded_worker",
  "model": "gpt-6-luna",
  "reasoning_effort": "medium",
  "fork_turns": "none",
  "message": "Absolute repository/worktree path; selected ticket and acceptance criteria; owned files; interface contract; verification command; concise expected result. No Git mutations or recursive delegation."
}
```

Replace the example model with `gpt-5.6-terra` or `gpt-6-sol` when selected for a worker. For a substantive reviewer, use `gpt-6-sol` / `high`, no writing, and the actual diff plus acceptance requirements. With this tool interface, do not use a full-history fork when overriding the model. If a tool cannot set a model, use configured child defaults and report what is known about the actual selection. Do not pretend a prose instruction guarantees the model used. An unspecified child uses the Sol default; Luna and Terra must be selected explicitly.

If a selected model or delegation is unavailable, the parent proceeds serially and records the fallback. Do not silently promote all workers to a more expensive model. The parent takes over ambiguous contracts, numerical stability and unresolved cross-module issues when needed. Escalating a particular subtask is justified by evidence, not the ticket number. Compare quality and total effort on representative tasks before treating API token prices as Codex task savings.

## Keep context small

Pass paths and the relevant acceptance requirements, not the whole conversation or every ticket. Let workers read only needed files. Require a short return: changed files, verified behavior, commands/results, unresolved findings. Avoid duplicate repository-wide research and repeated full CI in each worker. The parent integrates first and prepares the implementation record before final review. During corrections, run affected checks; run the required final full gate after committing the delivery tree, including committed-history secret detection. Repeat the full gate when substantive changes or unresolved failures justify it, not merely because another review step finished. Evidence-only edits follow the proportional recheck rule below; the final-head GitHub gate remains mandatory.

Use follow-up messages to fix a bounded issue in an existing worker. Use a fresh reviewer for the initial independent assessment; subsequent reviews can focus on corrections and their impact. The parent checks the final diff as a whole. Stop finished workers rather than creating idle agent trees.

Keep successful build/test output concise: retain detailed logs in temporary files when useful, report the exit status and check summary, and inspect relevant failure output. Preserve command failures when redirecting or piping output; a successful log-printing command must not mask a failed check. Do not commit logs or include entire lockfiles and repeated build output in agent handoffs.

Before the final full gate, format/check the prepared report and finish code review corrections. If the only later changes record results in Markdown, rerun the affected document/catalog checks and committed-history secret detection; retain the earlier full-gate evidence with its revision and require GitHub `Repository checks` on the final head. Changes to code, dependencies, configuration or test behavior still require the full gate on the changed delivery tree. Do not describe this combination as a local full-gate run on the final head.
