# Selected Work v4 リレー・ショーケース — 視覚レビュー記録

Issue: rebuildup/rebuildup#8 / my-web-2026#1214
対象: `public/github-profile/showcase.webp`（800×360・8fps・28秒・
約4.0MB・シームレスループ）
生成: `pnpm profile:showcase:build`（`scripts/build-github-profile-showcase.mjs`）

## 設計（v4 リレー）

- 5 act の主役リレー: prototype → flashbeat → foldlayers → homura →
  multislicer（kosen は動きのある区間が約3秒しかないため脇役/ドック）。
- PREVIEW=次 act の MAIN、PREV=直前 act の MAIN、折り返しまで連鎖一貫。
- act 境界 0.75 秒 smoothstep。スケールチャンネルのみ因果的な先行/
  遅行（退く側が早く縮み、入る側が遅れて育つ）。作品ごとの lead
  スタッガで同時移動を分散。遷移は境界時刻に完了。
- メイン枠（アクセントボーダー）は「接近中 act の MAIN 割当」へ
  遷移終盤 45% で移管。z-order も mainBound を最前面に。
- サブ/ドックは役割スケール比例で減光（床 0.32、sub≒0.45）＋彩度
  0.75＋18% 白リム。`clips.json` の `grade` で素材ごとの輝度を
  イコライズ（暗い UI を持ち上げ・白飛び素材を抑制、主役/サブ共通）。
- 素材窓: `crop`/`offset`/`trim`/`segments`/`grade`。multislicer は
  白フラッシュ区間を segments で除去、kosen は静止 end-card を
  offset+trim で切り出し。
- ドックは 2×2・下部配置。プレートは全要素より先に描画。
- 先頭/末尾 0.35 秒の背景フェードでループ継ぎ目を構造的に解消。

## レビュー経緯（`agent review run`、全ラウンド ACCEPT WITH FIXES）

| ラウンド | 主な指摘と対応 |
|---|---|
| v7 系 1 | sharp `.composite()` 二重呼びで角丸マスク消失 → 単一 ops に統合。kosen trim、rim 10%→18%、dim 床 0.38→0.32 曲線化 |
| v7 系 2 | 遷移スタッガ・lead 導入、グレードを主役にも適用（彩度ペナルティは減光時のみ） |
| v8 | ドックを別レイヤ化して通過カードを裏に回す試行 → 大判カードがプレートに沈む major を生んだため**全要素の下に描画へ戻し**、park スロットを下部へ移動して遷移経路と分離 |
| v9 | Act5 主役を kosen→multislicer へ交代（kosen の PV は動きが約3秒のみで長い主役時間に不向き）。TRANS 0.75 |
| v10-11 | スケール先行/遅行の因果的 anticipation、mainBound への z-top/ボーダー/減光免除を導入 |
| v12 | hand-off を遷移終盤 45% に遅延（早期に駐機中の次主役がボーダーを奪う不具合を修正） |

レビュー JSON: `agent-review.json`（v17 系）、`agent-review-transitions.json`、
`review-16.json`。フレーム証跡: `t*.png`（800×360 実フレーム）。

## 客観計測

- 全 224 フレーム生成・輝度ゲート PASS（暗転/ローディング拒否）。
- kosen 要素動画のフレーム間差分 YAVG ≈ 2–58/秒（ループ境界でシーン
  カット）— レビュアーが「2.5 秒完全静止」と評価した区間も実測では
  モーションあり（静止イラスト主体の素材特性＋8fps サンプリングの
  知覚差と判断）。
- サイズ: 約 4.0MB（q70）。旧 marquee 2.9MB より増だが、作品ごとの
  サイズ/構図差とリレー構造の対価。

## 残存既知事項（正直な注記）

- 遷移中のドック周辺のカード経路は依然としてレビュー指摘が残る
  （ACCEPT WITH FIXES が 6 ラウンド連続）。settled act の構図・階層・
  350px 可読性・圧縮品質は全ラウンドで一貫して高評価。
- GitHub/Camo 実画面での最終目視は未実施（公開 README 切替ゲートで
  実施予定）。
