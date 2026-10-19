# レイアウト stress fixture（Issue #416）

> `scrollbar-gutter`、長いリンク / 見出し / 多言語テキストを使う**独立した fixture**で、
> 320px 幅・スクロールバー常時表示の条件下にレイアウト破綻がないことを検出し、
> 「検査そのものが空回りしていない」ことも同じ実行で証明する。
>
> 判定の本体: [`scripts/check-layout-stress.mjs`](../../../scripts/check-layout-stress.mjs) /
> fixture と検出器: [`scripts/layout-stress.mjs`](../../../scripts/layout-stress.mjs) /
> fail-closed ルールの fixture suite: [`scripts/check-layout-stress.test.mjs`](../../../scripts/check-layout-stress.test.mjs) /
> report の生成: [`scripts/make-layout-stress-report.mjs`](../../../scripts/make-layout-stress-report.mjs)。

## なぜ必要か

`compat:check`（Issue #414）は「採用した Web API / CSS が対象ブラウザで動くか」を
manifest として宣言し検証する。**その宣言が実レイアウトで破綻しないこと**は
別の問題で、既存の gate には Visual diff もレイアウト実測もない。CI が緑でも、
320px で 3200px 幅の見出しが横スクロールする可能性がある。

そこで「宣言の検証」と「レイアウトの実測」を分けて、後者を独立 fixture として
持つ。fixture は **Worker / route / dev server に依存しない静的 HTML**で、
generation した CSS は 出荷済みの visual language（`src/styles.css` の base 規則と
`src/editorial/primitives/Container.tsx` のページ幅 / 余白）を写している。

## 何を測るか

10 個の stress story を 1 つの document に並べ、各 story に測定対象（target）と
観測点を宣言する。宣言（`STRESS_SECTIONS`）が fixture の生成と判定の双方の
唯一の情報源なので、story を足して target を宣言し忘れると `stress_target_missing`
で落ちる。

| # | story | 何を潰すか |
| --- | --- | --- |
| 01 | heading | 32px の長見出し、`text-wrap: balance` による日本語 / 英語 / 結合 |
| 02 | link | クエリとパスを含む長い URL（`src/styles.css` がローカル宣言する break-all） |
| 03 | identifier | 長いシンボル名・content hash |
| 04 | multilingual | 日 / 英 / 独 / 仏 / 露 / 韓 / アラビア / タイ・絵文字・結合文字・RTL |
| 05 | prose | `text-wrap: pretty` の長文段落 |
| 06 | grid | `minmax(0, 1fr)` と `min-width: 0` による grid の blowout |
| 07 | table | `min-width` のある表をスクロールコンテナに閉じ込める |
| 08 | code | 折り返さない `pre` と段落内インライン `code` |
| 09 | cta | 長いラベルを持つ折り返す flex 行 |
| 10 | gutter | 全幅の帯 / コンテナが、スクロールバーの有無で幅を変えないこと |

判定は「スクロールバーのある状態」と「スクロールバーを消した状態」の 2 回の実測を
同じ pure function（`evaluateStressRun`）に渡して行う。許差は sub-pixel の
**1px**（`TOLERANCE_PX`）。

`purpose` は fixture document に描かれ、report の画像にもそのまま写る文言である。
そのため「宣言した言語」を名指ししている story については、**宣言された言語が
実際にレンダリングされていること**を suite（`DECLARED_LANGUAGE_SCRIPTS`）が検証する。
タイ語は語間に空白がなく辞書の行分割でしか折り返せないため、320px では最も厳しい
ケースであり、宣言だけの言語にするとちょうどそこだけ検証されないまま報告される。

## 無言の合格にならないための fail 条件

誤検知も「検査が走っていない」ことも、そのまま合格にしないため、以下はすべて **error**：

