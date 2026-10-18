# Performance evidence (`docs/verification/perf/`)

Two independent measurement records live in this directory, one per Issue.
They answer different questions, so they are kept as separate documents
appended here rather than merged into one narrative.

| Document | Issue | Committed screenshot |
| --- | --- | --- |
| First-visit webfont measurement | #485 | `font-firstpaint-snapshot.webp` |
| 画像 CLS 回帰の証跡 | #486 | `images-cls-fixture.webp` |
| Large-list pagination measurement | #490 | `large-list-pagination.webp` (see `large-list-pagination.md`) |

---

## First-visit webfont measurement (Issue #485)

Reproduction record for the first-visit webfont / FOUT / CLS
measurement of the shipped Home and About surfaces.

This directory is evidence for one ticket, not a gate. Nothing in
`quality/profile.yaml` was changed by it, and the measurement command
is deliberately **not** wired into `validate:fast` / `validate:integration`
/ `validate:release` — see "Impact on `quality/profile.yaml`" below.

### Contents

| File | What it is |
| --- | --- |
| `font-firstpaint-snapshot.webp` | The committed measurement report: environment block (including the exact invocation it was produced by), per-run metrics, layout-shift attribution for this capture **and for the before capture it was compared against**, before/after tables, and the per-scenario page captures. The Issue names `font-firstpaint-snapshot.png`; the committed file is the WebP conversion of that capture (1280x3327, 256 KB, sharp WebP at quality 80 — the intermediate PNG is never committed) |

### What is measured

`scripts/font-first-paint-measure.mjs` (`pnpm run perf:fonts:measure`) drives
the installed Playwright Chromium against a **local** origin and records,
per route and scenario:

- `first-contentful-paint`, `largest-contentful-paint` (+ the LCP element),
- session-windowed cumulative layout shift (`layout-shift`, input-excluded,
  5 s session / 1 s gap — the definition CLS is specified with),
- the **swap instant**: the first moment a webfont `FontFace` reports
  `loaded` (`document.fonts.ready` is deliberately not used — it resolves
  before the stylesheet is parsed, so it reports a swap that never
  happened),
- `fonts.googleapis.com` / `fonts.gstatic.com` resource timing, split into
  requests that **delivered** a response and requests that were **aborted**
  (the blocked scenario aborts them on purpose, and Chromium keeps the
  entry either way),
- whether the webfont pipeline is usable **from this host at all**: the
  probe fetches the Google stylesheet, follows it to the `gstatic` face
  it references and asks for that too. Checking only the stylesheet host
  would report a run as a real webfont swap on a network that serves the
  CSS and blocks the font file, which is precisely the state in which no
  swap can ever be observed,
- layout-shift **sources** — the element and rect pairs that moved, for
  this capture and for the before capture passed with `--compare`,
- a fallback-readability verdict over real text probes in the blocked
  scenario, which fails both when the page has nothing legible left and
  when the block silently did not apply.

#### Absence is not zero

A metric that was never observed is recorded as `null` and rendered as
`n/a` — in `report.json`, in the report table and on stdout. The blocked
scenario has no webfont face to swap to, so it has no swap instant; `0 ms`
there would claim a measurement that does not exist, and `Math.round(null
* 1000) / 1000` is `0`, which is exactly what the first version of this
report did. For the same reason the before/after aggregate only covers
runs measured on **both** sides and prints how many that was (`paired
runs`): a route that only exists in one capture cannot be shown as an
improvement.

#### Scenarios

| Scenario | Condition | Question it answers |
| --- | --- | --- |
| `baseline` | no throttling, font origin reachable (the report records when it is not) | what does a first visit cost when the font arrives |
| `blocked` | `fonts.googleapis.com` + `fonts.gstatic.com` aborted | is there still readable text when the font origin is unreachable — the condition Issue #291's async-CSS pattern must survive |
| `slow-font` | CPU throttled x4, every font-origin response delayed 1500 ms | how long the FOUT window lasts and what it moves |

