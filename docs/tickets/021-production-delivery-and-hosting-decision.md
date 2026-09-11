# チケット 21: 本番配信構成とホスティング判断

## 目標

Nginx静的配信イメージの本番設定を固め、HTTPS配信先とライセンスの未確定事項を決定・記録し、公開可能な運用手順を作る。

## 範囲 / 非対象

- 範囲: Nginx headers/fallback、container scan検討、deployment runbook、hosting/license decision record。
- 非対象: ユーザーが決めていない第三者サービスへの実デプロイ、自動公開、サーバー側音声合成。

## 依存関係

1、20。開始前に依存 report の verified/merged 状態を確認する。

## 計画参照

実装計画 §2、§6、§8、§10 M5、§12、§13。

## 実装契約と想定ファイル

- web imageは最小Nginxで `dist` を配信し、SPA fallback、適切なMIME、cache/security headerを文書化する。
- runbookはHTTPSがAudioWorkletのsecure context条件を満たすこと、localhostとの差、環境変数/secretをimageへ入れないことを記す。
- hosting/licenseが未決なら決定に必要な選択肢を文書化して停止し、推測で外部デプロイしない。

## 受け入れ基準

- `make build` でproduction imageを再現可能に作り、コンテナからSPA/Worklet assetを返す。
- deployment runbookにHTTPS前提、rollback、イメージ識別、未決事項がある。
- hosting/license decision が承認済みでない場合、reportは `Status: blocked` とし、外部書込みを行わない。

## Docker 検証

- **既存:** `make build`、`make ci`。
- **追加なし:** web containerのHTTP/asset確認をbuild検証に含める。

## 並行作業案

Nginx/runbookとライセンス/hosting decision資料は分けられる。外部デプロイは担当範囲外。

## 手動証跡

HTTPS候補環境での実確認はhosting決定後に必要。未決の間はその理由をreportへ残す。

## 完了報告と聴感

`reports/021.md` は外部決定前にverifiedにならない。聴感は不要。