| rule | 意味 |
| --- | --- |
| `snapshot_incomplete` | 計測値が来ていない（fixture が測られていない） |
| `scroll_scenario_unreproduced` | document が縦にスクロールせず、スクロールバー自体が一度も現れない |
| `fixture_section_missing` | 宣言した story が無い、または面積 0 で描画された |
| `fixture_section_undeclared` | 描画された story が宣言に無い |
| `stress_target_missing` | 宣言した target が計測されていない |
| `stress_target_undeclared` | 計測された target が宣言に無い |
| `scroll_anchor_missing` | scroll-contained を宣言した target にスクロールコンテナが無い |
| `scroll_anchor_clipped` | scroll-contained を宣言した target の最も近いインライン軸の祖先が `overflow-x: hidden` / `clip` で、スクロールではなく**切り取る**。`hidden` はユーザーがスクロールできないので、480px の表は切り取られて到達不能になる（scroll anchor として受理しない） |
| `viewport_overflow` | document が横スクロールする |
| `target_overflow` | target がコンテンツボックスをはみ出す |
| `gutter_policy_missing` | `scrollbar-gutter: stable` が適用されていない |
| `gutter_not_reserved` | classic scrollbar の環境で gutter の予約幅が実測と合わない（**ブラウザ経路では到達不可能**：fixture が `html { overflow-y: scroll }` を強制するので root scrollbar は常に描画され、`scrollbar-gutter` の値によらず `documentGutter === scrollbarWidth` になる。ブラウザ経路で予約を証明するのは `content_shift`。この rule を落とすのは test 側の模した snapshot だけ） |
| `gutter_probe_missing` | 宣言した gutter probe が「スクロールバーあり / なし」の両方で測定されていない（shift 比較が無言で空振りするのを防ぐ） |
| `content_shift` | 全幅 probe の幅が、スクロールバーの有無で変わる |

さらに **warning** が 1 つある。platform が overlay scrollbar（予約幅 0px）で
gutter の実効性を観測できない環境では、shift 系は「測っていない」ので
`gutter_not_observable` として残す（無言の合格にしない）。

### scroll anchor は「スクロールするもの」だけを数える

`data-stress-scroll-contained` は「この target はコンテンツボックスの検査から
外してよい」という宣言なので、その opt-out を証明するのは**ユーザーが到達できる**
スクロールコンテナだけである。祖先走査は最も近いインライン軸の祖先で打ち切り、
`overflow-x: auto` / `scroll` だけを `scrollAnchor` として記録する。
`hidden` / `clip` はスクロールを許さないので切り取りに過ぎず、
`clippingAnchor` として別立ての `scroll_anchor_clipped` で落とす。
これを anchor として受理していた前は、480px の表が `hidden` の裏に隠れたまま
境界検査だけを飛ばし、document 側もはみ出さないので、baseline は**到達不能な表を
綠のまま承認する**無言の合格になっていた。より外側のスクロールコンテナは
救済にならない（内側で既に切れている）ので、その場合も `clipped` として落とす。

### control — 検出器が必ず落ちることを同じ実行で示す

healthy な fixture とは別に、同じ document に意図的 defect を 1 つずつ注入した
3 つの control を同じ実測経路に通し、**想定した rule で捕捉されること**を要求する。
control が生き残れば `detector_unproven` として **exit 2**（= exit 1 の
「fixture が壊れている」とは別の結果）。

| control | defect | 捕捉されるべき rule |
| --- | --- | --- |
| `control-gutter` | `scrollbar-gutter: auto` — 予約が解けて全幅が動く | `content_shift`（overlay scrollbar 環境では `gutter_policy_missing`） |
| `control-overflow` | 固定幅 1200px のブロック | `viewport_overflow` + `target_overflow` |
| `control-clip` | 表のスクロールコンテナを `overflow-x: hidden` に差し替える（スクロールを取り除く） | `scroll_anchor_clipped` |

## fixture の gutter policy は fixture 固有の宣言

この fixture は `html { scrollbar-gutter: stable; overflow-y: scroll }` を宣言するが、
**出荷 CSS（`src/styles.css`）には同じ宣言が無い**（`src/**` のいずれにも
`scrollbar-gutter` の宣言は無い）。つまり baseline の PASS は
「この policy を宣言した document は 320px で破綻しない」ことの証拠であり、
「出荷面が gutter を予約している」ことの証拠ではない。実際の出荷面は
`auto` のままで、`control-gutter` が測っている状況と等価である。

この隔たりを隠さないために 3 つの手当てをしている。

