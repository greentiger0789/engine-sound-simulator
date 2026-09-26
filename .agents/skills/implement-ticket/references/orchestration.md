# Cost-conscious orchestration

## Assign work

Keep the user-selected model as orchestrator. Before each worker spawn, define the owned paths, settled contracts, expected result and focused verification; then choose the model for that assignment. Judge uncertainty and impact, not just the ticket label or number of files:

| Scope                                                              | Model / effort             | Examples                                                                  |
| ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------- |
| Bounded change with a settled contract and clear checks            | `gpt-6-luna` / `high`      | Preset definitions and tests against an established event schema          |
| Bounded work where prior results favor Terra                       | `gpt-5.6-terra` / `medium` | Use when measured quality, latency, or availability favors it             |
| Contract discovery, interaction across modules, or unclear failure | `gpt-6-sol` / `medium`     | Multi-file behavior, DSP timing, an unexplained bug, or architecture work |
| Independent review of substantive implementation                   | `gpt-6-sol` / `high`       | Acceptance, regressions, numerical and concurrency behavior               |

The overall ticket can be complex while one independently owned part is suitable for Luna. A trivial edit may be cheaper for the parent to do directly than to spawn an agent. Do not assume all type fixes or CRUD changes are simple: inspect their contracts and effects first. If a Luna task exposes ambiguity or broader impact, stop that worker and reassign the remaining work to Sol or the parent. Keep final integration and review with the parent. Do not assign Luna merely to meet a quota. Verify model availability rather than guessing aliases in another environment.

Typically assign at most two independent writers and reserve the third child slot for review. A small change can stay with the parent. Do not split dependent steps merely to start more agents. Workers cannot spawn children.

Before concurrent edits, give each worker exclusive paths and stable contracts (types, events, API and test entrypoints). Keep lockfiles, package.json, Docker/CI settings and cross-module interfaces with one owner, normally the orchestrator. If changes require the same file, serialize them. Workers share a filesystem; review their diffs and do not blindly overwrite them.

## Invocation

If the spawn tool exposes `model`, `reasoning_effort`, and `fork_turns`, specify the chosen worker model explicitly with `fork_turns: "none"`. Use its built-in worker role if available, or the default role with the same ownership and Git restrictions in the task message. Do not choose the fixed `ticket-worker` role for a Luna or Terra assignment: its configured Sol model can take precedence. For example:

```json
{
  "task_name": "bounded_worker",
  "agent_type": "worker",
  "model": "gpt-6-luna",
  "reasoning_effort": "high",
  "fork_turns": "none",
  "message": "Absolute repository/worktree path; selected ticket and acceptance criteria; owned files; settled interface contract; focused verification command. Other agents share the workspace: do not overwrite their edits, delegate recursively, switch branches, stage, commit, push, or create PRs. Stop and report if the contract or scope proves unclear. Return changed paths, verification results, and remaining problems."
}
```

Replace the example model and effort with `gpt-5.6-terra` / `medium` or `gpt-6-sol` / `medium` when selected for a worker. For a substantive reviewer, use the configured `ticket-reviewer` role when available or explicitly select `gpt-6-sol` / `high`, no writing, and provide the actual diff plus acceptance requirements. With this tool interface, do not use a full-history fork when overriding the model. If the tool cannot set a model but accepts custom roles, use `ticket-worker-luna`, `ticket-worker-terra`, or `ticket-worker` as selected. If neither route can select the intended model, reassess whether the parent should do the task or record the actual fallback; do not silently use Sol for every worker. The configured child default is a safety fallback, not a routing decision. Do not pretend a prose instruction guarantees the model used.

If a selected model or delegation is unavailable, the parent proceeds serially and records the fallback. The parent takes over ambiguous contracts, numerical stability and unresolved cross-module issues when needed. Escalating a particular subtask is justified by evidence, not the ticket number. Record each delegated scope, selected and observed model/effort, and a short reason in the implementation report. Compare quality, corrections and total effort on representative tasks before treating API token prices as Codex task savings.

## Keep context small

Pass paths and the relevant acceptance requirements, not the whole conversation or every ticket. Let workers read only needed files. Require a short return: changed files, verified behavior, commands/results, unresolved findings. Avoid duplicate repository-wide research and repeated full CI in each worker. The parent integrates first and prepares the implementation record before final review. During corrections, run affected checks; run the required final full gate after committing the delivery tree, including committed-history secret detection. Repeat the full gate when substantive changes or unresolved failures justify it, not merely because another review step finished. Evidence-only edits follow the proportional recheck rule below; the final-head GitHub gate remains mandatory.

Use follow-up messages to fix a bounded issue in an existing worker. Use a fresh reviewer for the initial independent assessment; subsequent reviews can focus on corrections and their impact. The parent checks the final diff as a whole. Stop finished workers rather than creating idle agent trees.

Keep successful build/test output concise: retain detailed logs in temporary files when useful, report the exit status and check summary, and inspect relevant failure output. Preserve command failures when redirecting or piping output; a successful log-printing command must not mask a failed check. Do not commit logs or include entire lockfiles and repeated build output in agent handoffs.

Before the final full gate, format/check the prepared report and finish code review corrections. If the only later changes record results in Markdown, rerun the affected document/catalog checks and committed-history secret detection; retain the earlier full-gate evidence with its revision and require GitHub `Repository checks` on the final head. Changes to code, dependencies, configuration or test behavior still require the full gate on the changed delivery tree. Do not describe this combination as a local full-gate run on the final head.
