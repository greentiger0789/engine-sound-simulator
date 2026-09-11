# チケット 10: 多気筒設定と基準プリセット

## 目標

2/3/4気筒の明示的な燃焼位相プリセットを追加し、燃焼順序、周期境界、同時燃焼を保持する config/event contract を確定する。

## 範囲 / 非対象

- 範囲: 180°/270°/360°並列ツイン、等間隔3/4気筒、multi-cylinder validator と event test。
- 非対象: 編集UI、負荷操作、音色差を作るDSP、特定実車の再現、V型/6気筒以上。

## 依存関係

5、7。作業開始前に各依存チケットの `docs/tickets/reports/NNN.md` が `Status: verified` かつ origin/main へ merge 済みであることを確認する。

## 計画参照

実装計画 §4.2、§4.4、§10 M3、§11。

## 実装契約と想定ファイル

- `src/presets/` に 720° 基準で `0,360`、`0,180`、`0,270`、`0,240,480`、`0,180,360,540` を置く。
- event の順序は cylinder id、cycle index、sample offset を保持し、同角度は有効な同時燃焼として stable に返す。
- preset metadata は実車測定値でない「モデル値」を示す。気筒数は配列長だけから求める。

## 受け入れ基準

- 各 preset の1周期 event 間隔が順に `360/360`、`180/540`、`270/450`、`240/240/240`、`180/180/180/180` となる。
- 周期境界を含む interval と同時燃焼が unit test で確認される。
- 既存単気筒の event regression が成功する。

## Docker 検証

- **既存:** `make test`、`make ci`。
- **追加なし:** preset/event tests を既存 Vitest に加える。

## 並行作業案

preset data と boundary/event test matrix は分割可能。config 型の変更は ticket 11 より先に統合する。

## 手動証跡

不要。各 preset の角度と interval 表を PR/report に記録する。

## 完了報告と聴感

自動受け入れの結果を `reports/010.md` に残す。聴感確認は任意で、このチケットの依存解除条件にしない。
