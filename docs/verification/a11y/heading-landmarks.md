# 見出しとランドマークの論理構造を検証する（Issue #398）

> 検証対象: 公開ページの **見出しの階層（outline）** と **ランドマーク**。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.3.1 Info and Relationships (A)** と **SC 2.4.6 Headings and Labels (AA)**。

支援技術からページを読むとき、文書の論理構造を伝える手段は
「見出しの階層」と「ランドマーク」だけである。いまはページごとに見出し構造を
自由に決めていて、`h1` が 2 つあるページも、`h1` の次に `h3` が来るページも、
`main` ランドマークがないページも **機械的に検出できなかった**。
この Issue はページ単位の構造を **機械検査で固定する**。

## 適用対象（gate の走査範囲）

gate は **ページ単位のソース** を走査する。単位は「1 ページ =
-route ファイル + そのページを描画するコンポーネント」で、
`scripts/check-a11y-heading-landmarks.mjs` の `PAGE_UNITS` がその定義である。

| ページ unit | 種別 | 対象ファイル | 備考 |
| --- | --- | --- | --- |
| `home` | page | `src/routes/index.tsx` + `src/home/**` | ホーム画面（composer + 各セクション） |
| `about` | page | `src/routes/about.tsx` + `src/about/**` | 人物像画面 |
| `keyboard` | page | `src/routes/keyboard.tsx` + `src/keyboard/components/**` | キーボード配列の参照画面 |
| `portfolio-list` | page | `src/portfolio/components/PortfolioList.tsx` + `ProjectCard.tsx` | ポートフォリオ一覧 |
| `portfolio-detail` | page | `src/portfolio/components/PortfolioDetail.tsx` + `Markdown.tsx` | ポートフォリオ 1 件 |
| `legal-review` | component | `src/legal/**` | 資産権利レビュー**カード**（ページに埋め込まれる） |
| `external-api` | component | `src/external-api/**` | 外部 API 読み取りカード |
| `tools-index` | page | `src/routes/tools.index.tsx` | Tools 一覧 |
| `tools-detail` | component | `src/routes/tools.$slug.tsx` | Tool の埋め込みホスト shell（chrome なしの全画面 iframe。ページ own の outline を持たない） |
| `contact` | page | `src/routes/contact.tsx` + `src/contact/page.tsx` | お問い合わせ（route シェル + 描画するページ） |
| `projects-dotfiles` | page | `src/routes/projects.dotfiles.tsx` + `src/projects/DotfilesIntroductionPage.tsx` | dotfiles 導入（route シェル + 描画するページ） |
| `design-system` | page | `src/routes/design-system.tsx` + `src/routes/design-system/DesignSystemPage.tsx` | デザインシステム（route シェル + 描画するページ） |

走査対象は **60 ファイル**（2026-10-23 時点、`.ts` / `.tsx`）。

**種別（`kind`）は「推測」ではなく「宣言」する。** `PAGE_UNITS` の各 entry は
`kind: 'page'` か `kind: 'component'` を明示し、種別を宣言しない unit は
**既定で page** として扱う（fail-closed。推測で合格にしない）。

## 対象外（理由つき）

| 対象外 | 理由 |
| --- | --- |
| `src/routes/__root.tsx` | root は全ページ共通の shell（header / nav / footer）。1 ページ分の chrome でありページ自身ではない（root 自身の検査は別件） |
| `src/routes/admin.*` | 認証された管理画面。公開ページではない |
| `src/routes/design-system/**`（`DesignSystemPage.tsx` を除く） | 多数のエフェクトを 1 画面に合成するギャラリー。1 つのページではない（ページ構成本体は design-system unit として走査する） |
| `*.test.ts(x)` / `*.spec.ts(x)` | テストは「描画する」のではなく「検証する」。ページではない |
| `*.stories.tsx` | Storybook は変化形の一覧を表示する。ページではない |
| `**/fixtures/**` | fixture はデータ。出荷されたページではない |
| `src/contact/**`（`page.tsx` を除く）, `src/projects/**`（`DotfilesIntroductionPage.tsx` を除く）, `src/tools/**` | それぞれの obligation が自分のモジュールを持つ。本 Issue はページの描画本体だけを走査する（残りは既知の穴。下記「既知の制約」） |
| `src/routes/portfolio/**`, `src/routes/projects/**` | ディレクトリであり `src/routes/*.tsx` ではない |

対象外にした理由と件数は **gate の出力そのもの** に印字される
（`not scanned (deliberately out of scope):` と `excluded files inside the
scanned scope`）。除外は「黙って無視する」のではなく「読める」ことを意図している。

## 機械検査する規則

| rule | 意味 | 判定方法 |
| --- | --- | --- |
| `page-multiple-h1` | 1 ページが **2 つ以上の `<h1>`** を描画している | ページ unit 全体の `<h1>` 数 |
| `page-missing-h1` | ページが `<h1>` を **1 つも** 描画していない | ページ unit 全体の `<h1>` 数 |
| `page-heading-level-skip` | 見出しレベルが **1 段飛ばしている**（h1 → h3、h2 → h4） | ファイル内の見出し列の連続 2 個を比較 |
| `page-missing-landmark` | ページが **main ランドマーク** を描画していない | `<main>` / `role="main"` の出現回数 |
| `landmark-duplicated` | 同一ページ内で main ランドマークが **2 つ以上** ある | 同上 |

