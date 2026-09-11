# チケット 1: React/Vite/TypeScript と Docker Web 基盤

## 目標

React 19、TypeScript strict、Vite 8 の空の SPA を Docker で開発・本番相当配信できる状態にし、既存の `Repository checks` に型検証、lint、本番ビルドを加える。音声機能とテストランナーは導入しない。

## 範囲 / 非対象

- 範囲: `src/` の最小画面、Vite 設定、ESLint、依存 lockfile、`dev`/`build`/`web` Compose service、multi-stage Dockerfile、`make dev`/`down`/`build`、CI の既存必須チェック拡張。
- 非対象: AudioWorklet、Web Audio、Vitest、Playwright、UI の完成、公開ホスティング。`npm test` を成功扱いで作らない。

## 依存関係

なし。以後の全チケットがこの成果物を前提にする。

## 計画参照

実装計画 §2、§6（Worklet の独立 entry は次件）、§8、§9、§10 M1、§12。

## 実装契約と想定ファイル

- `package.json` は Node 24 の範囲を維持し、React/Vite/TypeScript/ESLint の実採用版を lockfile に固定する。
- `src/main.tsx` と `src/app/App.tsx` は StrictMode で起動し、以後の controller を差し込める空の画面領域を持つ。音声 API はまだ呼ばない。
- `compose.yaml` の `dev` は `0.0.0.0` へ bind、公開は `127.0.0.1:5173`。`web` はコンテナ内も8080で待ち受け、`127.0.0.1:8080:8080` で Nginx から `dist` を配信する。host の `node_modules` を使わない。
- Dockerfile は tooling、build、web を分離する。`make build` は build と web イメージを確認し、CI は現在の `Repository checks` 名を維持する。

## 受け入れ基準

- `npm ci` 後に TypeScript strict、ESLint、Vite production build が通る。
- `make dev` がViteを正しいbind/portで起動し、`make build` 後のweb コンテナが SPA と直接の深いパスのfallbackを返す。
- Dockerから dev service と web service へ HTTP request を送り、HTML と Vite client/HMR entry が応答することを確認する。実ブラウザのHMR表示は必須にしない。
- CI の `Repository checks` は既存の docs/Docker/secret 検証に lint・型検証・build を含み、テストなしを偽装しない。
- `make check` と `make ci` が成功する。

## Docker 検証

- **既存:** `make check`、`make ci`。
- **このチケットで追加:** `make build`、`make dev`、`make down`。`make dev` と web のHTTP確認は起動中コンテナから `curl -fsS http://dev:5173/` と `curl -fsS http://web:8080/`（または同等のhealth check）で実施する。

## 並行作業案

Docker/Makefile/CI と React/Vite/ESLint は別担当にできるが、依存バージョンとコマンド名は一人が統合して lockfile を確定する。

## 手動証跡

任意: Windowsブラウザで dev/web URL とHMRを確認してPR/reportへ記録する。これは音声を聞く要件ではなく、未実施でも自動受け入れを止めない。

## 完了報告と聴感

`reports/001.md` に自動検証、レビューした実装コミット（PR URL と最終 CI は PR 本文）を残す。聴感確認は不要であり、依存解除の条件ではない。