The settle window opens **when the swap lands**, not at a fixed offset:
in `slow-font` the swap is ~3.8 s in, and a fixed window that closed
before it would drop the very shift the swap causes. Both waits are
bounded (15 s) — including the `document.fonts.ready` settle, which
otherwise hangs forever on a stalled font request and would stall the run
before it can report anything — and a swap that never lands stays `n/a`.

The report records the invocation that produced it (origin, routes,
`--compare` input, timestamp, command line) next to the numbers, so two
captures of the same command on two ports can never be confused.

The script exits `0` on a completed measurement and non-zero only when
the measurement is impossible (no browser, unreachable base URL, a route
that does not answer 2xx). **It never fails on a metric**: thresholds are
Issue #386's obligation, the Lighthouse report harness is Issue #384's,
and the release gate is Issue #385's. Fusing them here is the confusion
Issue #485 asks to avoid.

### How to reproduce

```sh
pnpm run build                                  # production-equivalent local build
node scripts/e2e-local-bootstrap.mjs --port=15907 &   # local D1 + vite preview
pnpm run perf:fonts:measure -- \
  --base-url http://127.0.0.1:15907 \
  --out .tmp/font-first-paint/after
```

Artifacts land in `.tmp/font-first-paint/<out>/` (`report.json`,
`report.html`, one PNG per run). `.tmp/` is gitignored — only the
committed snapshot above is repository state.

To produce a before/after table, measure the pre-fix state first and
pass that report back. The fix is `src/styles.css` plus
`src/editorial/tokens.ts` only, so restoring those two files to their
pre-fix content and rebuilding is enough — the measurement script is
unchanged and both captures are taken with the same code:

```sh
git show <pre-fix-sha>:src/styles.css > src/styles.css
git show <pre-fix-sha>:src/editorial/tokens.ts > src/editorial/tokens.ts
pnpm run build && pnpm run perf:fonts:measure -- --base-url http://127.0.0.1:15907 \
  --out .tmp/font-first-paint/before

git restore src/styles.css src/editorial/tokens.ts && pnpm run build
pnpm run perf:fonts:measure -- --base-url http://127.0.0.1:15907 \
  --out .tmp/font-first-paint/after \
  --compare .tmp/font-first-paint/before/report.json
```

A working-tree restore is why the before capture is recorded with
`dirty: true`; the after capture was taken on a clean commit, so the
committed snapshot is verifiable against the SHA it names.

### Recorded conditions

Every number in the committed snapshot carries these, because a number
without them is not evidence:

| Condition | Value |
| --- | --- |
| Browser | Chromium 153.0.8010.12 (Playwright `^1.63.0`), headless |
| Viewport | 1280x800 @1x |
| Network | default Chromium (no throttling); webfont pipeline reachable — `stylesheet HTTP 200 + face HTTP 200` (both hosts probed) |
| CPU | throttle x4 in `slow-font`; host Apple M5 x10, darwin arm64 |
| Font delay | 1500 ms per font-origin response in `slow-font` |
| Host | macOS (darwin 27.0.0, arm64), 24 GB |
| Source (after, this snapshot) | branch `485`, commit `7acb11d`, clean tree |
| Source (before, `--compare` input) | branch `485`, commit `7acb11d`, dirty tree — `src/styles.css` and `src/editorial/tokens.ts` restored to their pre-fix content, which is exactly what the fix changes |

Both captures ran the same script commit, so the only difference between
them is the two restored files. The before capture names `7acb11d` rather
than the SHA it was built from on purpose: the script that produced the
numbers is the thing a reader has to trust to be the same, and that is
provable, while the built state is documented by `dirty: true` plus the
restore recipe above.

Desktop viewport only. A mobile matrix is not measured here — it belongs
with the Core Web Vitals budgets in Issue #386, which owns device and
budget definitions.

### Results

Pre-fix and post-fix, same script version, same host, same routes,
captured from the local preview build. The blocked rows have no swap
instant in either column, which is the point: there was no webfont to
swap to.

