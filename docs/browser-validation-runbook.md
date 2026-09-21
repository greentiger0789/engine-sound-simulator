# 公開準備用 Windows ブラウザ・長時間音声検証ランブック

公開デプロイを検討する段階で、Windows 実機の実際の音声出力から
詳細な host evidence を同じ条件で採取する手順である。現在の趣味開発中は
任意であり、未実施でもチケット 20 や後続の機能実装を止めない。Docker、HTTP 応答、headless Playwright は
事前回帰には使えるが、ここでいう開始成功、可聴応答、音切れ、CPU 使用率、
出力遅延の合格証明にはならない。

このアプリは回転と燃焼イベントから音を生成する。録音済みループの再生成功を
確認する手順ではない。公開判定にこのランブックを使う場合は、全 browser
matrix セル、基準 run、wired / internal の可聴応答 trial を別途定義する公開受け入れ
条件に照らす。実施した項目が期待を満たさなければ結果を `fail` とし、不具合を修正して
同じ条件で再実施する。未実施値を趣味開発中のオーナー報告から推測しない。

## 実施前の固定条件

1. 検証対象の commit、起動 URL、実施日時（タイムゾーンを含む）を記録する。
   開発版と本番相当版を区別する。`make dev` の場合は
   `http://localhost:5173`、本番相当版は `docker compose up --build web` で起動して
   `http://localhost:8080` を使う。検証後は `docker compose down` で、この検証用に
   起動した service を停止する。
2. Windows の音量、アプリの `Volume`、OS の拡張・空間音響・EQ、他の音声を
   固定する。通知、通信アプリ、録音、重い更新を止める。音量は聴覚を保護できる
   低い値から上げる。
3. 基準 run は有線または内蔵出力で行う。Bluetooth は別 run とし、基準の
   50 ms 判定や有線の結果を Bluetooth 結果で置換しない。
4. 各 browser で private/incognito window ではなく通常 window を使用し、拡張機能
   の有無を記録する。再現不能な拡張機能の干渉を疑うときは拡張なしの profile で
   再試行し、二つの結果を分ける。

`Start audio` はユーザーのクリックから実行する。自動再生を許可する設定変更で
代用しない。開始後に `Status: running` と実音を両方確認して初めて開始成功とする。
ページが開けたこと、HTTP 200、または DevTools にエラーがないことだけでは成功に
ならない。

## 共通の環境記録

各 browser/run の先頭に次の値を raw のまま記録する。値を取得できない項目は
推測値を書かず `not available` と取得方法を記す。

| 項目                                                                 | 記録値                   |
| -------------------------------------------------------------------- | ------------------------ |
| 実施者、日時、commit、URL（dev / web）                               | `TODO`                   |
| Windows edition / build、電源モード                                  | `TODO`                   |
| CPU 名、RAM、他の主な負荷                                            | `TODO`                   |
| browser 製品名、完全 version、profile / extensions                   | `TODO`                   |
| 出力 device 名、接続（wired / internal / Bluetooth）、Windows format | `TODO`                   |
| `AudioContext.sampleRate`                                            | `TODO`                   |
| `AudioContext.baseLatency`                                           | `TODO` / `not available` |
| `AudioContext.outputLatency`                                         | `TODO` / `not available` |
| preset、throttle、Dyno load、Volume、mute                            | `TODO`                   |
| 正確な開始・終了時刻、継続時間                                       | `TODO`                   |

### AudioContext 値の安全な採取

DevTools の Console で新しい `AudioContext` を作ると、それはアプリの context では
なく、デバイスを占有したり別の sample rate を返したりする。その値を evidence に
使わない。

代わりに、開始操作の直後、DevTools の Sources で
`src/audio/controller.ts` の `visualizationSource` を作る箇所へ breakpoint を設定し、
スコープ内のアプリ自身の `context` から次を読み取る。source map がない、
breakpoint を置けない、または値を安全に見られない browser では全項目を
`not available` としてよい。

```js
({
  sampleRate: context.sampleRate,
  baseLatency: context.baseLatency ?? "not available",
  outputLatency: context.outputLatency ?? "not available",
  state: context.state,
});
```

これは app の値を書き換えない観測方法である。`baseLatency` や `outputLatency` が
`0` の場合は raw 値 `0` と「browser reported 0; physical latency is not inferred」を記す。
property が未実装、`undefined`、または安全に読み取れない場合だけ `not available` とする。
欠損を補間したり OS の buffer size から算出したりしない。`sampleRate` は app context の
実測値であり、Windows の format 表示だけで代替しない。

## Browser matrix

以下を Windows の Chrome、Microsoft Edge、Firefox それぞれで実施する。
各セルには
`pass`、`fail`、`not-tested` のいずれかだけを置き、所見、正確な時刻、console error、
再現手順への参照を添える。

