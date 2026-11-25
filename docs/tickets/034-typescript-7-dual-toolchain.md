# チケット 34: TypeScript 7 / 6 の公式併用移行

## 目標

TypeScript 7 のネイティブコンパイラを型検査に使いながら、`typescript-eslint` など従来の TypeScript Compiler API を必要とするlintツールには TypeScript 6 API を提供する。Microsoft の TypeScript 7 移行案内にある npm alias 方式で両者を共存させ、Node.js 26 / Docker / npm lockfile / CI の再現可能なツールチェーンとして完成させる。

## 調査根拠

- [Microsoft: Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) は、TypeScript 7.0 に Compiler API が含まれないこと、API依存ツール向けに TypeScript 6.0 と並行利用すること、および npm alias を使う構成を案内している。
- 現在の `typescript-eslint` は TypeScript 7 を `typescript` として直接解決する peer range ではない。TypeScript 7 を単独更新した [PR #19](https://github.com/greentiger0789/engine-sound-simulator/pull/19) では `npm ci` が peer dependency の `ERESOLVE` で失敗した。
- Ticket 33 の完了報告ではNode.js 26基盤を更新し、TypeScript 7はlint API互換性を理由に保留している。本チケットではその保留を、Compiler API用にTypeScript 6を維持する公式の併用構成で解消する。
- 既存reportの「lint側がTypeScript 7を直接peer dependencyとして受け入れるまで待つ」という判断を本チケットで更新する。`typescript-eslint` のpeer rangeは変更せず、期待される `typescript` 名にはTypeScript 6を置くため、peer dependencyを無視する回避策には当たらない。
- このリポジトリはReact/Vite構成であり、Vue/Volar専用の制約は適用しない。TypeScript 7.1 Beta の `typescript-eslint` tsgo backend は実験的機能のため、このチケットでは採用しない。

## 範囲 / 非対象

- 範囲: `package.json` / `package-lock.json` の TypeScript 7 / TypeScript 6 API alias、型検査コマンド、Docker内のバージョン検証、既存TypeScript設定とlint経路の互換性確認、開発文書の更新。
- 非対象: ESLint規則やseverityの削減、型情報を使うlintへの移行、TypeScript 7.1 Beta / nightly や実験的 tsgo lint backend、Oxlint移行、アプリ・DSP・AudioWorkletの機能変更、Node.jsやPlaywright imageの独立したバージョン更新。

## 依存関係

33（`node26-latest-update`）。開始前に依存reportが `Status: verified` であり、変更が `origin/main` にmerge済みであることを確認する。Ticket 25 のlint移行と同時に実装しない。

## 計画参照

実装計画 §2、§8、§11、§12、§15。

## 実装契約と想定ファイル

- `package.json` / `package-lock.json`:
  - Microsoftの案内に沿って `@typescript/native` を安定版TypeScript 7のalias、`typescript` を `@typescript/typescript6` のaliasとして追加する。着手時点で公開されている安定版を調査し、両方の実バージョンを固定する。Beta / nightly は選ばない。
  - `npm run typecheck` と `npm run build` がTypeScript 7の `tsc --build` を使う。API互換性の検査でTypeScript 6を起動する場合は `tsc6` を明示する。
  - `npm ci` は標準のpeer dependency解決で成功させ、`--force`、`--legacy-peer-deps`、peer警告の抑制を追加しない。
- `typescript-eslint` / ESLint:
  - ESLintから `typescript` としてimportされるCompiler APIがTypeScript 6を指すことを確認する。
  - 現行の parser 設定、recommended lint rule、React Hooks lint、対象ファイル、browser/node globals、ignoreを維持する。TypeScript 7のbeta用バックエンドや新しいlint規則を同時導入しない。
- `tsconfig*.json`:
  - strictness、project references、`tsc --build` の対象を維持する。TypeScript 7の診断に必要な設定やコード修正は根拠とともに限定して行い、検査を弱めない。
  - 既存の `tsBuildInfoFile` とキャッシュが新しいcompilerで再現可能であることを確認する。
- `Dockerfile` / 検証:
  - tooling/build/dev/E2E の実行経路で、必要なNode.js engine条件と二つのcompilerを解決できることを確認する。
  - Docker内で `tsc --version` がTypeScript 7、`tsc6 --version` がTypeScript 6を示し、`npm ls` とpeer依存確認でESLint側のTypeScript APIが6へ解決される証拠を残す。
- `README.md`、`docs/implementation-plan.md`、開発手順:
  - 型検査compilerとAPI互換compilerの用途、version確認方法、依存更新時に両方を更新・検証する手順を記載する。

## 受け入れ基準

- TypeScript 7の安定版と `@typescript/typescript6` がnpm aliasで併置され、lockfileが再現可能である。
- `npm ci` がpeer dependency error/warning、`--force`、`--legacy-peer-deps` なしで成功する。
- `tsc --version` と `tsc6 --version` が意図したcompiler versionを示し、`npm run typecheck` がTypeScript 7で既存のsolution/project referencesを含む全対象を検査する。
- ESLint / `typescript-eslint` がTypeScript 6 APIを使用し、既存のlintルール・対象・ignore・severityが弱まらない。
- TypeScript 6と7の型検査結果を比較し、TypeScript 7固有の診断差分を説明・解消する。strictnessや検査対象を緩和して差分を隠さない。
- `make check`、`make test`、`make build`、`make e2e`、`make ci` がDockerで成功し、既存の `Repository checks` gateを維持する。
- アプリケーション、DSP、AudioWorklet、本番bundleの動作に意図しない変更がない。
- TypeScript 7.1 Beta / nightlyやexperimental tsgo backendを本番の型検査・lint経路へ持ち込まない。

## Docker 検証

- **既存:** `make check`、`make test`、`make build`、`make e2e`、`make ci`。
- **追加:** Docker内で `npm ci` 後に `tsc --version`、`tsc6 --version`、`npm ls typescript @typescript/native typescript-eslint` 相当の依存解決を確認する。TypeScript 6と7それぞれの型検査結果、およびTypeScript 7を使う通常の `npm run typecheck` の結果を記録する。

## 並行作業案

`package.json`、lockfile、Docker、CIの検証経路が共有されるため、統合は単一担当で行う。Ticket 25のOxlint移行や別の依存更新と同時に同じファイルを編集しない。

## 手動証跡

不要。自動検証、Docker内のcompiler解決、既存 `Repository checks` の成功を必須証跡とする。

## 完了報告

`reports/034.md` に採用したalias名と正確なversion、Node.js/npm/compiler version、peer依存の解決結果、TypeScript 6 / 7の診断比較、Docker検証コマンドと結果、レビュー対象commit、未解決事項を記録する。
