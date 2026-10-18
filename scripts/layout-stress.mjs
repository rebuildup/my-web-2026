/**
 * Layout stress fixture and detector for Issue #416.
 *
 * What this module owns
 * ---------------------
 * One obligation: answer "at the narrowest supported viewport, with a
 * visible scrollbar, does the shipped editorial layout break?" for a
 * fixed, independently runnable fixture — and prove that the answer is
 * not a silent pass.
 *
 * It is split in two halves on purpose:
 *
 *   1. The fixture (`STRESS_SECTIONS` + `renderStressFixture`) is a
 *      self-contained static document. No Worker, no dev server, no
 *      route. It mirrors the shipped base rules (`src/styles.css`) and
 *      the Container primitive (`src/editorial/primitives/Container.tsx`)
 *      closely enough that a break here is a break in the real visual
 *      language, and it is generated with the CSS inlined so the check
 *      stays hermetic and offline.
 *   2. The detector (`collectLayoutSnapshot` + `evaluateStressRun`) is
 *      split into a browser half (measure) and a pure half (judge).
 *      The pure half has no Playwright dependency, so `node --test`
 *      can prove every rule fails when it should — a detector that
 *      cannot fail is not evidence.
 *
 * Fail-closed rules (the ones that stop a green report from meaning
 * "the check never ran"):
 *
 *   snapshot_incomplete          the probe returned no usable numbers
 *   scroll_scenario_unreproduced the document did not scroll, so the
 *                                "visible scrollbar" condition was not
 *                                actually in play
 *   fixture_section_missing      a declared story section is absent or
 *                                has zero area (unimplemented fixture)
 *   stress_target_missing        a declared measurement target is absent
 *   stress_target_undeclared     a measured target is not in the spec
 *                                (renamed / orphaned fixture element)
 *   scroll_anchor_missing        a scroll-contained target has no scroll
 *                                container to hide behind
 *   viewport_overflow            the document scrolls horizontally
 *   target_overflow              a declared target crosses the content box
 *   gutter_policy_missing        `scrollbar-gutter: stable` is not applied
 *   gutter_not_reserved          the declaration reserves no gutter on a
 *                                platform with a classic scrollbar
 *   content_shift                a full-width probe changes width when the
 *                                scrollbar appears / disappears
 *
 * and one recorded warning, because an overlay-scrollbar platform cannot
 * observe the shift at all:
 *
 *   gutter_not_observable        reserved gutter is 0px (overlay
 *                                scrollbars) — the shift rule cannot run
 *
 * The controls (`control-gutter`, `control-overflow`) are the same
 * document with one deliberate defect each. The CLI refuses to report a
 * pass unless every control is caught by the expected rule, so the
 * detector proves itself in the same run that uses it.
 *
 * No secret, no network, no D1 / R2, no production access.
 */

/* ------------------------------------------------------------------ *
 * policy
 * ------------------------------------------------------------------ */

/** Narrowest viewport the stress fixture asserts on (Issue #416 AC #1). */
export const STRESS_VIEWPORT = { width: 320, height: 640, deviceScaleFactor: 1 };

/**
 * Sub-pixel tolerance. Chromium reports fractional layout values, and a
 * hairline border or a `margin-inline: auto` centring can land a box
 * 0.5px outside the content box without anything being visible. 1px is
 * the smallest value that still separates "rounding" from "overflow".
 */
export const TOLERANCE_PX = 1;

/** Variants the fixture renders. The first is the one that must pass. */
export const VARIANTS = {
	baseline: { id: 'baseline', mustPass: true, defect: null },
	'control-gutter': {
		id: 'control-gutter',
		mustPass: false,
		defect:
			'`scrollbar-gutter: auto` — the gutter is released when the scrollbar is not in play, so full-width content shifts',
	},
	'control-overflow': {
		id: 'control-overflow',
		mustPass: false,
		defect: 'a fixed 1200px block — the classic long-unbreakable-content overflow',
	},
};

/** Full-width elements whose width must not depend on the scrollbar. */
export const GUTTER_PROBE_IDS = ['gutter-band', 'gutter-container'];

/* ------------------------------------------------------------------ *
 * the fixture
 * ------------------------------------------------------------------ */

