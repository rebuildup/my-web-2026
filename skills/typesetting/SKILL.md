---
name: typesetting
description: >
  Web UI、document、editorial surface、table、form などで文字組みを設計・実装・改善するときに使用する。
  text role と language/script を分類し、実在する production reference と組版仕様を観察して、
  hierarchy、measure、line-height、line breaking、paragraph rhythm、mixed-script behavior を抽出し、
  current project へ翻訳して実コンテンツで visual verification まで行う。
---

# Typesetting

文字を font size の集合として扱わない。

**Inspect → Classify → Extract → Compose → Stress-test → Verify** を順に実行する。

目的は特定の書体や既存サイトの見た目をコピーすることではない。
文章・ラベル・数値・見出しが、情報の役割、言語、表示幅、実際の文量に対して読みやすく、比較しやすく、崩れずに配置される状態を作る。

## 1. Existing project first

外部 reference を見る前に current project の typography system を短く調査する。

確認対象:

- font family / fallback stack
- font files / variable font axes
- existing type scale / semantic text tokens
- line-height tokens
- font-weight usage
- text colors
- heading / body / label / caption primitives
- table / numeric styles
- localization / supported languages
- writing mode requirements
- content width / layout constraints
- renderer-specific limitations

最初に見つけた一つの style を project convention と断定しない。
同じ責務を持つ複数箇所を確認する。

既存 system が十分なら新しい type scale を作らない。

## 2. Classify the text role

まず text block の主目的を分類する。

### Display / Heading

対象:

- page title
- section heading
- hero copy
- key message

見る:

- hierarchy
- line-break shape
- maximum useful line count
- surrounding whitespace
- body text との scale contrast
- long heading fallback

### Long-form / Reading

対象:

- article
- documentation
- policy / legal text
- explanation
- report body

読む:
`references/long-form.md`

見る:

- measure
- line-height
- paragraph rhythm
- heading intervals
- lists / quotations / notes
- reading continuity

### Interface / Dense text

対象:

- application UI
- form
- settings
- navigation
- toolbar
- metadata
- table

読む:
`references/interface.md`

見る:

- compactness vs legibility
- label / value distinction
- truncation / wrapping policy
- numeric comparison
- state / emphasis hierarchy
- component heightとの関係

### Japanese / Mixed-script

対象:

- 日本語本文
- 和欧混植
- 日本語 + 数字 / 記号
- ruby
- CJK line breaking

読む:
`references/japanese.md`

日本語が含まれるだけで別 visual style にしない。
必要なのは script-specific layout behavior を確認することである。

### Mixed surface

一つの画面で複数 role を使ってよい。

例:

- dashboard title → Display
- dashboard table → Interface / Dense
- help drawer → Long-form
- Japanese labels → Japanese / Mixed-script

role ごとに組版条件を分ける。

## 3. Inspect real references before changing values

non-trivial な typography work では relevant な production / system references を原則 2 つ以上確認する。

evidence priority:

1. rendered production content
2. browser-computed text geometry / responsive behavior
3. current public source implementation
4. official design-system guidance
5. language / typography specifications

reference を見るときは font 名だけを記録しない。

最低限観察する:

- rendered font / fallback
- font size
- line-height
- weight
- text measure
- paragraph spacing
- heading spacing
- wrapping points
- alignment
- emphasis method
- list indentation
- numeric alignment
- responsive changes

可能なら同じ component を短文・長文の両方で確認する。

## 4. Extract relationships, not isolated values

### Hierarchy

heading hierarchy を `font-size` だけで作らない。

見る:

- size
- weight
- line-height
- spacing before / after
- width
- placement
- color / contrast
- capitalization / punctuation conventions

同じ level の見出しがページごとに arbitrary に変化していないか確認する。

### Measure

body text の横幅は layout の余り幅で決めない。

確認:

- 一行が長すぎて次行を追いにくくないか
- 短すぎて改行が増えすぎないか
- font size / language / content type に対して自然か
- wide viewport でも本文だけ無制限に広がっていないか

magic number を先に置かず、rendered sample から適切な reading width を決める。

### Line-height

line-height を component height の都合だけで決めない。

見る:

- script / font の ascender / descender / glyph density
- multi-line readability
- heading の line count
- dense UI か long-form か
- ruby / emphasis / inline icon の有無

body、heading、dense label を同じ line-height ratio に固定しない。

### Paragraph rhythm

paragraph spacing と line-height を別々に最適化しない。

見る:

- paragraph間の区切り
- heading前後の差
- listとの接続
- caption / note の subordinate relationship
- section boundary

空白量は content hierarchy を表現する。

### Alignment

長文本文は readability を優先し、装飾目的の center / right alignment を routine に使わない。

table / data では content type に合わせる。

- prose / labels → 通常は reading direction の start
- comparable numbers → 桁比較しやすい alignment
- short status / badge → component purposeに従う

### Emphasis

重要度を weight の追加だけで表さない。

同一画面で bold weight が増えすぎると hierarchy が消える。

優先順位:

1. semantic structure
2. placement / spacing
3. size / weight
4. color / decoration

## 5. Japanese and mixed-script behavior

日本語組版を Latin text の property preset だけで処理しない。

確認:

- `lang` / locale が正しく伝わるか
- 行頭・行末禁則
- punctuation の line break
- small kana / prolonged sound mark 周辺の break
- Japanese / Latin word boundaries
- full-width / half-width punctuation
- Japanese / Latin / numeric の apparent size
- baseline relationship
- ruby がある場合の行送り
- vertical writing が必要な場合の writing-mode behavior

CSS / renderer の property は仕様名だけから固定しない。
`line-break`、`word-break`、`overflow-wrap` などは current browser / renderer の実挙動を確認する。

heading や短い caption では、意味のまとまりを壊す改行を避けるため wrap opportunity を意図的に制御することがある。
ただし本文全体へ manual `<br>` や zero-width character を大量投入しない。

和欧混植で font を複数使う場合、family 名の相性より先に以下を確認する。

- apparent x-height / body size
- stroke density
- baseline
- weight equivalence
- punctuation shape
- numerals
- fallback glyph

font pairing 自体の探索は別 Skill の責務とし、ここでは readable composition を維持するための調整に限定する。

## 6. Numbers, tables, code and metadata

### Numbers

比較対象の数値は column を縦に読めるようにする。

確認:

- right alignment が適切か
- tabular numerals が必要か
- unit / sign / decimal point の扱い
- negative / percentage / currency の幅
- locale-specific formatting

数値を monospace font に変えるだけで整列問題を解決しない。

### Tables

表は prose と同じ組版にしない。

見る:

- header / data distinction
- numeric columns
- line wrapping
- row density
- minimum readable cell width
- long labels
- empty / unavailable value representation

column width を均等配分する前に data shape を見る。

### Code / technical text

monospace は code / identifiers / aligned technical data など semantic reason がある箇所に限定する。

prose 内 code が line-height や baseline を壊していないか確認する。

### Metadata

caption、timestamp、helper、secondary metadata を「小さく薄くする」だけで処理しない。

最低 readable size、contrast、density、importance のバランスを確認する。

## 7. Compose semantic tokens

繰り返し現れる text role は semantic token / primitive に昇格させる。

例:

```text
text-display
text-heading
text-body
text-body-compact
text-label
text-caption
text-mono
text-table
```

実装形式は current project に従う。

semantic role を保てるなら token 名は上記と一致しなくてよい。

避ける:

- `text-13`, `text-14`, `text-15` のような value-only proliferation
- ほぼ同じ style の大量複製
- component ごとの局所的な font-size 微調整

一度しか使わない display treatment を無理に global token にしない。

## 8. Content stress test before completion

placeholder の短文だけで typography を確定しない。

最低限以下で確認する。

- shortest realistic content
- typical content
- longest realistic content
- Japanese / Latin / numeric mixed sample
- fallback font
- narrow width
- wide width
- browser zoom / user font scaling where applicable

UI ならさらに:

- validation error
- disabled / selected / warning state
- translated string expansion
- empty value
- unusually large number

headline なら複数 line-break pattern を比較する。

## 9. Responsive transformation

mobile で desktop の type scale を一律縮小しない。

確認:

- text measure
- heading wrap
- line-height
- surrounding spacing
- table behavior
- label/value stacking
- navigation truncation

font size を変えず layout width を変える方が良い場合もある。

逆に small viewport で読みづらい既存 text を「画面が小さいからさらに小さくする」方向へ進めない。

## 10. Failure modes

避ける:

- font family を選んだだけで typography 完了とする
- 全 text style を単一 ratio の modular scale から機械生成する
- body width を parent の最大幅に任せる
- long-form を center align / full justify して readability を落とす
- heading の見た目のために semantic heading order を壊す
- Japanese letter-spacing を装飾目的で広範囲に固定する
- manual `<br>` で responsive line break を固定する
- fixed-height container で text overflow を隠す
- ellipsis を content design の代替にする
- tiny gray text を secondary information の標準表現にする
- table の全 column を同じ alignment / width にする
- localization / fallback で崩れる font metric を無視する

## 11. Visual verification gate

compile / lint / unit test success だけでは完了ではない。

rendered result を確認する。

最低限:

- hierarchy が scan で読める
- body measure が安定している
- multi-line text が窮屈でない
- paragraph rhythm が一貫している
- heading wrap が不自然でない
- Japanese punctuation / line break が破綻していない
- mixed-script baseline / apparent size が極端にずれていない
- numeric columns が比較しやすい
- truncation / overflow / clipping がない
- narrow / wide width で役割が保持される
- fallback font でも致命的に layout が崩れない

可能なら reference と current implementation を同じ viewport / text role で比較する。

## 12. Autonomous decision policy

以下は project evidence、content、reference から agent が自律的に決める。

- routine font size within established scale
- line-height
- ordinary paragraph spacing
- body measure
- heading wrap treatment
- numeric alignment
- semantic text token reuse
- ordinary truncation / wrapping policy

user に戻すのは product semantics や brand identity が変わる判断に限定する。

例:

- brand typeface 自体を変更する
- information hierarchy 自体を変更する
- legal / editorial formatting rule を変更する
- content を省略する
- localization policy を変更する

routine typography choice を「何pxがいいですか？」と user に投げない。

## 13. Report

長い typography 解説は要求されない限り不要。

必要なら簡潔に:

- classified text roles
- inspected references
- extracted composition rules
- content stress cases
- intentional deviations

だけを示す。

最終成果は font 名ではなく、実際の文章が rendered artifact 上で読みやすく、比較しやすく、崩れないかで評価する。