| Browser / version | Start: running + 可聴 | Stop: 無音 / idle | preset apply: 停止中に適用し次回開始へ反映 | error display: 意図的な無効位相 | Worklet / feature 差・console error | 判定   |
| ----------------- | --------------------- | ----------------- | ------------------------------------------ | ------------------------------- | ----------------------------------- | ------ |
| Chrome `TODO`     | `TODO`                | `TODO`            | `TODO`                                     | `TODO`                          | `TODO`                              | `TODO` |
| Edge `TODO`       | `TODO`                | `TODO`            | `TODO`                                     | `TODO`                          | `TODO`                              | `TODO` |
| Firefox `TODO`    | `TODO`                | `TODO`            | `TODO`                                     | `TODO`                          | `TODO`                              | `TODO` |

手順は各 browser で同一にする。

1. ページを開き、DevTools Console を消去する。`Start audio` を一度クリックし、
   `Status: running` と実際の出音を確認する。`Stop audio` をクリックし、無音と
   停止状態を確認する。
2. 停止中に `Engine preset` で `Evenly spaced four model` を選び、`Apply for next
start` を押す。`Active` / `Pending` 表示を確認後、もう一度開始して active config が
   4 気筒 preset になったことを記録する。走行中の preset apply はこの手順の成功に
   数えない。
3. 停止後に `Cylinder 4 phase (degrees)` へ `720` を入力し、Apply を押す。入力欄の
   validation error と error summary を確認し、実際に表示された文面を記録する。
   値を `540` に戻して正常化する。browser が AudioWorklet 非対応、secure context、
   module load、または processor error を表示した場合は、画面文面・console・時刻を
   raw のまま残して `fail` とする。

Firefox では、AudioWorklet 利用可否、`outputLatency` の露出、suspend / resume、表示
されたエラーを Chrome/Edge と同一であると仮定しない。異なる場合は feature difference
欄に事実を書く。実行した Firefox で必須機能が未対応なら `fail` とする。Firefox 自体を
起動できない、必要な device がないなど、検証を実施できなかった場合だけ `not-tested` と
理由を記す。

## 基準機: 4 気筒・48 kHz・10 分

この run は、matrix の browser ごとに必要な短い操作確認とは別の基準機測定である。
有線または内蔵出力、実際の `AudioContext.sampleRate === 48000`、`Evenly spaced four
model`、開始から終了まで連続 10 分を満たすことが前提である。48 kHz 以外なら結果を
記録しても基準 run は `not-tested` とする。出力 device や sample rate が途中で変化したら
中止時刻、変更内容、再試行の有無を記録する。

1. `Evenly spaced four model` を停止中に Apply し、開始後に app context の sample rate
   と UI の `Active: evenly-spaced-four-model` を確認して記録する。active が別構成なら
   timer を開始せず `fail` とする。throttle、Dyno load、Volume を記録する。推奨する
   固定負荷条件は throttle `50 %`、Dyno load `20.0 N m`、mute off である。別条件を使う
   場合は理由を書き、途中で操作した値と時刻を全て残す。
2. `Start audio` の実行時刻を秒まで記録して 10:00 を計時する。開始、2:00、5:00、
   8:00、10:00 で音切れ（瞬断、click、無音化、異常な連続音）、RPM 表示、status、
   Console の processor/worklet error を観測する。気付いた事象は発生時刻、継続時間、
   操作、再現性を記す。「なし」は全区間を聞いた場合だけ記録する。
3. 同時に Windows Task Manager と browser の Performance profiler を必要最小限で観測し、
   browser process の開始時 / 終了時 / 最大 CPU と memory、long task / worklet の処理時間に
   関する所見を記録する。
   profiler が DSP callback の数値を提供しない場合は `not available` と書く。128 frame /
   48 kHz なら block 予算は約 `2.67 ms`、目安は DSP p99 がその半分未満だが、browser
   profiler の別指標をこの p99 に読み替えない。計測開始・終了による負荷も所見に含める。
4. 10:00 到達時の正確な終了時刻を記録して `Stop audio` を押す。継続時間が 10:00 未満、
   processor error、知覚音切れ、または計測不能な必須事象があれば `fail`（環境・機能を
   実施していないだけなら `not-tested`）とする。

## 可聴応答と回転追従を分ける

50 ms は「入力を行ってから、出力から変化を初めて聞けるまで」の測定目標であり、
保証値ではない。throttle により RPM が上がるまでの機械モデルの追従時間は別の値で、
50 ms の合否から除外しないで別記録する。

### 可聴応答の測定

有線 / 内蔵出力で少なくとも 3 trial 行う。スピーカーから一定の短距離（例: 10 cm）に
マイクを固定し、同じ録音機器で、入力操作の物理的な click/tap 音とスピーカー音を
録る。安定して再生中に `Mute audio` を有効にし、同じ checkbox をクリックして mute を
解除した瞬間を入力にする。これにより、意図的な吸気・回転追従を主な測定値へ混ぜず、
UI 入力から出力開始までを測る。波形を sample 単位まで拡大して、入力 click の開始と
出力開始を読む。

入力 device は press と release の音を区別でき、checkbox が release で切り替わることを
事前に確認する。`t_input` は DOM の click activation に対応する物理的な release 音の
立ち上がりとする。DOM activation と対応づけられない touch device や無音 switch は使わず、
方法、device、波形上の marker を記録する。

