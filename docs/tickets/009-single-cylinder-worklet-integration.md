# チケット 9: 単気筒を Worklet と UI に統合

## 目標

M2の config/dynamics/events/DSP を Worklet に接続し、単気筒の idle・開度応答・簡易 limiter と低頻度 telemetry を UI に表示する。

## 範囲 / 非対象

- 範囲: processor integration、a-rate throttle、limiter の燃焼/駆動同期カット、20〜30Hz telemetry、RPM/開度表示。
- 非対象: 多気筒、preset editor、負荷 UI、波形/FFT、精密スターター/失火。

## 依存関係

3、5、6、7、8。

## 計画参照

実装計画 §3〜§7、§10 M2、§11。

## 実装契約と想定ファイル

- Worklet は構成を事前検証して受け取り、audio threadを時間基準に dynamics/events/DSP を処理する。
- throttle は AudioParam の長さ1と sample array の双方を処理する。telemetry は UI render cadence と分離し最大30Hz。
- limiter は redline の近傍で hysteresis を持ち、燃焼 pulse と drive torque の両方を同じ state で cut/restart する。
- UI は processor state とエラーを表示するが、毎 sample を React state に入れない。

## 受け入れ基準

- 単気筒で開始後 idle へ遷移し、開度で回転・音量が連続して変化し、閉じると idle へ戻る。
- limiter 時に event/pulse と torque が同期して抑制される。
- `processorerror` または有限値異常は無音化とUI通知になり、最後の正常構成を壊さない。
- E2E は開始、ready、RPM telemetry、停止を確認し、unit test は limiter 連動を確認する。

## Docker 検証

- **既存:** `make test`、`make e2e`、`make build`、`make ci`。
- **追加なし:** M2の regression を既存 command に追加する。

## 並行作業案

processor 統合、UI meter、E2E は分けられる。limiter state contract は DSP/dynamics 両担当で共通にする。

## 手動証跡

Windows Chromium/Edge で idle、開閉、limiter、停止を聞き、browser、device、sampleRate、異音/音切れの有無をPRへ残す。

## チケット6完了後の接続契約

- 既存のEngineAudioConfig（versionのみ）とtelemetry（framesRenderedのみ）を、EngineConfigのversion付きsnapshot、RPM、実効開度、limiter状態へ具体化する。controllerが正常構成を保持し、node再作成時にも初期構成を渡す。
- 初期構成の検証とdynamics/phase/DSP初期化が成功した後だけreadyを返し、controllerはそれ以前にrunningやunmuteへ進まない。初期化失敗は無音と型付き通知にし、再試行可能な正常構成を保持する。
- audio frame順に入力→1 kHz境界のdynamics更新→保持角速度でphase/event→DSPを処理する。各境界で対応sampleのa-rate値を読む（長さ1は保持）。全blockを最後の入力でadvanceする処理や二重advanceを避ける。
- limiter用のdrive torque倍率/許可状態をdynamicsへ渡す契約を追加し、pulseと同じcut/restart状態を使う。throttleを0にするだけでは吸気遅れが残るため代用しない。idle assistをcut対象に含めるか、hysteresis閾値、対応RPM/event密度上限も明記する。
- block途中の開度変化、scalar/vector等価入力、44.1/48 kHz、不均一blockを検証する。ready前の無音、processor再作成、limiterのtorque/pulse同期、例外時無音化も実際の統合経路で確認する。
- 初期構成はnode作成時のprocessorOptionsにrequest idとsnapshotを含める。processorはその構成の初期化成功でconfig-applied(requestId)を送り、その後に同じrequest id付きreadyを返す。controllerは現在のnodeと要求に一致する両応答までstarting/無音を維持する。拒否時はconfig-rejectedを返してreadyを送らない。順序逆転・古いid・古いnodeの応答でrunningへ進まないテストを追加する。
