# 開発への参加

現在は設計・基盤整備段階です。[実装計画](docs/implementation-plan.md)に従い、小さな PR 単位で実装します。

具体的な作業は [番号付きチケット](docs/tickets/README.md) で管理します。Codex の新しいセッションで「チケット1を対応して」と依頼すると、[自動実装フロー](docs/development-workflow.md) に従ってブランチ作成からセルフレビュー・検証・Draft PR まで進めます。初回はこのフローの設定 PR を main にマージしておく必要があります。

## 環境

WSL の Linux ファイルシステム上で作業し、Docker Engine または WSL integration を有効にした Docker Desktop と Docker Compose を利用してください。ホスト側の Node.js インストールは不要です。

```bash
make check
make format
make ci
```

`make shell` で Node.js 24 のコンテナを開けます。コンテナは `node` ユーザー（UID/GID 1000）で動作します。現在の WSL ユーザーと異なる場合、書き込みを伴うコマンドには `docker compose run --build --rm --user "$(id -u):$(id -g)" tools npm run format` を使います。依存関係はイメージ内でインストールし、実行時の匿名 volume に配置するため、ホストに `node_modules` を作りません。

現段階のコンテナはドキュメント検証用です。Web サーバーと音声機能は M1 以降に追加します。

## ブランチと PR

- 既定ブランチは `main`。`feat/...`、`fix/...`、`docs/...`、`chore/...` を作成してください。
- `main` への取り込みは PR と squash merge を使用します。
- `Repository checks` の成功、最新の `main` への追従、レビュー会話の解決を必須とします。
- 個人開発を想定して他者承認数は 0、管理者の bypass は設けません。共同開発になったら承認数を 1 に変更します。
- `main` の削除・force push は禁止です。初期投入後は直接 push できません。

コミットメッセージは `feat:`、`fix:`、`docs:`、`chore:` などで目的を示してください。音声変更の PR には、RPM・プリセット・サンプルレート・比較条件と聴感確認結果を記載します。

## CI の範囲

現時点では Docker ビルド、Prettier、Markdownlint、actionlint、Hadolint、Gitleaks（コミット履歴）を実行します。未実装のアプリに対するテストを成功扱いする設定はありません。DSP の単体テスト、TypeScript、ブラウザ検証は該当機能の追加時に CI へ組み込みます。

チケットカタログの依存関係・パス検証と、その検証スクリプトのテストも `make ci` に含みます。共有スキルと Codex 設定は許可したパスだけを Git に含め、ローカルの認証やセッション状態はコミットしません。

依存関係は lockfile をコミットし、CI では `npm ci` を使用します。依存更新は Docker ビルドと CI を通して確認してください。Dependabot は npm・Dockerfile・GitHub Actions を週次で確認します。Makefile 内の検証用イメージタグは手動更新対象です。