1. fixture の `gutter` story の `purpose`（= fixture document に描かれ、WebP に写る文言）に
   「この宣言は fixture 固有」であることを明記する。
2. report は `src/styles.css` を**読んで**その事実を文章にする（「出荷 CSS が宣言していれば
   対応する文になる」）。手で書いた主張は drift するため。
3. `scripts/check-layout-stress.test.mjs` が (1)(2) の両方を検証する。

**出荷 CSS に `scrollbar-gutter: stable` を採用するかどうかは owner の判断**で、本 PR では
決めていない。採用すれば全スクロール可能 page の予約幅が変わる製品上の変更であり、
採用しないなら「gutter 予約」は出荷面には未適用の policy として扱われるべきである。

## 実行方法

```bash
pnpm run compat:stress:check                                # gate 本体（exit 0）
pnpm run compat:stress:check -- --json                      # 機械可読な結果
pnpm run compat:stress:check -- --width 375                 # 別の幅でも同じ判定経路
node --test scripts/check-layout-stress.test.mjs            # fail-closed ルールの fixture suite
pnpm run verify:compat-stress-screenshot                    # report HTML + WebP を再生成
```

fixture 自体は `pnpm run compat:stress:check` が生成する
`file://$PWD/.tmp/layout-stress/baseline.html`（`.tmp/` は gitignored）。
同じ URL をブラウザで開けば 320px でそのまま見られる。expected result
（本 PR の記録環境で実行した実出力そのまま。overlay scrollbar のため
`gutter_not_observable` warning が毎回付き、gutter probe の Δ は 0.00px で
「予約幅が 0px なので差も 0」という観測であることに注意）:

```text
layout stress (Issue #416) · viewport 320x640 · chromium 153.0.8010.12
environment: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36 · language en-US

PASS  baseline
  sections 10 · targets 21 · scrollWidth 320 / clientWidth 320 · scrollbar 0px · gutter declared "stable" (overlay scrollbars: shift not observable)
  gutter probe gutter-band: 288.00px with scrollbar / 288.00px without (Δ 0.00px)
  gutter probe gutter-container: 288.00px with scrollbar / 288.00px without (Δ 0.00px)
  WARN  gutter_not_observable: this platform paints overlay scrollbars (reserved gutter 0px) — gutter reservation and shift cannot be measured here

CONTROL  control-gutter  (deliberate defect: `scrollbar-gutter: auto` — the gutter is released when the scrollbar is not in play, so full-width content shifts)
  sections 10 · targets 21 · scrollWidth 320 / clientWidth 320 · scrollbar 0px · gutter declared "auto" (overlay scrollbars: shift not observable)
  gutter probe gutter-band: 288.00px with scrollbar / 288.00px without (Δ 0.00px)
  gutter probe gutter-container: 288.00px with scrollbar / 288.00px without (Δ 0.00px)
  ERROR gutter_policy_missing: the fixture declares scrollbar-gutter: stable but the computed value is "auto"
  WARN  gutter_not_observable: this platform paints overlay scrollbars (reserved gutter 0px) — gutter reservation and shift cannot be measured here

CONTROL  control-overflow  (deliberate defect: a fixed 1200px block — the classic long-unbreakable-content overflow)
  sections 10 · targets 22 · scrollWidth 1200 / clientWidth 320 · scrollbar 0px · gutter declared "stable" (overlay scrollbars: shift not observable)
  gutter probe gutter-band: 288.00px with scrollbar / 288.00px without (Δ 0.00px)
  gutter probe gutter-container: 288.00px with scrollbar / 288.00px without (Δ 0.00px)
  ERROR viewport_overflow: the document scrolls horizontally at 320px (scrollWidth 1200 > clientWidth 320)
  ERROR target_overflow: target "control-overflow-block" (control-overflow の固定幅ブロック) leaves the content box by 880.00px
  WARN  gutter_not_observable: this platform paints overlay scrollbars (reserved gutter 0px) — gutter reservation and shift cannot be measured here

CONTROL  control-clip  (deliberate defect: the wide table's scroll container turned into a clip — the content is cut off with no way to scroll to it)
  sections 10 · targets 21 · scrollWidth 320 / clientWidth 320 · scrollbar 0px · gutter declared "stable" (overlay scrollbars: shift not observable)
  gutter probe gutter-band: 288.00px with scrollbar / 288.00px without (Δ 0.00px)
  gutter probe gutter-container: 288.00px with scrollbar / 288.00px without (Δ 0.00px)
  ERROR scroll_anchor_clipped: target "table" (最小幅を持つ表（scroll-contained）) is declared scroll-contained but its nearest inline-axis ancestor "table-scroller" clips instead of scrolling, so the overflow is unreachable
  WARN  gutter_not_observable: this platform paints overlay scrollbars (reserved gutter 0px) — gutter reservation and shift cannot be measured here

errors (0)
```

