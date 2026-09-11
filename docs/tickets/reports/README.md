# チケットの実装記録

各チケットの実装 PR に `NNN.md`（例: `001.md`）を追加します。計画書やこのディレクトリが存在するだけでは実装済みではありません。

依存チケットの完了判定には、最新の `origin/main` に取り込まれた記録の `Status: verified` と実装コードを使います。Draft PR の作成、CI の成功、Issue の close だけではマージ済みと扱いません。

記録のひな型は [report-template.md](../../../.agents/skills/implement-ticket/references/report-template.md) です。PR の最終 head SHA と CI URL は PR 本文に記載し、自己参照するコミット SHA や将来の merge commit を記録ファイルに書き込む必要はありません。

未完了は `Status: manual-validation-pending` または `Status: blocked` とし、理由と残る手順を記します。手動検証が必須でないチケットは、任意確認の未実施を明記して自動受け入れ結果で verified を判断できます。
