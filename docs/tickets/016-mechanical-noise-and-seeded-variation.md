# チケット 16: 機械次数音と seed 付き燃焼ばらつき

## 目標

クランク次数に同期する弱い機械音と、再現可能な seed 付き燃焼変動を加え、音色の変化を制御可能にする。

## 範囲 / 非対象

- 範囲: seeded PRNG、cylinder pulse variation、mechanical orders、config parameter、determinism tests。
- 非対象: 無制限乱数、実車ノック/失火再現、ギア雑音、録音音源。

## 依存関係

8、15。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §5、§10 M4、§11。

## 実装契約と想定ファイル

- RNG は config/rendererから明示 seed を受け、同じ seed/config/input列で event と許容誤差内波形を再現する。
- variation は小さなpulse amplitude/width変動に限定し、有限性と peak protection を迂回しない。
- mechanical orders は crank phase/RPM に同期し、設定可能な低いゲインで mix する。

## 受け入れ基準

- 同seedの offline render は再現し、異seedでは定義された範囲内で差が出る。
- ばらつき有無と機械音有無の各組合せで NaN/Infinity/peak超過がない。
- 機械成分が指定次数近傍に現れることを spectrum testで確認する。

## Docker 検証

- **既存:** `make test`、`make ci`。
- **追加なし:** seeded/DSP tests を追加する。

## 並行作業案

PRNG/variation と mechanical oscillator は並行可能。seed ownership と reset semantics を合わせる。

## 手動証跡

seed、RPM、負荷、spectrumを report に記録する。聴感は任意。

## 完了報告と聴感

`reports/016.md` に自動結果を残す。聴感確認はM4品質レビューでまとめる。

## チケット6完了後の接続契約

- strict parserは未知fieldを拒否する。seed/ばらつき等の追加fieldはconfig型・validator・presetと一緒に定義し、省略時defaultを持つ互換拡張かschema更新/移行かを明記する。seedの所有者とstop/start・構成再適用時のreset規則を定め、省略・不正値・再現性を検証する。
