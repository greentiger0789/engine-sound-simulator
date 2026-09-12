# 開発コンテナの依存更新が既存volumeへ反映されない

Status: resolved

- 優先度: P2。依存追加後の通常の開発再起動でパッケージ解決に失敗し得る。
- 発見: チケット1のPR #3レビュー。チケット6後の調査で未修正を再確認。
- 対象revision: `9f6d3a91f22826924ae7b6a605412436056dbdcd`。
- 対象: `Makefile` のdev target、`compose.yaml` のdev `/workspace/node_modules`匿名volume。

## 根拠と再現手順

記録時点ではコード追跡による確認であり、実行再現はしていなかった。
`make dev` → Ctrl+C → Docker内で依存追加とlock更新 → `make dev`。
期待: 新しいimageの依存を使用する。実際の構成: `up --build`は既存volumeを再利用するため、古いnode_modulesが新imageを隠す。
[Docker Compose仕様](https://docs.docker.com/reference/cli/docker/compose/up/)のvolume保持と`--renew-anon-volumes`を参照。

## 対応

`make dev` に `--renew-anon-volumes` を追加し、再作成する `dev` コンテナの
`/workspace/node_modules` を新しいイメージの内容で初期化する。対象サービスは
`dev` のみに限定し、別サービスやその volume は削除しない。

## 検証

2026-09-13 に隔離 Compose project `ess-dev-volume-regression` で確認した。

- チケット1完了時点の依存で `dev` を起動し、後から追加された `vitest` が
  resolve できないことを確認した。
- 現在の `package.json` と lockfile に切り替えて `make dev` を再実行すると、
  `/workspace/node_modules` の匿名 volume が更新され、`vitest` を import
  できた。
- 更新後の Vite 開発サーバーが HTTP 200 を返すことを確認した。
- 隔離 project には `dev` だけを指定し、検証後も同 project だけを
  `down --volumes` した。通常の `make dev` は他サービスの停止や volume
  削除を行わない。
