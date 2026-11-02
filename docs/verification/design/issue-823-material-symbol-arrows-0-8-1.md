# 操作の手がかりの文字記号（→ / ×）を Material Symbols に置き換える（0.8.1 / Issue #823）

作成: 2026-11-03
対象: `src/home/hero.tsx`、`src/home/composer.tsx`、`src/home/capabilities/grid.tsx`、
`src/home/current/CurrentProjects.tsx`、`src/about/components/AboutPage.tsx`、
`src/editorial/forms/Field.tsx`、`src/editorial/primitives/MaterialSymbol.tsx`
根拠: owner 指示（2026-11-01、#767 の Q3）「文字で描いた記号をやめ Material Symbols へ」

## 1. 何を直したか

`MaterialSymbol`（#785 で実装済み、`arrow_forward` 込み）が使われていたのは
`/tools` の行アイコンだけだった。**操作の手がかり**（リンクの矢印・エラー印）は
今も文字（`→` / `×`）で描かれていたので、描画された glyph に置き換えた。

| 場所 | before | after |
| --- | --- | --- |
| `src/home/hero.tsx` | `About me / 自己紹介 →` / `GitHub でソースを見る →` | `<MaterialSymbol name="arrow_forward" size={18} />` |
| `src/home/composer.tsx` | `<span aria-hidden="true">→</span>` | 同上 (18px) |
| `src/home/capabilities/grid.tsx` | `<span aria-hidden="true">→</span>` | 同上 (16px) |
| `src/home/current/CurrentProjects.tsx` | `<span aria-hidden="true">→</span>` | 同上 (16px) |
| `src/about/components/AboutPage.tsx` | -hero rail の `identity → interests → …`（4 文字）、Current 節の行頭 `→`（4 個）、本文リンクの `→`（1 個） | すべて `arrow_forward`（12px / 12px / 16px） |
| `src/editorial/forms/Field.tsx` | エラー印の `<span aria-hidden="true">×</span>` | `<MaterialSymbol name="close" size={14} />` |

### 1.1 glyph の追加は 1 つだけ

`MaterialSymbol` に追加したのは `close`（フォームのエラー印）だけ。出典 URL を
コメントに引用したうえで path をそのまま貼った（Apache-2.0、
<https://github.com/google/material-design-icons>）。`arrow_forward` は既存の
実装を再利用しただけで、glyph の集合を闇雲に増やしていない。

### 1.2 glyph の path データは「消費側ごとに 1 モジュール」に分けている

`MaterialSymbol` は glyph 名を受け取るのではなく、path データ（`d`）を **prop**
として受け取る。path データは 2 モジュールに分けている。

| モジュール | glyph | 到達範囲 |
| --- | --- | --- |
| `src/editorial/primitives/material-symbol-paths.ts` | `arrow_forward` / `close` | プラットフォーム自身の面（entry shell から到達） |
| `src/editorial/primitives/material-symbol-tool-paths.ts` | Tools index 専用 16 glyph | `src/routes/tools.index.tsx` のみ（route chunk に落ちる） |

理由: entry shell と route chunk の両方から import されるモジュールは
「import 者の最小共通祖先」= entry chunk に hoist される。1 つの表に全部の
glyph を入れてしまうと、entry が描かない ~6.4 KB の path データが全 route の
first paint に入り、per-route JS budget（Issue #482）を超えた（この PR の
1 回目の CI 失敗がその実測）。`d` を prop にして、消費側ごとにモジュールを
分けたことで、entry shell は 625.0 KiB → **618.7 KiB** に下がり、全 18 route が
budget 内に戻った。**budget の数値は変更していない。**

### 1.3 primitive 側で行った 1 つの変更

Panda の preflight（`reset` layer）が `svg { display: block }` を宣言しているため、
本文の中に置く glyph（`/about` の hero rail）は行の中でブロックになり、語が
1 行ずつ縦に潰れていた。`MaterialSymbol` 自身に `display: inline-block` を持たせ、
flex コンテナの中で使われる場合は（flex item として）従来と同じ表示のままとした。
`/tools` の既存アイコン（17 個）の表示は変わらない（before / after とも SVG 17）。

### 1.3 アクセシビリティ

- すべての glyph は `aria-hidden="true"`（`MaterialSymbol` が常に付与する）。
  意味はリンクの文言が持ち、リンクのアクセシブル名は変わらない。
- テキストから消えるのは記号だけ（`→` が消える、文言は残る）。
- `/about` の hero rail は元から `aria-hidden="true"` の領域なので、rail 内の
  記号を glyph に替えても読み上げられる名前は変わらない。

## 2. 実測

### 2.1 方法

- 自分の worktree（`/Users/rebui/work/my-web-2026.823`、branch `823`、base
  `release-0-8-1` @ `4778028c`）で **port 3303** の dev server を立てて測定した。
  `:3000` は使っていない。
- Playwright（`@playwright/test` 1.63）Chromium、`colorScheme: light`、
  `reducedMotion: reduce`、viewport 1440×900 と 390×844。
- `textArrows` は **DOM のテキストノード** に現れる `→` の文字数
  （`document.body` を text walker で走査して数えたもの）。`textCrosses` は
  同じく `×` の文字数。SVG は `document.querySelectorAll('svg').length`。
- 横はみ出しは `documentElement.scrollWidth - clientWidth`。
- before は同じ dev server の変更前のビルド、after は変更後。

### 2.2 文字記号と SVG の数

