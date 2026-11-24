# GitHub プロフィール README デザイン記録（Issue #1196 / rebuildup/rebuildup#5）

v0.11.3 の単一カード構成（ADR-0024）を撤回し、`github.com/rebuildup`
の README 全体をセクション構造で再設計した記録。配信側の契約は
`docs/adr/ADR-0025-github-profile-assets.md`、旧カードの契約は
ADR-0024（deprecated）が正本。

## 1. 媒体としての制約（GitHub README の実測に基づく）

- カスタム CSS・`style` 属性・`class` はサニタイズされる。使える
  レイアウト手段は Markdown・`<img width>`・`<table>`・
  `<div align>`・`<sub>` 程度。
- 画像は Camo プロキシ経由の `<img>` として配信される。SVG を
  `<img>` で読む場合、外部サブリソースも data URI 以外の参照も
  読めない（ADR-0024 §2.1）。
- `<table>` はモバイルで縮まず、セル内画像は `width="100%"` で
  セル幅に追随する。列数を増やすほどモバイルのサムネイルは小さく
  なる — 「作品を十分な大きさで見せる」要求と直接トレードオフ。
- Pinned repositories と Contribution Graph は GitHub 標準で
  README の下に自動表示される。README 側で repo 一覧や草を
  再現すると重複になるため、README は「人物・作品・現在」の
  3 役割に絞る。

## 2. 検討した構造案

実素材（公開 portfolio の isCover ラスタ、最大 1200px WebP
~10–120KB/枚）を使い、GitHub が実際に受け付けるマークアップだけで
4 案を作成し、デスクトップ（830px）・モバイル（360px）で実
レンダリングした。スクリーンショットは
`docs/verification/github-profile/` に保存。

| 案 | 構造 | 画像数 | desk 高さ | mob 高さ | 評価 |
| --- | --- | --- | --- | --- | --- |
| A `a-grid` | hero 2 枚 + 4 列モザイク + Now | 7 | 772px | 506px | コンパクトだがモバイルで 4 列サムネイルが ~80px と小さく作品の訴求が弱い |
| B `b-index` | 縦リスト型（サムネイル+テキスト行） | 7 | 652px | 1276px | 一覧性は高いがモバイルで縦に伸び、作品が「行」になりビジュアルの主役にならない |
| C `c-hero` | 大 hero + カテゴリ別 4 列 ×2 + Now | 10 | 1056px | 653px | 媒体別分類は分かりやすいが画像 10 枚で転送量最大、AE ツールの正方形カバーを 4/3 に潰す構図が作品の個性を損なう |
| D `d-final` | hero 1 枚 + 4 列モザイク + Now | 6 | 969px | 635px | A の改良。hero で主従を作ったが 4 列のモバイル問題は残る |
| **E `e-final`（採用）** | hero 1 枚 + 2×2 グリッド + Now | 6 | 1467px | 835px | 作品が desk ~400px / mob ~160px と十分な大きさ。情報密度より作品の見せ方を優先 |

### 採用案 E の構成

```
After Effects tools · Web apps · Motion design
Website · Booth · X dev · X design          ← 最小リンク行

## Selected work
  ┌──────────────────────────────────────┐
  │  hero: my-web-2025（中央、幅720px）    │
  │  + 作品名キャプション（個別リンク）     │
  └──────────────────────────────────────┘
  ┌─────────┬─────────┐
  │multislicer│ seishun │   ← 2×2、各作品が個別リンク
  ├─────────┼─────────┤
  │kosen-fes│pomodoroom│
  └─────────┴─────────┘
  <sub>全作品 → rebuildup.dev/portfolio</sub>

## Now
  <status strip: GitHub activity + Discord presence>
```

## 3. 採用判断の根拠

- **作品の主役化**: 要求の中心は「実際の制作実績を一目で」。
  A/D の 4 列モザイクはデスクトップでは成立するが、GitHub
  プロフィールの主要流入であるモバイルで ~80px まで縮み、
  作品の視覚的個性（映像作品の構図、Web アプリの画面）が
  失われる。E の 2×2 はモバイルでも ~160px を確保する。
- **hero の役割**: `my-web-2025`（このサイト自身）を hero に
  置くのは「何を作っている人か」の最短回答になる。映像作品
  （seishun）は grid で十分な大きさを持つ。
- **B を退けた理由**: テキストリストは CV 的で分かりやすいが、
  「ビジュアルデザインから再構築」の要求に対し作品画像が
  従属要素に留まる。モバイル高さも最大。
- **C を退けた理由**: 10 枚は Camo フェッチ数・転送量ともに
  最大で、カテゴリ分け（Tools & apps / Motion & web）の境界が
  実際の作品分類（AE ツール・Web アプリ・映像・Web デザイン）
  と一致せず、かえって探しにくい。
- **転送量**: E の作品画像は最適化 WebP 5 枚で計 ~250KB、
  status SVG は ~5KB。旧カード 1.23MB より 1/5 以下。

## 4. 作品選定

`src/http/github-profile/works.json` が正本。選定基準:

- 公開 portfolio（published + public）に実在し、isCover の
  ラスタメディアを持つこと
- 媒体の多様性: Web プラットフォーム（hero）/ AE ツール /
  映像作品 / Web デザイン / Web アプリ
- 商用・顧客案件は公開面で既に公開済みのもののみ

`FEATURED_SLUGS`（model.ts、旧カード用）とは独立。旧カードは
deprecated のため選定を共有しない。

## 5. 動的ステータスの分離

