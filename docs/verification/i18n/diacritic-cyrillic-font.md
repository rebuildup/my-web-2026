# 合字・結合記号・キリル文字の文字表示 — 検証レポート (#432)

- 対象: `src/i18n/glyphs.fixture.ts` の見出し fixture 16 行（fr / de / pt / ru）と、それを**出荷済み font stack** で描いたときの glyph 実測
- Issue: #432（`test(i18n): 合字・結合記号・キリル文字の文字表示検証`）
- 成果物: `docs/verification/i18n/diacritic-cyrillic-font.webp`
- 関連: [`docs/domain/i18n.md`](../../domain/i18n.md) §5（文章品質とタイポグラフィの分離）、[`unicode-slug-validation.md`](unicode-slug-validation.md)
- 状態: **fixture / CI 契約テスト / Storybook プレビュー / ブラウザ実測まで実装済み**。owner 判断が要る未確定事項は §6

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/i18n/glyphs.fixture.ts` の 16 行（`accent` / `combining` / `ligature` / `cyrillic` / `typography` の各 focus） |
| font stack | `src/editorial/tokens.ts` の `rawTokens.fonts.heading.value` / `.sans.value` をそのまま CSS に展開。fixture 側は tier 名しか宣言していない |
| webfont | `src/routes/__root.tsx` が読んでいる `fonts.googleapis.com/css2` の href を**抽出**して使う（script がリテラルを持たない） |
| capture 手段 | `node --experimental-strip-types scripts/capture-glyph-coverage.mjs`（= `pnpm run capture:glyph-coverage`） |
| 実測 | headless Chromium / 48px canvas 描画。`.notdef` 判定と webfont / fallback 判定は §2.2 |
| viewport / DPR | 1600 x 1000 / 1、`fullPage` 撮影 |
| 生成物サイズ | 1440 x 4186 px、**277 kB** WebP（quality 76、budget 300 kB） |
| 外部通信 | webfont の取得のみ（`fonts.googleapis.com` / `fonts.gstatic.com`）。判定・fixture・font stack に外部依存はない |
| 再現性 | 判定は決定的ながら **browser / platform に依存する実測**。CI の gate ではなく証跡である |

Issue は `docs/verification/i18n/diacritic-cyrillic-font.png` を指定しているが、リポジトリの検証 artefact の規約
（`docs/verification/i18n/README.md`）に合わせて **`.webp`** を commit した。script は 300 kB を超えると失敗し、
中間 PNG は `.tmp/` に残して commit しない。

## 2. 画面が示している条件

### 2.1 fixture が守る 4 つの主張

各行は「数値・否定・権限・文字」の guard substring を持っており、`src/i18n/glyphs.test.ts` が
**guard が本文に byte-exact で残ること**を固定する。校正ツールや formatter が
`ne pas` を削る / `nur lesen` を `Lesen` にする / `1 234,56` を `1234.56` にする /
`ß` を `ss` にする、という変更は**テストが落ちるので公開できない**。

| locale | 数値 guard | 否定 guard | 権限 guard |
| --- | --- | --- | --- |
| fr | `1` + **U+202F** + `234,56` | `ne pas modifier` | `lecture seule` |
| de | `1.234,56`（U+002E） | `nicht übersetzen` | `nur lesen` |
| pt | `1.234,56`（U+002E） | `não` | `somente leitura` |
| ru | `1` + **U+00A0** + `234,56` | `не переводить` | `только для чтения` |

同じ数値に 3 種類の group separator を使うのは**タイポグラフィの差**であって、値の差ではない。
この 3 つを fixture が並べることで、「文字は変えずに、空白の code point は locale データである」ことと
「locale は各行が自分の BCP-47 `lang` を持つ opt-in である」ことが同時に見える。

### 2.2 glyph 実測（53 code points）

| 判定 | 数 | 意味 |
| --- | --- | --- |
| `.notdef`（欠字 / tofu） | **0** | fixture が持つ 53 code point のどれも出荷 font stack で豆腐にならなかった |
| 出荷 webfont が供給 | 50 | `Zen Kaku Gothic New` / `Noto Sans JP` が当該 code point を描画した |
| platform fallback が応答 | 3 | **U+00A0 / U+202F / U+0327** |

fallback が応答した 3 つの内訳:

- **U+00A0 / U+202F** — 空白。ink 0 の文字で、sentinel（`monospace`）も webfont も**何も描かない**ため、
  差分判定は「どちらの供給元も同じ絵になる」から fallback 側になる。**coverage の失敗ではなく判定不能**であり、
  実際の advance（13.44px / 6.72px）は webfont の metrics が決めている。
- **U+0327 COMBINING CEDILLA** — 結合記号。webfont は供給しておらず、fallback face が mark を描く。
  `pt-coracao-nfd` は base letter と mark が別 face になる行であり、mark が cap の下に着く位置に
  おいてベース字形と fallback face が食い違う可能性は、この実測記録に残っている。

結合記号 5 種（U+0301 acute / U+0303 tilde / U+0306 breve / U+0308 diaeresis / U+0327 cedilla）は
すべて advance 0 で、webfont 供給は 4/5。「結合記号を base と同じ face が描くとは限らない」ことの実測である。

### 2.3 copy / paste のラウンドトリップ

レンダリング済みの 16 行を DOM selection で囲み、システム clipboard を通して読み戻した:

| 段階 | 結果 |
| --- | --- |
| DOM text → fixture | **一致**（16 行すべて byte-exact） |
| selection → fixture | **一致** |
| clipboard → selection | **一致**。ただし Chromium の plain-text 直列化が行間に改行 15 個を**追加**する |

改行はどの行も持たない code point なので、これは platform のテキスト直列化であって Unicode の書き換えではない。
比較は改行を除いており、その旨を artifact にも併記している。この 3 段のいずれかが崩れても
`capture-glyph-coverage.mjs` は exit 1 で止まる。

### 2.4 タイポグラフィの差（§5 の分離の実例）

| locale | 引用 | 数字の group separator | 結合記号・特殊文字 |
| --- | --- | --- | --- |
| fr | `«` `»`（内側に U+202F） | U+202F narrow no-break space | é は precomposed（NFC 行）と分解行が対になる |
| de | `„` `“` | `.` U+002E | ü は分解行、ß は常に 1 code point |
| pt | `“` `”` | `.` U+002E | ç / ã は precomposed、分解行は U+0327 + U+0303 |
| ru | `«` `»`（内側に U+00A0） | U+00A0 no-break space | й は分解行、ё は常に 1 code point |

**この fixture は文章を推敲していない。** `docs/domain/i18n.md` §5 に沿って、
yomiyasu などの校正ツールをこの capture / fixture / test のいずれにも入れておらず、
Python をこのリポジトリの実行必須ランタイムにもしていない。校正ツールは編集補助であり、
自動品質保証の証明にはならない、という同節の立場をこの Issue ではそのまま実装している。

## 3. CI で回っている部分 / 回っていない部分

| 部分 | 場所 | CI |
| --- | --- | --- |
| guard・form・code point・canonical 対・byte-exact ラウンドトリップ | `src/i18n/glyphs.test.ts`（19 件） | **回る**（`pnpm run test`、vitest workerd pool） |
| fixture 単一ソース | `src/i18n/glyphs.fixture.ts` | test / Storybook / capture の 3 消費者が参照 |
| Storybook プレビュー | `src/editorial/glyph-headings.stories.tsx`（`editorial/Glyph headings`） | `build-storybook` がコンパイルする |
| glyph 実測・fallback 判定・clipboard ラウンドトリップ | `scripts/capture-glyph-coverage.mjs` | **回らない**（ブラウザ + ネットワークが必要） |

実測を gate にしない理由は 1 つで、ネットワークを要する測定を `validate:fast` に置くと
**オフラインで red になる**からである。gate 化すべき部分（code point と主張）は CI のテストが担保し、
実測は証跡として artifact に残す。

## 4. 再現手順

```sh
# 1. CI 側の契約テスト
pnpm exec vitest run src/i18n/glyphs.test.ts

