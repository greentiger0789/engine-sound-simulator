# チケット 6: 回転体・吸気遅れ・idle の数値モデル

## 目標

開度を直接 RPM に変換せず、固定刻みの回転体モデルで慣性、駆動/摩擦/負荷、吸気一次遅れ、idle 維持を計算する。

## 範囲 / 非対象

- 範囲: SI 単位の dynamics state/step、1 kHz accumulator、負回転境界、調整可能 torque curve と負荷。
- 非対象: limiter、燃焼トルクリップル、UI 操作、音声出力。

## 依存関係

5。

## 計画参照

実装計画 §4.1、§4.3、§6、§10 M2、§11。

## 実装契約と想定ファイル

- `src/engine/dynamics.ts` は `J*dω/dt = Tdrive + Tidle - Tfriction - Tload` を使用し、rpm/rad/s の変換を一箇所に固定する。
- 入力 throttle は `[0,1]`、実効 throttle は一次遅れで持つ。sample ごとの crank phase 積分とは分離し、model step は accumulator で目標1 kHzにする。
- state は有限値と非負 RPM を保証し、異常入力は config validator と呼び出し境界で拒否する。

## 受け入れ基準

- 既知 parameter で RPM が開度に滑らかに追従し、閉時は抵抗により下降して idle 近傍に維持される。
- 同じ config/input sequence で決定的な結果を返し、急な入力や長時間 step に NaN/負 RPM が出ない。
- 44.1/48 kHz に相当する sample accumulator の差で dynamics 更新率が意図せず変わらない。
- `make test` と `make ci` が成功する。

## Docker 検証

- **既存:** `make test`、`make ci`。
- **追加なし:** 数値テストを既存 Vitest 経路へ加える。

## 並行作業案

モデル実装と期待値を独立に算出するテスト作成は分割可能。単位と update cadence は共通レビューする。

## 手動証跡

不要。RPM 時系列グラフまたは数値表を PR に添える。