### 3 つの決定的な読み方

1. **レベル判定は「ファイル内」で行う。**
   ページは複数のファイルから構成されるため、DOM 順をソースから再現することは
   できない。よってレベル飛ばしは「そのファイルで書かれた順」で比較する。
   共通 primitive のように `h2` で始まるファイルは、そのファイル自身の
   最初の見出しを起点とする（`h2` 開始なら `h2` → `h4` だけが違反）。
2. **`<h1>` と `main` の個数は「ページ unit」全体で見る。**
   ページは複数ファイルで描画されるので、ページとしての性質は unit 全体の個数で
   判定する。`src/home/hero.tsx` の `<h1>` と `src/home/composer.tsx` の
   `<main>` は、同一ページ（`home`）の 1 個ずつとして数えられる。
3. **共通 `SectionHeading` は `<h2>` として読む。**
   `src/editorial/primitives/SectionHeading.tsx` は 1 回の呼び出しにつき
   ちょうど 1 個の `<h2>` を描画する（その primitive 自身の doc comment が
   宣言している）。これを数えないと、primitive で組んだどのページも
   「レベルを飛ばしている」と誤検出する。primitive の描画するレベルは
   **primitive のソースから読む** ので、primitive が変われば gate も変わる。

### page unit と component surface の区別

`PAGE_UNITS` の各 unit は `kind: 'page'` か `kind: 'component'` を **宣言** する。
`kind` は **描画結果から推測しない**。

- **page の unit** は、`<h1>` と `main` ランドマークの個数を **無条件に** 課される。
  ページが `<h1>` と `main` の **両方** を失っても `page-missing-h1` と
  `page-missing-landmark` の **両方** として報告される（cold review で指摘された穴）。
- **component の unit** は、ページに埋め込まれるカード / リスト / パネルであり、
  ページ own の `<h1>` を持つべきではない。よって `page-missing-h1` /
  `page-missing-landmark` は課さない。ただし **見出しレベルは検査する**
  （コンポーネントもレベルを飛ばしてはいけない）。
- **種別の宣言がない unit は page として扱う**（fail-closed）。
  種別を推測して合格にさせない。

どちらの種別でも `page-heading-level-skip` は判定する。

## 既存コードの違反と修正

gate の初回実行で **3 件の違反** が出た。いずれも **構造** の修正で、
**日本語テキストは 1 文字も追加していない**。

| 違反 | 場所 | 修正 |
| --- | --- | --- |
| `landmark-duplicated` ×2 | `src/keyboard/components/KeyboardPage.tsx` | 3 つの描画分岐（ready / unavailable / プラットフォームなし）がそれぞれ `<main>` を持っていたため、**ページの `<main>` を 1 つに** 集約し、分岐側は `<section>` / `<div>` にした |
| `page-missing-landmark` | `src/routes/tools.index.tsx` | ページ本体が `<main>` を持たなかったため、**ページ全体を `<main>` で包んだ** |

いずれも「見出しの文言を変える必要はなく、要素の追加・属性の付与で解ける」修正である。

## 機械検査と人間の評価の区別

### 機械検査（`pnpm run a11y:heading-landmarks:check` / `pnpm run capture:a11y-heading-landmarks`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| 上表の 5 rule | ページ unit ごとの `<h1>` 数・`main` 数・見出しレベル | コメント除去後のソース走査（`scripts/check-a11y-heading-landmarks.mjs`） |
| fixture | `pass/` 2 ファイルは違反 0、`fail/` 6 ファイルは 5 rule をそれぞれ検出 | `node --test scripts/check-a11y-heading-landmarks.test.mjs` が **fixture を実際に読み**、同じ `evaluateUnit` で判定する |
| fixture の一致 | fixture 集合が `EXPECTED_FIXTURES` と **完全一致** すること、`pass/` の各 fixture が **見出しと `main` ランドマークを実際に持つ** こと、`fail/` の各 fixture が **違反を実際に報告する** こと | gate 自身が行う。違反は `fixture-expectation-mismatch`（5 rule とは別の、gate 自身の証拠に対する rule）。fixture を空に・削除しても gate は緑にならない |
| 描画された DOM | Chromium が返した実測値に同じ 5 rule を適用し、期待値と一致するか | `pnpm run capture:a11y-heading-landmarks`（一致しなければ成果物を書かずに exit 1） |

### 人間の評価（機械では判定しない）

- 見出しの**文言**がそのセクションを正しく説明しているか
- アウトラインの**順序**が読み手にとって自然か（構造的に正しくても読み味が悪ければ問題）
- 実機でのスクリーンリーダー読み上げ（VoiceOver / NVDA で outline とランドマークの announce）
- `main` ランドマークが「本文の始まり」としての位置にあるか
- 見出しレベルが**見た目**の文字サイズと合っているか

