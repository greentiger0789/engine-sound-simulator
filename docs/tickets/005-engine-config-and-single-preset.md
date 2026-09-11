# チケット 5: EngineConfig 検証と単気筒プリセット

## 目標

React/Web Audio 非依存の `EngineConfig` contract と入力検証を作り、4ストローク単気筒のモデル値プリセットを提供する。

## 範囲 / 非対象

- 範囲: schemaVersion、cylinder 配列、RPM/慣性/トルク/音色パラメーターの型と validator、単気筒 preset、unit tests。
- 非対象: UI 編集、多気筒 preset、回転計算、Worklet への適用。

## 依存関係

1、4。

## 計画参照

実装計画 §4.1、§4.4、§9、§10 M2、§11。

## 実装契約と想定ファイル

- `src/engine/config.ts` の `EngineConfig` は `schemaVersion`、`id`、`vehicleKind`、`cycleDegrees`、`cylinders[]`、idle/redline、慣性、torque curve、intake/exhaust を持つ。気筒数は `cylinders.length` からのみ導く。
- 各 cylinder は `id`、`firingAngleDeg`、`bankId`、強度を持つ。MVP UI 向け制限は validator option に置き、core は可変長を扱う。
- NaN/Infinity、空配列、重複 ID、範囲外位相、負慣性、idle>=redline、不正 curve を reject し、値を黙って補正しない。
- `src/presets/` の単気筒は 720°・角度0を使い、実車値と主張しないモデル値であることを metadata に示す。

## 受け入れ基準

- 正常な単気筒設定を parse でき、上記各不正値を理由付きで reject する。
- 同角度の異なる cylinder は将来の同時燃焼用に有効である。
- config module は React、DOM、Web Audio を import しない。
- `make test`、`make build`、`make ci` が成功する。

## Docker 検証

- **既存:** `make test`、`make build`、`make ci`。
- **追加なし:** このチケットは既存の unit/build/CI 経路だけを使う。

## 並行作業案

型/validator と preset data/tests は contract を先に合意すれば分けられる。

## 手動証跡

不要。PR に validator の入力表とテスト結果を記録する。