| route | viewport | textArrows before → after | textCrosses before → after | SVG before → after | 横はみ出し before → after |
| --- | --- | --- | --- | --- | --- |
| `/` | 1440 | 5 → **0** | 0 → 0 | 10 → 15 | 0 → 0 |
| `/` | 390 | 5 → **0** | 0 → 0 | 10 → 15 | 0 → 0 |
| `/about` | 1440 | 9 → **0** | 0 → 0 | 0 → 9 | 0 → 0 |
| `/about` | 390 | 9 → **0** | 0 → 0 | 0 → 9 | 0 → 0 |
| `/portfolio` | 1440 / 390 | 1 → 1 | 0 → 0 | 0 → 0 | 0 → 0 |
| `/tools` | 1440 / 390 | 0 → 0 | 0 → 0 | 17 → 17 | 0 → 0 |
| `/contact` | 1440 / 390 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `/projects/dotfiles` | 1440 / 390 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `/design-system` | 1440 / 390 | 12 → 12 | 3 → 3 | 9 → 9 | 0 → 0 |
| `/keyboard` | 1440 / 390 | 5 → 5 | 0 → 0 | 0 → 0 | 0 → 0 |

`/` の 5 → 0、`/about` の 9 → 0 が受け入れ条件。`/` の SVG が +5（hero 2 +
capabilities 2 + contact CTA 1）、`/about` が +9（rail 4 + Current 4 + 本文リンク 1）。

### 2.3 フォームのエラー印（`Field`）

| 項目 | before | after |
| --- | --- | --- |
| エラー印の要素 | `<span aria-hidden="true">×</span>` | `<svg aria-hidden="true">`（Material Symbols `close`） |
| テキストノードの `×` | 1 | **0** |
| エラー段落の SVG 数 | 0 | 1 |
| エラー段落の高さ | 22.39 px | 22.39 px（不変） |

`/admin/login` などで実際にエラーを発生させる経路はないため、Field を
エラー状態で 1 つだけ描画する確認用 route を検証中だけ置き、測定後に削除した
（成果物には残していない）。

### 2.4 CTA の高さ・幅（`/` と `/about` のリンク）

| リンク | viewport | 高さ before → after | 幅 before → after |
| --- | --- | --- | --- |
| `/about`（About me / 自己紹介） | 1440 / 390 | 40 → 40 | 203.92 → 210.31 |
| GitHub（でソースを見る） | 1440 | 40 → 40 | 193.67 → 195.67 |
| GitHub（でソースを見る） | 390 | 24 → 24 | 193.67 → 195.67 |
| `/portfolio`（→Portfolioを開く） | 1440 / 390 | 21 → 21 | 294.67 → 294.67 |
| `/tools`（→Toolsを開く） | 1440 / 390 | 21 → 21 | 294.67 → 294.67 |
| `/contact`（Contact を見る） | 1440 / 390 | 40 → 40 | 168.11 → 170.11 |
| `/keyboard`（キーボード配列 / Keyboard） | 1440 / 390 | 39 → 39 | 230.83 → 232.83 |

高さは全リンクで不変。幅は glyph が文字より少し広いため 2–6 px 増えるが、
はみ出しは 0 のまま（1440 / 390）。

## 3. 置き換えていない記号（意図的な残し方）

| 場所 | 記号 | 理由 |
| --- | --- | --- |
| `/design-system` の説明文 | `color → typography → spacing` ほか 12 文字、`×` 3 文字 | 手順・記法の一部。Issue #823 の「置き換えない」に明記されている |
| `/portfolio` の empty state | `→` 1 文字 | Issue #823 の対象ファイル一覧に含まれない |
| `/keyboard` の凡例 | `→` 5 文字 | キー操作の説明記法（`Space 長押し → HUB` ほか） |
| `/about` の外部ハンドル | `↗` | `→` / `×` 以外の記号。glyph を 1 つ追加する判断は owner 領分なので今回は触らない |

## 4. スクリーンショット（WebP / PNG なし）

| file | 内容 |
| --- | --- |
| `issue-823-home-1440-before.webp` / `-after.webp` | `/`（全ページ、1440） |
| `issue-823-home-390-before.webp` / `-after.webp` | `/`（全ページ、390） |
| `issue-823-about-1440-before.webp` / `-after.webp` | `/about`（全ページ、1440） |
| `issue-823-about-390-before.webp` / `-after.webp` | `/about`（全ページ、390） |
| `issue-823-field-error-1440-before.webp` / `-after.webp` | Field のエラー状態（1440） |
| `issue-823-field-error-390-before.webp` / `-after.webp` | Field のエラー状態（390） |

撮影は sharp で WebP（quality 82）へ変換している（PNG は repository に残して
いない）。撮影前に `[data-testid="analytics-consent"]` の同意帯を DOM から
外している（製品コードは変更していない）。

## 5. 自動テスト

- `src/home/current/CurrentProjects.test.tsx` — リンクの矢印が
  `<span aria-hidden="true">→</span>` ではなく SVG であること、HTML に `→` が
  残っていないことを検証する形へ更新。
- `src/editorial/forms/forms.test.tsx` — Field のエラー印が SVG であり、
  マークアップに `×` が残っていないことを検証するテストを追加。

## 6. bundle budget（Issue #482）

`pnpm run build` → `pnpm run bundle:budget:check` を同じツリーで実行した実測。

| build | client entry shell | 判定 |
| --- | --- | --- |
| `ba4f2e8e`（path データ 1 モジュール版） | 625.0 KiB | **17 route OVER** |
| 本commit（消費側ごとに path モジュールを分割） | **618.7 KiB**（633,558 B） | **18 route すべて ok** |

分割後、entry chunk に `arrow_forward` と `close` 以外の glyph path は含まれない
（built asset を直接 grep して確認: `motion` / `keyboard` / `menu_book` /
`palette` / `mic` の path はいずれも entry には不在、Tools index の chunk
`tools.index-*.js` にのみ存在）。共有 path は 196 B の独立 chunk
（`material-symbol-paths-*.js`）に落ちる。budget の閾値は変更していない。
