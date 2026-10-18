# Unicode 正規化と URL slug の扱い — 検証レポート (#433)

- 対象: `src/i18n/**`（表示本文ポリシー + URL slug ポリシー + 判断表）と、それを適用した 3 つの seam
- Issue: #433（`feat(i18n): Unicode正規化とURL slugの扱いを分離`）
- 成果物: `docs/verification/i18n/unicode-slug-validation.webp`
- 決定記録: `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md`
- 状態: **ポリシー / seam 適用 / 判断表 / CI gate / 検証画面まで実装済み**。未確定事項は §7

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/i18n/fixtures.ts` の判断表 17 行を、**出荷済みポリシー**（`describeUnicode` / `classifySlugCandidate`）と**出荷済み grammar**（`EMOJI_SLUG_GRAMMAR` / `PORTFOLIO_SLUG_GRAMMAR`）で分類した結果 |
| capture 手段 | `node scripts/capture-i18n-unicode-slug.mjs`（= `pnpm run capture:i18n-verification`） |
| 描画 CSS | `src/editorial/semantic-tokens.ts`（light）を CSS custom property に解決したもの。**webfont は取得しない**（宣言のみ、システム fallback で描画） |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 3812 px、**265 kB** WebP（quality 75、budget 300 kB） |
| 撮影時の fixture 行数 | 17（`assertFixtureCount` が 17 以外で失敗する。空または部分的な画面の黙認をしない） |
| 外部通信 | **0 件**。webfont を fetch せず `setContent` で描画するので、origin 自体が存在しない |
| 再現性 | 判断表と分類結果は決定的。ブラウザ撮影は byte 再現ではない |

Issue は `.png` 経路を指定しているが、リポジトリの検証 artefact の規約に合わせて **`.webp` を commit** した。
`scripts/capture-i18n-unicode-slug.mjs` は `.webp` 以外の出力先を拒否し、中間 PNG は削除する。

## 2. 画面が示している条件

### 2.1 表示本文（表示 / form / code points）

- `form` は `describeUnicode().form` の結果。`NFC` と `NFD` は**同じ単語の 2 表記**であり、
  比較キー（`foldKey` = NFC）では一致する。表示側は著作者の byte 列を保持する。
- `NFKC で変化` の印は、互換正規化で文字が変わる行。互換正規化は**タイポグラフィ**の変換であり、
  意味の変換ではない。`㎡ → m2` は意味が保たれる例、`① → 1` / `Ⅳ → IV` / `µ → μ` / `ﬁ → fi` は意味が変わる例。
  意味が変わるか否かと同じ手順で判別できないので、**どちらも適用しない**。
- `code points` 列は、結合記号や不可視文字など「目では判別できない差」を可視化するためのものである。

### 2.2 URL slug（slug 候補 / 判定）

- 判定は「著作者が URL に入れようとした文字列」を 2 つの URL 空間で見た結果。
  同じ文字列が片方で受理され他方で拒否されるのは、grammar が owner ごとに異なるため
  （`thumbs_up` は emoji では可、portfolio では不可）。
- 拒否理由の主語は**ポリシー**である。`café`（NFC）も `café`（NFD）も `non-ascii` として拒否され、
  「長さや pattern の偶然では説明できない」拒否になる。

### 2.3 反実仮想列（naive slugify なら）

一般的な slugify（NFKD + 結合記号の除去）を**採用した場合**の URL を併記している。採用しない理由の証拠であり、実装ではない。

| 入力 | naive slugify | 何が変わるか |
| --- | --- | --- |
| `5 µm tolerance` / `5 μm tolerance` | 両方 `/5-m-tolerance` | 異なる 2 文字（µ と μ）が **1 つの URL** に統合される |
| `ＭＵＬＴＩ slicer` / `Multi slicer` | 両方 `/multi-slicer` | 全角表記が ASCII プロジェクトの URL を乗っ取る |
| `N ≠ 3 (非対応)` | `/n-3` | **否定が丸ごと消える**（結合記号の除去で `≠` は `=` になる） |
| `① 優先` | `/1` | 数値が変わる |
| `Ⅳ 期` | `/iv` | 数値が変わる |
| `Café notes`（NFC）/ `Café notes`（NFD） | 両方 `/cafe-notes` | 同一単語の 2 表記。この場合は「たまたま」正しいが、`cafe` のような別語を別 URL にできない |

### 2.4 カタログ衝突監査

| kind | 内容 |
| --- | --- |
| `duplicate-url` | 2 件が同じ URL を主張する（到達できるのは 1 件だけ） |
| `normalization-alias` | NFC / NFD の表記違いが別 slug として登録されている（1 語 2 URL） |

どちらも D1 の PRIMARY KEY では検出できない（byte 列が異なるため）。公開前に検出する。

**この表は固定サンプルカタログの結果である。** `COLLISION_CATALOG`
（`scripts/capture-i18n-unicode-slug.mjs`）に対する audit であり、出荷済みの
reactions / portfolio カタログを監査したものではない。`findSlugCollisions` /
`assertNoSlugCollisions` はまだ production caller を持たないため、この画面が示すのは
**audit 機構が 2 種の衝突を検出できること**であって、**実カタログが clean であること**
ではない。画面上にも明記している。

## 3. 適用した seam

| seam | 変更 | 既存契約への影響 |
| --- | --- | --- |
| `src/reactions/slug-regex.ts` | `EMOJI_SLUG_GRAMMAR` を公開（grammar の所有は reactions のまま） | なし（追加のみ） |
| `src/reactions/slug-validate.ts` | `classifySlugCandidate` 経由に変更 | 例外メッセージは互換（`must be a string` / `must be 1..16 chars` / `must match ^[a-z][a-z0-9_]*$`）。非 ASCII に新しい理由が追加 |
| `src/portfolio/schema.ts` | `PORTFOLIO_SLUG_GRAMMAR` を公開、`SlugSchema` を classify 経由に、row → model の表示列を byte-exact で保持 | **受理集合は同一**。メッセージは byte 一致ではない: ASCII / grammar の拒否は owner の pattern から描画されるため `must match ^[a-z0-9][a-z0-9-]{0,127}$`（`/…/` の囲みなし）になり、Zod の issue `code` は `invalid_format` から `custom` になる。どちらも reason 互換であり、出荷済み consumer（`src/portfolio/public.ts` / `src/routes/portfolio/$slug.tsx`）はいずれも読まない（`success` で分岐するだけ） |
| `src/home/reactions/widget.tsx` | ローカル複製していた regex を canonical grammar に置換 | 受理集合は同一（`deriveSlugFromPicker` の既存テスト Green） |

`rowToProject` の byte-exact 性は **runtime assertion ではなく mapping の性質**として
固定している（`schema.test.ts` の「display text preservation」が全 display field を
walk する）。同じ式を 2 回渡す恒真な assertion は置かない。

## 4. 契約テストが固定していること

| テスト | 固定している性質 |
| --- | --- |
| `src/i18n/unicode.test.ts` | fold は NFC のみ。`describeUnicode` は text を書き換えない。NFC / NFD は foldKey が一致し byte は異なる。`≠` は NFKC では変化しない（mark 除去は別のリスク）。code point 表示は curated label |
| `src/i18n/slug-identity.test.ts` | 判定順序（not-a-string → empty → **non-ascii** → too-long → grammar-mismatch）。非 ASCII は grammar 不一致より先に理由になる。confusable は決して slug にならない。衝突監査の 2 種と「異なる語を alias と誤検出しない」こと |
| `src/i18n/fixtures.test.ts` | 判断表 17 行を**出荷済みの owner grammar** で分類する。**publish される slug はすべて ASCII** であり、採用された候補と byte 単位で一致する |
| `src/portfolio/schema.test.ts` | NFD / NFC / 互換文字のタイトルが row → model を byte-exact で通過すること。加えて「display text preservation」ケースが `rowToProject` の**全** display field（title / summary / role / period_label / markdown 5 種）を walk するため、trim / decode / NFC 再構成を 1 つでも入れると落ちる |
| `scripts/check-i18n-policy.test.mjs`（16） | コメント除去（URL や regex を誤読しない）、行番号の保持、exempt リスト、`toLocaleString(undefined)` / `new Intl.X(undefined)` の検出、型付き locale 変数を**違反にしない**こと、gate 自身が `src/**` に対して clean であること |
| `scripts/capture-i18n-unicode-slug.test.mjs`（14） | WebP 限定・サイズ予算・RIFF ヘッダ、反実仮想 slugify の実測値、evidence が**出荷済みポリシー由来**であること、レポートが「証明していないこと」を明記すること |

ローカル実測: `pnpm exec vitest run src/i18n/` = **89 passed**、
`pnpm exec vitest run src/i18n/ src/portfolio/schema.test.ts src/reactions/ src/home/reactions/` = **218 passed**（9 files）、
`node --test scripts/check-i18n-policy.test.mjs` = **16 passed**、
`node --test scripts/capture-i18n-unicode-slug.test.mjs` = **14 passed**。

## 5. CI gate（`pnpm run i18n:policy:check`）

`validate:fast` に組み込み済み。`src/**`（policy owner・test・stories・生成ファイルは除外）を走査し、
以下で fail する。

| rule | 違反するもの | 理由 |
| --- | --- | --- |
| `no-compatibility-fold` | コード中の `'NFKC'` / `'NFKD'` | 互換正規化は文字・数値・単位を書き換える |
| `no-implicit-normalize` | `src/i18n/**` 以外の `.normalize(` | 表示本文は記述どおり。正規化は owner 1 箇所に閉じる |
| `explicit-locale` | `toLocaleString()` 等の locale を名指ししていない呼び出し（引数なし、または明示的な `undefined`） | 訪問者環境に依存すると数値の意味が変わる。`undefined` は「決定していない」ことであって opt-in ではない |
| `intl-without-locale` | `new Intl.X()` の locale を名指ししていない呼び出し（引数なし、または明示的な `undefined`） | locale は opt-in であり、opt-in は明示である |
| `no-lossy-derivation` | `slugify(` / `deburr(` / `transliterate(` 等 | slug は導出せず、著作者が書く |

加えて、判断表が**出荷済みポリシーと食い違えば** fail する（表が古いドキュメントになるのを防ぐ）。
現在の実測: **195 ファイル走査 / 違反 0 / 判断表 17 行一致**。

**この gate が検査しないもの**（scope note に明記）:

- `scripts/`（§6 参照）。
- **URL parameter の case folding**。`src/routes/tools.$slug.tsx` は今も
  `params.slug.toLowerCase()` を使うため、該当する rule は無い。→ §7.4。
- **変数 locale**。`new Intl.NumberFormat(locale)` は違反にしない。Issue #430 の
  `src/home/format.ts` は型付き `HomeLocale`（`'en' | 'ja' | 'ko'`）を渡し、
  訪問者 locale のネゴシエーションを**意図的に未実装**と明記している。これは本ポリシーが
  求める opt-in そのものである。呼び出し側を読むだけでは「名指しされた locale」か
  「継承された locale」かを判定できないため、gate は推測しない。契約は所有
  obligation のドキュメントにある。
- 出荷済みカタログの衝突 audit（§2.4）。

## 6. 残るリスク（測定済み・隠していない）

| リスク | 内容 | 現状の対処 |
| --- | --- | --- |
| Node 実行依存 | gate と capture は TypeScript を直接 import する（Node >= 22.18 の型ストリップ） | `package.json#engines` と CI の node 22.18 に一致。Node が應じた場合は明確なメッセージで失敗する |
| スキャン対象 | gate は `scripts/` を含まない（capture の反実仮想列に `NFKD` / `slugify(` が現れるため） | 意図的。対象範囲は gate のヘッダと ADR に明記 |
| URL parameter の case folding | gate に「URL slug を case fold する」rule が無いため、`/tools/MultiSlicer` は 200 を返す | 意図的に未決。ADR-0017 §6.4 / §7.4 に記録。緑 = 「classified 済み」ではない |
| カタログ衝突 audit の未配線 | `findSlugCollisions` / `assertNoSlugCollisions` に production caller が無い | 検証画面の §2.4 は固定サンプルでの機構デモ。実カタログの監査は別 ticket |
| capture は browser 依存 | Playwright chromium を local に必要とする | 既に devDependency。`--no-capture` なら browser 無しで evidence を生成できる |
| 画像サイズ | 265 kB / budget 300 kB | quality 75、width <= 1600 で抑制。budget 超過時は script が失敗する |

## 7. 未決事項（owner 判断）

1. **`/portfolio/<非ASCII>` の応答**: 現在 `SlugSchema.parse` が throw するため 500 になる。404 に統一すべきか
   （route の 404 契約）は別 ticket であり、本 PR は route の挙動を変えていない。
2. **migration / publish scripts の `deriveSlug`**: `scripts/migrate-portfolio-from-2025.mjs` /
   `seed-portfolio-path-a.mjs` / `publish-portfolio-production.mjs` は slug を legacy id から**導出**する
   （ASCII 以外を除去）。今回のポリシーを共有していない。実データは ASCII slug のみだが、
   衝突検出の追加が必要かは owner 判断。
3. **locale opt-in の拡張**: 現在は `Intl.NumberFormat('en-US')` のような明示指定と、
   Issue #430 が追加した型付き `HomeLocale`（`src/home/format.ts`）のような**型で閉じた**
   locale 集合だけが通る。訪問者 locale を尊重する表示を今後追加する場合の契約
   （fallback、SSR と hydration の一致、ネゴシエーションのソース）は未定義。gate は
   変数 locale を検査しないため、この拡張は人手によるレビューが担う。
4. **`/tools/<slug>` の case folding**: 3 つ目の公開 URL 空間だが、このポリシーの分類を通っていない。
   `src/routes/tools.$slug.tsx` は `params.slug.toLowerCase()`（Issue #183 の display-case 許容）で
   lookup key を作るため、`/tools/MultiSlicer` と `/tools/multislicer` は同一 identity に解決する。
   grammar は `src/tools/manifest.schema.json` が所有する ASCII 限定表現なので、現時点で非 ASCII が
   この path に入ることはない。owner が決めるべきは「`classifySlugCandidate` を通す（＝Issue #183 の
   許容を廃止する）」か「恒久的な例外として ADR に明記する」か。gate はこれを検出しない。
   Issue #183 の出荷済み挙動を変えるため、本 PR では決定していない。

## 8. 再現手順

```bash
pnpm run i18n:policy:check                 # 判断表と出荷済みソースの policy 検査
pnpm exec vitest run src/i18n/             # policy の契約テスト
pnpm exec vitest run src/portfolio/schema.test.ts
node --test scripts/check-i18n-policy.test.mjs
node --test scripts/capture-i18n-unicode-slug.test.mjs
pnpm run capture:i18n-verification         # 検証画面を再生成（docs/verification/i18n/*.webp）
```

capture は外部通信 0 件・deploy なし・secret 読み出しなしのローカル処理である。