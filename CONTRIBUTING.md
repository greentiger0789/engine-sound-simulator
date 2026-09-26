# 開発への参加

現在は設計・基盤整備段階です。[実装計画](docs/implementation-plan.md)に従い、小さな PR 単位で実装します。

具体的な作業は [番号付きチケット](docs/tickets/README.md) で管理します。Codex の新しいセッションで「チケット1を対応して」と依頼すると、[自動実装フロー](docs/development-workflow.md) に従ってブランチ作成からセルフレビュー・検証・Draft PR まで進めます。初回はこのフローの設定 PR を main にマージしておく必要があります。

## 環境

WSL の Linux ファイルシステム上で作業し、Docker Engine または WSL integration を有効にした Docker Desktop と Docker Compose を利用してください。ホスト側の Node.js インストールは不要です。

```bash
make check
make test
make e2e
make format
make ci
```

`make shell` で Node.js 24 のコンテナを開けます。コンテナは `node` ユーザー（UID/GID 1000）で動作します。現在の WSL ユーザーと異なる場合、書き込みを伴うコマンドには `docker compose run --build --rm --user "$(id -u):$(id -g)" tools npm run format` を使います。依存関係はイメージ内でインストールし、実行時の匿名 volume に配置するため、ホストに `node_modules` を作りません。

`make dev` で Vite 開発サーバーを起動し、`http://localhost:5173` を
ブラウザで開けます。`make build` はアプリと Nginx 配信 image を作成します。
製品 UI から1〜4・6・8気筒の合成音を開始・停止し、音量、ミュート、
スライダー・数値・ホールドによるアクセル、簡易ダイノ負荷、ギアとクラッチを操作できます。車速も表示します。停止中は車両質量・前進ギア比、プリセットと360°／720°周期の燃焼位相を編集し、
次回開始時に安全に適用できます。回転・燃焼位相・燃焼パルスは AudioWorklet 内で
音声時間を基準に計算し、RPM、実効開度、レブリミッター状態を UI に表示します。
吸排気共鳴、構成seedで再現可能な小幅の燃焼変動、クランク同期の機械次数音も
AudioWorklet内で生成し、録音済みループは使いません。
出力監視用 AnalyserNode から現在波形と周波数スペクトルを描画し、適用中構成の
燃焼イベントを適用中の360°／720°周期に合う帯で確認できます。Canvas の描画は音声 scheduling には使いません。

## ブランチと PR

- 既定ブランチは `main`。`feat/...`、`fix/...`、`docs/...`、`chore/...` を作成してください。
- `main` への取り込みは PR の **Create a merge commit** を使用し、ブランチ内のコミット履歴を保持します。
- `Repository checks` の成功、最新の `main` への追従、レビュー会話の解決を必須とします。
- 個人開発を想定して他者承認数は 0、管理者の bypass は設けません。共同開発になったら承認数を 1 に変更します。
- `main` の削除・force push は禁止です。初期投入後は直接 push できません。

コミットメッセージは `feat:`、`fix:`、`docs:`、`chore:` などで目的を示してください。音声変更の PR には、RPM・プリセット・サンプルレート・比較条件と聴感確認結果を記載します。

PR 本文は [PR テンプレート](.github/pull_request_template.md) を基に日本語で記載し、テンプレートの見出しとチェック項目を維持します。

## CI の範囲

現時点では Docker ビルド、Prettier、Markdownlint、actionlint、Hadolint、
Gitleaks（コミット履歴）、ESLint、TypeScript、Vitest、Playwright による
Chromium 検証を実行します。Playwright は開発版と Nginx 配信版の実際の
AudioWorklet 読み込み、構成 ready handshake、RPM telemetry と製品 UI の
開始・停止・アクセル・簡易ダイノ負荷・ギア・クラッチ・音量・ミュートに加えて、車速、燃焼列と
analyser可視化の開始・停止・再作成を確認します。

GitHub Actions では、Docker layer を再利用するアプリ検証、ブラウザ E2E、リポジトリ・セキュリティ検証を並列実行します。必須ジョブ `Repository checks` は、いずれかが失敗・キャンセル・スキップされた場合も含めて結果を集約します。

チケットカタログの依存関係・パス検証と、その検証スクリプトのテストも `make ci` に含みます。共有スキルと Codex 設定は許可したパスだけを Git に含め、ローカルの認証やセッション状態はコミットしません。

依存関係は lockfile をコミットし、CI では `npm ci` を使用します。依存更新は Docker ビルドと CI を通して確認してください。Dependabot は npm・Dockerfile・GitHub Actions を週次で確認します。Makefile 内の検証用イメージタグは手動更新対象です。