/**
 * Fixture CSS. Every value is copied from the shipped source it claims
 * to mirror, so a token change that would break the layout shows up here
 * as a disagreement rather than as a silently different fixture:
 *
 *   font stacks          src/editorial/tokens.ts#fonts
 *   colours              src/editorial/semantic-tokens.ts#colors
 *                         (bg.canvas = neutral.0, bg.surface = neutral.50,
 *                         text.default = neutral.900, text.muted = neutral.500,
 *                         border.subtle = neutral.100)
 *   type scale           src/editorial/tokens.ts#fontSizes
 *   radius               src/editorial/tokens.ts#radii
 *   page width / padding src/editorial/primitives/Container.tsx
 *                         (maxWidth 1024px, paddingInline 4/6/8 at
 *                         base/md/lg = 16/24/32px against the spacing scale)
 *   breakpoints          src/editorial/tokens.ts#breakpoints (md 768 / lg 1024)
 *   line breaking        src/styles.css @layer base
 *                         (`word-break: normal` → `auto-phrase`,
 *                         `text-wrap: pretty`, `text-wrap: balance` on
 *                         headings, local `word-break: break-all` for
 *                         mono token names / long identifiers / URLs)
 *   box model            Panda preflight (`box-sizing: border-box`,
 *                         `img { max-width: 100% }`)
 *
 * The fixture adds no font-size floor, no hyphenation and no network
 * font: every measurement must not depend on which fonts the host
 * happens to resolve.
 */
export const FIXTURE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

html {
  /* The declared scrollbar policy under test: reserve the gutter so a
     scrollbar appearing cannot move the layout. */
  scrollbar-gutter: stable;
  /* Force a visible scrollbar in every run — overlay-scrollbar hosts
     otherwise never paint one and the whole condition goes untested. */
  overflow-y: scroll;
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  background: #ffffff;
  color: #0f172a;
  font-family: "Noto Sans JP", "Noto Sans JP Fallback", "Hiragino Kaku Gothic ProN", system-ui, sans-serif;
  font-size: 1rem;
  line-height: 1.7;
  /* src/styles.css @layer base — Japanese line breaking. */
  word-break: normal;
  word-break: auto-phrase;
  text-wrap: pretty;
}

:where(h1, h2, h3) {
  font-family: "Zen Kaku Gothic New", "Zen Kaku Gothic New Fallback", "Hiragino Kaku Gothic ProN", system-ui, sans-serif;
  margin: 0;
  letter-spacing: -0.025em;
  text-wrap: balance;
}

img { max-width: 100%; height: auto; display: block; }

.story {
  max-width: 1024px;
  margin-inline: auto;
  padding-inline: 16px;
  padding-block: 24px;
  border-block-end: 1px solid #f1f5f9;
}
@media (min-width: 768px) { .story { padding-inline: 24px; } }
@media (min-width: 1024px) { .story { padding-inline: 32px; } }