| Route | Scenario | CLS before | CLS after | FCP before / after (ms) | swap before / after (ms) |
| --- | --- | --- | --- | --- | --- |
| `/` | baseline | 0 | 0.002 | 144 / 140 | 686.1 / 730.6 |
| `/` | blocked | 0 | 0 | 128 / 116 | n/a / n/a |
| `/` | slow-font | 0.146 | **0.001** | 348 / 336 | 4550.9 / 3957.8 |
| `/about` | baseline | 0.975 | **0.001** | 152 / 148 | 532.3 / 529.1 |
| `/about` | blocked | 0 | 0 | 144 / 148 | n/a / n/a |
| `/about` | slow-font | 0.487 | **0.001** | 444 / 464 | 3931.7 / 3841.8 |

Read the CLS column and ignore the paint/swap columns: those are
single-run timings against a third-party origin and move by ±100 ms
between runs of the same build.

The CLS column is a **per-build** measurement, not a promise that the
value repeats. A row either wraps or it does not on the build that was
measured, and the `/` route sits close enough to its wrap threshold to
be measured on both sides of it: in these two captures `/` `baseline` is
`0` before and `0.002` after — both three orders of magnitude below the
criterion, but not the same number. The re-wrap reproduced on `/about`,
in both `baseline` and `slow-font`, where the shift is large enough
(0.487 / 0.975) that the verdict does not depend on which side of the
threshold the row falls.

**Pass criteria used for this ticket** (informational, not a gate):

| Criterion | Before | After |
| --- | --- | --- |
| `/about` and `/` read with the font origin blocked | readable (8/8 probes each) | readable (8/8 probes each) |
| CLS <= 0.1 in every scenario on both routes | 2 of 6 runs failed (`/about` 0.975 / 0.487) | 6 of 6 pass (max 0.002) |

0.1 is the Web Vitals "good" boundary for CLS and is used here only to
state whether the fix worked; nothing enforces it.

### What the shift actually was

A bare CLS number is unattributable. The committed snapshot carries the
sources for the two largest shifts of every run **of both captures**
("where the shift came from — before / after"), so the numbers above can
be checked against the elements that moved:

```
/about  baseline   before   shift 0.487 at 320.7ms
    ul    "ホームHome…"  872x29 -> 864x70     <- the desktop nav wraps to a second row
    main  "01 — Identity…"  1280x112 -> 1280x71
/about  baseline   before   shift 0.487 at 574.8ms
    ul    "ホームHome…"  864x70 -> 868x29     <- and unwraps when the webfont settles
/about  baseline   after    shift 0.001 at 358.7ms
    ul    "ホームHome…"  872x29 -> 836x29     <- same row, still one line
/about  baseline   after    shift 0.001 at 652.9ms
    ul    "ホームHome…"  836x29 -> 872x29
/about  slow-font  before   shift 0.487 at 2082.1ms  (same pair again, 3.9 s in)
    ul    "ホームHome…"  872x29 -> 864x70
/about  slow-font  after    shift 0.001 at 2073.8ms
    ul    "ホームHome…"  872x29 -> 836x29
```

Before, the nav row's height goes 29px -> 70px and back: a re-wrap, not
an image or an ad slot. After, the same row changes width (872 -> 836 ->
872) while its height stays 29px, which is a shift of 0.001 instead of
0.487.

On `/` the fix shows up differently, and both captures say so
explicitly: the pre-fix `slow-font` run re-wrapped the hero CTA row
(`main` 1280x331 -> 1280x365, `a` 199x24 -> 194x40, plus a `li`
appearing, 0.146 at 4796 ms), while after it records two 0.001 shifts on
an unchanged `307x77` `p` box. The `baseline` rows for `/` are the
knife-edge case described above: 0 before, 0.002 after, both far below
the criterion, from a different element than the one that used to wrap.