## 導入範囲の実行結果と環境

| 対象 | どこで走る | 結果 |
| --- | --- | --- |
| `evaluateStressRun` の全 rule（41 cases） | `pnpm run test` → CI `validate` job | pass |
| browser 半の gate（4 variant の実測） | `pnpm run compat:stress:check`（Chromium 必要） | baseline PASS / control 3 件捕捉 / exit 0 |
| report と WebP | `pnpm run verify:compat-stress-screenshot` | `docs/verification/compat/stress-story.webp` 生成 |

この PR の記録した実行環境:

```text
node        v26.12.0
platform    darwin arm64 (macOS 27.0.1)
chromium    153.0.8010.12 (playwright, headless)
viewport    320x640, deviceScaleFactor 1
scrollbar   予約幅 0px → overlay scrollbar。gutter の実効性はこの環境では
            観測できないため gutter_not_observable の warning として記録される。
            content_shift / gutter_not_reserved は classic scrollbar の
            環境でのみ観測される。本リポジトリには現在その条件を満たす
            記録が 1 件も存在しない（下の「既知の制約」参照）。
```

**CI について**: browser を起動する `compat:stress:check` は `validate:fast` にも、
`.github/workflows/compat.yml`（Issue #415）にも入れていない。前者は
offline・read-only・安価が契約で browser 起動はその契約を変えるため、後者は
「3 engine で出荷 UI が smoke する」という別 obligation への追加であり、
本 fixture はどちらの surface も測っていない（route も起動もしない）。CI に入れる判断を避けている理由は 1 つで、**この fixture の折り返し結果は host の
font metrics に依存する**ため。system font チェーンを使う fixture を、手元で再現
できない ubuntu-latest runner へ「跨る条件」として縛るのは、検証していない主張を
CI に持ち込むことになるため。代わりに**判定の pure 半**を
`check-layout-stress.test.mjs` として `pnpm run test` に結線してあるので、
CI では「検出器が必ず落ちること」が毎回検証される。実測は Chromium が入手済みなら
任意の環境で再現できる（`pnpm run e2e:install`）。

## スクリーンショット

- 保存先: `docs/verification/compat/stress-story.webp`
  （Issue 本文の `stress-story.png` と同じ path stem を使い、拡張子のみ `.webp`。
  PNG は repository を不必要に膨らませるため commit しない）
- 生成: `pnpm run verify:compat-stress-screenshot`
  （gate が落ちている場合は report を生成せず exit 1。
  capture は Chromium の PNG buffer を memory 上だけで持ち、最後に `sharp` で
  WebP 化。`scripts/_lazy-media-image.mjs` の 300 KB budget を超える場合は
  file を消して失敗する）
- 画像の内容: gate の判定表 + healthy fixture の**宣言された 10 story 全部**の実画面
  （320px 実寸。撮影リストは fixture 宣言 `STRESS_STORY_IDS` から生成しているので、
  story を追加しても撮影だけが取り残されない）+ `control-overflow` の実画面。
  **緑 1 枚だけの report にしていない**のは、壊れているときの見え方も同じ report に
  あるべきだから。
- capture の画角: 各 story はその section の領域を切り出して撮る（fold をまたいで
  半分だけ入ることを避けるため）。`control-overflow` は注入 block を含む document
  末尾の領域を切り出す。block は `<body>` の最後の子で 10 section のおよそ 8
  viewport 下にあるため、画角を指定しないと「fold 上の健全な画面」だけが写って
  いた。
