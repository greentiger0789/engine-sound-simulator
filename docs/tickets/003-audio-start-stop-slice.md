# チケット 3: ユーザー操作による開始・停止の縦切り

## 目標

低音量の合成基準信号を AudioWorklet から鳴らし、React UI の開始・停止・音量・ミュートを controller 経由で安全に動かす。

## 範囲 / 非対象

- 範囲: `AudioController` の AudioContext lifecycle、開始/停止フェード、基準信号、状態・エラー表示、StrictMode 再マウント対策。
- 非対象: RPM、アクセル、EngineConfig、燃焼音、可視化、構成変更。

## 依存関係

1、2。

## 計画参照

実装計画 §3、§5（出力安定性）、§7、§10 M1、§11。

## 実装契約と想定ファイル

- `src/audio/controller.ts` だけが `AudioContext`、node 接続、`resume()`/`close()` を所有する。React は controller の公開状態を読むだけにする。
- Worklet の読み込みはチケット2の `load-worklet.ts` を利用し、型付きエラーを画面の状態へ変換する。テスト専用ページで使っていた Context を製品に流用しない。
- `AudioContext` は click 等の操作から作成/再開し、開始直後は短い gain fade を通す。停止時も fade 後に停止する。
- `processorerror`、`statechange`、Worklet の `fatal-error` を画面上の復帰可能/不能な状態に変換する。二重 mount で二重発音させない。
- 基準信号は録音素材でなく processor 内の解析的な低振幅波形とし、最終ゲインは安全な初期値にする。

## 受け入れ基準

- 初期ロードは無音で、開始ボタンだけが AudioContext を作成または resume する。
- 開始、停止、音量変更、ミュートが controller 経由で反映され、同じ画面操作を繰り返しても node が重複接続しない。
- Worklet 非対応、secure context 不足、processor error の理由を表示できる。
- controller/DSPの自動検証で開始/停止のfadeと、突然のfull-scale出力がないことを確認する。

## Docker 検証

- **既存:** `make check`、`make build`、`make test`、`make e2e`、`make ci`（テスト環境はチケット2で導入済み）。
- **追加なし:** Vitest でゲイン包絡・有限出力を検証し、既存 Playwright で製品UIの開始・停止・ミュートと実際の Worklet 状態を確認する。包括的な失敗経路はチケット4で拡充する。

## 並行作業案

controller と React 操作部は分割できる。共有する状態 enum と error 表示文言は先に固定する。

## 手動証跡

任意: Windows Chromium/Edge の browser・audio device・sampleRate を記録し、開始/停止/ミュートの聴感所見を PR/report に残す。

## 完了報告と聴感

`reports/003.md` のverifiedは自動受け入れで判定する。人の聴感はM1の補助証跡であり、依存解除を止めない。
