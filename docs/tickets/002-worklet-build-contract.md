# チケット 2: AudioWorklet の独立ビルドと境界契約

## 目標

通常 bundle と分離した AudioWorklet module を dev・本番双方で `audioWorklet.addModule()` に読み込めるようにし、UI/controller と processor の型付き通信契約を定義する。

## 範囲 / 非対象

- 範囲: Worklet entry の Vite build 設定、URL 解決、`AudioParam` と `MessagePort` の message 型、ready/error/telemetry の最小 processor、Vitest/Playwright の最小 Docker 検証環境。
- 非対象: 実際のエンジン計算、持続的な音、製品UIの開始ボタン、包括的な状態遷移テスト（チケット4で拡充）。

## 依存関係

1。

## 計画参照

実装計画 §3、§6、§9、§10 M1、§11。

## 実装契約と想定ファイル

- `src/audio/worklets/` に processor entry と共有 message 型を置く。message は判別可能 union とし、`ready`、`telemetry`、`fatal-error`、後続の `replace-config` を予約する。
- 連続値は AudioParam（少なくとも `throttle`、`gain`）にし、構成データを毎フレーム MessagePort で送らない。
- processor は出力バッファの実際の長さを使い、`process()` 内で DOM、Promise、JSON、ログ、大きな allocation をしない。現段階は無音を出して ready だけ報告する。
- dev と Nginx 配信で module の URL、MIME、base path が同じ API で解決できるようにする。
- `src/audio/load-worklet.ts` に、既存の AudioContext と module URL を受け取り `addModule()` を呼ぶ最小 loader を置く。失敗は識別可能な型付きエラーとして返す。loader は Context の作成・resume・close を行わず、チケット3の controller がこの契約を利用する。
- このチケットで Vitest と Playwright、Docker の e2e service、`make test` / `make e2e` を導入して `make ci` に組み込む。Vitest は processor の無音・可変長バッファ・sampleRate 契約を検証し、Playwright はテスト専用の最小ページ上でユーザー操作から実際の AudioWorklet を作り ready を確認する。製品UIや将来の controller は不要。

## 受け入れ基準

- Chromium でユーザー操作後に module を読み込み、processor の ready を受け取れる。
- 44.1 kHz と 48 kHz、128 以外の出力フレーム長でも processor が例外なく無音を返す。
- 通常の Web Worker を代用せず、build 出力に Worklet module が含まれる。
- 読み込み失敗は共有 loader が識別可能なエラーとして返し、単体テストと不正 module URL のブラウザ検証で確認できる。

## Docker 検証

- **既存:** `make check`、`make build`、`make ci`。
- **このチケットで追加:** `make test`、`make e2e`。Playwright パッケージと公式ブラウザ image を一致させ、dev/web 配信の Worklet URL・MIME・ready を CI 内でも確認する。テスト専用ページを製品の dist に含めない。

## 並行作業案

Vite asset/build 側と共有 TypeScript contract 側は分けられる。processor API の最終形は次の controller 実装者とレビューする。

## 手動証跡

Docker 内の実 Chromium による dev/web の Worklet 読み込み結果を保存する。Windows での確認は任意で、音の品質判定は不要。
