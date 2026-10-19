# 表とコードブロックの読みやすさを検証する（Issue #407）

> 検証対象: `src/editorial/table-code.tsx`（`DataTable` / `CodeBlock` / `TableCodeFixture`）と、
> それが公開されている既存の画面 `/design-system` の 09 セクション。
> 実運用の代表例として `/portfolio/[slug]` の Markdown 本文のコードブロック
> （`src/portfolio/components/Markdown.tsx`）も同じ契約を通している。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.3.1 / SC 1.4.10 / SC 2.1.1 / SC 2.4.6**。

## 何を直したか

狭幅（375 px）で実際に失われる読みやすさは 2 つだった。どちらも
**「横にはみ出す」と「構造が伝わらない」** である。

| 観点 | 修正前 | 修正後 |
| --- | --- | --- |
| 表の名前 | `<caption>` を持たない table は、支援技術からは「無関係なセルの集合」にしか見えない | 可視 `<caption>` を持ち、同じ id でスクロール領域の accessible name になる |
| 行列ヘッダ | `scope` が無いと「今どの列の値か」が Unknown header になる | 列ヘッダは `scope="col"`、行ヘッダ列は `scope="row"`（構造として必ず出力） |
| 横スクロール | `overflow-x: auto` だけだと、スクロール先に **キーボードで到達できない**（矢印キーはページを移動する） | スクロール領域は `tabindex="0"` の名前付き `<section>`。矢印キーでその領域が動くことを Chromium で実測 |
| はみ出し | `<pre>` / `<table>` がそのままページ幅を決めると、文書全体が横スクロールする | スクロールはコンポーネント内部に閉じ込め、文書幅は常に viewport 幅（実測: `scrollWidth 375 = clientWidth 375`） |
| コードブロック | 生 `<pre>`。スクロール領域として扱われていない | `CodeBlock` も同じ契約（フォーカス可能・名前付き・内部スクロール） |

狭幅での横スクロールをコンテナ内に限定する、が本 Issue の要求の核心で、
これは「見た目」ではなく **文書スクロールが横に出ないこと** で機械検査している。

## 該当する WCAG 2.2 の項目

| 基準 | レベル | 該当箇所 | 判定 |
| --- | --- | --- | --- |
| SC 1.3.1 Info and Relationships | A | `DataTable` の `<caption>` / `scope="col"` / `scope="row"` | 適合 — ヘッダセル数と `scope` 付きセル数を Chromium で突き合わせる（fixture 4 状態すべて 100%） |
| SC 1.4.10 Reflow | AA | 両 scroll box、文書全体 | 適合 — 375 px で `documentElement.scrollWidth <= clientWidth`、あふれは領域内のみ |
| SC 2.1.1 Keyboard | A | 両 scroll box（`tabindex="0"`） | 適合 — 各領域にフォーカスして `ArrowRight` を送り、`scrollLeft` が進むことを実測 |
| SC 2.4.6 Headings and Labels | AA | caption（table）/ label（code block） | 適合（`DataTable` は必須、`CodeBlock` は条件付き。下記「既知の制約」） |

## 機械検査と人間の評価の区別

本 Issue の要求どおり、**機械で決まること**と**人が評価すること**を混ぜない。

### 機械検査（`pnpm run a11y:table:code:check` / `pnpm run capture:a11y:table-code`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| `table-outside-primitive` | `src/**` に、`<caption>` または全ヘッダセルの `scope` を欠く `<table>` が 1 つも無い | コメント除去後のソース走査（`scripts/check-table-code-a11y.mjs`） |
| `scroll-container-outside-primitive` | `src/**` に手書きの `overflowX: 'auto'` が 1 つも無い | 同上 |
| `primitive-contract-missing` | primitive が `caption` / `scope` / `tabIndex` / `aria-labelledby` / `overflowX` を持ち続けている | 同上 |
| `fixture-state-missing` | fixture の 4 状態がちょうど揃っている | 同上 |
| Reflow | 375 px で文書が横スクロールしない | Chromium 実測 |
| Keyboard | 溢れている領域は矢印キーで動く | Chromium 実測（`ArrowRight` → `scrollLeft`） |
| Name | スクロール領域の accessible name が解決する | Chromium 実測（`aria-labelledby` の解決先テキスト） |