作品画像（静的・ほぼ不変）と GitHub activity / Discord presence
（数分〜15 分鮮度）は更新頻度が異なるため、`Now` セクションに
独立した SVG（`GET /api/v1/github-profile/status`、数 KB・
ラスタなし）を置く。画像内に観測時刻を描く契約は ADR-0024 から
継承し、stale / unavailable を偽装しない。

## 6. 残課題・運用

- 作品の増減は `works.json` + `build-github-profile-works.mjs`
  の再生成 + README の表更新で行う（runbook 参照）。
- 掲載作品と portfolio 公開状態の整合は `works.test.ts` が
  fail-closed で検証する。
- Camo のキャッシュ特性・実画面検証はリリース後に
  `docs/runbook/github-profile-card.md` の手順で実測する。

## 7. v2 再設計（Issue #1204 / #1205 / rebuildup/rebuildup#8）

v0.13.0 の「hero + 2×2 グリッド + status」は、Selected Work の
縦占有・status の視認性・テキスト主体の自己紹介が課題となり、
rebuildup/rebuildup#8 のレビューで**単一リール構成をベースに全面
再設計**が決定した（案Bの2×2アニメタイルは不採用）。

- **作品リール**: `reel.webp`（animated WebP 560×315@4fps）1本が
  5作品の公開 YouTube 映像を巡回。縦横比は crop/blur 構図で吸収、
  先頭フレーム輝度ゲートでローディング/暗転を排除。GIF 比較は
  約1.7倍の容量で WebP 採用。生成は `profile:reel:build`、
  公開境界は snapshot の published+public 解決で fail-closed。
- **スキルアイコン**: tandpfun/skill-icons（MIT）を自前ホストの
  静的 SVG として配信（描画システムは自作しない）。
- **統合 now**: `/api/v1/github-profile/now` が contributions /
  streak / top language / activity / Discord を1枚の SVG に統合。
  カード4枚の横並びは不採用。`/status` は互換のため残す。

## 8. v3 全面再設計（rebuildup/rebuildup#8、ADR-0026）

v2（リール + 8 アイコン + 統合 `/now`）は不採用。旧 STATUS のグラフ・動き・
独立更新を回復しつつ、ゼロから再設計した。

- **作品**: 単一リールを廃止し、`clips/<slug>.webp` の animated WebP
  タイル 9 点を 3 列グリッドで同時視認。Web アプリ・AE ツール・
  ツール・映像・UI の領域を混在させた。全フレーム輝度ゲート付き。
- **活動**: `/api/v1/github-profile/activity` がリポジトリ別活動バー +
  公開 feed を 1 枚の SVG で返す。時刻は Asia/Tokyo、観測スタンプは UTC。
- **Presence**: `/api/v1/github-profile/presence` が独立チップを返す。
  activity と別レスポンス・別キャッシュ。
- **スタック**: 旧 48 技術ツリーを起点に 48 技術の light/dark アイコン。
- **比較**: A=3×3 グリッド + 活動カード案を採用（B=スポットライト案は
  1 作品への偏りで不採用）。デスクトップ/モバイル・ライト/ダークの
  実レンダリング比較は `.tmp/profile-design/` のモックと
  `shots/` スクリーンショット、および本節のプロトタイプ評価を参照。

## 9. v3.1 修正（2026-11-24、レビュー指摘対応）

- **Selected Work**: 3×3 クリップグリッドは「動く一覧」であり要求の
  スライドショーではないとして不採用。`showcase.webp`（480×680 縦
  マーキー、6fps・18秒ループ・約2.9MB）に変更 — 作品タイルが
  セル状に常時上スクロールし、複数作品が常に同時視認・静止
  フレームなし・シームレスループ。個別リンクは README の
  テキスト一覧が担う。
- **Activity**: バーが events・見出しが commits だった意味論不一致を
  `EVENTS BY REPOSITORY` に修正。観測スタンプも JST に統一
  （presence チップ同様）。
- **スキル照合**: 旧 48 技術（my-web-2025 `skillRows`）と掲載アイコンを
  全件照合した結果、48 技術すべてが対応アイコンとして存在する
  （`C#`→`csharp`、`C++`→`cpp`、`Go`→`golang`、`tailwind css`→`tailwind`、
  `Adobe XD`→`xd` 等の命名差のみで欠落なし）。使用実績は my-web-2026 の
  依存関係と portfolio `technologies` メタデータと照合済み。
- **証跡**: レンダリング結果とレビュー用フレームを
  `docs/verification/github-profile/v4/` にコミットし PR から参照可能にする。

## 10. v3.2 修正（2026-11-24、レビュー第2弾対応・Issue #1214）

縦マーキー（v3.1）も「均一タイルの単調スクロール」として不採用。
横長・高さ抑制の **シーン構成モーションコラージュ** へ再設計した。

- **比較**: 実素材のプロトタイプ2案（A=常時ドリフトコラージュ、
  B=シーン構図+斜めマスク遷移）を生成・比較し B を採用。
  証跡は `docs/verification/github-profile/v5/`。
- **採用構成**: `showcase.webp`（800×360@8fps、約21秒、約2.9MB）。
  4 シーン + ループバックを斜めワイプ（xfade diagtl/diagbr/
  diagtr/diagbl 巡回）で接続。シーンごとに hero/脇役のサイズ・
  構図・尺が異なり（hero+脇役、左右分割、3作品トリオ、全高
  hero+脇役）、hero は Ken Burns push-in、脇役は位相の異なる
  正弦ドリフト。ループ継ぎ目は先頭/末尾の背景色 bookend フェード
  で構造的にシームレス化。
- **定義**: `showcase.json` を schema v2（scenes/items/wipes/
  loopBack）へ更新。生成は `profile:showcase:build`、
  `--review` で全編サンプルフレームを書き出せる。
