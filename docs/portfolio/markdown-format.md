# Markdown 書式の契約（Issue #435）

> 対象 obligation: `src/portfolio/**`（Portfolio の本文は operator が書く Markdown）。
> 判定する場所: `src/portfolio/markdown.safety.test.tsx`（CI fixture）、
> `src/portfolio/components/Markdown.stories.tsx`（プレビュー）。
> 検証成果物: [`docs/verification/content/markdown-format-regression.webp`](../verification/content/markdown-format-regression.webp)。

この文書は「何がレンダラに保証され、何はレンダラがしてはいけないか」を決める。
**レンダラの実装は変えていない。** `src/portfolio/markdown.lexer.ts` と
`src/portfolio/components/Markdown.tsx` は Issue #77 のままで、#435 で足したのは
fixture・test・この文書・検証レポートの生成 script だけである。

## 1. 3 つの主張を混ぜない

Markdown の議論で「安全に描画できた」は、3 つの別の主張が混ざった結果に
なる。どれが必要で、どれがレンダラにできないのかを先に固定する。

| 主張 | 誰が担う | 検証方法 | 断定できる範囲 |
| --- | --- | --- | --- |
| **安全性**（危険な入力が実行されない） | レンダラ | `markdown.safety.test.tsx` の構造アサート（tag / attribute / href scheme） | 「入力が実行可能な markup にならない」ことまで |
| **タイポグラフィ**（同じ入力は同じ markup） | レンダラ | 同一入力の 2 回描画が一致すること、smart quote 等の置換がないこと、CJK が 1 文字も変わらないこと | 「入力の文字が書き換えられない」ことまで |
| **文章品質**（主張が正しく、レビュー済みか） | **原稿側（人）** | **自動では検証しない** | レンダラは保証しない |

### 1.1 文章品質は自動品質保証ではない

Issue は「未確定な推敲を勝手に公開しない」を完了条件に挙げている。これはレンダラ
の責務ではなく、公開判断の責務である。

- 公開される行は `src/portfolio/load.ts` が `status='published'` かつ
  `visibility='public'` のものだけを返す（`docs/portfolio/decisions.md`
  Decision 3）。
- レンダラは要約も補完も言い換えも行わない。**入力に無い文字を 1 つも出力しない**
  ことを test で構造的にアサートしている（可視テキストの文字集合 ⊆ 入力の文字集合
  ∪ Markdown marker）。さらに、**入力に無い文字列（空白を含まない 4 文字以上の
  連続）も 1 つも出力しない**ことを、marker を外した入力行からの部分文字列として
  アサートしている。文字集合だけの検査では「入力が既に持つ文字を並べただけの
  盗作」を許してしまうため、個々の連続そのものを閉じている。
