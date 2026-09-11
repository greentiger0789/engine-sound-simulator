# チケット 18: M4 音質・性能レビュー

## 目標

固定した比較条件でM4音色をレビューし、スペクトル・処理負荷・任意の人の聴感所見を再現可能な報告にまとめる。

## 範囲 / 非対象

- 範囲: comparison matrix、offline measurement、manual listening template、M4 report。
- 非対象: 新規DSP機能、実車同等の宣言、録音データのプロダクト利用。

## 依存関係

15、16、17。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §5、§10 M4、§11、§13。

## 実装契約と想定ファイル

- matrix は preset、RPM、load、throttle、sampleRate、基準gain、seedを固定して比較する。
- report は RMS/DC/peak、燃焼次数エネルギー、Nyquist指標、block budgetを示す。実車参考音は使っても再生素材にしない。
- 聴感欄は「実施者/ブラウザ/device/出力経路/所見」を分離して記録し、未実施を合格に見せない。

## 受け入れ基準

- 自動測定が全 matrix で finite、peak<=1、定義済み spectral limitsを満たす。
- M4 reportに比較条件と測定結果、既知のモデル値/限界が記録される。
- `make test` と `make ci` が成功する。

## Docker 検証

- **既存:** `make test`、`make ci`。
- **追加なし:** review measurementを既存offline testへ置く。

## 並行作業案

測定集計と任意聴感の記録は並行可能。release判断は自動測定結果を先に確定する。

## 手動証跡

任意だが推奨: Windowsで同条件を聞き、音切れ、耳障りなalias、preset差を記録する。人の確認が未実施なら report に `listening: not-run` と書く。

## 完了報告と聴感

`reports/018.md` の verified は自動受け入れのみで可能。聴感はM4 phase品質証跡であり、未実施でも後続自動作業を止めない。
