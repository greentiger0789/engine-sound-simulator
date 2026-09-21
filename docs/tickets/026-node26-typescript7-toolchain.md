# チケット 26: Node.js 26 / TypeScript 7 ツールチェーン移行

## 目標

Dependabot PR #19 と #25 を個別に取り込まず、Node.js 26 LTS、対応する Node.js 型定義、TypeScript 7、lint 周辺依存を互換性のある一組として更新する。実行環境、型検査、package metadata、Docker、CI、開発文書のバージョン契約を一致させる。

## 範囲 / 非対象

- 範囲: Node.js tooling/build image、Playwright package / test image の Node.js 互換性、`engines.node`、`@types/node`、TypeScript、TypeScript 対応が必要な lint 依存、npm lockfile、TypeScript / lint 設定、Docker / CI 検証、バージョンを記載する開発文書。
- 非対象: Nginx image の更新、patch 更新だけで完結する formatter / test runner 更新、アプリ・DSP の機能変更、lint 規則の削減、peer dependency の強制無視。

## 依存関係

4。開始前に依存 report の verified/merged 状態を確認する。

加えて、Node.js 26 が LTS になり、採用中の lint 経路が TypeScript 7 を公式にサポートしていることを開始条件とする。いずれかを満たさない場合は、互換性を強制せず blocked の根拠を完了報告へ記録する。

## 計画参照

実装計画 §2、§8、§11、§12。

## 調査根拠

2026-09-21 時点の Dependabot PR を次のように確認した。

- [PR #19](https://github.com/greentiger0789/engine-sound-simulator/pull/19) は TypeScript 6.0.3 から 7.0.2 への major 更新だが、`typescript-eslint@8.70.0` の peer range `>=4.8.4 <6.1.0` と競合し、`npm ci` が `ERESOLVE` で失敗する。
- [PR #25](https://github.com/greentiger0789/engine-sound-simulator/pull/25) は Docker の Node.js image だけを 24 から 26 へ更新し、`package.json` の `engines.node` と実装計画に残る Node.js 24 LTS 契約を更新しない。
- [PR #33](https://github.com/greentiger0789/engine-sound-simulator/pull/33) は `@types/node` だけを 26 へ更新する。Node.js 24 の実行環境と型で利用可能な API がずれるため単独では取り込まず、本チケットの Node.js 26 移行時に同じ major へ揃える。

Node.js 26 が Current の間は、Node.js 24 LTS を優先するとした実装計画の判断を維持する。TypeScript 7 についても、`--force` や `--legacy-peer-deps` で未対応 lint stack を導入しない。

## 実装契約と想定ファイル

- 実装開始時点の最新 Node.js 26 LTS patch と digest を確認し、`Dockerfile` の tooling/build 共通基盤を更新する。`package.json` / `package-lock.json` の `engines.node` は実際に検証する Node.js 26 の範囲へ揃え、Node.js 24 を検証せず対応範囲に残さない。
- 独立した Playwright e2e image 内の Node.js も `engines.node` を満たすことを確認する。満たさない場合は `@playwright/test` と公式 image を同じ互換 version へ一緒に更新し、package / image の固定対応と digest pinを維持する。
- `@types/node` は実行時 Node.js と同じ major の互換 patch に揃える。Node.js 26 固有 API が偶発的に browser bundle や Node.js 24 前提の経路へ混入していないことを型検査と build で確認する。
- TypeScript 7 と、公式 peer range が TypeScript 7 を含む lint 周辺依存を一緒に更新する。Ticket 25 が先に完了して ESLint 系依存が除去されている場合は、実装時の lint 経路に合わせて対象を読み替え、ESLint を再導入しない。
- TypeScript 7 の移行資料と compiler diagnostics を確認し、`tsconfig*.json`、Vite / Playwright 設定、app / audio / engine / test / tooling source の必要な互換修正を行う。strictness、project reference、`tsc --build` の検査範囲を弱めない。
- `package-lock.json` は採用する Node.js/npm で再生成し、`npm ci` が peer warning の無視や install flag の追加なしで成功する状態にする。
- `README.md`、`docs/implementation-plan.md`、開発手順にある Node.js / TypeScript / lint 構成の記述を実装後の契約へ更新する。Dependabot PR #19 / #25 / #33 の commit を機械的に重ねず、本チケットの単一ブランチで整合した差分を作る。

## 受け入れ基準

- Node.js 26 が LTS であり、Docker image、`engines.node`、`@types/node`、文書が Node.js 26 契約で一致する。
- TypeScript 7 と lint 経路の公式互換範囲が一致し、`npm ci` が `ERESOLVE`、unsupported-version warning、`--force`、`--legacy-peer-deps` なしで成功する。
- TypeScript strict、project reference、React Hooks lint、既存の browser / node globals と ignore、`Repository checks` gate の検出範囲を弱めない。
- `npm run typecheck`、`npm run lint`、unit test、production build が Node.js 26 基盤で成功し、開発用と本番相当の Playwright E2E も `engines.node` を満たす test image で成功する。
- アプリ、AudioWorklet、DSP、回転モデルの既存テスト結果と本番 bundle の責務境界に意図しない変更がない。
- Dependabot PR #19 / #25 / #33 を別々に merge する必要がなく、本チケットの実装 PR だけで対象 toolchain の整合更新が完結する。

## Docker 検証

- **既存:** `make check`、`make test`、`make build`、`make e2e`、`make ci`。
- **追加:** tools / build / dev / e2e image 内で `node --version`、`npm --version`、`tsc --version` と install 時の peer dependency 解決を記録し、全 Node.js 実行 stage が `engines.node` を満たすこと、`package.json`、型定義、Docker image の major が一致することを確認する。

## 並行作業案

Node.js / Docker / metadata と TypeScript / lint 互換修正の事前調査は並行化できる。ただし `package.json`、`package-lock.json`、Docker image、CI の統合と最終バージョン確定は一人が担当し、複数の依存更新 PR に分割しない。

## 手動証跡

任意: Windows ブラウザで dev / web の起動、音声開始・停止、主要操作を確認する。聴感の主観評価は本チケットの必須条件にせず、既存 E2E とエラー不在を自動受け入れの基準とする。

## 完了報告

`reports/026.md` に旧版と採用版の対応表、Node.js 26 の LTS 根拠、TypeScript / lint の公式互換範囲、lockfile 再生成環境、Docker 検証結果、レビュー対象 commit を記録する。開始条件を満たさない場合は、回避 flag を追加せず `Status: blocked` として不足する upstream 条件を明記する。
