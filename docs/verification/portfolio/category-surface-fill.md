# portfolio カードのカテゴリ提示を「左バー」から「面の塗り + 形状 + 語」へ

Issue #794。owner 判断（2026-11-01）は

> portfolio の左バー（識別子の左端カラーバー）は消す。border も残せない。面の区別は塗りで行う。

で、この記録はその判断後の実描画を **before / after の両方**で測ったものである。
対象は `src/portfolio/components/ProjectCard.tsx`。

## 1. 何を測ったか

| 項目 | 値 |
| --- | --- |
| 対象 surface | `ProjectCard`（`/portfolio` 一覧の 1 行 = 1 `<article>`） |
| 描画元 | `src/portfolio/components/ProjectCard.stories.tsx` の `AllCategories` / `Monochrome`（synthetic placeholder。実在の project ではない） |
| 条件 | 1440×900 / 390×900 × light / dark、および greyscale proof の 2 条件 |
| ブラウザ | Chromium（`@playwright/test`、`deviceScaleFactor: 1`、`colorScheme` を条件ごとに指定） |
| 配信 | loopback のみの静的サーバ（`file://` では ES module を読めないため） |
| 再生成 | `node scripts/capture-project-card-category-bar.mjs --label=before|after` |

`before` は changed tree では撮れないので、次の手順で取得した（スクリプト冒頭にも書いてある）。

```sh
git stash push -- src/portfolio/components/ProjectCard.tsx src/portfolio/components/ProjectCard.stories.tsx
node scripts/capture-project-card-category-bar.mjs --label=before
git stash pop
node scripts/capture-project-card-category-bar.mjs --label=after
```

スクリプトは単なる撮影ではなく **assertion** である。`--label=after` は
「絶対配置の装飾が 0」「inline-start border が 0」「面の塗りが canvas と異なる」
「4 カテゴリが 4 種類の `StateMark` と語を持つ」を満たさなければ失敗し、
`--label=before` は逆に「絶対配置の装飾がちょうど 1 個で、その class に
`accent.category.*` が入っている」ことを要求する。ラベルと実体がずれた撮影は
**失敗する**ので、before / after が同じ絵の二重投稿になることはない。

## 2. 実測（computed style、1 条件 = 4 カード。値は 4 枚で同一）

| | 絶対配置の装飾 | バー幅 | バーの `background-color` | カードの `background-color` | `border-inline-start-width` |
| --- | --- | --- | --- | --- | --- |
| before / 1440 light | **1 個** | 4.00 px | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 px |
| before / 1440 dark | 1 個 | 4.00 px | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 px |
| before / 390 light | 1 個 | **0.00 px** | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 px |
| before / 390 dark | 1 個 | 0.00 px | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 px |
| **after / 1440 light** | **0 個** | — | — | `rgb(248, 250, 252)` = `bg.surface` | 0 px |
| **after / 1440 dark** | **0 個** | — | — | `rgb(17, 19, 23)` = `bg.surface` | 0 px |
| **after / 390 light** | **0 個** | — | — | `rgb(248, 250, 252)` | 0 px |
| **after / 390 dark** | **0 個** | — | — | `rgb(17, 19, 23)` | 0 px |

面の段差（カードの塗り vs ページ canvas、WCAG の比として記録）:

| 条件 | カード | canvas | 比 |
| --- | --- | --- | --- |
| light | `rgb(248, 250, 252)` | `rgb(255, 255, 255)` | **1.046 : 1** |
| dark | `rgb(17, 19, 23)` | `rgb(10, 11, 14)` | **1.058 : 1** |

この比は **テキストのコントラストではない**（SC 1.4.3 / 1.4.11 の対象ではない）。
「面が地から一段上がっている」ことだけを示す値で、`bg.surface` が現行 token で
持てる唯一の raised plane である。より強い段差は #764 の token 実装（canvas と
surface の再設計）で決まる話で、この PR は raw color を足さない。

