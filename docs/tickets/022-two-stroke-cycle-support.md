# チケット 22: 2ストローク cycleDegrees 対応

## 目標

coreを作り直さず、`cycleDegrees: 360`の2ストローク設定、イベント率、位相テストを追加する。

## 範囲 / 非対象

- 範囲: config validatorの対応cycle方針と360°回帰、2ストロークpreset、phase/event/DSP regression、UI表記。
- 非対象: 実エンジンの掃気・ポートタイミング詳細、2ストローク専用音響モデル、V型。

## 依存関係

10、20。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §4.1、§4.4、§10 M6、§11。

## 実装契約と想定ファイル

- event rateは `rpm/60 * (360/cycleDegrees) * cylinderCount` を使い、720°の仮定をhard-codeしない。
- config/UIは2/4ストロークと周期を明示し、MVP4ストロークの既定presetを変えない。
- `firingAngleDeg` は適用cycleの範囲で検証する。

## 受け入れ基準

- 6000rpm単気筒2ストロークは100 event/s、4ストロークは50 event/sの回帰を通す。
- 360°境界のeventは欠落/重複せず、既存4ストロークpresetがすべて成功する。
- UIでcycleの違いが表示され、`make test`、`make e2e`、`make ci`が成功する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** cycle matrixを既存検証へ追加する。

## 並行作業案

config/phaseとUI表記は並行可能。DSPはcycle非依存contractを維持する。

## 手動証跡

任意: 360/720°表示と開始停止を確認する。聴感は後続拡張レビューで扱う。

## 完了報告と聴感

`reports/022.md` に自動結果を記録する。聴感は依存解除条件ではない。

## チケット6完了後の接続契約

- 現validatorはcycleDegreesを正の有限値として扱い360°を既に受け入れるため、単に360を許可する変更は不要。対応cycleの方針を明示し、現存構成との互換性を検証する。
- チケット11/13の720°固定表記・入力境界・燃焼帯の目盛・アクセシブル名をactive cycleDegreesから導出する。360°/720°の適用切替、0°と周期境界を含めて検証する。
