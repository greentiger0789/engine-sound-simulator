# チケット1〜6完了後の調査

調査日: 2026-09-12。対象main: `9f6d3a91f22826924ae7b6a605412436056dbdcd`。

## 結論

Sol / mediumを親、Terra / mediumを実装、Terra / highを独立レビューにする現設定を維持する。全6件の親セッションと直接の実装/レビュー子セッションで実モデル設定を確認した。チケット1〜4は2ワーカー、5〜6は1ワーカーであり、小さいチケットで分割を減らせている。独立レビューは各件で実施され、指摘後の修正・再確認が記録されている。

チケット7を開始する前にsample位相の契約、9を開始する前に入力時刻・初期化・limiterの契約、11を開始する前に停止中の構成保存方式を明確にする必要がある。本変更で対象チケットへ反映した。既存実装を変更するものではない。

## 調査対象と証拠の範囲

親6セッションのユーザー指示、tool実行と結果、子のモデル/effort、最終報告を確認し、PR本文、実装記録、マージ済みコードと照合した。暗号化されたメッセージや非公開の推論内容は評価根拠にしない。生のセッション履歴はリポジトリへ格納しない。

マージ後の各コミットのGitHub必須チェックも成功している。これは現在の調査でテストを再実行したという意味ではない。音の物理出力・遅延・品質を再測定しておらず、後続チケットに対する検討は現契約の静的レビューである。

| チケット | マージ済みPR                                                          | マージコミット | マージ後CI                                                                                                    |
| -------- | --------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| 1        | [#3](https://github.com/greentiger0789/engine-sound-simulator/pull/3) | `2625601`      | [success](https://github.com/greentiger0789/engine-sound-simulator/actions/runs/34676352024/job/103506793203) |
| 2        | [#4](https://github.com/greentiger0789/engine-sound-simulator/pull/4) | `cb5650c`      | [success](https://github.com/greentiger0789/engine-sound-simulator/actions/runs/34678409784/job/103512319761) |
| 3        | [#5](https://github.com/greentiger0789/engine-sound-simulator/pull/5) | `837cfb0`      | [success](https://github.com/greentiger0789/engine-sound-simulator/actions/runs/34680439421/job/103517992751) |
| 4        | [#6](https://github.com/greentiger0789/engine-sound-simulator/pull/6) | `cb9f94d`      | [success](https://github.com/greentiger0789/engine-sound-simulator/actions/runs/34681413678/job/103520605429) |
| 5        | [#7](https://github.com/greentiger0789/engine-sound-simulator/pull/7) | `fabb5a8`      | [success](https://github.com/greentiger0789/engine-sound-simulator/actions/runs/34687737547/job/103537583674) |
| 6        | [#8](https://github.com/greentiger0789/engine-sound-simulator/pull/8) | `9f6d3a9`      | [success](https://github.com/greentiger0789/engine-sound-simulator/actions/runs/34688682452/job/103540048452) |

## セッション品質と改善

- チケット1: 実際には参照projectを検査しない型チェックを修正。後の再レビューで発見したdev依存volume問題はまだ残るため、[バグ記録](../bugs/BUG-20260912-dev-dependency-volume.md)へ保存した。README/CONTRIBUTINGは2〜3で更新されており、当時の指摘をすべて未修正と扱わない。
- チケット2: 本番E2Eが共通loaderを迂回していた点と、cleanup失敗が成功扱いになる点を修正。テストharness成功と実際のproduct経路を区別する必要がある。
- チケット3: stop時gain ramp、ready待機、重複startの競合を独立レビューで修正。ユーザーが音量を上げて基準音を確認した発言はあるが、全環境の聴感合格とは扱わない。
- チケット4: StrictModeを有効にするだけではremountの直接証明にならず、観測を追加。テスト数と記録の不一致も修正。
- チケット5: presetがparse成功するだけでは720°/角0°の直接検証にならず、assertionを追加。
- チケット6: 派生数値の非有限化と長すぎるadvanceを修正。有限入力だけで中間値の安全性を保証しないこと、失敗時の状態を明示することをレビュー指示へ追加。

証拠不足をレビューが検出している点は良好だが、4/5で似た指摘が繰り返したため、reportにテストfile/caseと実assertionを対応付ける指示を強めた。レビュアー設定も同じ観点を補足した。モデルを一律に上位へ変更する根拠はない。

親のmake ci要求は1〜5で各2回、6で4回あった（tool入力の集計であり、成功した全CIの回数ではない。6には権限拒否と整形エラーが含まれる）。2/5などでは実装後の全CIに続き、結果を記したreport-only commit後にも全CIを実行している。証跡だけの追記には文書/catalog検査と履歴秘密検査を実施し、以前の全CI対象revisionと区別して記録する方式へ変更した。最終headのGitHub必須CIは維持する。

セッションの総入力tokenにはcache済み履歴の再入力が多く含まれるため、その値だけで費用や利用枠消費を断定しない。同条件の単一agent比較もないため、最適なコストとは断定しない。

## 後続チケットへの反映

| チケット | 具体化した事項                                                                      |
| -------- | ----------------------------------------------------------------------------------- |
| 7        | 角速度のsample入力、保持規則、絶対時刻/同時event順序、0 rpm、変速中のbuffer分割検証 |
| 8        | 長時間offline処理のbuffer分割、10秒advance上限の維持、状態継続                      |
| 9        | config初期化後ready、a-rate入力と1 kHz更新順、drive torqueのlimiter制御、対応範囲   |
| 11       | stopでgraphを破棄する既存方式に合わせたpending保存・次回startでack・正常構成保持    |
| 12       | loadの単位/転送方式/反映時点とチケット9の入力時刻規則                               |
| 15       | sampleRateを知らない静的validatorとNyquist制約の分担                                |
| 16       | strict schemaへのfield追加と互換性、seedのreset規則                                 |
| 17       | 測定に使う最高対応RPM/event密度の定義                                               |
| 22       | 360°は既にparse可能という前提、720°固定UI/帯表示の動的化                            |

10/13/14/18〜21/23〜24は確認した範囲で番号・依存関係の変更を必要としない。全将来実装の正しさを保証する意味ではなく、各チケット開始時に直近の契約を再確認する。多気筒化や負荷拡張そのものを今回実装しない。

## Codex設定

`.codex/config.toml`のモデル・effort・並列数は変更しない。観測結果が設定と一致しており、[公式subagents資料](https://learn.chatgpt.com/docs/agent-configuration/subagents)も役割別model/effort設定を説明している。変更は`ticket-reviewer.toml`の証跡・数値レビュー指示と実装スキルに限定した。

## 検証記録

Docker内の`npm run check`が成功（Prettier、Markdownlint、ticket catalog、tooling 9 tests、ESLint、TypeScript）。最初の実行は本レポートの表の整形で停止し、整形後の再実行が成功した。skill-creatorのquick_validateとCodex TOML parseもDocker内で成功。既存実装の新しい聴感・性能証拠はない。

独立したTerra / highレビュアーは、CIの比例再検証ルールと初期構成のack/ready順序に2件の指摘を行った。前者は実装revisionの全CIと、後続の証跡のみのrevisionに必要な検証を明確に分離した。後者はrequest id付き`config-applied`の後に同じidの`ready`を受け取るまで無音を維持し、古い応答や順序逆転を拒否する契約へ修正した。修正後の再レビューではactionableな指摘は残らなかった。
