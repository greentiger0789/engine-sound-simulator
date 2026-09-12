# チケット 15: 吸排気共鳴フィルター

## 目標

燃焼パルスに安定な排気共鳴フィルター群を適用し、開度/負荷連動の吸気ノイズと共鳴を加える。

## 範囲 / 非対象

- 範囲: stable resonator/filter coefficients、管長/減衰/マフラー相当のモデル値、intake noise、offline spectrum tests。
- 非対象: 実排気管の完全流体計算、分岐反射、録音素材、機械音、WASM。

## 依存関係

8、14。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §5、§10 M4、§11、§13。

## 実装契約と想定ファイル

- `src/audio/dsp/` の filter は有限値、安定係数、reset lifecycle を明示し、configのexhaust/intake parameterに対応する。
- intake noise は開度・負荷で帯域/ゲインを制御し、白色ノイズ単独でengineを代用しない。
- 実車データがない値は model metadata に記す。

## 受け入れ基準

- 全 M3 preset と開度条件で finite output、peak<=1、filter instabilityなし。
- 固定入力で共鳴設定変更が定義した周波数帯のエネルギーを変え、Nyquist近傍の異常増幅を起こさない。
- 同一seed/inputの offline 結果が許容誤差内で再現する。

## Docker 検証

- **既存:** `make test`、`make ci`。
- **追加なし:** spectral assertions を既存 DSP test に加える。

## 並行作業案

exhaust filter と intake path は分けられる。output protection との接続は共通レビューする。

## 手動証跡

固定RPM/負荷/音量での spectrum 図を report に添える。聴感所見は任意。

## 完了報告と聴感

`reports/015.md` に自動結果を残す。人の音質判断はM4 reviewまで必須にしない。

## チケット6完了後の接続契約

- 静的validatorが受け入れる正のresonanceHzでも実sampleRateのNyquistを超え得る。DSP初期化時に安全な上限へ写像するか拒否するかを明記し、正常構成の保持規則と整合させる。44.1/48 kHzでNyquist超過入力・再初期化・有限出力を検証する。
