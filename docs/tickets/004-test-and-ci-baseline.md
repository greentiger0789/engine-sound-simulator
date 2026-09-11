# チケット 4: 音声ライフサイクルの回帰テストと CI 基準

## 目標

チケット2・3の Vitest / Playwright 検証を拡張し、二重開始・読み込み失敗・中断・再マウントといったライフサイクルの回帰を `Repository checks` で検出する。

## 範囲 / 非対象

- 範囲: 実在する状態遷移/エラー変換helperの単体テスト、`tests/` の失敗経路E2E、既存コマンドのCI集約。
- 非対象: M2 以降のエンジン/DSP 数値ケース、ブラウザ横断の完全検証、headless 結果を聴感合格とみなすこと。

## 依存関係

1、2、3。

## 計画参照

実装計画 §2、§8、§10 M1、§11、§12。

## 実装契約と想定ファイル

- `tests/e2e/` はクリックで開始し Worklet ready/状態応答を待ち、停止後の状態を確認する。HTTP 200 だけで成功にしない。
- Vitest は `AudioController` からDOM/Web Audioを切り離した状態遷移/エラー変換helperを対象にする。正常な `idle -> starting -> running -> stopping -> idle`、二重開始拒否、`processorerror` と module-load失敗の表示可能なerrorへの変換を各々testする。実装がこのhelperをまだ持たない場合は、ticket 3で導入した最小pure moduleを抽出し、空suiteや `passWithNoTests` は設定しない。
- チケット2の Playwright 公式 image と Compose `e2e` service を再利用し、対象 server の起動と終了を再現可能にする。
- `make test` は Vitest、`make e2e` は Playwright、`make ci` は lint/typecheck/build/test/e2e と既存検証を失敗伝播する。
- CI job を分割しても、必須名 `Repository checks` の集約 job は failure/cancel/skip を正しく失敗にする。

## 受け入れ基準

- Docker 内で `make test` と `make e2e` が再現可能に成功する。
- `make test` は上記controller state/error contractの正/失敗ケースを実行し、test fileを0件として成功しない。
- E2E が user gesture、Worklet ready、停止に加え、開始連打、Worklet 読み込み失敗、processor error、StrictMode 再マウント後の再開を検証する。失敗を隠さず、エラーの表示と復帰可否が契約に一致する。
- `make ci` と GitHub CI がアプリの型・lint・build・unit・E2Eを実行する。
- Chromium image と lockfile の組み合わせが CI で固定される。

## Docker 検証

- **既存:** `make check`、`make build`、`make test`、`make e2e`、`make ci`。
- **追加なし:** チケット2の検証基盤へ回帰ケースを加え、CI の失敗伝播を確認する。

## 並行作業案

Vitest/CI と Playwright/Compose は並行可能。CI 集約の変更は最後に一つへ統合する。

## 手動証跡

Docker の実 Chromium による実行ログを PR に記録する。Windows ブラウザでの追加確認は任意とする。音質・遅延の証跡は後続チケットで扱う。

## 完了報告と聴感

`reports/004.md` にunit/E2Eの件数と結果、レビューした実装コミット（PR URL と最終 CI は PR 本文）を残す。実ブラウザ・聴感は補助証跡であり、verifiedの必須条件ではない。
