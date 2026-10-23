# Copilot 補足指示

このファイルは `AGENTS.md` と `.agents/skills/implement-ticket/SKILL.md` の共通指示を補完するものです。
重複を避け、Copilot 固有の補足に絞ります。

## エージェント定義

Copilot 用のカスタムエージェントは `.github/agents/` に定義されています。Codex の `.codex/agents/*.toml` と対応関係は以下の通りです。

| Codex (.codex/agents/*.toml) | Copilot (.github/agents/*.agent.md) | 役割 |
|---|---|---|
| `ticket-worker.toml` | `ticket-worker.agent.md` | 跨モジュール推論・契約発見が必要なチケットサブタスク |
| `ticket-reviewer.toml` | `ticket-reviewer.agent.md` | チケット diff の独立レビュー（読み取り専用） |
| `ticket-worker-luna.toml` | `ticket-worker-luna.agent.md` | 契約が確定した境界的なチケットサブタスク |
| `ticket-worker-terra.toml` | `ticket-worker-agent.md` | GPT-5.6 Terra が最適と判断される境界的サブタスク |

モデル名は Codex の TOML 形式とは異なるため、Copilot 側のモデル名・利用可能ツール・権限は各環境に合わせて調整されています。

## チケット対応フロー

チケット番号による依頼（例：`チケット1を対応して`）は、共通の `AGENTS.md` と `.agents/skills/implement-ticket/SKILL.md` に従います。Copilot 側で追加の手順は不要です。

## モデル選択の補足

`AGENTS.md` の「委譲と品質」セクションに従い、サブエージェントをスポーンする前にモデルと reasoning effort を選択してください。Copilot のカスタムエージェント frontmatter に記載されたモデルはフォールバック候補であり、実際のモデル選択は実行環境に依存します。

## 制約

- `.codex/config.toml` や `.codex/agents/*.toml` のモデル指定・設定形式を Copilot がそのまま読み込むわけではありません。
- エージェントの役割や指示は移せても、モデル名、利用可能なツール、権限などは Copilot 環境に合わせて調整してください。
- スキル本体は `.agents/skills/implement-ticket/` を共通のまま保ち、二重管理しないでください。
