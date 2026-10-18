# 状態表示の色依存を検証する（Issue #411）

> 検証対象: `/` の Status セクション（`src/home/status/`）と `/portfolio` の
> カード category 表现（`src/portfolio/components/ProjectCard.tsx`）。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.4.1 Use of Color (Level A)**。参照実装は
> [colors.md §accent.\* token roles](../../../src/editorial/colors.md)。

## 何を直したか

修正前は、両 surface とも **色以外の channel で状態が伝わっていなかった**。

| surface | 修正前の状態表現 | 色を消すと |
| --- | --- | --- |
| Status badge | `ok` だけ accent 塗り、`degraded` と `unreachable` は同じ neutral 塗り | 3 状態すべて同じ角丸ピル |
| Portfolio card rule | `accent.category.<facet>` を塗った 4px の rule（4 hue × 同一形状） | 4 category すべて同じ bar |

`StateMark`（`src/editorial/primitives/StateMark.tsx`）が形状語彙を持ち（1 要素の `<span>` + `clip-path`。
inline `<svg>` は採用しない — 理由下記）、
status 3 状態は **円 / 三角 / 交叉**、category 4 種は
**菱形 / 正方形 / 横棒 / シェブロン** を使う。badge / card の既存テキストと
併せることで **shape + text の 2 channel** になり、色は補強に降格した。
マークは `aria-hidden` で、**accessible name はテキスト側の責務**のまま。

## 該当する WCAG 2.2 の項目

| 基準 | レベル | 該当箇所 | 判定 |
| --- | --- | --- | --- |
| SC 1.4.1 Use of Color | A | status badge / category rule | 適合 — 形状 + テキストの 2 channel |
| SC 1.1.1 Non-text Content | A | `StateMark` の `<span>` | 適合 — 装飾なので text alternative 不要。`aria-hidden="true"` で AT には露出しない（機械検査で確認） |
| SC 1.4.11 Non-text Contrast | AA | マーク（`currentColor` 継承）、4px rule | 適合 — 下表の測定値 |
| SC 1.3.1 Info and Relationships | A | status 行 | 適合 — 構造は変更なし（`<dl>` / `<dt>` / `<dd>`）。色を情報の符号化に使っていない |
| SC 4.1.2 Name, Role, Value | A | status / portfolio | 適合 — 新しい role / 属性は無く、mark は accessibility tree から消える |

### 非テキストコントラスト（`src/editorial/tokens.ts` の値から算出した実測）

| 要素 | light | dark |
| --- | --- | --- |
| `text.muted`（neutral badge 内の mark とラベル、`bg.subtle` 上） | 4.34 : 1 | 5.37 : 1 |
| `text.inverse`（accent badge 内の mark、`bg.accent` 上） | 5.93 : 1 | 5.93 : 1 |
| `accent.category.*` の rule（`bg.canvas` 上） | 4.92 – 7.90 : 1 | 9.87 – 14.93 : 1 |

SC 1.4.11 の下限は 3 : 1。mark は自前の色を持たず `currentColor` を継承するため、
**ラベルが満たすコントラストを過不足なく継承**する。

## 機械検査（この Issue で機械的に確認したこと）

| 検査 | 手段 | 結果 |
| --- | --- | --- |
| 3 状態 shape が相互に異なる | `src/home/status/tiles.test.tsx`（SSR markup） | pass |
| 4 category shape が相互に異なる | `src/portfolio/components/ProjectCard.test.tsx` | pass |
| shape が装飾のまま（AT に露出しない） | 同上 / Chromium `Accessibility.getFullAXTree` | pass（`image` / `graphics-symbol` ノード 0、static text に `reachable` / `degraded` / `unreachable` が出現） |
| facet 無しカードが category cue を捏造しない | `ProjectCard.test.tsx` | pass（mark 0、`data-category` 不在） |
| greyscale 化で情報が消えない | **committed WebP 自体**を decode し、全ピクセルの `r == g == b` を測定（色相を 0 にした状態の機械検査） | pass（4 枚とも非 gray ピクセル 0、最大 channel delta 1 = lossy WebP の丸めのみ） |
| lint / 境界 | `biome check` / `pnpm run architecture:check` | pass |