`t_audible` は trial ごとに次の同じ規則で求める。入力前 500 ms の muted 区間から 1 ms
RMS window の中央値を noise floor とする。normalized full scale を `1` としたとき、
`max(noise floor * 4, 0.001)`（noise floor の 12 dB 上または -60 dBFS の高い方）を
threshold とする。mute 解除後に、連続する 5 個の 1 ms window が threshold を超えた最初の
window の先頭を `t_audible` とする。noise gate 等で noise floor が `0` でも threshold を
`0` にしない。clipping、外来音、または threshold を満たす出力を得られない trial は
選び直さず `not-tested` と理由を残して、条件を修正した別 trial と区別する。noise floor、
threshold、window 長も raw evidence に記録する。

- raw evidence: 録音 file 名/ハッシュ、sample rate、mic と speaker の距離、noise floor、
  threshold、各 trial の `t_input`、`t_audible`、`t_audible - t_input`、最大値、判定を
  残す。
- 空気伝搬補正をする場合は距離と温度近似を記録し、補正前値と補正後値を併記する。
  10 cm なら伝搬は約 0.3 ms である。補正値だけを報告しない。
- 3 trial 全てが補正前でも `<= 50 ms` なら `pass`、一つでも超過すれば `fail`、録音や
  入力マーカーを同期できなければ `not-tested` とする。耳で「速い」と感じただけの
  評価は数値測定の代わりにならない。

この試験の音の変化には、入力配送、AudioParam / Worklet 処理、出力 buffer、スピーカー、
および次の燃焼信号が現れるまでの時間が含まれる。入力から processor に届く遅延だけを
app が計測・公開していない場合、その値は `not available` とする。可聴応答を
「processing latency」と呼び替えない。

### 機械的 RPM 応答

可聴応答とは別の `Hold accelerator` trial で、入力時刻から RPM 表示が初めて一貫して
変化する時刻、または事前に定めた RPM 閾値へ達する時刻を記録する。表示は約 20–30 Hz
の telemetry であり、厳密な audio-time 測定ではない。この値はモデルの回転追従の
観測であり、可聴応答 50 ms の合否には使わない。

## Bluetooth の別記録

Bluetooth device は codec、OS、接続状態で遅延が大きく変わる。基準 run と同じ表や判定を
共有せず、次を別 section に記録する。Bluetooth の可聴応答が 50 ms を超えても、有線 /
内蔵の基準 run を失敗扱いに変更しない。ただし Bluetooth 自体の結果は `pass` / `fail` /
`not-tested` で正直に判定する。

| Device / codec（分かる場合） | Browser/version | sampleRate | latency 3 trials | dropouts | 判定 / 所見 |
| ---------------------------- | --------------- | ---------- | ---------------- | -------- | ----------- |
| `TODO`                       | `TODO`          | `TODO`     | `TODO`           | `TODO`   | `TODO`      |

## Report に貼る raw evidence ひな型

測定結果を要約だけにせず、次の空欄を埋めて `docs/tickets/reports/020.md` に貼る。添付録音、
screenshot、profiler export はリポジトリに置く必要がある場合だけ、機微情報を除いて
パスと hash を残す。

```text
Status: manual-validation-pending | verified | blocked
Commit / URL:
Operator / local date-time / timezone:
Windows edition/build / power mode:
CPU / RAM / background load:
Browser product / complete version / profile/extensions:
Output device / connection / Windows format:
AudioContext: sampleRate=, baseLatency=, outputLatency=, observation method=
Preset / throttle / Dyno load / Volume / mute:
Start timestamp=; end timestamp=; elapsed=

Matrix:
  Chrome: start=, stop=, preset apply=, error display=, feature difference=, raw notes=
  Edge: start=, stop=, preset apply=, error display=, feature difference=, raw notes=
  Firefox: start=, stop=, preset apply=, error display=, feature difference=, raw notes=

10-minute four-cylinder 48 kHz run:
  observed active config:
  checkpoints / audible dropouts / processor errors:
  CPU / memory / profiler method and observations:
  pass|fail|not-tested and reason:

Audible-response trials (wired/internal only):
  recording method/file/hash/distance/input marker/noise floor/threshold:
  trial 1: t_input=, t_audible=, raw delta=, corrected delta=, result=
  trial 2: t_input=, t_audible=, raw delta=, corrected delta=, result=
  trial 3: t_input=, t_audible=, raw delta=, corrected delta=, result=
  input-to-processing latency: measured value or not available, method=
  mechanical RPM response: definition/value or not-tested=

Bluetooth (separate): device/codec=, browser=, trials=, dropouts=, result=
Failures / reproduction / retest result:
```

`pass` はその行の事前条件・観測・合格閾値を満たした場合だけに使う。`fail` は実施して
期待結果を満たさなかった場合で、再現手順、raw error、再検証結果を必ず残す。
`not-tested` は未実施、必要な装置がない、または測定可能な証拠を取得できなかった場合で、
理由と次に必要な手順を残す。HTTP 成功や headless 成功をいずれの host 項目の `pass` にも
変換しない。必須項目の `fail` は、修正後の同条件 retest が `pass` になるまで report の
`verified` を禁止する。