The desktop nav row sits within ~1% of its wrap threshold — the
component already records this ("at `lg`+ gap 3 brings the full roster
onto one measured line (871.5px <= 880.4px)"). A `space-between` header
puts the brand mark in the same flex line, and the brand is set in the
`heading` family, so when the webfont swap changes the brand's width the
row's remaining budget crosses the threshold and wraps — then unwraps
when the webfont settles.

### The one fix

One element, one root cause: a **metric-compatible fallback face** for
each webfont family, defined at the top of `src/styles.css` and placed
ahead of the raw platform names in the `sans` / `heading` tokens
(`src/editorial/tokens.ts`). The four `@font-face` rules and the two
token chains are the same element — the fallback metric mismatch behind
the existing `display=swap` window — not four separate changes. The faces
are the same local font the chain already named, scaled with
`size-adjust` plus `ascent-override` / `descent-override` so the pre-swap
fallback occupies the space the webfont will occupy, and the row stops
crossing the threshold.

The values were measured, not guessed — canvas `measureText` at 100 px
over the real nav/label strings, on the reference host above:

| Webfont | Weight | local face | size-adjust | ascent | descent |
| --- | --- | --- | --- | --- | --- |
| Noto Sans JP | 400 | `Hiragino Kaku Gothic ProN W3` | 94.24% | 123% | 30% |
| Noto Sans JP | 700 | `Hiragino Kaku Gothic ProN W6` | 92.43% | 125% | 31% |
| Zen Kaku Gothic New | 400 | `Hiragino Kaku Gothic ProN W3` | 90.45% | 128% | 32% |
| Zen Kaku Gothic New | 700 | `Hiragino Kaku Gothic ProN W6` | 86.17% | 134% | 33% |

Each rule's `src` and its metrics name the **same** face, and the face is
the right weight for the rule. The 700 rules point at `W6` (bold): a
`font-weight: 700` rule naming `W3` would make the browser believe the
swap window already has a bold face, so heading tier would be drawn with
regular outlines exactly when the fallback is supposed to look like the
page, and nothing would compensate with synthetic bolding. Measured
against `W3` the 700 faces would be 97.77% / 91.14% instead — which is
the mismatch an earlier revision of this ticket shipped, since the
metrics were taken at family level (where macOS answers 600 and 700 with
`W6`) while the rule named `W3`.

There is no 600 rule, deliberately. On this host only `W3` and `W6` of
`Hiragino Kaku Gothic ProN` resolve — `W0/W1/W2/W4/W5/W7` fall back to
the default face (verified by measuring every full name, and by the
identical fallback width they produce) — and macOS itself answers a
family-level 600 request with `W6`. Declaring 700 only means the 600
requests in the shipped surfaces resolve through the bold face, which is
what the platform already did: no hierarchy loss in the swap window, and
no invented face.

Two things this deliberately does **not** touch:

- the async-CSS pattern from Issue #291 (`media="print"` + the inline
  flip script) and `display=swap` — the swap window still exists, it just
  no longer moves boxes;
- any threshold, gate or CI step.

`src: local('Hiragino Kaku Gothic ProN W3')` (or `W6`) names the
**full** face name: Chromium resolves `local()` against the full name
only, and the family name leaves the rule `unloaded` — a silent no-op
rather than a failure. Verified on the reference host. Where the local
face does not exist, the rule fails to load and the token chain falls
through to `system-ui` exactly as before, so the override cannot make a
platform it was not measured on worse.

### Impact on `quality/profile.yaml`

Recorded, and **deliberately zero**:

| Profile surface | Effect |
| --- | --- |
| `gates.fast` / `gates.integration` / `gates.release` | unchanged — no measurement step was added to any `validate:*` entry point |
| `ci.jobs` / `ci.required_checks` | unchanged — no workflow change, no new required check |
| `change_risk_mapping` | unchanged — this ticket touches `src/styles.css`, `src/editorial/tokens.ts` and a script: `src_unit` / `config_only`, both already mapped to `fast` |
| `coverage_policy` | unchanged — no coverage data collected |

`perf:fonts:measure` is a manual, artefact-producing command in the same
family as `layout-audit-shoot`. Adding it to a gate would turn a
measurement into a threshold decision before Issue #386 has defined
budgets and device matrices, and would make a flaky third-party origin a
red CI run. That ordering is the point of the split.

### Reproducing on a CI runner

Not wired, deliberately — and not reproducible as written. The metric
face is `src: local('Hiragino Kaku Gothic ProN W3')`, which cannot
resolve on a Linux runner: the rule fails to load and the chain falls
through to `system-ui`, i.e. the pre-fix behaviour. A CI run would
therefore not reproduce these CLS numbers *with or without* the fix —
the measurement is macOS-specific by construction, which is why the
report records the host and why the command is not a gate.

