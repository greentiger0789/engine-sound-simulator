# チケット 23: V型・自動車向け6/8気筒設定

## 目標

複数bankと6/8気筒を扱うモデルpresetを追加し、coreが気筒数増加やV型設定で作り直しなく動くことを検証する。

## 範囲 / 非対象

- 範囲: V型/6/8気筒の明示event preset、bankId routing、性能測定、UI上限の見直し。
- 非対象: 幾何学からの自動位相導出、検証済み特定車種名、精密集合管/反射、車両負荷/ギア。

## 依存関係

17、20、22。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §1、§4.2、§4.4、§5、§10 M6、§13。

## 実装契約と想定ファイル

- presetは明示したfiring angle/cylinder id/bankIdを持ち、名称はmodel configurationであることを示す。
- validatorのMVP UI上限1〜4を一般化する場合、コア制限とUI制限を別に保つ。
- 6/8気筒はbank bus経路を通り、単一bankと既存bike presetの出力契約を壊さない。

## 受け入れ基準

- 6/8気筒 presetの周期内event数/順序/境界がunit testで確認される。
- 44.1/48kHzでfinite output/peak<=1を満たし、4気筒性能目標回帰を維持する。
- UIは対応気筒数とモデル値の限界を表示し、`make test`、`make e2e`、`make ci`が成功する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** high-cylinder matrixを追加する。

## 並行作業案

preset/event testとUI generalizationは分割可能。bank routeの変更はDSP担当が統合する。

## 手動証跡

任意: 6/8気筒presetをWindowsで開始し、CPU/音切れ所見を記録する。実車再現の主張はしない。

## 完了報告と聴感

`reports/023.md` に自動結果を残す。人の聞き取りは必須ではない。
