# チケット 11: 位相編集 UI と停止中の安全な構成適用

## 目標

プリセット選択と気筒ごとの720°燃焼位相編集を提供し、構成を停止中だけ検証・保存し、次回startで適用を確認して最後の正常構成を維持する。

## 範囲 / 非対象

- 範囲: config editor、数値入力、validation error、停止中 apply、preset 選択、燃焼列テキスト/帯の基礎表示。
- 非対象: 走行中 hot-swap、クランク幾何学からの位相導出、V型編集、音色パラメーター編集。

## 依存関係

3、5、9、10。開始前に各依存の verified/merged report を確認する。

## 計画参照

実装計画 §4.1、§4.4、§5、§7、§10 M3、§11。

## 実装契約と想定ファイル

- UI 表記は必ず「燃焼位相（720°周期）」とし、crank pin angle や点火進角と混同しない。
- validator failure は入力に紐付けて表示し、Workletへ送らない。停止中のみpending構成を保存し、次回startでprocessorのpulse/filter stateを初期化する。
- processorによる適用確認まで active config を置換せず、失敗時は最後の正常 config と音声状態を維持する。

## 受け入れ基準

- 1〜4気筒の位相入力、preset 選択、不正値表示がキーボード操作可能である。
- 再生中は編集値を適用できず、停止後にpendingとして保存し、次回startのprocessor確認後にのみactiveへ昇格する。
- 不正 config と Worklet rejection は画面に理由を表示し、既存音声構成を壊さない。
- E2E が編集、拒否、停止後pending保存、次回startでの適用確認とreadyを検証する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** validator/E2Eケースを追加する。

## 並行作業案

editor UI と controller/worklet apply handshake は分割できる。message schema は ticket 9 の初期化/ready契約を拡張し、controllerとprocessorを同時に更新する。

## 手動証跡

編集→停止→適用の画面録画またはスクリーンショットと、invalid 値の表示を report に残す。聴感は任意。

## 完了報告と聴感

`reports/011.md` に自動結果を記録する。人の聴感確認は phase-level の補助証跡であり依存解除条件ではない。

## チケット6完了後の接続契約

- stop()はnode/contextを破棄するため、存在しないMessagePortへ送らない。controllerにactiveConfigとpendingConfigを保持し、停止中の検証済み入力はpendingとして保存する。
- 次回ユーザー操作によるstartでpending構成を渡し、request id付きconfig-applied/config-rejectedで初期化結果を確認してからactiveへ昇格する。pendingと適用済みをUIで区別し、拒否時は最後の正常構成を保持して再試行できる。停止中applyだけではAudioContextを起動しない。
- E2Eは停止→pending保存（contextなし）→start→ack/ready→新構成で動作、およびprocessor拒否→正常構成で再試行を確認する。古いnode/requestの応答でactive構成が書き換わらないことも検証する。
- 初期化の転送・応答順はチケット9を再利用する。現在のpending snapshotとrequest idに一致するconfig-applied後のreadyが揃うまでactiveへ昇格せず無音を維持する。同一nodeの古いidやready先行も拒否し、config-rejected後にreadyを受けても復活させない。