Making it CI-reproducible needs an owner decision, not a script change:

1. measure a Linux-visible metric override per platform, or
2. serve a pinned font from the repository instead of `local()`, or
3. run the measurement on a macOS runner.

All three also assume the runner can reach `fonts.googleapis.com` /
`fonts.gstatic.com`; the report probes both hosts and says so per run,
but a runner without egress turns `baseline` and `slow-font` into
"platform fallback, no swap" rows.

### Known limits

- Desktop viewport only; no mobile matrix (Issue #386).
- One run per scenario. A layout shift is a measurement of the build it
  was taken on, not a distribution: the `/` `baseline` row reads 0 before
  and 0.002 after, and `/about` is far enough from its threshold for the
  verdict not to depend on which side it falls. The timing rows are not
  repeatable at all, and this ticket deliberately does not average them.
- The metric values are macOS-specific by construction (see above). Other
  platforms keep today's behaviour via the chain fallback; a
  platform-specific override would need its own measurement.
- In Chromium the faces the CSS font loader fetches do not appear in the
  resource buffer at all, so the counted font-origin request is the
  Google Fonts stylesheet. `fonts.gstatic.com` sends no
  `Timing-Allow-Origin` either, so its responses would carry neither
  bytes nor a response start; the report counts them as not delivered
  rather than guessing.
- The before capture was taken with the pre-fix `src/styles.css` and
  `src/editorial/tokens.ts` in a dirty working tree (that is what
  measuring the old build means), so it records `dirty: true`. The after
  capture, which is what the committed snapshot renders, was taken on a
  clean commit.

---

## 画像 CLS 回帰の証跡（Issue #486）

`images-cls-fixture.webp` は Issue #486 が要求するスクリーンショットであり、
`/design-system` の `07 — Image` セクションで実測した**ブラウザ / CI レポート**である。

![image CLS regression — Issue #486](./images-cls-fixture.webp)

このファイルは「その画像が何を主張しているか」の正本。数値は
`.tmp/image-cls-report.json`（未 commit）にも machine-readable で残る。

> **拡張子は Issue が名指しした `.png` ではなく `.webp`。** Chromium の full-page
> capture を PNG で持つと 1 枚 360KB になり、再生成のたびにそれが repository に
> 積み上がる。WebP quality 80 は平坦な UI color と mono 文字・flat gradient には
> 視覚差が無く、121KB で収まる。生成 script 側で **幅 ≤ 1600px / quality 80 /
> 300KB 上限**を assert しており、超過したら commit せず終了する
> （`scripts/image-cls-report.mjs#encodeEvidence`）。PNG は commit していない。

### 何の回帰を測るか

`portfolio_media` は intrinsic size（`width` / `height`）を D1 に持っていたが、
UI の `<img>` はそれを表現していなかった。`<img>` は `width: 100%` + `height: auto`
だけで、intrinsic size を知らない状態では **height 0px** から始まる。`loading="lazy"`
の cover が訪問者のスクロール後に解決すると、その下の要素がすべて押し下げられる。
つまり画像入り surface における純粋な CLS shift である。

修正は 1 要素（`PortfolioMediaFigure` の `<img>`）に閉じていて、
予約機構は次の 3 つだけ:

1. row が正の intrinsic size を持つとき `width` / `height` 属性を出す
   → UA が `aspect-ratio: auto <w> / <h>` を導出し|first paint から枠を確保する
2. 同じ比率を inline `aspect-ratio` として明示する
   → 属性から比率を導出しない engine でも予約が効く
3. （同じ枠契約の延長）`error` で placeholder に差し替えるとき、placeholder frame
   も同じ比率で塗るので**差し替えでも高さが変わらない**

`src/portfolio/components/PortfolioMedia.tsx` が canonical。

### fixture を使う理由（`/portfolio` を測らない理由）

`/portfolio` はローカルで画像を 1 枚も描画できない。`composeMediaUrl`
（`src/portfolio/media.ts`）は R2 の public custom domain が束縛されるまで `null` を返し、
`MEDIA_PUBLIC_BASE_URL` は production-only var である（`wrangler.production.jsonc`）。
したがってローカルの `/portfolio` は常に placeholder 分岐を通り、`<img>` について何も語らない。

fixture（`src/routes/design-system/sections/ImageCls.tsx`）は**本番と同じ
`PortfolioMediaFigure`** を固定データで描画する。測っている要素は出荷される要素で、
固定しているのはデータだけ。Issue が求める「他機能の完成を待たない fixture での計測」が
これに当たる。

4 セル（各 `data-cls-fixture`）:

| セル | 内容 | 測るもの |
| --- | --- | --- |
| `eager-cover` | `loading="eager"` / 1600×900 / first viewport | LCP 相当。読み込み前後で枠が同じ |
| `placeholder` | `url: null` / 1600×900 | 配信 URL が無いときの予約枠 |
| `unknown-size` | `width`/`height` = null | 寸法未計測 row の劣化経路（予約しない = 仕様） |
| `lazy-cover` | `loading="lazy"` / 1280×720 / 220vh 下の spacer の後 | **CLS の被験体** |

`lazy-cover` の直後にある `data-cls-sentinel` 行が測定の中心になっている理由:
layout-shift は「描画された content が**動いた**とき」しか記録されない。
ページ最下端の figure は予約を外れていても下に動かされる content が無いため 0 になる。
sentinel が「figure が押す相手」であり、これがないと before 状態も測れない。

sentinel の位置は **region 基準の document 座標**で測る（`regionSentinelOffset` /
`readDocumentBox`）。その理由は 2 つある:

- viewport 座標（`boundingBox()`）だと、scroll anchoring や
  `scrollIntoViewIfNeeded` の丸めによる**スクロール量**が「移動」として混ざる
  （実際に 1.4px の偽陽性が出た）
- sentinel の絶対座標だと、**region より上**にある無関係な reflow（この page では
  web font swap だけで 1px 超動く）が混ざる。gate が主張すべきことは
  「lazy figure が下の content を押さない」であって、
  「page 上のどこでも reflow しない」ではない。
  region 基準なら上の reflow は region と sentinel を一緒に動かすので差分は 0、
  一方 region 内での figure の成長は sentinel だけを押すので差分として残る。

### 再現条件（local / CI 共通）

条件は `scripts/_image-cls.mjs` に**定数**として置き、gate とレポートが同じ値を import する。
別々の値で測ると、レポート画像が gate が一度も assert していない数値の証拠になってしまう。

| 条件 | 値 | 理由 |
| --- | --- | --- |
| browser | Chromium（Playwright 1.63.x、CI でも同じ project） | `playwright.config.ts` は 0.1.0 で Chromium only |
| viewport | 1280×900 / deviceScaleFactor 1 | desktop Chrome の既定に相当 |
| network | fixture raster `/fixtures/cls-inline-1280x720.png` の response を **700ms 保持**、他は unthrottled | lazy fetch が decode 前に終わると intrinsic size を知る機会を消してしまう |
| CPU | CDP `Emulation.setCPUThrottlingRate` = **4×** | Lighthouse の既定 mobile throttle。CLS は layout property なので verdict は変わらないが、#384–#387 の Lighthouse 数値と可比になるよう固定する |
| source SHA | 生成時に `git rev-parse HEAD` を画像へ刻印 | 「どの commit で測ったか」を画像が自分で答える |
| 判定基準 | scoped CLS **≤ 0**、枠高さ Δ **≤ 0.5px**、sentinel offset Δ **≤ 0.5px** | Core Web Vitals の "good" は 0.1 だが、予約契約は shift を 0 にするためにある |

ローカル: `pnpm run build` 済みで
`pnpm exec playwright test e2e/image-cls.spec.ts`（Playwright の `webServer` が
migration + seed 込みで preview を起動する）。

CI: `.github/workflows/ci.yml` の Playwright step だけがこの spec を回す。
起動条件は push to `main` / `release-*`、または `ui-change` label 付き PR。
Draft PR の `validate:integration` には含まれない点に注意。

### before / after の実測値

`before` は revision を checkout したものではなく、**同じページ・同じ browser・同じ条件で**
lazy `<img>` から `width` / `height` / inline `aspect-ratio` を取り除いた DOM
（= この ticket 以前の描画そのもの）から測定した値。

| 測定 | before（#486 以前） | after（出荷状態） | 合格基準 |
| --- | --- | --- | --- |
| decode 前の枠高さ | 0px | 321.38px | > 0.5px（すでに予約済み） |
| decode をまたぐ枠高さ Δ | +321.38px | 0px | \|Δ\| ≤ 0.5px |
| sentinel offset（region 基準）Δ | +321.38px | 0px | \|Δ\| ≤ 0.5px |
| scoped CLS | 0.06947 | 0 | ≤ 0 |

（viewport 1280×900 での実測。セル幅に依存するため絶対値は環境差が出るが、
Δ と CLS は条件が固定されていれば再現する。）

### この gate が空振りしないための仕組み

`e2e/image-cls.spec.ts` には 4 本の test がある。最後の 1 本は
**false-green guard**: 同じ条件で予約を外した状態を作り、必ず shift が出ることを確認する。

これがないと「何も測っていない 0」と「予約が効いた 0」を gate が区別できない。
さらに測定中は

- `decodedBefore`（decode 前に枠を読めたか）を assert する
- `#design-system-image` fragment を**付けない**（fragment で初期 navigation 中に
  lazy fetch が始まり、「decode 前」を観測できなくなるため）

の 2 つで「測れていなかった」ケースを失敗させる。

### `srcset` / `sizes` について（未決の owner decision）

実測すると **現状 `srcset` も `sizes` も absent** である。これは意図的で、
gate として固定してある（`toBeNull()`）。理由:

- `composeMediaUrl` は 1 つの object key → 1 つの R2 URL を返すだけで、
  bucket の前段で画像を resize する mechanism がリポジトリに存在しない
- `srcset` を書くことは「配信面が実行しない transformation の URL 構文を捏造する」ことになる
- 実際に low-volume rendition を用意するときの選択肢は 2 つあり、**どちらも owner 決定**:
  1. Cloudflare Image Resizing（`/cdn-cgi/image/...`）— zone 側の設定と費用、
     custom domain が Worker route を通る必要がある
  2. ingest 時に R2 へ variant を pre-generate する —
     `portfolio_media` に variant 幅の行を持てる schema 変更と job が必要

決定されるまで `<img>` は 1 枚だけを送る。#384–#387（Lighthouse 計測 / gate / CWV budget）
とは重複しない: あちらは budget と gate、本 ticket は 1 要素の予約契約と証跡。

### `quality/profile.yaml` への影響

**変更なし。** 判断根拠:

- 変更 risk は `src_unit`（component）+ 既存 fixture route。既存 profile では
  `fast` gate（`pnpm run validate:fast`）で十分
- E2E step は `release_extra` の既存項目。新規 job / 新規 trigger / 新規 script を
  足していない（`disallowed_patterns` の "duplicate … on the same trigger" に該当しない）
- gate を 1 つ増やすなら `security_gates` に budget として書くのが本筋だが、
  #486 の gate は「0 ayakude 达不到たら落ちる」assertion であり、
  Lighthouse / CWV budget という別の axis（#386）着她しない

fixture raster の再生成を CI で gate するのは **していない**
（`scripts/generate-image-fixtures.mjs --check` は手動実行用）。
gate を増やす判断は owner 決定として次 Issue に残す。

### 再生成

```bash
pnpm run build
node scripts/image-cls-report.mjs              # 4310 番で preview を自分で上げる
node scripts/image-cls-report.mjs --base-url=http://127.0.0.1:3000  # 既存 server に|population
node scripts/generate-image-fixtures.mjs       # fixture raster を書き直す
node scripts/generate-image-fixtures.mjs --check  # commit 済みバイト列との drift を検出
```

証跡画像は timestamp と commit SHA を含むので、再生成すると必ず差分が出る。
policy / fixture / component を触った changeset と同じ commit で更新する。
