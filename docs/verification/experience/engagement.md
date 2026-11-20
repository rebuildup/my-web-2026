# 「見てて楽しい」— 静的 / 操作の 2 体験比較検証画像 (#517)

- 対象: `src/personal/engagement/`（preview データ + 表示コンポーネント + Storybook stories）
- Issue: #517（`spike(experience): 「見てて楽しい」の2種類の体験を比較`）
- 成果物:
  - `docs/verification/experience/engagement-static.png`（静的案・広幅 1440px）
  - `docs/verification/experience/engagement-interactive.png`（操作案・広幅 1440px）
- 状態: **本 Issue で実装・検証済み**。採用・不採用・ページ適用の判断は §7 に記し、本 preview では決めない

## 1. 何を比較したか

Issue #517 は Miro の「見てて楽しい」を **制作動機側（作るのが楽しい）と見せたいもの側（見せるのが楽しい）の両方**を含む語として扱い、同じ実コンテンツを **静的で読める体験** と **操作・動きで楽しい体験** の 2 案で比較する spike である。採用デザインの決定も全ページ適用も本 Issue に含めない。

そこで材料には公開済みの記録だけを使う: **公開 portfolio の 6 作品**（`src/portfolio/seed.ts`、その根拠は `docs/personal/domain.md` §8–§9）。両 variant は `src/personal/engagement/Engagement.preview.ts` の**同一データ**（`ENGAGEMENT_WORKS`）を `EngagementWorkFacts` という共有レンダラ経由で描く。したがって画面に見える差はすべて容れ物の差であり、内容の差ではない — これが本 preview の実験条件である。

### 2 つの表示

- **静的 — 読む体験** — 6 作品の全事実を 1 枚の文書として並べる。状態を持たず、操作も動きも無い。
  - 全 6 作品の事実が初期表示に全て存在する
  - JavaScript の状態・イベントハンドラを持たない
  - アニメーションを 1 つも emit しない
- **操作 — 遊ぶ体験** — 1 作品ずつめくる deck。前後ボタンと矢印キーで操作し、位置表示と進行バーを持つ。
  - 同時に 1 作品だけを表示し、残りは操作で辿る
  - 前後ボタン 2 本と ArrowLeft / ArrowRight キーで操作できる
  - 作品の切り替えに 1 種類の step transition を持つ
  - reduced motion では transition を emit せず即時に切り替わる

### 比較の 4 軸（Issue の完了条件）

1. **視認性** — 情報が一目で読めるか。スクロールなしで掴める量はどれだけか。
2. **操作可能性** — キーボードだけで全情報に辿り着けるか。状態が分かるか。
3. **読み込み負荷** — 初期表示に必要な JS / 描画コストはどれだけか。
4. **reduced motion** — 動きを減らす設定で、情報が欠けずに表示されるか。

### 材料 — 同一の 6 作品（公開済みの記録のみ）

seed の `displayOrder` 順に、そのまま事実を転記する。追加・脚色・未公開情報は無い。

| 作品 | period | role |
| --- | --- | --- |
| my-web-2026 — Personal Web Platform on Cloudflare Workers | 2025-09 - present | Solo architect / developer |
| Aulymo — After Effects lyric motion tool | 2022 - present | Solo developer / distributor |
| MultiSlicer — After Effects effect plugin (C++) | 2023 - present | Solo developer |
| Tastile — scheduling product (multi-client) | 2024-06 - present | Solo developer |
| project-init / design-skills — agent engineering / design workflow knowledge | 2025-06 - present | Author / maintainer |
| 2026 Summer internship — ScienceArts / OPTiM | 2026 夏 (Summer 2026) | Intern |

各作品の fact と technologies は preview データ `ENGAGEMENT_WORKS` が seed と verbatim で保持し、parity test が文書側の存在を検査する（§5）。fact は以下の通り:

