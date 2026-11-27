# v17 — 統計 surface 精査の before/after 記録（Issue #1262 / #1264）

`/vitals` と `/top-languages` の統計表示改善（参加スコープの可視化、
Top Languages の ALL 主表示化）の変更前後記録。対象はこの 2 surface
のみ — `/profile` 合成カード・他 surface は不変。

## 画像

- `cmp-{dark,light}-{desktop,mobile}.png` — BEFORE（公開 v0.15.2、
  左）| AFTER（本ブランチ、右）を 1 枚に並べた比較。各行が
  vitals / top-languages の順。
- `vitals-*.png` / `top-languages-*.png` — AFTER の単体レンダリング
  8 点（実本番 snapshot データ、dark/light × desktop/mobile）。

## 実測（viewBox 高さ、実 snapshot）

| surface | v0.15.2 desktop | v0.15.2 mobile | after desktop | after mobile |
|---|---|---|---|---|
| `/vitals` | 152px | 144px | 236px | 228px |
| `/top-languages` | 92px | 112px | 152px | 232px |

`/vitals` は PARTICIPATED レーン 1 段分（+84px）。`/top-languages` は
ALL 主バー + OWNED/PARTICIPATED 副バー対の 3 バー構成。

## agy 独立レビュー履歴（`.tmp/review-v21/`）

- **v21（Gemini）REQUEST CHANGES**: gradient id が x 座標のみ由来で
  同一 x のバー同士がセグメントを共有する描画バグ（blocker）、
  主従階層の不在、モバイル高さ、kicker クリアランスを指摘。
- **v21r2（Claude Sonnet）APPROVE WITH FIXES 相当**: blocker 解消を
  確認。副次指摘 — OWNED バーの無名セグメント（凡例と不一致）、
  モバイルのブロック間リズム、kicker クリアランス。
- **v21r3 APPROVE WITH FIXES**: 無名セグメント解消・リズム統一を
  確認。残件は minor のみ（ヒーロー凡例の 'Other' 折返しは Rust を
  落とせないため既知のトレードオフとして維持、12px レグibility
  floor により副バー凡例はこれ以上縮小不可）。

## 主な実装判断

- `langBar` の gradient id は stop リストのコンテンツハッシュ
  （決定的・描画ごとに一意・同一バーは共有可）。
- 副バーは `sub` variant: 6px バー・top-2 言語+Other 凡例・
  タイトな行間。`langSegments(langs, named)` でバー描画と凡例が
  必ず同じ top-N を指す（無名スライスの再発防止）。
- `/vitals` PARTICIPATED レーンは colCount を狭めてアカウント
  strip と同じカラムトラック（desktop 0+4 / mobile 0+2）に整列、
  kicker は captionDy 18 でクリアランス確保。未計測時はレーン
  自体を描画しない（「参加なし」と「未計測」を区別）。
- 契約 `docs/domain/github-profile-data.md` §3.2 に冗長性排除・
  ALL 主表示の意味論・本人コード変更量の計測不能性・rank 採用
  基準（妥当性+実態適合）・stats card 503 と SWR 配信継続性を記録。