# 2. Storybook で見たければ
pnpm run storybook   # → editorial/Glyph headings

# 3. 実測 + artifact 再生成（ネットワークと Playwright chromium が必要）
pnpm run capture:glyph-coverage
# 判定だけなら:
node --experimental-strip-types scripts/capture-glyph-coverage.mjs --probe-only
```

生成物は `.tmp/glyph-coverage.html`（撮影 HTML）と `.tmp/glyph-coverage-probe.json`（全判定の機械可読版）。
`--probe-only` でも判定・fallback・clipboard の結論は同じで、画像だけが作られない。

## 5. 未対応範囲（この Issue が測っていないもの）

- **ASCII**。fixture が持つ非 ASCII 53 code point だけを測る。platform のラテンカバレッジは対象外。
- **platform 差**。実測は macOS arm64 / Chromium 153 のみ。Windows / Linux の fallback face は別の質問であり、
  `docs/verification/compat/browsers-matrix.webp` の責務。
- **どの face が答えたか**。差分判定は「出荷 family が描かなかった」ことまでで、実際に描いた face の**名前**は取らない。
  `document.fonts.check()` は code point の coverage 判定に使えない（実測では未ロードの U+E0FF に対しても true を返す）。
- **shaping**。ligature / kerning / cluster 単位の整形は測っていない。判定は孤立した 1 code point 単位。
- **縦の metrics**。combining mark と行高の干渉、fallback face の ascent / descent の差は測っていない。
- **viewport / テーマ**。1600px light のみ。狭い画面・dark・forced-colors は対象外。
- **clipboard は plain-text のみ**。`text/html` flavor を通した場合の往復は未検証。
- **webfont 取得失敗時**。その場合 script は exit 1 で、platform fallback の実測を coverage の証拠として出さない。

## 6. 未確定事項（owner の判断が必要）

1. **heading stack に Cyrillic 専用 fallback を足すか。** 現状の結論は「不要」（欠字 0、
   webfont が 50/53 を供給）だが、これは *この macOS の platform fallback* についての話である。
   Windows の fallback で 3 つを供給できるかは、このリポジトリからは判定できない。
2. **U+0327（分解された ç）を本文に使うか。** 現状は fixture 内のみ。本文で NFD を許すなら、
   base と mark が別 face になる件を含めて fallback face 指定の要否を検討する。
   platform は**行の bytes を保持する**ので、書かないという判断自体は編集側の担当。
3. **校正ツールの導入。** 本 Issue は導入しない。導入する場合も「編集補助」であり、
   `docs/domain/i18n.md` §5 の立場（自動品質保証ではない）は変わらない。

## 7. 参考

- `docs/domain/i18n.md` §5 / §6 / §7
- `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md`
- W3C i18n: <https://www.w3.org/International/>
- nanaism/yomiyasu（校正ツール。**採用していない**: §2.4 のとおり編集補助であり、本 Issue の判定はそれに依存しない）