- my-web-2026: Personal Web Platform の再構築。TanStack Start / Hono / Panda CSS / Cloudflare D1+R2 を obligation-oriented architecture で束ねる。
- Aulymo: After Effects で lyric motion を作るための tool。実装だけでなく productization / support / update まで経験。
- MultiSlicer: C++ / After Effects SDK で書いた effect plugin。native plugin development を実践。
- Tastile: scheduling を扱う product。Web / Android / desktop / backend を含む multi-client development。
- project-init / design-skills: agent が実際の project で使える engineering / design workflow を形式知化した Skills 集。
- 2026 Summer internship — ScienceArts / OPTiM: 2026 年夏に ScienceArts と OPTiM で software / product development に関する internship を経験。

technologies（seed verbatim、作品ごと）:

- my-web-2026: TypeScript / Cloudflare Workers / TanStack Start / Hono / Panda CSS / D1 / R2 / Biome
- Aulymo: After Effects / ExtendScript / TypeScript / BOOTH
- MultiSlicer: C++ / After Effects SDK / Premiere Pro SDK
- Tastile: TypeScript / React / Kotlin / Rust / Tauri
- project-init / design-skills: Markdown / Claude Code / Cursor / Codex
- 2026 Summer internship — ScienceArts / OPTiM: Team development / Code review / Spec-driven development

### 典拠（画面が参照する記録 — parity test が実在を検査）

| label | path |
| --- | --- |
| src/portfolio/seed.ts | `src/portfolio/seed.ts` |
| docs/personal/domain.md §8–§9 | `docs/personal/domain.md` |

### 公開リンク（画面が出してよい URL はこの 5 件だけ）

- https://github.com/rebuildup/my-web-2026
- https://361do.booth.pm
- https://github.com/rebuildup/project-init
- https://github.com/rebuildup/design-skills
- https://rebuildup.dev/portfolio

## 2. 撮影条件

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/personal/engagement/Engagement.stories.tsx` の `Static` / `Interactive` story（story 自身の `render()` 出力） |
| capture 手段 | `node scripts/capture-engagement.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → PNG） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900、deviceScaleFactor 1（`fullPage` 撮影） |
| interactive の撮影状態 | 撮影前に next コントロールで全 6 作品を巡回し、先頭へ戻した状態（操作済みの実画面） |
| reduced motion 検証 | 同一 harness を `reducedMotion: 'reduce'` の別コンテキストで開き、step panel の `data-motion-state` と computed `animation-name` を読む |
| 再現性 | encode 段は決定的、ブラウザ撮影は byte 再現ではない。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ `storybook dev` ではなく harness なのか

`pnpm run build-storybook` はこの repository では manager-only の静的ビルドになる（`@storybook/react-vite` builder がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack Start plugin が preview の出力先を取る）。同じ事実を `scripts/capture-manifesto.mjs`（#535）と `scripts/capture-handle-map.mjs`（#524）が記録している。

