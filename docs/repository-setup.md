# GitHub リポジトリの設定

## 対象と設定の根拠

公開先は `greentiger0789/engine-sound-simulator`、既定ブランチは `main` です。

[参考リポジトリ](https://github.com/greentiger0789/ollama-discord-chat-app-docker)の Docker Compose / Makefile、workflow・Dockerfile の lint、秘密情報検査、Dependabot、PR テンプレートを参考にしています。本プロジェクトでは個人開発で取り込めるよう他者承認は必須にせず、CI を必須にします。

## セキュリティ自動化

- `dependabot.yml` は npm、GitHub Actions、Dockerfile、Docker Compose の更新を週次で確認します。GitHub の **Dependabot alerts** と **Dependabot security updates** も有効にし、脆弱性アラートと修正 PR を受け取ります。
- `codeql.yml` は JavaScript / TypeScript を push、PR、週次で解析し、結果を Security タブへ登録します。
- `trivy.yml` は本番 Web イメージとリポジトリの依存・設定を HIGH / CRITICAL でスキャンし、SARIF を Security タブへ登録します。脆弱性検出は報告のみで必須 CI を失敗させません。スキャンや結果登録自体の失敗は成功扱いにしません。フォークからの PR は権限上 SARIF 登録を行わず、スキャンだけ実施します。
- `SECURITY.md` に脆弱性の非公開報告方法を記載します。GitHub の **Private vulnerability reporting** を有効にしてください。
- Secret Scanning と Push Protection も有効のまま維持します。ワークフローの権限は必要な job に限定し、`pull_request_target` は使用しません。

新しい公開リポジトリでは、管理者として次の設定を有効にします（既存リポジトリでも再実行できます）。

```bash
gh api --method PUT repos/greentiger0789/engine-sound-simulator/vulnerability-alerts
gh api --method PUT repos/greentiger0789/engine-sound-simulator/automated-security-fixes
gh api --method PUT repos/greentiger0789/engine-sound-simulator/private-vulnerability-reporting
```

GitHub の設定状態を確認するには:

```bash
gh api repos/greentiger0789/engine-sound-simulator \
  --jq '.security_and_analysis'
gh api repos/greentiger0789/engine-sound-simulator/actions/permissions/workflow
gh api repos/greentiger0789/engine-sound-simulator/automated-security-fixes
gh api repos/greentiger0789/engine-sound-simulator/private-vulnerability-reporting
```

CodeQL / Trivy の結果は GitHub の Security タブで確認します。Dependabot の脆弱性アラート API は管理者権限で確認してください。

ルールの原本は [main.json](../.github/rulesets/main.json) です。GitHub 上で変更した場合は、このファイルも更新します。

## 初期作成・再設定

以下は管理者が実行する初期セットアップ用です。すでに存在するリポジトリや ruleset に対して作成コマンドを再実行しないでください。通常開発では実行不要です。

```bash
# 初回コミットと基盤ファイルのコミット後
gh repo create greentiger0789/engine-sound-simulator --public --source=. --remote=origin --push
gh repo edit greentiger0789/engine-sound-simulator --default-branch main --enable-merge-commit --enable-squash-merge=false --enable-rebase-merge=false --delete-branch-on-merge

# CI 成功を確認してからルールを適用
gh run list --repo greentiger0789/engine-sound-simulator --branch main
gh api --method POST repos/greentiger0789/engine-sound-simulator/rulesets --input .github/rulesets/main.json

# 設定を確認
gh api repos/greentiger0789/engine-sound-simulator/rulesets
```

既存ルールの更新には一覧で ID を確認し、同じ JSON を `PUT repos/greentiger0789/engine-sound-simulator/rulesets/{id}` に渡します。必須チェック名 `Repository checks` は workflow の job 名と一致させます。GitHub Actions の integration ID は `15368` に限定します。

## 運用上の選択

- PR 必須、CI 成功必須、最新の main 必須、会話の解決必須、merge commit のみ。
- リポジトリの `Allow merge commits` を有効にし、ruleset の許可方式を `merge` にします。merge commit と両立しない `Require linear history` は設定しません。
- 他者承認数 0、管理者を含め bypass なし。単独開発でも CI を通して取り込めます。
- workflow 権限は `contents: read`。`pull_request_target` は使用しません。
- 公開リポジトリを作成しますが、Web アプリのデプロイは M1 以降で別途構成します。
- ライセンスは未選定です。公開であることと、第三者への再利用許諾は別のため、OSS ライセンスの追加は公開配布方針が決まった段階で行います。

GitHub の仕様は [rulesets の公式説明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)を参照してください。