.story__eyebrow {
  margin: 0 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
}
.story__title { font-size: 1.5rem; line-height: 1.15; }
.story__purpose { margin: 8px 0 0; font-size: 0.875rem; line-height: 1.6; color: #64748b; }

.story__body { margin-top: 16px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.story__label { margin: 0; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; color: #64748b; }
.story__note { margin: 0; font-size: 0.875rem; color: #64748b; }

.paragraph { margin: 0; }

.link, .mono {
  /* The local break rule src/styles.css documents for mono token names,
     long identifiers and URLs. */
  font-family: "JetBrains Mono", ui-monospace, monospace;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.link { color: #0369a1; }

.chip {
  display: inline-block;
  padding: 4px 8px;
  border: 1px solid #f1f5f9;
  border-radius: 9999px;
  background: #f8fafc;
  font-size: 0.75rem;
}

.grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
@media (min-width: 640px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.card {
  min-width: 0;
  padding: 16px;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  background: #f8fafc;
}
.card__title { font-size: 1rem; margin: 0 0 8px; }

.scroll-x {
  /* A wide table in a scroll container: the container needs min-width 0
     or it blows the parent out (the grid/flex min-content trap). */
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}
.data-table { width: 100%; min-width: 480px; border-collapse: collapse; font-size: 0.875rem; }
.data-table th, .data-table td {
  padding: 8px;
  border-block-end: 1px solid #f1f5f9;
  text-align: left;
  vertical-align: top;
}
.data-table th { color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }

.code-block {
  margin: 0;
  max-width: 100%;
  overflow-x: auto;
  padding: 12px;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  background: #f8fafc;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.75rem;
  line-height: 1.6;
  white-space: pre;
}

.cta-row { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
.cta {
  min-width: 0;
  padding: 8px 16px;
  border: 0;
  border-radius: 8px;
  background: #0f172a;
  color: #ffffff;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
}

.band { width: 100%; background: #f8fafc; padding: 16px 0; border-block: 1px solid #f1f5f9; }
.band__inner { max-width: 1024px; margin-inline: auto; padding-inline: 16px; font-size: 0.75rem; color: #64748b; }
@media (min-width: 768px) { .band__inner { padding-inline: 24px; } }
@media (min-width: 1024px) { .band__inner { padding-inline: 32px; } }

.rtl { margin: 0; direction: rtl; text-align: right; }

/* ---- deliberate defects (controls) --------------------------------- */

/* control-gutter: drop the reservation so the scrollbar moves layout. */
html[data-stress-variant='control-gutter'] { scrollbar-gutter: auto; }

/* control-overflow: the classic unbreakable fixed-width block. */
[data-stress-control='overflow'] {
  display: block;
  width: 1200px;
  height: 8px;
  background: #0ea5e9;
}
`;

/* ------------------------------------------------------------------ *
 * story content
 * ------------------------------------------------------------------ */

const LONG_URL =
	'https://rebuildup.dev/portfolio/a-very-long-project-slug-used-for-wrapping-verification?ref=layout-stress&campaign=layout-stress-320&locale=ja-JP&utm_source=docs-verification';

const LONG_HASH = 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const LONG_SYMBOL = 'createCloudflarePortfolioMediaLoaderWithExplicitMediaBindingResolutionPolicy';

/**
 * The declared stress sections. This array is the single source of
 * truth for both the rendered fixture and the detector: the renderer
 * emits `data-stress-target="<id>"` for every declared target, and the
 * evaluator fails on a target that is measured but not declared (and on
 * a declared target that is not measured). Adding a story here without
 * giving it a target is therefore a visible, failing omission.
 */
export const STRESS_SECTIONS = [
	{
		id: 'heading',
		eyebrow: '01 / heading',
		title: '長見出し・結合タイトル',
		purpose:
			'32px の見出しと `text-wrap: balance` が、語のない日本語・長い英語・両者結合で 320px に収まるか。`text-wrap` は折り返し位置を変えるだけで語は割らないので、割れない語は identifier ストーリー（ローカルの break-all が宣言されている場所）に置いている。',
		targets: [
			{ id: 'heading-jp', label: '長文日本語の見出し' },
			{ id: 'heading-en', label: '長い英語の見出し' },
			{ id: 'heading-mixed', label: '日本語 / 英語 結合の見出し' },
		],
		body: `
      <p class="story__label">日本語（14 文字）</p>
      <h1 data-stress-target="heading-jp" style="font-size: 2rem;">読みやすさと折り返し検証用の非常に長い日本語の見出し</h1>
      <p class="story__label">English（長い語）</p>
      <h2 data-stress-target="heading-en" style="font-size: 1.5rem;">A Long English Heading That Has To Settle On Three Lines Without Stranding The Last Word</h2>
      <p class="story__label">日本語 / English 結合</p>
      <h3 data-stress-target="heading-mixed" style="font-size: 1.125rem;">レイアウト破綻の検証用タイトル / A Mixed Script Heading For The Same Section</h3>`,
	},
	{
		id: 'link',
		eyebrow: '02 / link',
		title: '長い URL',
		purpose: 'クエリとパスを含む長い URL が、コンテナからのはみ出しではなく改行で収まるか。',
		targets: [
			{ id: 'link-url', label: '完全な URL' },
			{ id: 'link-host', label: 'ホスト + パス部分' },
		],
		body: `
      <p class="story__label">完全な URL</p>
      <p class="paragraph"><a class="link" data-stress-target="link-url" href="https://rebuildup.dev/">${LONG_URL}</a></p>
      <p class="story__label">ホスト + パス</p>
      <p class="paragraph"><a class="link" data-stress-target="link-host" href="https://rebuildup.dev/">rebuildup.dev/portfolio/a-very-long-project-slug-used-for-wrapping-verification</a></p>`,
	},
	{
		id: 'identifier',
		eyebrow: '03 / identifier',
		title: '長い識別子・ハッシュ',
		purpose:
			'mono のトークン名・シンボル名・content hash が 320px で収まるか（src/styles.css がローカル宣言する break-all の対象）。',
		targets: [
			{ id: 'identifier-symbol', label: '長いシンボル名' },
			{ id: 'identifier-hash', label: 'content hash' },
		],
		body: `
      <p class="story__label">シンボル名</p>
      <p class="paragraph"><code class="mono" data-stress-target="identifier-symbol">${LONG_SYMBOL}</code></p>
      <p class="story__label">content hash</p>
      <p class="paragraph"><code class="mono" data-stress-target="identifier-hash">${LONG_HASH}</code></p>`,
	},
	{
		id: 'multilingual',
		eyebrow: '04 / multilingual',
		title: '多言語テキスト',
		purpose:
			'日本語・英語・ドイツ語・フランス語・ロシア語・韓国語・アラビア語・タイ語・絵文字が同じ段落で破綻しないか。',
		targets: [
			{ id: 'multilingual-body', label: '多言語本文' },
			{ id: 'multilingual-rtl', label: 'RTL 段落' },
			{ id: 'multilingual-emoji', label: '絵文字と結合文字' },
		],
		body: `
      <p class="paragraph" data-stress-target="multilingual-body" lang="ja">日本語の文章と English prose and a German sentence with a long compound (Grundlagenverschiebungsprüfung) and français avec ses accents, plus русский текст для проверки переноса и 한국어 문장. 日本語の文中に識別子 <code class="mono">createD1PortfolioLoader</code> を含めると、ベース規則とローカルの break-all の両方が同じ段落で効きます。</p>
      <p class="paragraph rtl" data-stress-target="multilingual-rtl" lang="ar" dir="rtl">نص عربي طويل لاختبار الفواصل مع نص لاتيني مختلط في نفس الفقرة.</p>
      <p class="paragraph" data-stress-target="multilingual-emoji" lang="ja">絵文字 👨‍👩‍👧‍👦 👩🏽‍💻 🇯🇵 と結合文字 é à ö の並び。 viel Grüße aus München.</p>`,
	},
	{
		id: 'prose',
		eyebrow: '05 / prose',
		title: '長文段落',
		purpose: '`text-wrap: pretty` の下で、長い段落が横スクロールを生まないか。',
		targets: [{ id: 'prose-paragraph', label: '長文段落' }],
		body: `
      <p class="paragraph" data-stress-target="prose-paragraph">${'この段落は折り返しの確認用です。スクロールバーが常時に表示されている状態で、スクロール gutter が予約されているため、段落の幅はスクロールバーの有無で変わりません。'.repeat(4)}</p>`,
	},
	{
		id: 'grid',
		eyebrow: '06 / grid',
		title: 'グリッドとカード',
		purpose: 'minmax(0, 1fr) と min-width: 0 により、狭い幅でカードが親をはみ出さないか。',
		targets: [
			{ id: 'grid', label: 'カードグリッド' },
			{ id: 'grid-card', label: '長文を含むカード' },
		],
		body: `
      <div class="grid" data-stress-target="grid">
        <div class="card" data-stress-target="grid-card">
          <p class="card__title">配版の装飾と <code class="mono">portfolioMediaCompositionPipeline</code></p>
          <p class="story__note">グリッドの子は min-content まで膨らむため、minmax(0, 1fr) と min-width: 0 がないと狭い幅で親をはみ出します。</p>
        </div>
        <div class="card">
          <p class="card__title">短いカード</p>
          <p class="story__note">対になるカード。2 列目は 640px 以上でのみ並びます。</p>
        </div>
      </div>`,
	},
	{
		id: 'table',
		eyebrow: '07 / table',
		title: '幅を持つ表',
		purpose:
			'min-width のある表がスクロールコンテナ内に収まり、ページ横スクロールを発生させないか。',
		targets: [
			{ id: 'table-scroller', label: 'スクロールコンテナ' },
			// The table is wider than the viewport on purpose; what is
			// asserted is that the scroll container keeps that width to
			// itself, so the table is measured as scroll-contained.
			{ id: 'table', label: '最小幅を持つ表（scroll-contained）', scrollContained: true },
		],
		body: `
      <div class="scroll-x" data-stress-target="table-scroller">
        <table class="data-table" data-stress-target="table" data-stress-scroll-contained>
          <thead>
            <tr><th scope="col">Identifier</th><th scope="col">Constraint</th><th scope="col">Value</th></tr>
          </thead>
          <tbody>
            <tr><td><code class="mono">createD1PortfolioLoader</code></td><td>SSR でのみ D1 を参照する</td><td>allowed</td></tr>
            <tr><td><code class="mono">composeMediaObjectUrl</code></td><td>R2 の public URL を合成する</td><td>allowed</td></tr>
            <tr><td><code class="mono">LegacyImportScriptOneTwoThree</code></td><td>移行用の使い捨てスクリプト</td><td>denied</td></tr>
          </tbody>
        </table>
      </div>`,
	},
	{
		id: 'code',
		eyebrow: '08 / code',
		title: 'コードブロック',
		purpose: '折り返さない pre 要素が横スクロールをコンテナ内に閉じ込めるか。',
		targets: [
			{ id: 'code-block', label: '長いコマンドの pre' },
			{ id: 'code-inline', label: '段落内のインライン code' },
		],
		body: `
      <pre class="code-block" data-stress-target="code-block">pnpm exec vitest run test/integration/layout-stress-fixture.test.ts --reporter=dot</pre>
      <p class="paragraph" data-stress-target="code-inline">段落の途中で <code class="mono">MY_WEB_2026_CONSUMER_API_KEY</code> のような長い識別子が进来了ときに、段落ごと横スクロールしないことを確認します。</p>`,
	},
	{
		id: 'cta',
		eyebrow: '09 / cta',
		title: 'CTA 行',
		purpose: '折り返す flex 行が、長いラベルでも親をはみ出さないか。',
		targets: [
			{ id: 'cta-row', label: '折り返すボタン行' },
			{ id: 'cta-button', label: '長いラベルボタン' },
		],
		body: `
      <div class="cta-row" data-stress-target="cta-row">
        <a class="cta" data-stress-target="cta-button" href="https://rebuildup.dev/">検証レポートを再現する</a>
        <a class="cta" href="https://rebuildup.dev/portfolio">Portfolio を見る</a>
        <a class="cta" href="https://rebuildup.dev/about">About を見る</a>
      </div>`,
	},
	{
		id: 'gutter',
		eyebrow: '10 / gutter',
		title: 'スクロールバー gutter',
		purpose:
			'全幅の帯とコンテナが、スクロールバーの表示 / 非表示で幅が変わらないこと（`scrollbar-gutter: stable` の実効性）。',
		targets: [
			{ id: 'gutter-band', label: '全幅の帯（gutter probe）' },
			{ id: 'gutter-container', label: '全幅コンテナ（gutter probe）' },
		],
		body: `
      <div class="band" data-stress-target="gutter-band" data-gutter-probe="gutter-band">
        <div class="band__inner" data-stress-target="gutter-container" data-gutter-probe="gutter-container">全幅の帯。スクロールバーの有無で 1px たりとも幅が変わらないことが、この帯の観測点になる。</div>
      </div>`,
	},
];

/** Every declared measurement target, in declaration order. */
export const DECLARED_TARGETS = [
	...STRESS_SECTIONS.flatMap((section) =>
		section.targets.map((target) => ({ ...target, section: section.id })),
	),
];

/**
 * Targets that must be absent from the healthy fixture and measured when
 * a control injects them. They exist so the controls trip the same rules
 * the baseline is judged by, instead of tripping a rule of their own.
 */
export const DECLARED_OPTIONAL_TARGETS = [
	{
		id: 'control-overflow-block',
		label: 'control-overflow の固定幅ブロック',
		optional: true,
	},
];

/** Declared targets that also carry a gutter-stability probe. */
export const DECLARED_GUTTER_PROBES = GUTTER_PROBE_IDS;

const ALL_DECLARED_TARGETS = [...DECLARED_TARGETS, ...DECLARED_OPTIONAL_TARGETS];

/* ------------------------------------------------------------------ *
 * fixture rendering
 * ------------------------------------------------------------------ */

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderSection(section) {
	return `  <section class="story" data-stress-section="${section.id}" aria-labelledby="story-${section.id}">
    <header>
      <p class="story__eyebrow">${escapeHtml(section.eyebrow)}</p>
      <h2 class="story__title" id="story-${section.id}">${escapeHtml(section.title)}</h2>
      <p class="story__purpose">${escapeHtml(section.purpose)}</p>
    </header>
    <div class="story__body">${section.body}
    </div>
  </section>`;
}

/**
 * Render the stress fixture as a standalone HTML document.
 *
 * @param {object} [options]
 * @param {keyof VARIANTS} [options.variant] which defect (if any) to inject
 * @returns {string} a complete, self-contained document
 */
export function renderStressFixture({ variant = 'baseline' } = {}) {
	if (!VARIANTS[variant]) {
		throw new Error(`unknown stress fixture variant: ${variant}`);
	}
	const controlBlock =
		variant === 'control-overflow'
			? '\n    <div data-stress-target="control-overflow-block" data-stress-control="overflow"></div>'
			: '';
	return `<!doctype html>
<html lang="ja" data-stress-variant="${variant}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>レイアウト stress fixture (Issue #416)</title>
<style>${FIXTURE_CSS}</style>
</head>
<body>
  <p class="story__eyebrow" style="padding: 16px 16px 0;">Issue #416 · layout stress · variant: ${escapeHtml(variant)}</p>
${STRESS_SECTIONS.map((section) => renderSection(section)).join('\n')}${controlBlock}
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * browser half of the detector
 * ------------------------------------------------------------------ */

/**
 * Measure the document. Serialized into the page by Playwright, so it
 * must stay self-contained (no closure over this module).
 *
 * @param {{overflowY?: 'scroll' | 'auto' | 'hidden'}} [options]
 * @returns {object} raw measurement snapshot
 */
export function collectLayoutSnapshot(options) {
	const root = document.documentElement;
	const previousOverflowY = root.style.overflowY;
	const previousScrollLeft = window.scrollX;
	const requested = options && typeof options.overflowY === 'string' ? options.overflowY : null;
	if (requested) root.style.overflowY = requested;
	window.scrollTo(0, 0);
	// flush layout so the measurement reflects the applied overflow-y
	void root.offsetHeight;

	const scrollbarProbe = document.createElement('div');
	scrollbarProbe.setAttribute('data-stress-probe', 'scrollbar');
	scrollbarProbe.style.cssText =
		'position:fixed;top:-9999px;left:-9999px;width:120px;height:120px;overflow-y:scroll;overflow-x:hidden;';
	document.body.appendChild(scrollbarProbe);
	const scrollbarWidth = scrollbarProbe.offsetWidth - scrollbarProbe.clientWidth;
	scrollbarProbe.remove();

	const rectOf = (element) => {
		const rect = element.getBoundingClientRect();
		return {
			left: rect.left,
			right: rect.right,
			width: rect.width,
			height: rect.height,
		};
	};

	const sections = Array.from(document.querySelectorAll('[data-stress-section]')).map((element) => {
		const rect = rectOf(element);
		return { id: element.getAttribute('data-stress-section'), ...rect };
	});

	const targets = Array.from(document.querySelectorAll('[data-stress-target]')).map((element) => {
		const rect = rectOf(element);
		// Nearest ancestor that actually clips / scrolls on the inline
		// axis. A target that declares itself scroll-contained is measured
		// against the document content box only when it has no such
		// ancestor, so the marker cannot be used to hide a real overflow.
		let scrollAnchor = null;
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			const overflowX = getComputedStyle(parent).overflowX;
			if (
				overflowX === 'auto' ||
				overflowX === 'scroll' ||
				overflowX === 'hidden' ||
				overflowX === 'clip'
			) {
				scrollAnchor = parent.getAttribute('data-stress-target') ?? parent.className ?? 'anonymous';
				break;
			}
		}
		return {
			id: element.getAttribute('data-stress-target'),
			scrollContained: element.hasAttribute('data-stress-scroll-contained'),
			scrollAnchor,
			...rect,
		};
	});

	const probes = Array.from(document.querySelectorAll('[data-gutter-probe]')).map((element) => {
		const rect = rectOf(element);
		return { id: element.getAttribute('data-gutter-probe'), width: rect.width };
	});

	const snapshot = {
		variant:
			root.getAttribute('data-stress-variant') || document.body.getAttribute('data-stress-variant'),
		viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
		root: {
			clientWidth: root.clientWidth,
			clientHeight: root.clientHeight,
			scrollWidth: root.scrollWidth,
			scrollHeight: root.scrollHeight,
			gutterDeclaration: getComputedStyle(root).scrollbarGutter,
			overflowY: getComputedStyle(root).overflowY,
		},
		scrollbarWidth,
		documentGutter: window.innerWidth - root.clientWidth,
		sections,
		targets,
		probes,
		environment: {
			userAgent: navigator.userAgent,
			language: navigator.language,
			fontStatus: document.fonts ? document.fonts.status : 'unsupported',
		},
	};

	root.style.overflowY = previousOverflowY;
	window.scrollTo(previousScrollLeft, 0);
	return snapshot;
}

/* ------------------------------------------------------------------ *
 * pure half of the detector
 * ------------------------------------------------------------------ */

function isFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

function issue(rule, message, detail) {
	return detail === undefined ? { rule, message } : { rule, message, detail };
}

/**
 * Judge a measurement run. Pure: no DOM, no browser, no I/O.
 *
 * @param {object} run
 * @param {object} run.withScrollbar snapshot with `overflow-y: scroll`
 * @param {object} run.withoutScrollbar snapshot with `overflow-y: hidden`
 * @param {object} [policy]
 * @returns {{errors: object[], warnings: object[], stats: object}}
 */
export function evaluateStressRun(run, policy = {}) {
	const tolerance = isFiniteNumber(policy.tolerancePx) ? policy.tolerancePx : TOLERANCE_PX;
	const errors = [];
	const warnings = [];
	const withScrollbar = run?.withScrollbar;
	const withoutScrollbar = run?.withoutScrollbar;

	const incomplete = (reason) => errors.push(issue('snapshot_incomplete', reason));

	if (!withScrollbar || !withoutScrollbar) {
		incomplete('both the scrollbar and no-scrollbar snapshots are required');
		return { errors, warnings, stats: { tolerance } };
	}

	const required = [
		withScrollbar.root,
		withoutScrollbar.root,
		withScrollbar.scrollbarWidth,
		withScrollbar.sections,
		withScrollbar.targets,
		withScrollbar.probes,
	];
	if (
		required.some((value) => value === null || value === undefined) ||
		!isFiniteNumber(withScrollbar.root.clientWidth) ||
		!isFiniteNumber(withScrollbar.root.clientHeight) ||
		!isFiniteNumber(withScrollbar.root.scrollWidth) ||
		!isFiniteNumber(withoutScrollbar.root.clientWidth) ||
		!Array.isArray(withScrollbar.sections) ||
		!Array.isArray(withScrollbar.targets) ||
		!Array.isArray(withScrollbar.probes)
	) {
		incomplete('the probe returned no usable numbers — the fixture was not measured');
		return { errors, warnings, stats: { tolerance } };
	}

	/* --- the "visible scrollbar" condition actually happened --------- */
	const scrolls = withScrollbar.root.scrollHeight > withScrollbar.root.clientHeight;
	if (!scrolls) {
		errors.push(
			issue(
				'scroll_scenario_unreproduced',
				'the fixture did not scroll vertically, so no scrollbar was ever in play',
				`scrollHeight ${withScrollbar.root.scrollHeight} <= clientHeight ${withScrollbar.root.clientHeight}`,
			),
		);
	}

	/* --- declared sections and targets all rendered ---------------- */
	const measuredSections = new Map(withScrollbar.sections.map((entry) => [entry.id, entry]));
	for (const section of STRESS_SECTIONS) {
		const measured = measuredSections.get(section.id);
		if (!measured) {
			errors.push(
				issue('fixture_section_missing', `section "${section.id}" is not in the fixture`),
			);
			continue;
		}
		if (!(isFiniteNumber(measured.width) && measured.width > 0) || !(measured.height > 0)) {
			errors.push(
				issue('fixture_section_missing', `section "${section.id}" rendered with zero area`, {
					width: measured.width,
					height: measured.height,
				}),
			);
		}
	}
	for (const id of measuredSections.keys()) {
		if (!STRESS_SECTIONS.some((section) => section.id === id)) {
			errors.push(
				issue('fixture_section_undeclared', `section "${id}" is rendered but not declared`),
			);
		}
	}

	const measuredTargets = new Map(withScrollbar.targets.map((entry) => [entry.id, entry]));
	for (const target of ALL_DECLARED_TARGETS) {
		if (!measuredTargets.has(target.id)) {
			if (target.optional) continue;
			errors.push(
				issue('stress_target_missing', `target "${target.id}" (${target.label}) was not measured`),
			);
		}
	}
	for (const id of measuredTargets.keys()) {
		if (!ALL_DECLARED_TARGETS.some((target) => target.id === id)) {
			errors.push(issue('stress_target_undeclared', `target "${id}" is rendered but not declared`));
		}
	}

	/* --- horizontal overflow ---------------------------------------- */
	const contentWidth = withScrollbar.root.clientWidth;
	if (withScrollbar.root.scrollWidth > contentWidth + tolerance) {
		errors.push(
			issue(
				'viewport_overflow',
				`the document scrolls horizontally at ${withScrollbar.viewport.innerWidth}px (scrollWidth ${withScrollbar.root.scrollWidth} > clientWidth ${contentWidth})`,
				{
					scrollWidth: withScrollbar.root.scrollWidth,
					clientWidth: contentWidth,
					tolerance,
				},
			),
		);
	}
	for (const target of ALL_DECLARED_TARGETS) {
		const measured = measuredTargets.get(target.id);
		if (!measured) continue;
		if (measured.scrollContained) {
			// Fail closed: a target may opt out of the content-box check
			// only when it really does live inside a scroll container.
			if (!measured.scrollAnchor) {
				errors.push(
					issue(
						'scroll_anchor_missing',
						`target "${target.id}" is declared scroll-contained but has no scroll container ancestor`,
					),
				);
			}
			continue;
		}
		const overRight = measured.right - contentWidth;
		const overLeft = -measured.left;
		if (overRight > tolerance || overLeft > tolerance) {
			errors.push(
				issue(
					'target_overflow',
					`target "${target.id}" (${target.label}) leaves the content box by ${Math.max(overRight, overLeft).toFixed(2)}px`,
					{
						left: measured.left,
						right: measured.right,
						contentWidth,
						tolerance,
					},
				),
			);
		}
	}

	/* --- the declared scrollbar gutter ------------------------------- */
	if (withScrollbar.root.gutterDeclaration !== 'stable') {
		errors.push(
			issue(
				'gutter_policy_missing',
				`the fixture declares scrollbar-gutter: stable but the computed value is "${withScrollbar.root.gutterDeclaration}"`,
			),
		);
	}

	const scrollbarWidth = withScrollbar.scrollbarWidth;
	const gutterObservable = isFiniteNumber(scrollbarWidth) && scrollbarWidth > 0;
	if (!gutterObservable) {
		warnings.push(
			issue(
				'gutter_not_observable',
				'this platform paints overlay scrollbars (reserved gutter 0px) — gutter reservation and shift cannot be measured here',
			),
		);
	} else {
		const reserved = withScrollbar.documentGutter;
		if (Math.abs(reserved - scrollbarWidth) > tolerance) {
			errors.push(
				issue(
					'gutter_not_reserved',
					`scrollbar-gutter: stable reserved ${reserved.toFixed(2)}px but the platform scrollbar is ${scrollbarWidth}px`,
					{ reserved, scrollbarWidth, tolerance },
				),
			);
		}
		const withWidths = new Map(withScrollbar.probes.map((entry) => [entry.id, entry.width]));
		const withoutWidths = new Map(withoutScrollbar.probes.map((entry) => [entry.id, entry.width]));
		for (const probeId of DECLARED_GUTTER_PROBES) {
			const a = withWidths.get(probeId);
			const b = withoutWidths.get(probeId);
			if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
				errors.push(
					issue('gutter_probe_missing', `gutter probe "${probeId}" was not measured in both runs`),
				);
				continue;
			}
			const shift = Math.abs(a - b);
			if (shift > tolerance) {
				errors.push(
					issue(
						'content_shift',
						`"${probeId}" changes width by ${shift.toFixed(2)}px when the scrollbar is not in play`,
						{ withScrollbar: a, withoutScrollbar: b, tolerance },
					),
				);
			}
		}
	}

	const shifts = DECLARED_GUTTER_PROBES.map((probeId) => {
		const a = withScrollbar.probes.find((entry) => entry.id === probeId);
		const b = withoutScrollbar.probes.find((entry) => entry.id === probeId);
		return { id: probeId, withScrollbar: a?.width ?? null, withoutScrollbar: b?.width ?? null };
	});

	return {
		errors,
		warnings,
		stats: {
			tolerance,
			variant: withScrollbar.variant ?? null,
			viewport: withScrollbar.viewport ?? null,
			sections: measuredSections.size,
			targets: measuredTargets.size,
			clientWidth: contentWidth,
			scrollWidth: withScrollbar.root.scrollWidth,
			scrollHeight: withScrollbar.root.scrollHeight,
			scrollbarWidth,
			documentGutter: withScrollbar.documentGutter,
			gutterObservable,
			gutterDeclaration: withScrollbar.root.gutterDeclaration,
			shifts,
		},
	};
}

/**
 * Rules a control variant is *required* to trip. Environment-aware only
 * in one place: on a platform with overlay scrollbars the gutter control
 * cannot shift content, so the missing declaration is the rule that must
 * fire there instead. The control must trip at least one of them either
 * way — `check-layout-stress.mjs` treats an all-clear control as a
 * detector failure, not a pass.
 *
 * @param {string} controlId
 * @param {{gutterObservable?: boolean}} environment
 * @returns {string[]}
 */
export function requiredControlRules(controlId, environment = {}) {
	if (controlId === 'control-gutter') {
		return environment.gutterObservable === false ? ['gutter_policy_missing'] : ['content_shift'];
	}
	if (controlId === 'control-overflow') return ['viewport_overflow', 'target_overflow'];
	throw new Error(`unknown control variant: ${controlId}`);
}
