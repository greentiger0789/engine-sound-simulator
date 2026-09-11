# チケット 7: クランク位相積分と単気筒燃焼イベント

## 目標

4ストローク720°周期の位相を sample 単位で積分し、半開区間規則で燃焼 crossing を取りこぼさず時刻付きイベントとして出す。

## 範囲 / 非対象

- 範囲: phase integrator、event cursor、周期境界、sample 内補間、固定6000 rpmの単気筒テスト。
- 非対象: パルス波形、複数気筒、UI表示、燃焼/排気の別タイミング。

## 依存関係

5、6。

## 計画参照

実装計画 §4.1、§4.2、§5、§6、§10 M2、§11。

## 実装契約と想定ファイル

- `src/engine/phase.ts` と `events.ts` は phase を `[0, cycleDegrees)` に正規化し、区間を `[previous,next)` と定義する。
- event は cylinder id、cycle index、angle、sample 内 offset を持つ。RPM 変更中に phase を reset しない。
- 同時イベントを許し、最後の角度から次周期の先頭までを必ず走査する。

## 受け入れ基準

- 6000 rpm・720°・単気筒は1秒に50イベントを出す。
- 44.1/48 kHz と異なる process buffer 長で event 時刻誤差が1 sample以内である。
- 0° crossing と周期境界、急な RPM 変更で重複/欠落しない。
- `make test` と `make ci` が成功する。

## Docker 検証

- **既存:** `make test`、`make ci`。
- **追加なし:** event 数と時刻を unit test で検証する。

## 並行作業案

boundary test matrix と integrator は分けられる。半開区間の定義をテスト名にも明記する。

## 手動証跡

不要。6000 rpm/1秒の event 数と境界ケースのテスト出力を PR に記録する。
