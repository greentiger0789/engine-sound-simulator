# チケット 19: 操作性・アクセシビリティ・音声 lifecycle

## 目標

開始/停止、input、error状態をキーボードと支援技術で操作可能にし、非表示化、context中断、復帰不能nodeを安全に扱う。

## 範囲 / 非対象

- 範囲: labels/aria/status、focus、reduced visual load、visibility suspend/fade、statechange/processorerror recovery UX。
- 非対象: iOS/Safari特有の音声経路対応、公開HTTPS、レイアウト全面刷新。

## 依存関係

14、18。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §3、§7、§10 M5、§11。

## 実装契約と想定ファイル

- button/slider/number inputは programmatic name/value/stateを持ち、error/statusは必要な頻度だけannounceする。
- `visibilitychange` では短いfade後にsuspendし、復帰時は明示ユーザー操作でresumeする。壊れたWorklet nodeはcontrollerが再作成できる。
- 画面の描画負荷は audio threadの時間基準を変更しない。

## 受け入れ基準

- keyboardだけで開始、停止、mute、throttle、config入力を操作できる。
- E2Eがvisibility/suspend、復帰要求、processorerrorの画面表示と復旧を確認する。
- repeated mount/unmount と start/stopでnode/listener/animation loopの増加がない。
- `make test`、`make e2e`、`make ci` が成功する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** lifecycle/accessibility testsを追加する。

## 並行作業案

accessibility UIとcontroller recoveryは分割可能。status messageの語彙とstate enumは共有する。

## 手動証跡

任意: keyboard操作とbrowser accessibility treeの確認結果を report に残す。聴感確認は不要。

## 完了報告と聴感

`reports/019.md` に自動証跡を記録する。手動a11y確認は補助証跡。
