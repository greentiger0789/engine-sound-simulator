# 本番配信・ホスティング判断ランブック

この文書は、公開を承認する前に静的 Web 配信を再現、検証、ロールバックするための手順と、未決のホスティング・ライセンス判断を記録するものである。アプリの音声は利用者のブラウザ内の Web Audio API / AudioWorklet で合成する。配信基盤で音声を合成したり、録音済みエンジン音を配信したりしない。

## 現在の状態と境界

- **Status: blocked** — 公開ホスティング先と利用許諾をオーナーが承認・記録していない。
- 現在は外部デプロイ、自動公開、DNS 変更、証明書発行を行わない。`make build` とローカルの `web` コンテナは、本番相当の再現・検証だけに使う。
- 当面の具体的な推奨は、承認まで公開を開始せず、候補を「TLS を管理できる静的ホスティング」に絞ることである。候補サービス、課金アカウント、独自ドメインはまだ選ばない。
- リポジトリは public だが、ライセンスは未選定である。ライセンス不在を許諾済みと解釈せず、成果物を第三者サービスへ公開しない。

この状態は [実装計画の未確定事項](implementation-plan.md#13-未確定事項と決める時点) と整合する。外部公開を準備する際の実ブラウザ・聴感・長時間検証は、別途 [Windows ブラウザ・長時間音声検証ランブック](browser-validation-runbook.md) に従う。

## 安全な配信条件

### HTTPS と AudioWorklet

AudioWorklet を使うアプリは secure context を必要とする。本番 URL は有効な TLS 証明書を使う `https://` とし、HTTP から HTTPS へリダイレクトする。証明書エラー、mixed content、平文 IP アドレスでの公開を許容しない。

`http://localhost`（および loopback）はブラウザが開発用に trustworthy origin として扱うため、ローカル確認では AudioWorklet が動作し得る。しかしこれは、LAN 上の `http://<IP>` や外部の平文 HTTP が secure context になることを意味しない。`make dev` の `http://localhost:5173` と `web` の `http://localhost:8080` は開発・本番相当のローカル確認用であり、公開 HTTPS の受け入れ証跡には数えない。

公開候補環境では、ブラウザの `window.isSecureContext`、ユーザー操作からの音声開始、Worklet の読み込み、停止、エラー表示を確認する。HTTP 200 だけでは AudioWorklet の成功を示さない。CSP を導入または変更する場合は、Worklet asset の読み込みを実ブラウザで再確認する。

### Nginx response policy

配信先を変更しても、次の Nginx response contract を維持する。CDN や TLS
終端 proxy が header を削除・上書きする場合は、同じ値またはそれ以上に厳しい値を
公開 URL の実 response へ設定して確認する。

| 対象                                           | response / MIME                             | cache                                                  |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `/`、`/index.html`、存在する asset 以外の path | SPA の `index.html` / `text/html`           | `Cache-Control: no-cache`。各 rollout 後に再検証する   |
| `/assets/engine-audio-worklet.js`              | Worklet / JavaScript。存在しなければ `404`  | stable URL のため `Cache-Control: no-cache`            |
| その他の `/assets/*`                           | 拡張子に対応する MIME。存在しなければ `404` | Vite content hash 付きのため `max-age=31536000`（1年） |

全 response に次を付与する。HTTPS を終端する公開 edge では、証明書と redirect を
確認した後に HSTS も設定する。ローカル HTTP の Nginx image は HSTS を送らない。

| header                    | 値 / 維持する制約                                                                                                                                                               | 目的                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `Content-Security-Policy` | `default-src 'self'`、`script-src 'self'`、`worker-src 'self'` を含み、object と frame 埋め込みを禁止。現行の完全な値は [`nginx.conf`](../nginx.conf) を source of truth とする | 外部 script、Worklet、埋め込み元を制限 |
| `Permissions-Policy`      | `camera=(), geolocation=(), microphone=()`                                                                                                                                      | 使用しない端末 capability を無効化     |
| `Referrer-Policy`         | `strict-origin-when-cross-origin`                                                                                                                                               | cross-origin へ送る referrer を制限    |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                       | 宣言 MIME 以外としての解釈を防止       |
| `X-Frame-Options`         | `DENY`                                                                                                                                                                          | clickjacking 用の frame 埋め込みを拒否 |

### イメージと秘密情報

本番イメージは Dockerfile の `web` stage に `dist` をコピーする最小 Nginx イメージである。環境変数、API key、証明書秘密鍵、トークン、`.env` を build context、`dist`、Docker image layer に含めない。静的配信に値が必要になった場合も、まず公開可能な値かを確認し、秘密値をクライアントへ渡す設計を採用しない。

配布・ロールアウトでは可変の `latest` だけを識別子に使わない。次を記録し、registry に push する場合は commit に対応する不変 tag と digest の両方を release record に残す。

| 記録項目           | 取得例                                            | 用途                      |
| ------------------ | ------------------------------------------------- | ------------------------- |
| source commit      | `git rev-parse HEAD`                              | build 入力の特定          |
| image ID           | `docker image inspect --format '{{.Id}}' <image>` | ローカル build の照合     |
| immutable digest   | registry push 後の `repo@sha256:...`              | rollout / rollback の対象 |
| build 時刻・実行者 | release record に記入                             | 追跡可能性                |

digest が得られる前に外部 rollout を始めない。イメージ tag は commit SHA など一意で再利用しない値にし、稼働環境は tag ではなく `repo@sha256:...` を指定する。

## 公開前の判断・承認記録

オーナーは次の選択肢と基準を確認し、決定を issue、PR、または release record のいずれか一つに記録してから公開を承認する。未記入の `TODO` は承認ではない。

| 判断           | 選択肢                                               | 判定基準                                                                                              | 現在の記録                                                                                                                                                           |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hosting        | TLS 対応の静的ホスト、自己管理 Nginx、公開しない     | HTTPS / redirect、独自ドメイン・費用、ログとデータ取扱い、障害時の rollback、静的 asset の cache 制御 | 未決。公開しない状態を継続                                                                                                                                           |
| license        | MIT、Apache-2.0、GPL 系、公開しない                  | 再利用許可、著作権表示・特許条項、派生物の条件、依存物との整合                                        | 未決。LICENSE は追加しない                                                                                                                                           |
| container scan | release 前にイメージ scan を実施、または導入を見送る | ベースイメージの CVE、重大度、修正可否、例外の期限・根拠                                              | **推奨:** hosting 承認後、最初の registry push 前に Trivy 等で scan を CI/release 手順へ追加し、Critical/High は修正または期限付きの承認記録なしに公開しない。未承認 |

承認記録には少なくとも、決定者、日時、hosting と URL、license、費用・アカウント責任者、採用する image digest、scan 結果または例外、rollback 責任者を含める。ここにある推奨はオーナー承認を表すものではない。

## 再現 build とローカル確認

外部公開前に、対象 commit を clean な作業ツリーで確認してから次を実行する。

```bash
make build
docker compose up --build web
```

別の端末で `http://localhost:8080/` を開き、SPA の深い URL も開く。開始操作から Worklet が ready になり、asset が返り、停止できることを確認する。完了後は、この確認で起動した service を停止する。

```bash
docker compose down
```

ローカル確認で記録するのは commit、実行したコマンド、image ID、確認 URL、SPA fallback、Worklet asset の HTTP 応答、開始/停止結果である。localhost の結果を HTTPS 公開環境の結果として転記しない。リポジトリの自動回帰は `make ci`（または公開時点の必須 `Repository checks`）を成功させる。

## 承認後の rollout と health verification

以下は hosting/license が承認され、immutable digest と scan 結果が記録された後だけ実施する。特定の外部サービスの管理画面や認証情報は、この文書に記録しない。

1. release record で source commit、`repo@sha256:...`、構成変更、承認者、rollback 対象 digest を再確認する。
2. まず production と分離された preview/staging URL に、その digest を配信する。HTTPS、HTTP-to-HTTPS redirect、証明書の有効性、SPA fallback、主要 asset と Worklet asset の MIME / 応答を確認する。
3. preview/staging で [ブラウザ検証ランブック](browser-validation-runbook.md) の公開準備用の必要項目を実行し、実行環境と未実施項目を記録する。headless E2E や curl を可聴確認の代替にしない。
4. health verification が通った digest だけを production に rollout する。production URL でも HTTPS、`window.isSecureContext`、開始・停止、Worklet 読み込み、SPA fallback、browser console error の有無を確認する。開始成功は `Status: running` と実音の両方で判定する。
5. rollout 時刻、URL、digest、確認者、確認結果、監視期間と異常の有無を release record に追記する。確認不能・失敗・想定外の console error は rollout 成功にしない。

## rollback

障害、secure context 不足、Worklet の読み込み失敗、開始不能、重大な脆弱性、または health verification の失敗時は、調査より先に最後に検証済みの immutable digest へ戻す。可変 tag を再 push して戻すことはしない。

1. 影響した URL、開始時刻、症状、現在の digest、直前に成功した digest を記録する。
2. hosting の rollout 設定を直前の `repo@sha256:...` に戻す。戻す対象がない場合は公開を停止するか、ホストの保守ページへ切り替える。この選択は事前承認記録の責任者が行う。
3. HTTPS、SPA fallback、開始/停止、Worklet 読み込みを再確認し、rollback 後の digest と時刻を記録する。
4. 原因、影響範囲、再発防止、再 rollout の承認条件を残す。問題を修正しても、同じ health verification と承認なしに再公開しない。

## release record テンプレート

```text
Status: planned | approved | rolled-back | blocked
決定者 / 日時:
Hosting / production URL:
License:
Source commit:
Image immutable digest:
Previous verified digest:
Container scan（tool, date, result, accepted exceptions）:
HTTPS / redirect verification:
SPA / Worklet asset verification:
Browser / audible verification:
Rollout time / verifier:
Rollback owner / result:
未解決事項:
```

現在の record は `Status: blocked` とし、hosting、license、digest、scan、外部 URL、実公開の確認結果はいずれも `not decided` / `not performed` とする。
