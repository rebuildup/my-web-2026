# 疑似ローカライズ stress — 検証レポート (#429)

- 対象: `src/i18n/pseudo-locale.ts` の疑似ローカライズ fixture 11 行（長文 / 結合文字 / 数値 / Bidi）と、それを**出荷済み font stack** で 320 px の枠に描いたときの実測
- Issue: #429（`test(i18n): 疑似ローカライズで文字膨張・RTL耐性を確認`）
- 成果物: `docs/verification/i18n/pseudo-locale-stress.webp`
- 関連: [`docs/domain/i18n.md`](../../domain/i18n.md) §5（文章品質とタイポグラフィの分離）・§6（locale は opt-in）、[`diacritic-cyrillic-font.md`](diacritic-cyrillic-font.md)
- 状態: **fixture / CI 契約テスト / Storybook プレビュー / ブラウザ実測まで実装済み**。owner 判断が要る未確定事項は §6

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/i18n/pseudo-locale.ts` の stress 11 行。うち UI surface 描画は 5 行（`en-longform` / `en-negation-permission` / `de-compound` / `ja-mixed` / `he-rtl-acronym`） |
| 膨張 | `expandPseudoText()` — 結合記号（U+0301 / U+0304）と幅を持つ U+00B7 のみを挿入する。書き換え・翻訳・機械的変換以外の編集は**しない** |
| font stack | `src/editorial/tokens.ts` の `rawTokens.fonts.*` をそのまま CSS に展開。fixture 側は font を宣言しない |
| webfont | `src/routes/__root.tsx` が読んでいる `fonts.googleapis.com/css2` の href を**抽出**して使う（script がリテラルを持たない）。実行時 `webfont loaded: true`（`Noto Sans JP` 372 face / `Zen Kaku Gothic New` 242 face が `status: loaded`、`document.fonts.check()` も true） |
| capture 手段 | `node --experimental-strip-types scripts/capture-pseudo-locale-stress.mjs`（= `pnpm run capture:pseudo-locale`） |
| 実測 | headless Chromium / frame 幅 320 px。判定は「横方向 overflow が無い」「宣言した meaning token が**描画された見出し**に連続して残っている」「**ブラウザが描いた** isolate 数が宣言数と一致する」の 3 種 |
| 実測 2 通り | 出荷済みの折り返し規則だけ（`src/styles.css` の body ルール + `SectionHeading`）と、それに fixture ローカルの `overflow-wrap: anywhere` を足したもの（§2.2） |
| viewport / DPR | 1440 x 1000 / 1、`fullPage` 撮影 |
| 生成物サイズ | 1280 x 3198 px、**291 kB** WebP（quality 80、budget 300 kB） |
| 外部通信 | webfont の取得のみ（`fonts.googleapis.com` / `fonts.gstatic.com`）。fixture・判定・font stack に外部依存はない |
| 再現性 | 判定は決定的ながら **browser / platform に依存する実測**。CI の gate ではなく証跡である |

Issue は `docs/verification/i18n/pseudo-locale-stress.png` を指定しているが、リポジトリの検証 artefact の規約
（[`README.md`](README.md)）に合わせて **`.webp`** を commit した。script は 300 kB を超えると失敗し、
中間 PNG は `.tmp/` に残して commit しない。

## 2. 画面が示している条件

### 2.1 11 行の実測値

`expansion cp` は **isolate を除いた**膨張後の長さで、ratio の判定も同じ基準（§3.3）。`protected` は
装飾から除外した meaning token の code point 数、`word` は最長単語の膨張前後、LRI / PDI は
U+2066 / U+2069 の個数。

| row | dir | lang | src cp | expansion cp | ratio | protected | word | LRI / PDI | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `en-baseline` | ltr | en | 55 | 83 | 1.509 | 0 | 8 → 16 | 0 / 0 | ok |
| `en-longform` | ltr | en | 365 | 548 | 1.501 | 41 | 12 → 24 | 0 / 0 | ok |
| `en-negation-permission` | ltr | en | 88 | 132 | 1.500 | 35 | 10 → 12 | 0 / 0 | ok |
| `en-numbers` | ltr | en | 79 | 119 | 1.506 | 46 | 18 → 40 | 0 / 0 | ok |
| `de-compound` | ltr | de | 104 | 156 | 1.500 | 0 | 68 → 108 | 0 / 0 | ok |
| `ja-mixed` | ltr | ja | 52 | 78 | 1.500 | 0 | 23 → 35 | 0 / 0 | ok |
| `combining-marks` | ltr | de | 26 | 39 | 1.500 | 0 | 6 → 12 | 0 / 0 | ok |
| `digits-variant` | ltr | und | 83 | 125 | 1.506 | 18 | 12 → 27 | 0 / 0 | ok |
| `ar-rtl-embedded` | rtl | ar | 70 | 105 | 1.500 | 17 | 8 → 13 | 4 / 4 | ok |
| `he-rtl-acronym` | rtl | he | 44 | 66 | 1.500 | 14 | 6 → 12 | 4 / 4 | ok |
| `digits-only` | ltr | und | 16 | 16 | 1.000 | 0 | 10 → 10 | 0 / 0 | ok（documented limit） |

`digits-only` 行は「装飾できる base 文字が無い」ため 1.5x に到達できない。`documentsLimit: true` を宣言した
行なので `documentedLimits` に記録し、**finding ではなく limit** として扱う。宣言を落とすと finding になる
（`src/i18n/pseudo-locale.test.ts` が両方を固定）。

### 2.2 320 px の UI surface（実画面の before / after）

各行に badge・見出し・CTA の 3 つの surface を、**原文**と膨張後の 2 枚で並べている。
frame には**出荷済みの折り返し規則だけ**を乗せる:

- body: `src/styles.css` の `@layer base` ルール（`word-break: normal` → `auto-phrase`、`text-wrap: pretty`）
- 見出し: `src/editorial/primitives/SectionHeading.tsx` が足す `text-wrap: balance`

**`overflow-wrap: anywhere` はこのレポート独自の回避策（fixture-local mitigation）であって
editorial の recipe ではない。** 出荷済みの言語は見出しにそのような規則を宣言していない。
capture は同じ frame を 2 回測る:

| frame | 出荷済み規則の scrollWidth / clientWidth | fixture-local `overflow-wrap: anywhere` あり | 判定 |
| --- | --- | --- | --- |
| `en-longform` before / after | 318 / 318 ・ 318 / 318 | 318 / 318 ・ 318 / 318 | overflow なし |
| `en-negation-permission` before / after | 318 / 318 ・ 318 / 318 | 318 / 318 ・ 318 / 318 | overflow なし |
| `de-compound` before / after | **588 / 318 ・ 701 / 318** | 318 / 318 ・ 318 / 318 | **出荷済み規則では overflow**（§6 の未確定事項） |
| `ja-mixed` before / after | 318 / 318 ・ 318 / 318 | 318 / 318 ・ 318 / 318 | overflow なし |
| `he-rtl-acronym` before / after | 318 / 318 ・ 318 / 318 | 318 / 318 ・ 318 / 318 | overflow なし |

ページ全体の `documentScrollWidth` は 1440（viewport 幅と同値）で、横スクロールは発生していない。

`de-compound`（68 code point の分割不能ドイツ語複合語）は膨張後 108 code point になる。
出荷済みの規則は `word-break: normal` / `auto-phrase` と `text-wrap: balance` だけで、
この語には折り返し機会がないため 320 px の枠を超える（before 588 px / after 701 px に対し
枠の内側 318 px）。**これは fixture が意図的に見つけ出す欠陥**（`note`: "This is the row that finds a
container narrower than its content"）であり、`overflow-wrap: anywhere` を足せば全 frame が収まる。
ただしその宣言は**この fixture のものであって出荷済みのものではない**ので、capture は
非ゼロ終了ではなく「記録された観測」としてartefact と stdout に残し、
「長い見出しをどこでも折り返してよいか」は `src/editorial/` の判断として §6 に未確定として残す。

### 2.3 meaning / 数値 / 否定 / 権限の保存

`meaningTokens` で宣言した token は **protected span** として装飾から除外される。実測で残ったもの:

| row | token | 残る場所 |
| --- | --- | --- |
| `en-longform` | `never rewrites the source` / `documented limit` | 膨張後の見出しテキスト |
| `en-negation-permission` | `read-only` / `do not publish` / `admin access` | 膨張後の見出しテキスト |
| `en-numbers` | `1,234,567` / `12:30` / `2026-01-05` / `99.9%` / `/api/v1/reactions` | 数字 run は装飾対象外として byte-exact |
| `ar-rtl-embedded` | `12` / `2026` / `admin` / `$12.50` | isolate の内側、順序そのまま |
| `he-rtl-acronym` | `12` / `2026` / `SLA` / `99.9%` | isolate の内側、順序そのまま |

この「残る」判定はブラウザ側でも行う。判定対象は **frame ではなく `h3` ノードの
`textContent`** である。frame には同じ token list から作られた CTA チップも入っており、
frame 全体で探すとそのチップが「見出しが壊れていない」証明になってしまうため。
見出しに token が連続して現れなければ `evaluateMeasurement()` が finding を出すので、
**スクリーンショットが緑でも token が消えていたら capture は非ゼロ終了**する。

### 2.4 Bidi（UAX #9）

RTL 2 行は Latin / 数字 run を U+2066 LRI … U+2069 PDI で隔離する。実測は `4 / 4` で balancing、
未隔離の数字 run は 0。deprecated な U+202A–U+202E は fixture にも capture の出力にも現れない。
これは「RTL を壊さない」ための最小の施策であって、**RTL 対応ではない**（§6）。

隔離の検証は**ブラウザが描いた文字列**を数えて行う。宣言値 `row.bidi.isolates` を
自分自身と比べる検査では失敗できないため、`page.evaluate` で各 frame の `h3` の
`textContent` に含まれる U+2066 / U+2069 を数え、宣言数と一致しないときは finding にする
（サニタイザや正規化、将来の SSR/CSR 変換が isolate を落としても exit 0 にはならない）。

## 3. この fixture が守る 3 つの主張

### 3.1 可逆性

`collapsePseudoText(expandPseudoText(source)) === source` を byte-exact で固定する
（`src/i18n/pseudo-locale.test.ts`「is byte-exactly reversible」）。挿入が許されるのは
U+0301 / U+0304 / U+00B7 の 3 文字だけ、`assertExpandableText()` は既にその文字を含む source を拒否する。
可逆性が保たれない fixture は「元の意味を守る」という主張の前提を失うため、拒否する方が誠実だと決めた。

### 3.2 数値は payload

数字 run は装飾対象外で、`2026-01-05` は **1 つの run** として扱われる（U+002D を group separator として
受理する。`2026` / `01` / `05` に割ると「日付が survived」という fixture の主張と監査が噛み合わない）。
三桁区切り・時刻・ISO 日付・`%`・`$`・パスがすべて byte-exact で残ることを `digitRunsPreserved` が固定する。

### 3.3 ratio の定義

ratio は **膨張のみ**で測る。RTL 行は膨張の後に isolate が付くため、isolate を含めて測ると
1.5x に届いていない行が 1.5x を満たしたことになる（`he-rtl-acronym` は isolate込みで 1.682x）。
実測表の `expansion cp` も isolate を除いた値이며、`expandedCodePoints` が isolate を含む値。

## 4. この Issue が**証明していない**こと

`PSEUDO_LOCALE_LIMITS` がそのまま artefact にも Storybook にも出る。この 6 項目は owner 決定を代行しない。

1. **翻訳ではない。** どの文も翻訳・レビュー・校正されていない。yomiyasu のような校正ツールは
   **編集補助**であり、自動品質保証の証明にはならない（[`docs/domain/i18n.md`](../../domain/i18n.md) §5）。
   追加の Python 実行ランタイムも導入していない（capture は Node + Chromium のみ）。
2. **RTL 対応ではない。** 確認できたのは「数字と Latin run が内部で LTR のまま、枠が壊れない」まで。
   mirroring（`dir` / logical properties / icon 反転）、RTL locale の登録、RTL の copy は未決定。
3. **文章品質を評価していない。** 校正は編集者の仕事（ADR-0017 は自動 gate を翻訳品質保証として扱わない）。
4. **レイアウト保証ではない。** 320 px の 1 パスは「この幅でのこのビルドがどう動いたか」という
   観測であって、未測定のフォント・viewport・surface の証明ではない。§2.2 のとおり、出荷済みの
   折り返し規則では 1 行が overflow する（§6）。
5. **複数形 / 単位 / 数値書式の契約ではない。** それらは home format adapter（Issue #430）と locale データの担当。
6. **性能予算ではない。** 1.5x は最悪ケースの推測であり、実 locale の測定値ではない。

## 5. 対象テストと CI

| 対象 | コマンド | 何が緑になること |
| --- | --- | --- |
| fixture 契約 | `pnpm exec vitest run src/i18n/pseudo-locale.test.ts` | 37 テスト。膨張・可逆性・数値 run・空白・protected span・bidi 隔離・limit の扱い・意味 token・長文行、そして「全描画面が同じ 1 本の膨張文字列を読む」ことと surface 行の選択が fixture 側だけに立っていること |
| capture の純粋部分 | `node --experimental-strip-types --test scripts/capture-pseudo-locale-stress.test.mjs` | 23 テスト。report の escape、limits の逐語表示、`before` frame が原文であること、verdict ロジック（overflow / token 消失 / **描画された isolate 数**の不一致 / webfont 未読込 / fixture 失敗）、2 通りの実測の合成（`evaluateRun`：出荷済み規則だけで overflow した frame は「記録」であって失敗ではない）、そして「出荷モジュールが fixture を import しない」こと |
| wiring | `pnpm run test:wiring:check` | 新しい `scripts/*.test.mjs` が `pnpm test` から到達可能 |
| 実測 | `pnpm run capture:pseudo-locale` | Chromium で 320 px frame を出荷済み規則と fixture-local 回避策の両方で実測し、文字レベルの違反があれば非ゼロ終了 |

Storybook は同じ fixture を同じ関数で `editorial/Pseudo locale stress` として描く
（`src/editorial/pseudo-locale-stress.stories.tsx`）。fixture は `src/i18n/` が持ち、描画は `src/editorial/` が持つ。
描画面の選択行も `PSEUDO_SURFACE_SAMPLE_IDS` として fixture 側だけに立ち、
capture と Storybook が同じ 1 本の膨張文字列（`pseudoExpandedText()`）を読む。

## 6. 未確定事項（owner 判断）

| 項目 | 状態 |
| --- | --- |
| 出荷済みの折り返し規則が見出しをどこまで折り返すか（§2.2 の実測 gap） | **未決定**。`de-compound` は出荷済み規則（`word-break: normal` → `auto-phrase` + `text-wrap: balance`）の下で 320 px の枠を超える（588 / 701 > 318）。`overflow-wrap: anywhere` を**global に採用するか、local に許すか、あるいは現状のままにするか**は `src/editorial/` の判断であり、本 Issue は **`src/styles.css` も primitive も変えていない**。capture はこれを「記録された観測」として残す（失敗扱いにはしない）ので、editorial 側で何かを変えたら §2.2 の数値を取り直すこと |
| RTL の正式対応（mirroring / locale 登録 / copy） | **未決定**。本 Issue は約束しない。必要な 判断は owner |
| 疑似 locale の runtime opt-in（`qps-ploc` を dev だけで有効化する仕組み） | **未実装**。`PSEUDO_LOCALE_ID` は記録のみで、`src/home/format.ts` が返す locale 集合には入っていない |
| 本 fixture のサンプル文の翻訳・校正 | **未実施**。実際の copy にするなら owner / 編集者の作業 |
| 実 locale の膨張率の測定 | 未着手。1.5x は推測値 |

## 7. 再現手順

```sh
# 1. CI 側（browser / network 不要）
pnpm exec vitest run src/i18n/pseudo-locale.test.ts
node --experimental-strip-types --test scripts/capture-pseudo-locale-stress.test.mjs

# 2. 実測 artefact の再生成（headless Chromium と webfont への network が必要）
pnpm run capture:pseudo-locale

# 3. Storybook での目視確認
pnpm run storybook   # editorial/Pseudo locale stress

# 中間ファイル
# .tmp/pseudo-locale-stress.html        report（gitignored）
# .tmp/pseudo-locale-stress-probe.json  実測 JSON（gitignored）
# .tmp/pseudo-locale-stress.png         中間 PNG（gitignored・commit しない）
```