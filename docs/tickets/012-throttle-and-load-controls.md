# チケット 12: アクセル・負荷操作 UI

## 目標

0〜100%のラベル付き slider/数値入力と、押している間だけ開く操作、簡易ダイノ負荷を UI から controller へ連続的に渡す。

## 範囲 / 非対象

- 範囲: throttle slider、hold control、keyboard/pointer handling、focus loss解除、load control、AudioParam 接続。
- 非対象: ギア/車速/クラッチ、入力をRPMへ直結する操作、config 編集。

## 依存関係

6、9。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §4.3、§6、§7、§10 M3、§11。

## 実装契約と想定ファイル

- throttle の canonical 範囲は controller 境界で `[0,1]`、UI 表示は0〜100%とする。音声 thread には a-rate AudioParam を渡す。
- hold 操作は `pointerup`、`pointercancel`、window blur、keyboard keyup で必ず0へ戻し、input/textarea 編集中のキーを奪わない。
- load は dynamics の `T_load` 調整で、RPM目標値を直接書き換えない。

## 受け入れ基準

- slider、数値入力、keyboard、pointer の各経路が同じ throttle state を更新する。
- pointer cancel と focus loss 後に hold throttle が0に戻る。
- load を増やすと同一開度の定常RPMが低下し、unit/E2Eで確認できる。
- accessibility name/value が存在し、`make test`、`make e2e`、`make ci` が成功する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make ci`。
- **追加なし:** input edge cases を既存の検証へ追加する。

## 並行作業案

UI input state と dynamics/load test は並行できる。controller に送る範囲と解除条件は共通化する。

## 手動証跡

Windowsで pointer cancel/focus loss と開度応答を確認し、操作結果を report に残す。聴感評価は任意。

## 完了報告と聴感

`reports/012.md` に automated evidence を残す。人の聞き取りは必須ではない。

## チケット6完了後の接続契約

- チケット9のframe/1 kHz境界の入力規則を再利用する。loadはAudioParamか明示した制御周期のmessageかを選び、単位・範囲・反映時点を定義する。現在のprocessorにはload parameterがないため、controllerとprocessorを同時に更新する。