- caption と画素の対応: `control-overflow` の capture には fixture が
  描画する defect 色 `#0ea5e9` が実際に含まれていることを生成時に数え、
  足りない場合は report を書かずに失敗する。キャプションは画像の主張なので、
  画素を伴わないまま「意図的 defect」を名乗ることを構造的に防ぐ。
- 符号化: 1500px / quality 45（`scripts/_lazy-media-image.mjs` の 300 KB budget 内、
  実測 293,296 B）。他の verification report が quality 80 を使うのに下回るのは、
  11 枚の 320px viewport capture を含むため。page の幅を縮めたのであって、
  文字サイズを縮めたわけではない。

## 既知の制約

- **fixture の `scrollbar-gutter: stable` は出荷 CSS に無い**（前の節参照）。出荷 CSS に
  採用するかは owner 判断。
- fixture は静的 HTML であり、出荷 route を実際にレンダリングしたものではない。
  出荷 CSS（`styled-system/` の生成物）は fixture に embed していないので、
  token を変えたとき fixture の CSS 自体は追随しない。**コピーのずれは gate で
  検出する**：`scripts/check-layout-stress.test.mjs` が `src/editorial/tokens.ts` /
  `src/editorial/primitives/Container.tsx` を読み、fixture が使う色・ breakpoint・
  Container の max-width / page margin が今も出荷側と一致することを検証する
  （一致しなければ赤になる）。fixture を token から**生成**する形は別 Issue
  （本 Issue のスコープ外）。
- `text-wrap` は語を割らない。したがって「72 文字の分割できない英単語の見出し」は
  実測で overflow する。出荷 surface がそのような見出しを描いていないため、
  fixture ではそのケースを identifier story（`src/styles.css` が break-all を
  宣言している場所）に置いてある。見出し側で break を許す判断は別の決定。
- overlay scrollbar の環境では gutter 系（`content_shift` / `gutter_not_reserved`）が
  原理的に観測できず、`gutter_not_observable` の warning になる。**本リポジトリには
  classic scrollbar で観測した記録が 1 件も存在しない。** macOS の Chromium は
  overlay scrollbar 固定で、この host で実測した範囲（既定 / `--headless=new` /
  `--disable-features=OverlayScrollbar` /
  `--disable-features=OverlayScrollbar,FluentOverlayScrollbar` / headful のいずれも
  予約幅 0px）では classic 化しない。したがって「gutter に関するこの gate は何も
  主張していない」という状態はすでに存在し、CI に実測が記録されているわけでは
  ない（下の「CI について」の通り、browser 半はどの workflow にも入っていない）。
  証拠になっているのは次の 2 点だけである。
  1. 判定の pure 半は classic scrollbar を**模した snapshot**
     （`scripts/check-layout-stress.test.mjs`）で `gutter_not_reserved` /
     `content_shift` / `gutter_probe_missing` が落ちることが検証されている。
  2. 実 browser で classic scrollbar を 1 度でも観測する条件を CI（Linux runner）
     へ追加するか、受け入れ条件の「visible scrollbar」をこのプラットフォーム
     現実に合わせて再定義するかは **owner の判断**であり、本 PR では決めていない。
- 検出は Chromium 1 engine での実測（E2E と同じ方針）。多 engine の検証は
  Issue #415（`.github/workflows/compat.yml`、3 engine の public UI smoke）が
  所有し、CJK 禁則処理の実測は Issue #431（`scripts/cjk-line-break-measure.mjs`、
  `/design-system` route）が所有する。本 Issue と重複しないのは、本 fixture が
  「記法（どの文字が行頭に来るか）」ではなく「幅（はみ出すか・ずれるか）」を測るため。
- fixture の CSS は token 値を手書きで写しているため、生成物ではない
  （上の drift test がずれだけを検出する）。
- viewport は fixture 内では `320px` を固定している。gate の `--width` は
  document の viewport 幅を変えるだけで、story 側の CSS は
  `src/editorial/tokens.ts#breakpoints`（md 768 / lg 1024）に追随する。
