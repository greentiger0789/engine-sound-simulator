# チケット 8: 単気筒パルス DSP と出力保護

## 目標

燃焼イベントから解析的な滑らかな圧力パルスを継続状態で生成し、DC除去、有限値監視、ピーク保護、ミュートを通して安全に出力する。

## 範囲 / 非対象

- 範囲: pulse state、sample 内 event offset、負荷連動の強度/幅、DC blocker、gain/limiter、offline DSP tests。
- 非対象: 吸排気共鳴、機械音、ランダムばらつき、multicylinder mix、aliasing 最適化。

## 依存関係

6、7。

## 計画参照

実装計画 §5、§6、§10 M2、§11。

## 実装契約と想定ファイル

- `src/audio/dsp/` は engine event を入力とし、録音素材、矩形 impulse、無制限高調波を使わない。
- 各 cylinder の pulse state は連続し、event offset に従って同一 sample 内の発火も反映する。
- output protection は最終段で finite 値を保証し、異常時は無音へ遷移できる。絶対 peak は1以下、初期 gain は低い。
- DSP は Web Audio と分離し、offline renderer が同じ処理を呼べる。

## 受け入れ基準

- 同じ config/seed/input sequence の波形は許容誤差内で再現する。
- idle、中開度、全開、急な入力で NaN/Infinity がなく、保護後 peak が1以下、DC が定義した閾値内である。
- 6000 rpmの event 列に対応する pulse 数を持ち、mute は出力を無音にする。
- `make test` と `make ci` が成功する。

## Docker 検証

- **既存:** `make test`、`make ci`。
- **追加なし:** offline waveform test を既存 Vitest で実行する。

## 並行作業案

pulse 生成と protection/filter テストは分けられる。event 入出力型は ticket 7 を変更しない。

## 手動証跡

RMS、DC、peak、sampleRate、テスト条件を PR に記録する。聴感は次件の統合後に確認する。
