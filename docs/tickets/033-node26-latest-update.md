# チケット 33: Node.js 26 最新版へのランタイム更新

## 目標

Docker の tooling / build 共通基盤で使用している Node.js 26 を最新版（26.13.0）へ更新し、`package.json` の `engines.node`、Docker イメージのダイジェストピン、関連する型定義、lockfile、および開発ドキュメントのバージョン契約を一致させる。Dependabot による個別 PR（`docker/node-26.13.0-bookworm-slim` 等）を単独で取り込まず、リポジトリ全体の整合性を保った状態で単一チケットとして更新・検証を完了する。

## 範囲 / 非対象

- 範囲: `Dockerfile` の tooling ステージにおける Node.js 26 イメージタグおよび digest pin の更新（`node:26.13.0-bookworm-slim`）、`package.json` / `package-lock.json` の `engines.node` 更新（`>=26.13.0 <27`）、`@types/node` のバージョン整合確認、npm lockfile の再生成、`docs/implementation-plan.md` 等のドキュメント記述の更新、Docker / CI 検証。
- 非対象: Playwright 公式 Docker イメージや Nginx イメージの更新（独立した依存更新として扱う）、TypeScript 7 への移行（`typescript-eslint` の公式 peer range サポート待ちのため本チケットの対象外）、アプリケーション本体・DSP・UI の機能変更。

## 依存関係

26（`node26-typescript7-toolchain`）。開始前に依存 report（`docs/tickets/reports/026.md`）の verified/merged 状態を確認する。

## 計画参照

実装計画 §2、§8、§11、§12。

## 調査根拠

- リモート追跡ブランチ `origin/dependabot/docker/node-26.13.0-bookworm-slim`（commit `5fe1c45`）にて、`node:26.12.0-bookworm-slim` から `node:26.13.0-bookworm-slim`（digest: `sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68`）へのバンプ提案が到着している。
- 現在の `Dockerfile` では `FROM node:26.12.0-bookworm-slim@sha256:742a0fe7320e09e0321222b68165e6ac731d30470e7ea7f98f9bfc3a6e1034fe AS tooling` が指定されており、`package.json` の `engines.node` は `">=26.12.0 <27"` となっている。
- Docker イメージのみを更新すると、`package.json` の `engines.node` やドキュメント（`docs/implementation-plan.md`）の記載と乖離するため、チケット26の方針に従い、イメージ、`engines`、lockfile、ドキュメントを一括して整合させる必要がある。

## 実装契約と想定ファイル

- `Dockerfile`:
  - `tooling` ステージのベースイメージを `node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68` へ更新する。
- `package.json` / `package-lock.json`:
  - `engines.node` を `">=26.13.0 <27"` へ更新する。
  - 新しい Node.js 環境下で `package-lock.json` を整合・再生成し、`npm ci` が警告やエラーなく成功する状態にする。
- `@types/node`:
  - Node.js 26.13.0 と整合する最新の `@types/node`（26.x 系）を確認し、必要に応じて更新する。
- `docs/implementation-plan.md`:
  - ランタイムバージョンの記述を Node 26.13.0 へ更新する。
- `docs/tickets/reports/033.md`:
  - 更新前後のバージョン対応表、Node.js 26.13.0 採用根拠、Docker 検証結果、レビュー対象 commit を記録する。

## 受け入れ基準

- `Dockerfile` の tooling ステージが Node 26 最新版（`node:26.13.0-bookworm-slim`）とその digest pin を使用している。
- `package.json` の `engines.node` が `">=26.13.0 <27"` と一致し、`package-lock.json` が peer dependency や lockfile 不整合なく一致する。
- `npm ci` が `ERESOLVE`、`--force`、`--legacy-peer-deps` なしで成功する。
- `docs/implementation-plan.md` 等の文書に記載された Node.js バージョンが実装後の契約と一致する。
- `npm run typecheck`、`npm run lint`、unit test、production build、Playwright E2E がすべて成功する。
- アプリケーション、DSP、AudioWorklet の挙動・テスト結果に意図しない変更がない。
- Dependabot の Node.js 更新 PR を単独でマージせず、本チケットの実装 PR だけで整合した更新が完結する。

## Docker 検証

- **既存:** `make check`、`make test`、`make build`、`make e2e`、`make ci`。
- **追加:** tooling / build コンテナ内で `node --version`（`v26.13.0`）および `npm --version` を確認し、`engines.node` を満たすこと、package metadata と Docker イメージのバージョンが一致することを確認する。

## 並行作業案

Node.js / Docker / metadata 更新とドキュメント修正は一連の作業であり、単一のブランチで完結させる。

## 完了報告と手動証跡

`docs/tickets/reports/033.md` に旧版（26.12.0）と採用版（26.13.0）の対応表、Docker 検証結果（`node --version`, `npm --version`）、`Repository checks` の通過記録を記録する。手動聴感評価は必須としない。