## 3. 分かったこと: 左バーは**塗られていなかった**

before の computed style は、バーの `background-color` が light / dark の
どちらでも `rgba(0, 0, 0, 0)` であることを示す。class は
`bg-c_accent.category.design` 等が付いているが、**ビルド後の CSS にその
utility の規則が存在しない**。

```text
# ビルド成果物の CSS にあるもの（/design-system の静的 class から生成）
.bd-s-c_accent\.category\.design{border-inline-start-color:var(--colors-accent-category-design)}
# ないもの
.bg-c_accent\.category\.design{…}
```

原因は Panda の静的抽出である。元の実装は

```tsx
backgroundColor: category ? `accent.category.${category}` : 'transparent',
```

と **文字列補間で token path を組み立てていた**ため、抽出器は
`accent.category.*` を 1 つも観測できず、utility を生成しない。実行時の
`css()` は class 名だけを返すので、要素は 4px 幅で存在するが透明だった。

つまり:

- 本番で「4 色の左バー」として見えていたものは **存在しない**（DOM ノードと
  class 名だけがあった）。この削除による**見た目の後退は 0**。
- この Issue の判断（バーを消し、面の塗りで区別する）は、実際に塗られていた
  場合と比べても変わらない。塗りは after で初めて実体を持つ。
- `/design-system` の `StatusAccents` はカテゴリごとに**静的な**クラス名を
  書いているため、こちらは実際に塗られている。同じ「左バー」でも
  `ProjectCard` だけが無色だった。

## 4. 色以外の経路（壊してはいけないもの）

Issue #411 の結論（形 + 語で読める）は維持している。after の 4 カードは
それぞれ `data-state-mark` が `design` / `code` / `tool` / `writing` の 1 個ずつで、
語（`Design` / `Develop` / `Video` / `Other`）を併記する。色をすべて外した
greyscale フレームでも、この 2 経路はそのまま残る。

スクリプトは before / after の両方で「4 カードが 4 種類の mark を持つ」
「各カードに語がある」を検査している。バーを消すついでに mark を落とす変更は
`--label=after` で落ちる。

## 5. スクリーンショット（すべて WebP）

`docs/verification/portfolio/` 配下。12 枚（before / after × 6 条件）。

| ファイル | 内容 |
| --- | --- |
| `project-card-category-before-desktop-light.webp` / `-dark` | 1440、変更前（左端に DOM ノードはあるが色は無い） |
| `project-card-category-before-mobile-light.webp` / `-dark` | 390、変更前（バー幅は 0） |
| `project-card-category-before-monochrome-light.webp` / `-dark` | greyscale proof、変更前 |
| `project-card-category-after-desktop-light.webp` / `-dark` | 1440、変更後（面の塗り + mark + 語） |
| `project-card-category-after-mobile-light.webp` / `-dark` | 390、変更後 |
| `project-card-category-after-monochrome-light.webp` / `-dark` | greyscale proof、変更後 |

各ファイルは 20–28 kB（上限 300 kB）。PNG は生成後すぐ削除し、リポジトリには
入れていない。

## 6. この記録が示していないこと

- 色覚シミュレーション（deuteranopia / protanopia）の実機確認は**未実施**。
  greyscale は近似であって代替ではない（#411 と同じ制約）。
- Windows High Contrast（`forced-colors: active`）の実機確認は**未実施**。
  mark は `currentColor` なので形は残るが、実機確認は別 Issue。
- 面の段差 1.046 : 1 は、light では目視でほぼ分からない。これは
  `bg.surface` の現行値の性質であり、強めるかどうかは #764 の token 判断。
- `/portfolio` 実 route ではなく story fixture を撮っている（ローカルの D1 が
  空で一覧が 0 件になるため）。fixture は実在 project を装わない placeholder で、
  card の描画経路は本番と同じ `ProjectCard` である。
