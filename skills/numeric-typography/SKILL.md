---
name: numeric-typography
description: >
  Use when numbers are a first-class reading or comparison surface in UI, tables, dashboards,
  editorial layouts, counters, identifiers, or mixed Japanese/Latin text. Choose numeral form,
  width behavior, alignment, sign/unit treatment, and fallback from the numeric task and locale,
  then verify the rendered values instead of defaulting every number to monospace or tabular figures.
---

# Numeric Typography

Last reviewed: 2026-09-14

数字を「本文と同じ文字」または「全部 monospace」にしない。

**Classify numeric role → Inspect locale/content → Choose figure behavior → Align by comparison task → Stress-test → Verify**

を基本にする。

この Skill は numeral glyph とその周辺記号を、読む・比較する・更新を追う・識別するという目的に合わせて設計する。
数値の意味や locale format 自体を書き換えることは担当しない。

## When to use

使う:

- dashboard / KPI / metric
- price / percentage / duration / measurement
- table / list の比較可能な数値
- timer / counter / live metric
- invoice / report / financial or statistical composition
- ID / serial / reference number / version
- 本文中の年・数量・割合・分数・序数
- 日本語 + Latin + 数字 + unit / currency / punctuation の混植

使わない:

- paragraph / heading / measure / line-height 全般 → `typesetting`
- 和文・欧文を別 family で混ぜる optical matching → `font-mixing`
- table の row/column semantics・sort・selection・responsive interaction → `table-design`
- decimal/grouping/currency/date の locale rule 自体 → `internationalization-design`
- chart scale / encoding / visual comparison → `data-visualization`

## Workflow

1. current project の font、numeric style、locale formatter、table/metric primitives を確認する。
2. 数字を `prose / comparable quantity / display metric / dynamic value / identifier / fraction-ordinal` に分類する。
3. 値そのものと unit・sign・separator・currency・suffix を分けて観察する。
4. reference を開き、figure height、figure width、alignment、update behavior、locale、mixed-script behavior を比較する。
5. current font が必要な OpenType feature を実際に持つか確認する。
6. project / brand / design system の既存 typography を保ちながら最小限の numeric treatment を適用する。
7. realistic values、locale variants、fallback、narrow/zoom、更新前後を render して確認する。

## Observe

### Numeric role

数字が何を意味するかではなく、利用者がどう読む必要があるかを見る。

- prose の一部として流して読む
- 複数値を縦方向に比較する
- 一つの重要 metric を即座に読む
- 値の変化を連続的に追う
- 一桁ずつ正確に識別する
- 分数 / 序数として周辺文字と読む

同じ `1234` でも role が違えば適切な treatment は違う。

### Figure height

- lining figures が周囲の caps / display hierarchy と揃うか
- oldstyle figures が prose の rhythm に馴染むか
- ascender / descender の変化が dense comparison を妨げないか
- current font の default figure style が何か

`lining = UI`, `oldstyle = editorial` のような固定分類にしない。
実際の family、text role、比較要求で決める。

### Figure width

- proportional figures で文章 rhythm が自然か
- tabular figures で同じ桁位置が安定するか
- live update 時に digit 幅の変化で周囲が動かないか
- equal width が不要な prose にまで tabular treatment を広げていないか

**tabular figures と monospace typeface は別物**として扱う。
数字だけの桁幅安定が目的なら、まず同一 family の tabular figures を検討する。

### Alignment

比較対象では何を揃えると読みやすいかを決める。

- integer magnitude → 桁位置 / right edge
- fixed precision → decimal separator / decimal places
- signed values → sign column / sign position
- percentage / currency / unit → value と affix の relationship
- range / ratio / time → separator と各 field の consistency

right alignment を「数字だから」という理由だけで使わない。
ID、date、phone-like identifier など arithmetic comparison をしない numeric-looking content は別に判断する。

### Sign, separator, unit and currency

数字本体だけでなく以下を一つの reading unit として確認する。

- plus / minus / accounting negative notation
- decimal separator
- grouping separator
- percent / per-mille
- currency symbol / code
- measurement unit
- approximation / inequality sign
- exponent / scientific notation
- compact notation suffix

locale により glyph、位置、spacing、directionality が変わる。
見た目を揃えるために formatter output を手作業で置換しない。

### Dynamic values

counter / timer / live metric では:

- digit replacement で container width が揺れないか
- value length が増えたとき隣接 element を押し出さないか
- sign / decimal / unit が不必要に移動しないか
- update animation を使う場合も最終 static value が明確か

layout stability が必要だからといって全周辺 text を monospace にしない。

### Identifiers

ID / serial / version / reference number は quantity と分ける。

- leading zero を保持する
- grouping を勝手に追加しない
- decimal と version separator を混同しない
- `0/O`, `1/I/l` 等の識別が本当に重要か
- slashed zero が周囲の font/style と整合するか

slashed zero は data point / code で有効な場合があるが、すべての prose numeral に適用しない。

### Fractions and ordinals