この 5 項目は gate の出力でも `not machine-checked (human evaluation):` として
明示され、検証画像内にも同じ文言が印字される。

## スクリーンショット

`docs/verification/a11y/heading-landmarks.webp`
（Issue #398 が指定する `heading-landmarks.png` の WebP 版。
**PNG はリポジトリに置いていない** — capture script が `.png` を拒否する規約のため）。

- 生成: `pnpm run capture:a11y-heading-landmarks`
- 左: **正常なページ構造**（`main` 1 個 / `h1` 1 個 / `h1` → `h2` → `h3`）
- 右: **違反した構造**（`h1` 2 個 / `h1` → `h3` / `main` なし）
- 右の evidence パネル: 描画された DOM の実測値と、ソース gate のページ unit ごとの判定
- 上部: 検証レポート（WCAG 対応・機械検査項目・人間の評価項目）
- 失敗条件: 描画された実測値が期待値と矛盾した場合、**成果物を書かずに exit 1**

## 検証コマンド

```bash
pnpm run a11y:heading-landmarks:check   # 機械検査（gate）
pnpm run capture:a11y-heading-landmarks # Chromium で実測して WebP を生成
node --test scripts/check-a11y-heading-landmarks.test.mjs
node --test scripts/capture-a11y-heading-landmarks.test.mjs
```

## 誤検知が起きたときの対応

機械検査は **構造** だけを判定する。誤検知が起きた場合は、次の順で対処する。

1. **その unit は本当にページか。** 共通コンポーネントが `<h1>` を持つべきではない
   場合は、`PAGE_UNITS` の定義側で `kind: 'component'` を **明示** する
   （`page-missing-h1` / `page-missing-landmark` は課されない）。逆に、
   本物のページなら `kind: 'page'` を明示する（既定でも page になる）。
2. **その `<h1>` / `main` は本当に重複か。** 描画の分岐が排他的である場合
   （`KeyboardPage` の ready / unavailable など）、ソース上の個数と実際の
   個数が食い違う。gate は **ソース** の個数で判定する（描画を再現しないため）ので、
   ソース側を「1 個のランドマーク」に直すのが正解。
3. **見出しレベルが意図的に飛びているのか。** primitive 経由の見出し
   （`SectionHeading`）は level 2 として数える。それ以外の primitive が
   見出しを描画する場合は、その primitive を gate のモデルに加えてから
   判定し直す。
4. いずれも該当しない場合は **owner へ判断を仰ぐ**。見出しの文言変更を伴う
   修正は public copy の変更になるため、copy editorial approval gate の
   承認が必要である（copy を変えない構造修正は承認不要）。

## 既知の制約

- **レベル判定はファイル内で行う。** ページが複数ファイルから構成される場合、
  ファイル跨ぎのレベル飛ばし（例: `h1` を持つファイルと `h3` を持つファイルが
  別々）は検出しない。検出できるのは「同じファイルで書かれた連続した見出し」の
  飛ばしだけである。DOM 順の再現は Worker と binding を要するため、
  この gate は行わない。
- **`src/contact/**` / `src/projects/**` / `src/tools/**` は一部のみ走査。**
  ページの描画本体（`src/contact/page.tsx`、`src/projects/DotfilesIntroductionPage.tsx`）は
  unit に含めて走査するが、残りのモジュールは自分の obligation が heading と
  landmark を持っている。残りを広げるかどうかは unit 定義と source 走査の拡張であり、
  別の ticket での決定を要する。
- **ポートフォリオ本文の Markdown 見出しは `h3` / `h4` / `h5` のまま。**
  ページ外見出しは `h1` なので描画上は `h1` → `h3` になるが、
  `src/portfolio/markdown.safety.test.tsx` が「ページ外見出しは `h3`/`h4`/`h5` の
  スロット」という**既存の明示的な契約**として固定しているため、本 Issue では
  変更しない（変更は別 ticket の決定事項）。
- **`kind: 'component'` の unit は「宣言された判断」である。**
  `legal-review` / `external-api` / `tools-detail` は、ページに埋め込まれる
  カード、または chrome なしの iframe ホスト shell であり、ページ own の
  `<h1>` / `main` を持たない。種別は **宣言** なので、gate の出力には
  `(component)` として印字され、reader が判断の根拠を追える。
  一方 `tools-detail` は `<h2>` だけを持ち `<h1>` を持たないため、
  スクリーンリーダーからは「ページ名の-announce がない」状態として残る。
  これは public copy の変更を要する事項であり、本 Issue のスコープ外。
- **`scripts/_source-scan.mjs` の行番号バグを本 Issue で直した。**
  JSX の閉じタグ `</h1>` を正規表現リテラルと誤認して改行を二重に数えており、
  報告行が 1 行ずれる（JSX の閉じタグが多いファイルほどずれる）状態だった。
  `</` を正規表現の開始とみなさないよう修正したので、本 gate 以外の
  `stripComments` 利用 gate（table-code / reduced-motion / i18n-policy など）
  の報告行番号も正しくなった。既存テストは通過している。
