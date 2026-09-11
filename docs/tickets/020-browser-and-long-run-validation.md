# チケット 20: 実ブラウザ横断・長時間動作の検証

## 目標

Windows の Chromium、Edge、Firefoxで機能を検証し、4気筒48kHzの10分動作と可聴応答目標を測定して公開品質の host evidence を確定する。

## 範囲 / 非対象

- 範囲: browser matrix、10分runbook、latency/CPU/device記録、known issues、host evidence report。
- 非対象: unsupported browserの実装、モバイルSafari、無関係な性能機能の追加（検証で見つかった対象範囲の不具合はこのチケットで修正）。

## 依存関係

14、17、19。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §1、§6、§7、§10 M5、§11。

## 実装契約と想定ファイル

- runbookは browser/version、OS、CPU、audio device、sampleRate、baseLatency/outputLatency（取得時）、preset、load、throttle、test開始/終了を記録する。
- 4気筒48kHzで10分再生し、知覚音切れ、操作から可聴応答、processor error、memory/CPU所見を記す。Bluetooth遅延は別扱いにする。
- FirefoxはWorklet/feature差を明記し、失敗をHTTP成功で隠さない。

## 受け入れ基準

- Chromium、Edge、Firefoxそれぞれで開始、停止、preset apply、error表示の結果が matrix にある。
- 基準機の4気筒48kHz/10分の結果と、50ms可聴応答の測定方法・結果が記録される。
- 未達または未検証の環境は明示する。対象機能の不具合は修正・再検証し、外部要因で未完了なら verified にせず再現手順と残る対応を記す。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** Docker/headlessは事前回帰に使うが、このチケットのhost測定を代替しない。

## 並行作業案

browserごとの実施者は並行できる。matrix/report統合は一担当が行う。

## 手動証跡

**必須。** Windows実機と音声出力で上記matrixを実施し、`reports/020.md`にraw結果を残す。未実施なら `Status: manual-validation-pending` とし、このチケットはverifiedにしない。

## 完了報告と聴感

このチケットだけはhost/human evidenceが受け入れ必須である。後続は report が `verified` になるまで依存を開始しない。
