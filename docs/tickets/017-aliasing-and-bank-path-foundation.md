# チケット 17: aliasing 対策とバンク別経路の土台

## 目標

高回転時の折り返しを測定して必要な帯域制限/oversamplingを導入し、将来のバンク別排気遅延・反射へ拡張できる signal routing contract を作る。

## 範囲 / 非対象

- 範囲: high-RPM spectral measurement、必要時の oversampling/decimation またはband-limiting、bankId別 bus/route、DSP budget instrumentation。
- 非対象: 実際の分数遅延・反射ネットワーク、WASM移植、聴感でのみの判断。

## 依存関係

10、15、16。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §5、§6、§10 M4、§11、§13。

## 実装契約と想定ファイル

- `bankId` ごとに signal を集約できる internal route を作り、現行の単一排気 mix と同じ既定結果を保つ。
- 最高対応RPMで pulse 生成前の帯域を制御する。最終low-passだけで既にaliasした成分を直す設計にはしない。
- frames/sampleRateから block budget を計算し、計測は production audio pathで allocation/logを発生させない。

## 受け入れ基準

- 44.1/48kHz、各 preset、最高RPMで Nyquist近傍の定義済み指標が基準値内で、finite output/peak<=1を満たす。
- bankId別の routing を unit test で確認し、既存単一bank presetの回帰を維持する。
- 48kHz・128 framesの処理時間99pが2.67msの半分未満を目標とする測定値を report に残す。未達は最適化/WASM判断を別チケットに起票し、値を隠さない。

## Docker 検証

- **既存:** `make test`、`make ci`。
- **追加なし:** offline spectral/route testを追加する。

## 並行作業案

bank routingとoffline alias測定は並行できる。oversampling導入は結果を受けて一担当が統合する。

## 手動証跡

自動spectrum/benchmark表を report に残す。実ブラウザ profiler は任意の補助証跡。

## 完了報告と聴感

`reports/017.md` に結果を残す。聴感はM4 reviewで扱い、依存解除条件にしない。