greyscale は「すべての状態を 1 枚に写して色だけ外す」ため、
**色が state の唯一の channel なら 2 枚が同じに見える**。
この検査はその反証になる。色覚シミュレーションではない点には注意（下節）。

## 人間の評価（機械では判定できない部分）

| 項目 | 状態 |
| --- | --- |
| greyscale フレームで 3 状態を並べたとき、shape + 語彙が即座に判別できる | 目視確認済み |
| light / dark 双方で mark の輪郭が背景から分離する | 目視確認済み（WebP 2 枚） |
| 200% zoom・縮小表示（360px 1 列）での可読性 | 目視確認済み（`status-states.webp`） |
| 色覚シミュレーション（deuteranopia / protanopia）による実機確認 | **未実施**（環境に simulator がない。上の greyscale は近似であり代替ではない） |
| Windows High Contrast（`forced-colors: active`）での実機確認 | **未実施**。mark は `currentColor` なので forced colors でも形は残るが、実機確認は別 Issue |
| スクリーンリーダー実機（NVDA / VoiceOver）での読み上げ | **未実施**。AT 側は Chromium の accessibility tree で確認済み（name がテキスト由来、mark は不在） |

## スクリーンショット

| ファイル | 内容 | 環境 | 合否 |
| --- | --- | --- | --- |
| `status-monochrome.webp` | Status 3 状態を 1 枚にまとめた greyscale | Storybook fixture 相当の静的 render / Chromium 1400×900 @2x / `colorScheme: light` | ✅ 3 状態が形状で判別可能 |
| `status-monochrome-dark.webp` | 同上（dark appearance） | 同上 / `colorScheme: dark` | ✅ |
| `status-states.webp` | 正常 / 失敗 / 空 snapshot / 縮小幅（360px） | 同上 / light | ✅ 空 snapshot も `unreachable` の形と語になる |
| `category-monochrome.webp` | 4 category の card を greyscale で | 同上 / light | ✅ 4 種が形状で判別可能 |
| `category-monochrome-dark.webp` | 同上（dark） | 同上 / dark | ✅ |
| `category-appearance.webp` | 同一 4 card の通常表示（色あり） | 同上 / light | 参考（色 Removed 前の対比用） |

## 再現手順

fixture 自体は Storybook に置いてある（`pnpm run build-storybook` でコンパイルされる）。

- `home/StatusTiles` → `Monochrome` / `MixedHealth` / `EmptyStatuses` / `NarrowViewport`
- `portfolio/ProjectCard` → `AllCategories` / `Monochrome` / `NoFacets`
- `Editorial/StateMark` → `Vocabulary` / `SmallSize` / `DefaultSize`

dark / light は `prefers-color-scheme` 切替なので、**1 つの story を 2 回
emulate** した（story 側を 2 つに増やしていない）。

## 既知の制約

- ローカルの Storybook dev preview はこのリポジトリで起動できない
  （Storybook 8.6 と Vite 7 の非互換。iframe が
  `@id/__x00__virtual:/@storybook/builder-vite/vite-app.js` を 404 で落とす）。
  本 Issue のスクリーンショットは同じ fixture 構成を静的 render して撮影した。
  Storybook 自体の修正は別 Issue の領域。

- **形状は inline `<svg>` ではなく CSS（`clip-path` / `border-radius`）で描画している。**
  当初 `<svg>` で実装したが、`test/fixtures/markdown-xss-fixtures.ts` は
  article 領域内の `<svg` を「実行可能 markup」として検出する（Issue #451 の
  `<svg onload>` コーパス）ため、`/portfolio` 一覧の card（1 行 = 1 `<article>`）が
  `test/integration/markdown-xss-ssr.test.ts` を落とした。セキュリティ不変条件を
  装飾のために弱める判断はしなかった。副次的に、1 要素・子要素 0 で
  per-card DOM cost も最小（+1 node）になった。
