# チケット 25: Oxlint への Lint 基盤移行

## 目標

ESLint、typescript-eslint、eslint-plugin-react-hooks で構成された FE の Lint 基盤を stable な Oxlint へ移行し、現在の TypeScript / React Hooks 検出範囲を弱めずに設定と依存関係を簡素化する。

## 範囲 / 非対象

- 範囲: Oxlint 設定、npm scripts / lockfile、Docker / CI の lint 経路、開発文書、旧 ESLint 依存と設定の削除、移行前後の診断同等性確認。
- 非対象: Oxfmt への移行、Prettier / Markdownlint の削除、型検査を Oxlint へ統合すること、アプリ・DSP の機能変更、nursery / alpha 機能の導入。

## 依存関係

4。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §2、§8、§11、§12。

## 調査根拠

2026-09-13 時点で Oxlint は v1 系の stable / semantic versioning 対象で、ESLint v9/v10 flat config は `@oxlint/migrate` による移行が公式に案内されている。React plugin には `react/rules-of-hooks`、`react/exhaustive-deps` と React Compiler 系規則が組み込まれている。

- [Oxlint](https://oxc.rs/docs/guide/usage/linter)
- [ESLint からの移行](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint)
- [built-in plugins](https://oxc.rs/docs/guide/usage/linter/plugins)
- [versioning policy](https://oxc.rs/docs/guide/usage/linter/versioning)

Formatter は Prettier を維持する。Biome は Markdown の parse / format が未対応であり、この repository の Markdown 中心のチケット / report 整形を単独で置換できない。Oxfmt は対象言語を扱えるが、同日時点では beta であり、Markdown は npm package 内の bundled Prettier へ委譲される。CI 基盤の置換は stable 化後に再評価する。

- [Biome language support](https://biomejs.dev/internals/language-support/)
- [Oxfmt beta](https://oxc.rs/blog/2026-02-24-oxfmt-beta)
- [Oxfmt language support](https://oxc.rs/docs/guide/usage/formatter/language-support)

## 実装契約と想定ファイル

- `@oxlint/migrate` の出力を出発点に、`eslint.config.js` の対象、ignore、browser / node globals、typescript-eslint recommended と `react-hooks` recommended-latest の規則・severity を棚卸しする。自動変換結果を無検証で採用しない。
- Oxlint の native plugin / stable rules を優先し、JavaScript custom plugin、type-aware linting、nursery rules は導入しない。現在の `tsc --build` による型検査は独立して維持する。
- React Hooks は少なくとも rules-of-hooks、exhaustive-deps と、現行 `eslint-plugin-react-hooks` recommended-latest が有効にする React Compiler 系規則について、同等の native rule と severity を明示する。対応する stable rule がない場合は検出を削らず、ESLint を残して blocker として報告する。
- `package.json` / `package-lock.json` は Oxlint を exact version で固定し、`npm run lint` と既存 `npm run check` / `make check` / `make ci` の利用契約を変えない。完全移行できた場合だけ ESLint、typescript-eslint、eslint-plugin-react-hooks、globals と `eslint.config.js` を削除する。
- Prettier、`.prettierrc.json`、`.prettierignore`、Markdownlint と Markdown の検証順序は維持する。`docs/implementation-plan.md` のコード品質欄と開発文書を実装後の構成へ更新する。

## 受け入れ基準

- 現行ソースに対する移行前 ESLint と移行後 Oxlint がともに成功し、有効規則の対応表に未説明の欠落がない。
- 一時 fixture または既存 tooling test で、未使用変数、型のみ構文の代表的違反、条件分岐内の Hook、欠落した Hook dependency、採用中の React Compiler 規則の代表的違反を Oxlint が非 0 で検出する。
- browser / node 対象と `dist` / `node_modules` ignore が保たれ、アプリ・test・config・tooling script の意図した全ファイルが lint 対象になる。
- ESLint 系の実行時依存と設定を完全に除去し、`npm run lint`、`make check`、`make test`、`make build`、`make ci` が成功する。
- Formatter の出力差分を発生させず、Prettier / Markdownlint と既存 `Repository checks` gate を維持する。

## Docker 検証

- **既存:** `make check`、`make test`、`make build`、`make ci`。
- **追加:** Docker 内で移行前後の規則対応表作成と、代表的な違反 fixture に対する Oxlint の失敗検証を行う。fixture を常設する場合は `npm run test:tooling` から実行する。

## 並行作業案

設定・依存・CI が同じ契約へ集中するため、実装は分割しない。規則対応表と fixture のレビューは実装と独立して実施できる。

## 手動証跡

任意: 使用する editor の Oxlint 拡張で TS / TSX の診断と safe fix を確認する。editor 動作は verified の必須条件にしない。

## 完了報告

`reports/025.md` に移行前後の依存・規則対応表、fixture の検出結果、自動検証、レビュー対象 commit を記録する。Oxfmt / Biome の再評価は formatter の stable 化または Markdown native 対応後に別判断とし、本チケットへ混在させない。