capture は長-lived な dev server に依存しないため `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、その story が持つ `render()` 出力をレンダリングする。harness が描くものは「コピーした preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM・実際の操作・2 つの motion 設定を preview データと突き合わせる**。capture が fail する条件は以下（1 つでも欠ければ非 zero で終了し、artefact は書かれない）。

| 項目 | 判定 |
| --- | --- |
| document title | 描画された `<h1>` が `見てて楽しい — 静的と操作の 2 つの体験` と一致 |
| variant 識別 | stage の `data-engagement-variant` が capture 対象（static / interactive）と一致 |
| document metadata | status / source / verification / document の 4 項目が `<header>` の `<dl>` に存在 |
| 同一情報（static） | `[data-engagement-work]` が seed 順の 6 id と一致し、各 card が title / periodLabel / role / fact / 全 technologies を含む |
| 同一情報（interactive） | next コントロールで実際に巡回し、訪問 id 列が seed 順の 6 id と一致。各訪問 card がその作品自身の事実を全て含む |
| 操作可能性 | prev / next の `<button>` が存在、`[data-engagement-position]` が `N / 6` を報告、`[data-engagement-progress]` の進行トラックが存在 |
| キーボード操作 | prev ボタンに focus して ArrowLeft を押すと位置が実際に 1 つ戻る（6 → 5 を実測） |
| variant card / 4 軸 | 2 つの variant ラベルと全 fact、4 軸の label と question が body text に存在 |
| reduced motion | 通常 context: `data-motion-state="animated"` + computed `animation-name: engagementStep`。reduce context: `data-motion-state="reduced"` + computed `animation-name: none` |
| 公開リンク | `<a href>` の一意集合が宣言済み 5 URL と一致。未宣言 URL（創作リンク）は fail |
| 典拠 path | `src/portfolio/seed.ts` と `docs/personal/domain.md` が body text に存在 |
| 奥付 | `[data-notes-list] li` が `ENGAGEMENT_NOTES` と一致（件数も一致） |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow） |
| artefact budget | commit した PNG が各 1024 KB 以下 |

## 4. 4 軸の比較結果（観測の記録 — 採否ではない）

### 視認性

- **静的**: 6 作品の全事実（title / period / role / technologies / fact / links）が 1 枚に並ぶ。1440px では 2852px の縦長になるが、情報はスクロールを待たず全て存在し、見出しと card の階層で拾い読みできる。
- **操作**: 同時に見えるのは 1 作品だけ。deck は 1880px と静的より低いが、残り 5 作品の存在は位置表示 `N / 6` と進行バーが示すのみで、各作品の事実は操作するまで DOM に現れない。

### 操作可能性

- **静的**: 操作対象は公開リンクのみ。キーボード到達はリンクの Tab 順だけで、作品間の移動という操作自体が存在しない — 欠陥ではなく設計。
- **操作**: prev / next は実 `<button>`（Tab + Enter/Space で動作、`aria-keyshortcuts` が矢印キーを告知）、deck は bubble する `onKeyDown` で ArrowLeft / ArrowRight に応答（capture が 6→5 の実移動を検証）。位置は `aria-live="polite"` の読み上げで状態が分かり、進行トラックはその情報を持つ装飾として `aria-hidden`（role を偽装しない）。reduced motion でもこの読み上げは残る — 動きだけが消え、情報の伝達経路は残る。

### 読み込み負荷（実測）

harness build（story 1 本分の Vite production build、Panda 抽出済み CSS 込み）の出力合計:

| variant | JS | CSS | HTML | 合計（非圧縮） |
| --- | --- | --- | --- | --- |
| static | 253.42 kB（gzip 79.98 kB） | 66.66 kB（gzip 15.20 kB） | 0.38 kB | 320,363 bytes（約 313 kB） |
| interactive | 253.33 kB（gzip 79.93 kB） | 66.66 kB（gzip 15.20 kB） | 0.38 kB | 320,368 bytes（約 313 kB） |

観測: **バイト数は実質同一**（差は 5 bytes）。両 variant は同じ `Engagement.tsx` を import するため chunk が分かれず、静的案の「JS を積まない」利点はこの構成ではバイト差として現れない。実際の差は実行時側にある: 静的案は state も handler も持たず hydration 後の仕事が無いのに対し、操作案は `useState` 1 つ・click handler 2 つ・keydown handler 1 つ・`aria-live` 領域を持つ。6 作品という小さい情報量ではこの差は体感できないが、情報量が増えるほど「初期表示で全事実を DOM に置く」静的案の DOM サイズと「1 つずつ差し替える」操作案の再描画コストのトレードオフが効いてくる — どちらが得かは情報量と利用形態次第であり、本 spike の材料では決着しない。

### reduced motion

- **静的**: アニメーションを emit しないので、設定の有無で表示は変わらない（比較対象としての基準線）。
- **操作**: 通常時は step panel に `animation-name: engagementStep`（translateY 8px→0、180ms、transform のみ・opacity 不使用）。`prefers-reduced-motion: reduce` では component が `animation-name` を emit せず（`data-motion-state="reduced"`）、computed style も `none` — capture が両 context で実測。stylesheet 側にも `data-motion="engagement-step"` の backstop selector があり（`src/styles.css`、contract 定数 `ENGAGEMENT_STEP_MOTION`）、client の preference 読み取りを経ない markup でも同じ結論になる。**情報は欠けない**: swap は即時になり、`aria-live` の位置読み上げと progressbar は両 mode で同一 DOM。

## 5. 本文との一致（parity gate）

`docs/verification/experience/engagement.md`（本書）と preview データ `src/personal/engagement/Engagement.preview.ts` の一致は `scripts/check-engagement-preview-parity.test.mjs` が検証する。

- 本書に、全 work の title / periodLabel / role / fact / 全 technologies、全 variant の label と facts、全 axis の label と question、全 source の path、全 link の URL、全 note が verbatim で存在すること。
- 全 `source.path` がリポジトリに実在すること。
- 全 work の `sourceId` が宣言済み source に解決すること。
- variant がちょうど `static` / `interactive` の 2 つ、作品が 6 件、軸が Issue の 4 つ（視認性 / 操作可能性 / 読み込み負荷 / reduced motion）であること。

capture 側の検査は「preview データと**描画された DOM・実操作・2 つの motion 設定**の一致」を見る別系統であり、parity gate は「データと文書の一致」を見る。両方が通ることで「文書・データ・画面・操作・reduced motion」の面が同じものを指す。

## 6. 再現手順

```sh
# 依存が無い場合
git submodule update --init --recursive
pnpm install

