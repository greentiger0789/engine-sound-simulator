# チケット 20: 実ブラウザ横断・長時間動作の検証

## 目標

Chrome でオーナーのスモーク確認を行い、自動回帰と組み合わせて趣味開発段階の host evidence を確定する。公開準備時に使えるクロスブラウザ・長時間・遅延測定のランブックも保持する。

## 範囲 / 非対象

- 範囲: Chrome のオーナースモーク確認、自動ブラウザ回帰、公開準備用の browser matrix・10分・latency/CPU/device ランブック、known issues、host evidence report。
- 非対象: unsupported browserの実装、モバイルSafari、無関係な性能機能の追加（検証で見つかった対象範囲の不具合はこのチケットで修正）。

## 依存関係

14、17、19。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §1、§6、§7、§10 M5、§11。

## 実装契約と想定ファイル

- オーナーの明示的な手動確認報告は、報告された範囲の host evidence として扱い、未提供の環境・測定値は推測しない。
- 公開準備用 runbook は browser/version、OS、CPU、audio device、sampleRate、baseLatency/outputLatency（取得時）、preset、load、throttle、test開始/終了を記録できる状態を保つ。
- Edge / Firefox、4気筒48kHzの10分再生、50ms可聴応答測定、CPU/memory profiler、Bluetooth比較は公開準備開始まで任意とする。実施時は headless/HTTP 成功で代用せず、失敗を隠さない。

## 受け入れ基準

- Docker の Chromium E2E が開始、停止、4気筒 preset apply、無効位相 error 表示を dev/web で検証する。
- Chrome で問題がなかったというオーナーのスモーク確認報告があり、問題が報告された場合は対象機能を修正・再検証する。報告に含まれない OS や操作範囲は推測しない。
- クロスブラウザ、10分動作、50ms可聴応答の未実施は任意の公開準備証跡として明示し、未実施だけで `verified` を妨げない。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** Docker/headlessは事前回帰に使うが、このチケットのhost測定を代替しない。

## 並行作業案

browserごとの実施者は並行できる。matrix/report統合は一担当が行う。

## 手動証跡

趣味開発中は Chrome のオーナースモーク確認を必須とする。報告された範囲と未提供の詳細を `reports/020.md` に正直に記録する。公開準備時は runbook の詳細 matrix と測定を別途実施する。

## 完了報告と聴感

Chrome のオーナースモーク確認と自動回帰を趣味開発段階の受け入れとする。後続は改訂後 report が `verified` として main に取り込まれてから開始する。公開前には詳細ランブックを再実行する。
