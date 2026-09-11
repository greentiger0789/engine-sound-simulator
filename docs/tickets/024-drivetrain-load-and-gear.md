# チケット 24: 車両負荷・クラッチ・ギア拡張

## 目標

Engine coreと分離したDrivetrain modelとして車両負荷、クラッチ、ギア、車速を追加し、M6拡張を完了する。

## 範囲 / 非対象

- 範囲: drivetrain state/config、gear ratio、clutch coupling、vehicle resistance、UI表示/操作、回帰テスト。
- 非対象: 精密タイヤ/路面/変速機物理、実車性能保証、ギアによる危険なoverrevの詳細、サーバー機能。

## 依存関係

6、20、23。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §1、§4.3、§4.4、§10 M6、§13。

## 実装契約と想定ファイル

- `src/engine/drivetrain.ts` は EngineConfig を変更せず別config/stateとして結合する。neutralでは従来の簡易load挙動を保つ。
- clutchは連続coupling、gearは有効ratio、vehicle resistanceは速度依存として表し、単位と境界をvalidatorで固定する。
- UIは現在gear、vehicle speed、clutchを表示し、不正ratio/負質量をrejectする。

## 受け入れ基準

- neutral、clutch disengaged、engaged gearの各ケースでRPM/車速が期待方向に変化する。
- 不正drivetrain configを拒否し、既存bike/2stroke/6/8cylinder testsがすべて通る。
- start/stop/config apply後にstateが有限で、`make test`、`make e2e`、`make ci`が成功する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** drivetrain unit/E2Eを既存commandへ追加する。

## 並行作業案

drivetrain numerical modelとUI/E2Eは分割可能。EngineConfig非破壊を統合レビューで確認する。

## 手動証跡

任意: neutral/gear/clutch操作の画面とRPM/車速所見を残す。聴感は依存解除条件ではない。

## 完了報告と聴感

`reports/024.md` に自動結果を記録する。M6の人の聴感レビューはphase-level補助証跡として別途残す。
