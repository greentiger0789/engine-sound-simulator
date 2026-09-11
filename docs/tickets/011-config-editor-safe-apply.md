# チケット 11: 位相編集 UI と停止中の安全な構成適用

## 目標

プリセット選択と気筒ごとの720°燃焼位相編集を提供し、構成を停止中だけ検証・適用して最後の正常構成を維持する。

## 範囲 / 非対象

- 範囲: config editor、数値入力、validation error、停止中 apply、preset 選択、燃焼列テキスト/帯の基礎表示。
- 非対象: 走行中 hot-swap、クランク幾何学からの位相導出、V型編集、音色パラメーター編集。

## 依存関係

3、5、9、10。開始前に各依存の verified/merged report を確認する。

## 計画参照

実装計画 §4.1、§4.4、§5、§7、§10 M3、§11。

## 実装契約と想定ファイル

- UI 表記は必ず「燃焼位相（720°周期）」とし、crank pin angle や点火進角と混同しない。
- validator failure は入力に紐付けて表示し、Workletへ送らない。停止中のみ `replace-config` message を送り processor は pulse/filter state を作り直す。
- apply 成功まで active config を置換せず、失敗時は最後の正常 config と音声状態を維持する。

## 受け入れ基準

- 1〜4気筒の位相入力、preset 選択、不正値表示がキーボード操作可能である。
- 再生中は編集値を適用できず、停止後にのみ正常 config が適用される。
- 不正 config と Worklet rejection は画面に理由を表示し、既存音声構成を壊さない。
- E2E が編集、拒否、停止後 apply、ready を確認する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** validator/E2Eケースを追加する。

## 並行作業案

editor UI と controller/worklet apply handshake は分割できる。message schema は ticket 2 の互換性を保つ。

## 手動証跡

編集→停止→適用の画面録画またはスクリーンショットと、invalid 値の表示を report に残す。聴感は任意。

## 完了報告と聴感

`reports/011.md` に自動結果を記録する。人の聴感確認は phase-level の補助証跡であり依存解除条件ではない。
