# 開発コンテナの依存更新が既存volumeへ反映されない

Status: open

- 優先度: P2。依存追加後の通常の開発再起動でパッケージ解決に失敗し得る。
- 発見: チケット1のPR #3レビュー。チケット6後の調査で未修正を再確認。
- 対象revision: `9f6d3a91f22826924ae7b6a605412436056dbdcd`。
- 対象: `Makefile` のdev target、`compose.yaml` のdev `/workspace/node_modules`匿名volume。

## 根拠と再現手順

コード追跡による確認であり、今回の調査では実行再現していない。
`make dev` → Ctrl+C → Docker内で依存追加とlock更新 → `make dev`。
期待: 新しいimageの依存を使用する。実際の構成: `up --build`は既存volumeを再利用するため、古いnode_modulesが新imageを隠す。
[Docker Compose仕様](https://docs.docker.com/reference/cli/docker/compose/up/)のvolume保持と`--renew-anon-volumes`を参照。

## 対応範囲と完了条件

今回の調査は実装変更を含めず、本記録を残す。後続の依存更新に影響するため優先して対応する。
暫定回避はdevコンテナ削除後の再作成。恒久対応はdev起動時の匿名volume更新などを検討し、ユーザーの別サービス/volumeを削除しない。
隔離Compose projectで上記手順を実行し、再起動後に追加依存をresolveできること、既存dev起動が成功することを確認する。