### 人間の評価（機械では判定しない）

- 200 % ズームでの muted ヘッダ文字とヘアライン rule のコントラスト
- caption の文言が表の内容を正しく表現しているか
- 実機でのスクリーンリーダー読み上げ（VoiceOver / NVDA で表の名前とヘッダ Cells のAnnounce）
- 320 px および 400 % ズームでの読みやすさの判断
- compact（縮小表示）の密度が妥当か

この 5 項目は `scripts/check-table-code-a11y.mjs` の出力でも
「not machine-checked」として明示され、検証画像内にも同じ文言が印字される。

## 4 状態の再現（Issue 完了条件 2）

`src/editorial/table-code.fixture.ts` の `TABLE_CODE_CASE_IDS` は
`01-normal` / `02-empty` / `03-failure` / `04-compact` の 4 つで、
**この集合そのものを** 機械検査と capture が assert する（fewer states だと落ちる）。

| 状態 | 内容 | 保持されるもの |
| --- | --- | --- |
| `01-normal` | 4 行（WCAG 基準 × 対応内容） | caption / 全ヘッダ scope / 行ヘッダ列 |
| `02-empty` | 0 行 | caption とヘッダ行は残る（列構造が AT に伝わる） |
| `03-failure` | 読み込み失敗 | 同上 + 全幅 1 行のメッセージ |
| `04-compact` | 同一データ・低密度 | 同上（`data-table-compact="true"`） |

再現場所は **既存の公開画面** `/design-system`（09 セクション）と
Storybook（`editorial/Table & readability`）の 2 箇所。未確定なページ配置には
依存していない（`routes/design-system` は fixture を import するだけ）。

## スクリーンショット

`docs/verification/a11y/table-code-mobile.webp`（Issue #407 が指定する
`table-code-mobile.png` の WebP 版。PNG はリポジトリに置いていない）。

- 生成: `pnpm run capture:a11y:table-code`
- 対象: 375 px / deviceScaleFactor 2 の Chromium に、出荷している fixture をそのまま描画
- 左: 実表示（375 px の描画を 780 px に拡大して表示）
- 右: 機械検査の結果（状態ごとの caption / scope / focusable / 実測スクロール量）
- 上部: 検証レポート（WCAG 対応・機械検査項目・人間の評価項目）
- 失敗条件: reflow / スコープ / caption / フォーカス / 矢印キースクロールのいずれかが
  観測と矛盾した場合、**成果物を書かずに exit 1**（見栄えのよい画像だけが残ることを防ぐ）

## 検証コマンド

```bash
pnpm run a11y:table:code:check        # 機械検査（gate）
pnpm run capture:a11y:table-code      # Chromium で実測して WebP を生成
pnpm exec vitest run src/editorial/table-code.test.tsx
node --test scripts/check-table-code-a11y.test.mjs scripts/capture-a11y-table-code.test.mjs
```

## 既知の制約

- **portfolio のコードブロックに独自 caption は無い。**
  `src/portfolio/markdown.safety.test.tsx` は「レンダラが本文に無い文言を公開してはいけない」
  を契約としており、renderer 由来の "Code example" のようなラベルは置けない。
  そのため fence の言語 token があればそれを領域名として使い、無ければ無名のまま
  （フォーカス可能性と内部スクロールは確保する）。author 由来の per-block caption を
  持たせるには Notion body schema の決定が要るため、本 Issue の範囲外。
- **`/design-system` の 09 セクションは表示のみ。** 実運用の表（portfolio の一覧など）が
  この primitive を使うかは各 obligation の判断であり、本 Issue は primitive と
  既存公開画面での再現までを担当する。