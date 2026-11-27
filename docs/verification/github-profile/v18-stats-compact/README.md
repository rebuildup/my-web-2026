# v18 — 統計 surface 圧縮再設計の before/after 記録（Issue #1240 継続）

v17 の ALL 主表示化で vitals+top-languages 合計高さが desktop
244→388px / mobile 256→460px に増加した問題への対応。情報は維持し、
意味グループ・モチーフ・数値階層で情報構造を再編した。

## 画像

- `cmp-{dark,light}-{desktop,mobile}.png` — BEFORE（公開 v0.15.2、
  左）| AFTER（本ブランチ、右）。
- `vitals-*.png` / `top-languages-*.png` — AFTER 単体 8 点
  （実本番 snapshot、dark/light × desktop/mobile）。

## 実測（viewBox 高さ）

| surface | v0.15.2 desk/mob | v17 desk/mob | v18 desk/mob |
|---|---|---|---|
| `/vitals` | 152/144 | 236/228 | **196/188** |
| `/top-languages` | 92/112 | 152/232 | **144/204** |
| **合計** | **244/256** | **388/460** | **340/392** |

v17 比で desktop −48px / mobile −68px。公開版比では情報量
（参加スコープ + 3 バー構成）に見合う +39%/+53% に圧縮。

## 構造変更

- `/vitals`: 6 指標を意味で 2 グループ化 — consistency
  （streak/contributions、広セル）→ output（commits/PRs/issues/
  stars、4 セル 1 行）。PARTICIPATED スコープは独立 metric row を
  廃止し `git-fork` アイコン + 1 行 muted テキスト
  （`28 contributed projects · 53,144 stars`）に — レーンの空白と
  stars 指標の混同を解消。未計測時は行ごと非表示。
- `/top-languages`: hero（ALL REPOS 結合バー + 凡例）は維持、
  OWNED/PARTICIPATED 副バーの air を「ブロック間（凡例→次
  kicker）」へ再配分し kicker→bar を統一。mobile は積みのままだが
  各ブロックを ~12px 圧縮（144→204 の内訳: hero ~80 + 副バー
  2×~60）。
- `metricStrip` に `perRow` オプション追加（従来 3 固定）。
  `/profile` 合成カードの METRICS 順は commits/PRs/issues/stars に
  並び替え（同一情報・グルーピング改善、3+3 グリッド維持）。

## データ契約の修正

`docs/domain/github-profile-data.md` §3.2: `repos.participated`
（実績計測）と `metrics.contributedTo`（GraphQL affiliation）は
**定義の異なる別集計**であり、件数一致（ともに 28）は母集団同一性の
証明にならない旨を明記。コード変更量の言語別計測は Issue #1267
へ分離。request 時上流取得の残件（top-langs/streak/pin）と
stats card cold-start 503 は Issue #1268 へ整理。
