# チケット 13: 燃焼列・波形・FFT 可視化

## 目標

燃焼位相列、現在の波形、周波数スペクトルを Canvas 2D と AnalyserNode で表示し、音声処理の時間基準を UI 描画から分離する。

## 範囲 / 非対象

- 範囲: analyser connection、Canvas waveform/FFT、720° event strip、描画 lifecycle と表示ラベル。
- 非対象: chart library、録音/書き出し、UI animation を音声 scheduling に使うこと、音色品質評価。

## 依存関係

9、10、11。

## 計画参照

実装計画 §3、§7、§9、§10 M3、§11。

## 実装契約と想定ファイル

- `AnalyserNode` は出力監視用に接続し、音の主経路や processor timing を変更しない。
- Canvas は devicePixelRatio、resize、停止/cleanup を扱い、rAFは描画専用。event strip は720°周期と各 cylinder id を表示する。
- telemetry/visual input は固定上限頻度で読取り、React render を audio sample 毎に発生させない。

## 受け入れ基準

- 再生中に waveform/FFT と RPM/開度が更新され、停止後に描画 loop が停止する。
- preset/位相変更後、燃焼列が active config の角度・順序を示す。
- canvas resize と unmount を繰り返して listener/node/animation loop が増えない。
- `make test`、`make e2e`、`make ci` が成功する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** lifecycle E2E/unit casesを追加する。

## 並行作業案

event strip と analyser canvas は分割できる。controller の analyser ownership を先に決める。

## 手動証跡

各 twin preset の strip/FFT を含むスクリーンショットと、CPU使用が描画で急増しない所見を report に残す。聴感は任意。

## 完了報告と聴感

`reports/013.md` に検証結果を記録する。可視化は聴感の代替ではない。