# PNG 2 枚 + 検証レポート（ブラウザが必要: @playwright/test の chromium）
node scripts/capture-engagement.mjs
# レポートのみ / 既存 build の再利用
node scripts/capture-engagement.mjs --no-capture
node scripts/capture-engagement.mjs --no-build

# parity gate（文書とデータの一致）
node --test scripts/check-engagement-preview-parity.test.mjs

# capture 契約テスト（ブラウザ不要）
node --test scripts/capture-engagement.test.mjs
```

Storybook で見る場合は `pnpm run storybook` → `Preview / Engagement` の `Static` / `Interactive`。

## 7. 採用 / 保留の判断（owner 決定事項）

本 preview は比較の材料を揃えるところまでで、**採用もページ適用も決めない**。観測として残る判断材料:

- **静的案が向く場合**: 情報が「一覧として俯瞰される」ことが価値の中心（portfolio 一覧、記録の列挙）。コスト最小・JS 不要・reduced motion で差が出ない。
- **操作案が向く場合**: 1 項目ずつ「めくって楽しむ」ことが体験の中心で、情報量が画面に収まらない場合。キーボード・読み上げ・reduced motion の退避路は実装済みで、退避しても情報は欠けない。
- **両者の中間**: 実際の採用判断では「情報の種類ごとに容れ物を選ぶ」ハイブリッドが自然に見えるが、それは owner の決定であり本 Issue の範囲外。

未確認事項:

- Miro ボードの付箋本文は未確認（owner 確認待ち）。引用できるのは Issue が引用した見出し語「見てて楽しい」だけ。
- 「見せる側が楽しい」の具体的な対象画面（どのページ・どの情報が deck に向くか）は未決。
- 採用する場合の route 接続・サイト上の位置・正式公開は owner 決定。

## 8. 奥付

- 2 つの表示は同一データ（ENGAGEMENT_WORKS）を描く。見える差はすべて容れ物の差であり、内容の差ではない。
- 材料は公開済みの記録（src/portfolio/seed.ts / docs/personal/domain.md）に限定し、未公開の作品・実績・個人情報は含めない。
- 本 preview は採用を決めない。どちらの体験をどこに使うかは owner 決定であり、ページへの適用も本 Issue の範囲外。
- 公開 route への接続・サイト上の位置・正式公開は owner 決定であり、本 preview の範囲外。
