# チケット 14: M3 利用可能版の回帰・受け入れ

## 目標

M1〜M3を通して、各多気筒 preset のイベント間隔、開始/停止、構成再適用、出力安全性を固定回帰にし、最初の利用可能版を判定可能にする。

## 範囲 / 非対象

- 範囲: preset matrix、offline audio checks、E2E failure paths、README/利用手順の更新、M3 report。
- 非対象: 新規DSP音色、M4音質改善、全ブラウザ/10分性能合格。

## 依存関係

10、11、12、13。開始前に全依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §10 M1〜M3、§11、§12。

## 実装契約と想定ファイル

- test matrix は全 preset × idle/mid/full throttle × start/stop を走らせ、NaN/Infinityなし・protection後peak<=1を判定する。
- 180/270/360 twin は同一RPMの angle interval を明示テストする。READMEは Docker起動・対応範囲・モデル値を説明する。
- report はチケット単位の自動結果と任意のWindows確認を分ける。

## 受け入れ基準

- M3 preset matrix が unit/offline tests で成功し、既存単気筒回帰を維持する。
- E2E が開始、ready、停止、失敗表示、停止後構成再適用を確認する。
- `make ci` が成功し、README のコマンドが実行可能である。
- 180°/270°/360°の event interval が仕様通りである。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make build`、`make ci`。
- **追加なし:** matrix は既存 commandに組み込む。

## 並行作業案

offline regression、E2E、README/report は並行できる。受け入れ判定は統合担当が一つの report にまとめる。

## 手動証跡

任意: Windows Chromium/Edgeで twin 3種の差を聞き、preset、RPM、sampleRate、device、所見を記録する。未実施でも自動受け入れは妨げない。

## 完了報告と聴感

`reports/014.md` に **Status: verified** を付けるには全自動受け入れ基準とレビューを満たす。報告は実装 PR に含め、後続チケットの依存を解除するのは main への merge 後とする。人の聴感はM3 phase evidenceとして別記録し、依存解除の必須条件にしない。