- [yomiyasu](https://github.com/nanaism/yomiyasu) のような文章編集補助は**原稿を
  直す道具**であって、**品質を保証する検査ではない**。Issue の「参考」にある
  「利用は文章編集補助であり、自動品質保証の証明にはならない」を、そのまま
  実行可能な形にしているだけである。この test は「レンダラが文章を変えない」こと
  しか証明しない。
- この repository に Python を新たな実行必須ランタイムとして追加しない。上記の
  検証はすべて Node + Vitest + Storybook だけで完結する。

### 1.2 locale は必要な機能でのみ opt-in する

レンダラは **locale を推論せず、受け付けず、出力しない**。

- `PortfolioMarkdown` の props は `source` と `siteOrigin` のみ。`lang` / `dir` /
  locale 依存の typography は存在しない。推測で `lang` を渡しても DOM に出ない
  ことを test している。
- smart quote（`"` → `“”`）、ellipsis（`...` → `…`）、dash（`--` → `—`）、CJK の
  禁則処理、locale ごとの font fallback を**一切行わない**。
- 将来、日本語の改行禁則のように locale が本質的に必要な機能を入れる場合、それは
  **消費側の surface が明示的に opt-in する**。レンダラが文脈から推測して
  適用することはない。opt-in する機能ごとに別の Issue を立てる。判断の記録は
  `docs/portfolio/decisions.md` Decision 6。

## 2. 対応している構文

`src/portfolio/markdown.lexer.ts` が解釈するのは以下のみ（#77 から変わらない）。

| 種別 | 構文 | 出力 |
| --- | --- | --- |
| 見出し | `#` / `##` / `###` | `<h3>` / `<h4>` / `<h5>`（`h1` / `h2` はページ側の責務） |
| 段落 | 連続した非空行 | `<p>` |
| リスト | `-` `*` / `1.` | `<ul>` / `<ol>` |
| コード | ```` ```lang ```` | `<pre><code>`（中身の 1 文字も変えない） |
| 引用 | `>` | `<blockquote>`（連続行は空白 1 個で結合） |
| 罫線 | `---` / `***` / `___` | `<hr>` |
| inline | `**` `*` `_` / `` ` `` / `[text](url)` | `<strong>` / `<em>` / `<code>` / `<a>` |

リンクの URL policy：同一 origin と相対リンクは `target="_self"`、別 origin と
`http(s)` 以外の scheme は `target="_blank"` + `rel="noopener noreferrer"`。
`javascript:` / `data:` / `vbscript:` / `file:` は `href="#"` に落ちる。

Raw HTML は**解釈されない**。`<script>` のような入力は `<` と `>` が escape された
テキストとして画面に出る（削除も変換もされない）。

## 3. 未対応の構文（削除ではなく「文字のまま残る」）

#77 の時点で意図的に未実装の構文は、**削除も変換もせず、そのまま本文の文字として
残る**。reader には「描画できなかった」と 동시에「本文の一部」として見える。
fixture 記事（`src/portfolio/fixtures/markdown/technical-article.md`）はこれを
実際に書いているので、test だけでなく reader にも見える。

**ただし 2 つだけ例外がある**。行頭の `- ` は対応済みの list syntax として消費される
（task list）と、画像構文は対応済みの link syntax に一部分落ちる（画像）。どちらも
意味を消さないが**形は変わる**ので、operator に明示する。

| 構文 | 例 | 現状 |
| --- | --- | --- |
| 脚注 | `[^1]` と定義行 `[^1]: 定義` | 未対応。marker も定義行も本文のまま残り、リンクは作られない |
| 表 | `\| a \| b \|` と区切り行 | 未対応。行が 1 段落として残る |
| 数式 | `$E = mc^2$` / `$$\sum…$$` | 未対応。TeX として解釈されない |
| 取り消し線 | `~~text~~` | 未対応。`~~…~~` がそのまま残る |
| 4 段以上の見出し | `####` | 未対応。`####` が段落に残る |
| reference link | `[text][ref]` | 未対応。`[text][ref]` がそのまま残り、リンクは作られない |
| setext 見出し / 定義リスト | `見出し` + `===` / `用語` + `: 定義` | 未対応。行がそのまま段落になる |
| **task list（行頭）** | `- [ ] 読書中` / `- [x] 完了` | 未対応。ただし行頭の `- ` は対応済みの list syntax として**消費される**ので `<ul><li>[ ] 読書中</li></ul>` になる。`[ ] …` の文字は残るが bullet は読者に表示されない |
| **task list（inline）** | `` `- [ ] 読書中` `` | 未対応。code span の中は解釈されないので `- [ ] 読書中` がそのまま残る |
| **画像** | `![図](/media/a.png)` | 未対応。ただし **link として部分的に劣化する**（§ 3.1） |
| 入れ子リスト | `- a` の後にインデント付き `- b` | 未対応。`a` は list、`  - b` はインデントを残したまま**段落**になる（list item に平坦化されない） |
| 複数段落の blockquote | `> a` の後に空行と `> b` | 未対応。2 つの blockquote に分かれる（結合されない） |

### 3.1 画像だけは「文字のまま残る」ではない

`![alt](url)` は parser が `!` と `[alt](url)` に分解する。`[alt](url)` は**対応済み**
の link syntax なので、画面には `<a>` として出る。`<img>` は作られない。

| 入力 | 描画 | 可視テキスト |
| --- | --- | --- |
| `![図](/media/a.png)` | `!<a href="/media/a.png" target="_self" rel="">図</a>` | `!図` |
| `![](/media/a.png)` | `!<a href="/media/a.png" target="_self" rel=""></a>` | `!` |
| `![alt](https://example.com/x.png)` | `!<a href="https://example.com/x.png" target="_blank" rel="noopener noreferrer">alt</a>` | `!alt` |

URL は link policy を通る（別 origin は `target="_blank"` + `rel="noopener noreferrer"`、
危険 scheme は `href="#"`）。安全性は link とまったく同じで、**形だけが違う**。
alt テキストのない `![](url)` は名前のない anchor になり、reader は「名前のない
リンク + 余分な `!`」を見る。画像を使うなら未対応であることを本文に書くか、
code span で囲んで literal text として出すこと。この挙動は suite の
`markdown safety: image syntax degrades into a link, not literal text` で固定している。

### 3.2 足すときの条件

構文を足すのは「実際に必要になったとき」だけ。実装を先取りしない。

上の表のうち **test で固定しているもの** は、脚注（marker / 定義行）、pipe table、
数式、取り消し線、4 段以上の見出し、reference link、setext 見出し、定義リスト、
task list（行頭 / inline の 2 形態）、画像の link 劣化、入れ子リストの段落劣化、
複数段落の blockquote の分割 — つまり表の全部。`docs/portfolio/decisions.md`
Decision 6 の「文字のまま残る」という主張と、この表および § 3.1 の例外の主張は、
同じ suite が支えている。

## 4. 既知の limitation（test が固定している挙動）

### 4.1 intraword の `_` は emphasis になる

CommonMark は単語の途中の `_` を emphasis にしないが、この lexer はする。そのため
素の `MAX_RETRY_COUNT` は画面上で `MAXRETRYCOUNT` になる。

- **推奨**: 識別子・パス・関数名は code span（`` `MAX_RETRY_COUNT` ``）で書く。
  code span は byte-exact に保存される（test 済み）。
- lexer の意味論を変えると公開済みの本文の表示が変わるため、**owner 判断が必要**。
  #435 では修正せず、挙動を test で固定して記録するだけにしている。

### 4.2 scheme を落とされた link が `target="_blank"` を保持する

`isExternalHref` は origin で分類するため、`href="#"` に落とされた link にも
`target="_blank"` が残る。安全ではあるが、死んだ link が新しい tab を開くという
UX 上の問題。`#` を href に持たない link は内部リンク扱いにするのが素直だが、
これも公開済み本文の表示が変わるため #435 では記録のみ。

## 5. 検証の再現手順

```bash
# CI fixture（workerd pool、33 ケース）
pnpm exec vitest run src/portfolio/markdown.safety.test.tsx

# プレビュー（実画面）
pnpm run storybook    # portfolio/Markdown → SupportedSyntax / HostileInput

# 検証レポート（source と実レンダリングの左右比較 + 判定表）
node scripts/markdown-format-report.mjs
# → .tmp/markdown-format-report/report.html

# 検証画像を Issue 指定パス（.png）の WebP 版へ取り直す
node scripts/markdown-format-report.mjs --capture
# → docs/verification/content/markdown-format-regression.webp

# レポート builder の test
node --test scripts/markdown-format-report.test.mjs
```

レポートの HTML は `.tmp/` に出力され（gitignored）、リポジトリに残るのは
WebP の検証画像だけである。`--capture` は Chromium で撮影し、メモリ上で sharp に
渡して WebP にするので、中間 PNG はディスクに書かれない。

fixture 3 ファイル（`technical-article.md` / `hostile.md` / `index.ts`）は CI
fixture と Storybook とレポートが同じものを読む。表示だけが個別に発生しない。

## 6. 関連

- `src/portfolio/markdown.lexer.ts` — 文法の実装（唯一の場所）。
- `src/portfolio/components/Markdown.tsx` — AST を JSX に歩く唯一の面。
- `src/portfolio/markdown.safety.test.tsx` — この文書の fixture 級 test。
- `src/portfolio/markdown.test.tsx` — 単位レベルの AST / 描画 test。
- `docs/portfolio/decisions.md` Decision 6 — locale opt-in と未対応構文の判断。