- fraction / numerator / denominator feature が current font にあるか
- feature が対象範囲だけに適用されているか
- slash-separated identifier や date を誤って fraction 化していないか
- ordinal feature が locale / language の表記と一致するか

font feature を paragraph 全体へ機械的に適用しない。

### Japanese and mixed text

- 日本語に対する数字の apparent size / baseline / width
- full-width / half-width を semantic requirement なしに混在させていないか
- unit / percent / currency / parentheses 周辺が浮いていないか
- 縦組では数字を1字ずつ立てる、回転する、縦中横にする等の選択が文脈に合うか
- fallback 時に numeral width / punctuation behavior が変わらないか

cross-family optical matching が必要なら `font-mixing` を併用する。

## Decision rules

### Running prose

- 数字を文章として読むなら、周囲の prose rhythm を優先する。
- proportional figures を第一候補として比較する。
- oldstyle / lining は font と文章 hierarchy を render して決める。
- prose 内の数字を比較用 table と同じ理由で tabular 化しない。

### Comparable columns and lists

- quantity の比較が主目的なら桁位置を安定させる。
- right alignment + tabular figures を有力な基準として検討する。
- precision、unit、sign の揺れを先に正規化できるか確認する。
- `monospace font` は tabular alignment の代替 shortcut にしない。

### Display metrics / KPI

- first-glance readability と hierarchy を優先する。
- lining / tabular が有効かは metric の更新性と隣接要素で決める。
- label、value、unit、trend indicator の hierarchy を一体で見る。
- digits を巨大化するだけで metric hierarchy を作らない。

### Dynamic counters / timers

- update 前後で box geometry が不必要に動くなら tabular figures を検討する。
- value length の境界 (`999 → 1,000`, `9:59 → 10:00`) を必ず試す。
- reduced-motion / no-animation state でも値変更が理解できることを確認する。

### Identifiers

- arithmetic comparison ではなく exact recognition を優先する。
- leading zero、separator、case、prefix/suffix を source data の一部として保持する。
- 必要なら slashed zero / monospace を使うが、識別 problem がない場合まで適用しない。

### Locale first

- formatting semantics は locale formatter / project policy に従う。
- `1,234.56`、`1.234,56`、currency 前置/後置、compact notation、RTL direction を一つの locale から一般化しない。
- typography は formatter output を読みやすく配置する。locale semantics を上書きしない。

## References

詳細な比較観点と source status は [`references/numeric-typography.md`](./references/numeric-typography.md) を読む。

実装前に少なくとも:

- W3C CSS Fonts Level 4
- current production design system 2件以上
- Unicode CLDR

を対象 artifact に応じて開く。
日本語組版または print/editorial が関係する場合は JLReq / Adobe OpenType guidance も確認する。

## Avoid

- 数字を全部 monospace にする
- 数字を全部 tabular figures にする
- table / prose / KPI / identifier を同じ numeric style に統一する
- tracking / letter-spacing で tabular width を偽造する
- font が持たない OpenType feature を存在する前提で設計する
- right alignment だけで precision / unit / sign の不整合を隠す
- locale separator、currency order、compact suffix を hard-code する
- ID を quantity として format して leading zero を消す
- version number を decimal number として整形する
- fraction feature を slash を含む text 全体へ適用する
- slashed zero を prose 全般へ無条件に適用する
- full-width / half-width を見た目だけの理由で一括変換する
- fallback 後の digit width / baseline / symbols を確認しない
- live value が更新されるたびに surrounding layout を揺らす

## Verify

最低限、実際に render して次を比較する。

### Sample set

- prose: `2026年9月14日に12.5%増加した`
- comparable values: positive / negative / zero / decimals / different digit counts
- currency: small / large / negative / fractional
- percentage / measurement with units
- KPI: short value / long value / compact value
- dynamic boundary: `99 → 100`, `999 → 1,000`, `9:59 → 10:00`
- identifier: leading zero、`0/O`、`1/I/l` を含む realistic sample
- fraction / ordinal where product actually uses them
- Japanese + Latin + numerals + symbols
- at least two relevant locales when locale-sensitive output exists

### Render checks

1. prose の rhythm が numeric treatment だけで不自然に割れていない。
2. comparison surface で桁・decimal・sign・unit を追いやすい。
3. tabular / lining / oldstyle / slashed-zero 等の feature が current font で実際に反映される。
4. fallback font でも information が失われず、致命的な width shift がない。
5. dynamic value の代表的な桁数境界で surrounding layout が破綻しない。
6. identifier の leading zero / separator / literal content が保持される。
7. locale を変えて decimal/grouping/currency/percent/compact notation の意味を壊していない。
8. narrow width / browser zoom / user font scaling で clipping・overlap・unit detachment がない。
9. 日本語混植では数字・記号が baseline / apparent size / spacing 上極端に浮かない。
10. print / document artifact なら exported/rasterized page でも decimal alignment、fraction、small text を再確認する。

`font-feature-settings` が設定された、または Storybook が開いた、だけで完了にしない。
