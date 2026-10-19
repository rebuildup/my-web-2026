#!/usr/bin/env node
/**
 * capture-pseudo-locale-stress — pseudo-localisation stress capture for
 * the Issue #429 fixture.
 *
 * Usage:
 *   node --experimental-strip-types scripts/capture-pseudo-locale-stress.mjs [options]
 *
 *   --probe-only     run the measurement, skip the screenshot
 *   --out <webp>     screenshot path
 *                    (default docs/verification/i18n/pseudo-locale-stress.webp)
 *
 * What it does
 * ------------
 * 1. Reads the stress table from `src/i18n/pseudo-locale.ts` and audits
 *    it with the SAME functions `src/i18n/pseudo-locale.test.ts`
 *    asserts on, so the picture cannot be greener than the gate.
 * 2. Renders a self-contained HTML report with the SHIPPED font stacks
 *    read from `src/editorial/tokens.ts` and the webfont href read from
 *    `src/routes/__root.tsx`. Neither is restated here: a report that
 *    declared its own font would be measuring a second, fictional
 *    product.
 * 3. Loads that report in headless Chromium at the narrowest supported
 *    viewport (320 px per frame) and MEASURES what the Issue asks for:
 *
 *      - **the UI does not break** — neither the page nor any single
 *        320 px frame overflows horizontally, at source text or at the
 *        1.5x expansion;
 *      - **the meaning survived into the DOM** — every declared
 *        `meaningToken` is still a contiguous substring of the text the
 *        browser laid out in the heading, and the whole expanded string
 *        is what the fixture says it is;
 *      - **bidi markers survived** — the isolate counts the browser
 *        actually rendered match the counts the row declares, so
 *        nothing stripped them on the way to the screen.
 *
 *    The layout half is measured TWICE, because one of those three
 *    questions is a question about CSS the capture does not own:
 *
 *      - **shipped rules** — exactly what the product declares for
 *        body text (`src/styles.css`: `word-break: normal` then
 *        `auto-phrase`, `text-wrap: pretty`) and for a heading
 *        (`SectionHeading`: `text-wrap: balance`). Nothing more;
 *      - **fixture-local mitigation** — the same frames with one extra
 *        declaration, `overflow-wrap: anywhere`, which this report adds
 *        for the measurement only. It is NOT an editorial recipe; the
 *        shipped language has no such rule, and a row that needs freer
 *        breaking adds a local one (the contract in
 *        `src/editorial/layout-system.md` §3.4).
 *
 *    Both verdicts are printed. A frame that holds only with the
 *    mitigation is a product observation about the shipped breaking
 *    rules, reported here rather than silently fixed or silently
 *    dropped: deciding what a heading may break is `src/editorial/`'s
 *    call, and this fixture records it as an open decision.
 *
 * 4. Writes the measurement as JSON and screenshots the report as WebP.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * It does not proofread, translate, or score any sentence, and it does
 * not claim RTL support: no locale is registered, no `dir` is negotiated
 * and no mirroring is applied, so a passing run means "this build does
 * not break under these strings at 320 px", nothing more. The Arabic and
 * Hebrew rows are neutral stress strings, not approved copy, and none of
 * it may be published. No proofreading tool is part of this capture, and
 * it adds no Python runtime: it is Node + Chromium only.
 *
 * `--experimental-strip-types` is what lets plain Node load the
 * TypeScript fixture and tokens.
 *
 * Exit codes: 0 = the measurement completed, every frame held under the
 * fixture-local mitigation, and every string-level fact (page overflow,
 * meaning tokens, rendered isolates, webfont, fixture audit) held under
 * the shipped rules too; 1 = one of those failed. A frame that overflows
 * ONLY under the shipped rules is printed as `shipped-rule overflow` and
 * recorded as an open editorial decision — it does not fail the run,
 * because the breaking recipe is not this script's to choose.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_HTML = resolve(REPO_ROOT, '.tmp/pseudo-locale-stress.html');
const OUT_JSON = resolve(REPO_ROOT, '.tmp/pseudo-locale-stress-probe.json');
const MAX_BYTES = 300 * 1024;
/** Frame width of the narrowest supported viewport the fixture claims. */
const FRAME_WIDTH = 320;
const VIEWPORT = { width: 1440, height: 1000 };

const escapeHtml = (value) =>
	String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

/**
 * The report model — the single input `renderReportHtml` reads.
 *
 * Splitting the pure decision from the browser work is what lets
 * `capture-pseudo-locale-stress.test.mjs` assert on the report text and
 * the verdict logic without Chromium.
 *
 * @param {object} input
 * @param {{samples: readonly any[], passing: number, failing: number, ok: boolean}} input.audit
 * @param {readonly any[]} input.samples every stress row, in table order
 * @param {readonly string[]} input.surfaceIds rows a surface is drawn for
 * @param {Record<string, string>} input.fonts shipped font stacks by role
 * @param {string} input.fontHref webfont stylesheet the product loads
 * @param {readonly string[]} input.limits what the fixture does NOT prove
 */
export function buildReportModel({ audit, samples, surfaceIds, fonts, fontHref, limits }) {
	const surfaces = surfaceIds.map((id) => samples.find((row) => row.id === id)).filter(Boolean);
	const byId = new Map(audit.samples.map((row) => [row.id, row]));
	return {
		fonts,
		fontHref,
		limits,
		audit,
		surfaces,
		rows: audit.samples.map((row) => ({ ...row, sample: samples.find((s) => s.id === row.id) })),
		verdictById: byId,
		frameWidth: FRAME_WIDTH,
	};
}

/** The UI surfaces a report row draws: one badge, heading, button, caption. */
export function surfaceHtml({ sample, row, fonts, expanded }) {
	// The `before` frame shows the SOURCE string and the `after` frame
	// the expansion. Rendering the expansion twice under a `source`
	// label would have been a pair of identical frames with two
	// captions.
	const text = expanded ? row.expandedText : sample.text;
	const direction = sample.direction;
	return `<div class="frame" data-pseudo-frame="${escapeHtml(expanded ? 'after' : 'before')}" data-pseudo-id="${escapeHtml(sample.id)}" lang="${escapeHtml(sample.lang)}" dir="${escapeHtml(direction)}">
	<span class="frame-label mono">${escapeHtml(expanded ? `after · ${row.ratioTarget}x` : 'before · source')} · ${expanded ? row.expandedTextCodePoints : row.sourceCodePoints} cp</span>
	<span class="badge">${escapeHtml(sample.subject)}</span>
	<h3 style="font-family:${escapeHtml(fonts.heading)}">${escapeHtml(text)}</h3>
	<span class="cta">${escapeHtml(sample.meaningTokens?.[0] ?? 'Publish status')}</span>
</div>`;
}

/**
 * The full report document.
 *
 * Escapes every fixture string: the fixture is data, and a data value
 * that reached the document unescaped would let a fixture rewrite the
 * artefact that is supposed to prove the fixture.
 */
export function renderReportHtml(model) {
	const { fonts, audit, rows, limits } = model;
	const surfaces = model.surfaces
		.map((sample) => {
			const row = model.verdictById.get(sample.id);
			return `<article class="surface" data-pseudo-surface="${escapeHtml(sample.id)}">
	<header class="row-head"><span class="mono id">${escapeHtml(sample.id)}</span><span class="mono tag">lang=${escapeHtml(sample.lang)} · ${escapeHtml(sample.direction)} · ${row.ratio.toFixed(3)}x · longest word ${row.expandedLongestWord} cp · ${row.ok ? 'audit ok' : `AUDIT FAILED: ${escapeHtml(row.findings.join('; '))}`}</span></header>
	<div class="pair">
		${surfaceHtml({ sample, row, fonts, expanded: false })}
		${surfaceHtml({ sample, row, fonts, expanded: true })}
	</div>
	<p class="note">${escapeHtml(sample.note)}</p>
</article>`;
		})
		.join('\n');

	const tableRows = rows
		.map(
			(row) => `<tr data-pseudo-audit="${escapeHtml(row.id)}">
	<td class="mono">${escapeHtml(row.id)}</td>
	<td class="mono">${escapeHtml(row.sample.lang)} · ${escapeHtml(row.direction)}</td>
	<td class="src">${escapeHtml(row.sample.text)}</td>
	<td class="out">${escapeHtml(row.expandedText)}</td>
	<td class="mono num">${row.sourceCodePoints}</td>
	<td class="mono num">${row.expandedTextCodePoints}</td>
	<td class="mono num">${row.ratio.toFixed(3)}</td>
	<td class="mono num">${row.protectedCodePoints}</td>
	<td class="mono num">${row.expandedLongestWord}</td>
	<td class="mono num">${row.bidi.isolates.lri} / ${row.bidi.isolates.pdi}</td>
	<td class="${row.ok ? 'ok' : 'bad'}">${row.ok ? 'ok' : escapeHtml(row.findings.join('; '))}</td>
</tr>`,
		)
		.join('\n');

	const limitItems = limits.map((limit) => `<li>${escapeHtml(limit)}</li>`).join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Issue #429 — pseudo-localisation stress</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="${escapeHtml(model.fontHref)}" />
<style>
	:root {
		--font-heading: ${fonts.heading};
		--font-body: ${fonts.sans};
		--font-mono: ${fonts.mono};
		--canvas: #ffffff;
		--text: #0b1020;
		--muted: #5b6472;
		--rule: #e3e6ec;
		--ok: #146c43;
		--bad: #a01b2b;
	}
	* { box-sizing: border-box; }
	body {
		margin: 0;
		padding: 32px 40px 40px;
		background: var(--canvas);
		color: var(--text);
		font-family: var(--font-body);
		font-size: 13px;
		line-height: 1.6;
		/* The shipped base breaking rule, transcribed from the @layer
		 * base body rule in src/styles.css: normal first, then
		 * auto-phrase, plus text-wrap: pretty. It is restated here
		 * rather than linked because this report is a standalone file,
		 * but it is the product's rule and nothing more. */
		word-break: normal;
		word-break: auto-phrase;
		text-wrap: pretty;
	}
	.wrap { max-width: 1360px; margin: 0 auto; }
	.mono { font-family: var(--font-mono); font-size: 11px; }
	.muted { color: var(--muted); }
	.eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); }
	h1 { font-family: var(--font-heading); font-size: 26px; line-height: 1.25; margin: 6px 0 8px; }
	h2 { font-family: var(--font-heading); font-size: 17px; margin: 28px 0 10px; }
	p.lede { max-width: 110ch; color: var(--muted); margin: 0 0 4px; }
	.banner { border: 1px solid var(--rule); border-left: 3px solid var(--muted); padding: 8px 12px; margin: 12px 0 0; color: var(--muted); }
	.banner.ok { border-left-color: var(--ok); color: var(--ok); }
	.banner.bad { border-left-color: var(--bad); color: var(--bad); }
	.pair { display: flex; gap: 20px; flex-wrap: wrap; }
	.frame {
		width: ${model.frameWidth}px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		text-align: start;
	}
	.frame-label { color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
	.badge {
		display: inline-flex;
		align-self: start;
		align-items: center;
		height: 24px;
		padding: 0 8px;
		border-radius: 9999px;
		background: #eceef1;
		color: var(--muted);
		font-size: 12px;
		font-weight: 600;
	}
	/* The shipped heading rule (SectionHeading adds text-wrap: balance
	 * over the inherited base rule) and nothing else. */
	h3 { font-size: 18px; line-height: 1.3; margin: 0; text-wrap: balance; }
	/* Fixture-local mitigation, OFF unless the capture switches it on
	 * for the second measurement pass. It is NOT an editorial recipe:
	 * the shipped language declares no such rule for headings, and this
	 * class exists so the report can print both verdicts instead of
	 * certifying a declaration the product does not make. */
	html.breaks-anywhere h3 { overflow-wrap: anywhere; }
	.cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 40px;
		padding: 0 16px;
		border-radius: 8px;
		background: #1c4ed8;
		color: #ffffff;
		font-size: 14px;
		font-weight: 600;
		text-align: center;
	}
	.surface { border-bottom: 1px solid var(--rule); padding-bottom: 14px; margin-bottom: 14px; }
	.row-head { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; margin-bottom: 8px; }
	.row-head .id { color: var(--text); }
	.row-head .tag { color: var(--muted); }
	.note { color: var(--muted); margin: 8px 0 0; max-width: 120ch; }
	table { width: 100%; border-collapse: collapse; }
	th, td { text-align: start; vertical-align: top; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--rule); }
	th { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
	/* Report-local: a table cell has no width budget of its own, so a
	 * 108-code-point compound would otherwise stretch the whole
	 * document. This is the REPORT's layout, not a product surface. */
	td.src, td.out { font-size: 12px; max-width: 34ch; overflow-wrap: anywhere; }
	td.num { text-align: end; }
	.ok { color: var(--ok); }
	.bad { color: var(--bad); }
	ul.limits { margin: 0; padding-inline-start: 20px; color: var(--muted); max-width: 130ch; }
	ul.limits li { margin-bottom: 4px; }
	ul.breaks { margin: 0; padding-inline-start: 20px; max-width: 130ch; font-family: var(--font-mono); font-size: 11px; }
	ul.breaks li { margin-bottom: 4px; }
	ul.breaks li.ok { color: var(--ok); }
	ul.breaks li.bad { color: var(--bad); }
</style>
</head>
<body>
<div class="wrap">
	<p class="eyebrow">Issue #429 — test(i18n): 疑似ローカライズで文字膨張・RTL耐性を確認</p>
	<h1>1.5x expansion · long compounds · combining marks · digits · bidi</h1>
	<p class="lede">Fixture copy only. Every string exists to stress a character class; none of it is approved site copy, none of it is a translation, and none of it may be published. The expander is mechanical and reversible — combining marks plus a width-bearing filler, no rewrite — so a declared negation, permission word, number or route path stays readable verbatim inside the grown string. The font stacks below are the shipped ones, read from <code>src/editorial/tokens.ts</code>.</p>
	<p class="banner" data-role="verdict">measurement: not run yet</p>
	<p class="banner" data-role="webfont">webfont: not checked yet</p>

	<h2>UI surfaces at ${model.frameWidth} px, before and after expansion</h2>
	<p class="lede">A badge, a heading, a call to action and a caption, each at the source string and again at the pseudo-expansion. If the expansion were fatal this is where it would show. These frames carry only the breaking rules the product declares: the base rule from <code>src/styles.css</code> (<code>word-break: normal</code> then <code>auto-phrase</code>, <code>text-wrap: pretty</code>) and the heading rule from <code>SectionHeading</code> (<code>text-wrap: balance</code>). No preview-only break rule is applied.</p>
	${surfaces}

	<h2>What the shipped breaking rules do at ${model.frameWidth} px</h2>
	<p class="lede">The same frames are measured twice: once as the product renders them, and once with <code>overflow-wrap: anywhere</code> switched on for the measurement only. That second declaration is a <strong>fixture-local mitigation, not an editorial recipe</strong> — the shipped language declares no such rule for a heading — so a row that holds only under it is a recorded observation about the shipped rules, and an open <code>src/editorial/</code> decision, not a passed verdict.</p>
	<ul class="breaks" data-role="shipped-overflow"><li>measurement: not run yet</li></ul>

	<h2>Source vs expanded, and the CI audit verdict</h2>
	<p class="lede">${audit.passing} passing / ${audit.failing} failing rows of ${audit.samples.length}. The verdict column is the same <code>auditPseudoSamples()</code> the unit test asserts on, so a green picture cannot disagree with a green gate.</p>
	<table>
		<thead>
			<tr><th>row</th><th>lang · dir</th><th>source</th><th>expanded</th><th>src cp</th><th>expansion cp</th><th>ratio</th><th>protected</th><th>word</th><th>LRI / PDI</th><th>verdict</th></tr>
		</thead>
		<tbody>
${tableRows}
		</tbody>
	</table>

	<h2>What this capture does NOT establish</h2>
	<ul class="limits">
${limitItems}
	</ul>
</div>
</body>
</html>
`;
}

/**
 * The verdict for ONE measured configuration of the frames.
 *
 * Pure on purpose: the browser run collects facts, this function decides
 * what they mean, and the unit test asserts the decision without ever
 * launching Chromium.
 *
 * Layout findings (a frame wider than its box) are also returned
 * separately, because they are the one class of finding a CSS change
 * can resolve — {@link evaluateRun} needs to tell "the product's
 * breaking rules let this frame overflow" apart from "this fixture
 * string lost its meaning".
 *
 * @param {object} input
 * @param {{viewportWidth: number, documentScrollWidth: number}} input.page
 * @param {ReadonlyArray<{id: string, phase: string, scrollWidth: number, clientWidth: number, headingText: string, isolates: {lri: number, pdi: number}}>} input.frames
 * @param {ReadonlyArray<{id: string, token: string}>} input.meaningTokens
 * @param {readonly {id: string, lri: number, pdi: number}[]} input.isolates isolate counts the rendered heading must carry, per row
 * @param {boolean} input.webfontLoaded
 * @param {{ok: boolean}} input.audit the audit report the rows were rendered from
 */
export function evaluateMeasurement({
	page,
	frames,
	meaningTokens,
	isolates,
	webfontLoaded,
	audit,
}) {
	const findings = [];
	const layoutFindings = [];
	const push = (message, layout = false) => {
		findings.push(message);
		if (layout) layoutFindings.push(message);
	};
	if (!audit.ok) push('the fixture audit itself reported a failing row');
	if (!webfontLoaded) push('the shipped webfont did not load, so the stack was not measured');
	if (page.documentScrollWidth > page.viewportWidth + 1) {
		push(
			`the page overflows horizontally: ${page.documentScrollWidth} > ${page.viewportWidth}`,
			true,
		);
	}
	for (const frame of frames) {
		if (frame.scrollWidth > frame.clientWidth + 1) {
			push(
				`frame ${frame.id} (${frame.phase}) overflows: ${frame.scrollWidth} > ${frame.clientWidth}`,
				true,
			);
		}
	}
	for (const { id, token } of meaningTokens) {
		const frame = frames.find((row) => row.id === id && row.phase === 'after');
		if (!frame) {
			push(`no rendered frame for row ${id}, so its meaning tokens were not measured`);
			continue;
		}
		// The HEADING, not the frame: the frame also renders a call to
		// action built from the same token list, so a frame-wide search
		// would let the chip vouch for the heading it was checked
		// against — and prove nothing about the expansion.
		if (!frame.headingText.includes(token)) {
			push(`meaning token "${token}" did not reach the rendered heading of row ${id}`);
		}
	}
	for (const expected of isolates) {
		if (expected.lri !== expected.pdi) {
			push(`row ${expected.id} declares unbalanced isolates (${expected.lri}/${expected.pdi})`);
		}
		const frame = frames.find((row) => row.id === expected.id && row.phase === 'after');
		if (!frame) continue;
		// Counted in the RENDERED text, not in the string the fixture
		// built: comparing `row.bidi` with itself cannot fail, so a
		// sanitiser, a normaliser or a future SSR/CSR transform that
		// dropped an isolate would still have exited 0.
		if (frame.isolates.lri !== expected.lri || frame.isolates.pdi !== expected.pdi) {
			push(
				`row ${expected.id}: the rendered heading carries ${frame.isolates.lri}/${frame.isolates.pdi} U+2066/U+2069, but the row declares ${expected.lri}/${expected.pdi} — something added or stripped isolates on the way to the screen`,
			);
		}
	}
	return { ok: findings.length === 0, findings, layoutFindings };
}

/**
 * The run-level verdict over the two measured configurations.
 *
 * `shipped` is what the product's own breaking rules do; `mitigated` is
 * the same frames plus the fixture-local `overflow-wrap: anywhere`.
 *
 *   - every string-level fact (page overflow, meaning tokens, rendered
 *     isolates, webfont, fixture audit) must hold in BOTH — those do
 *     not depend on CSS;
 *   - every frame must hold under the mitigation, because that is the
 *     configuration the fixture claims;
 *   - a frame that overflows only under the shipped rules is RECORDED,
 *     not failed. Whether a heading may break anywhere is
 *     `src/editorial/`'s decision (an open item in §6 of
 *     `docs/verification/i18n/pseudo-locale-stress.md`), and a capture
 *     that fails on it would only invite the next worker to remove the
 *     observation instead of resolving it.
 */
export function evaluateRun({ shipped, mitigated }) {
	const stringFindings = (verdict) =>
		verdict.findings.filter((finding) => !verdict.layoutFindings.includes(finding));
	const findings = [...stringFindings(shipped), ...stringFindings(mitigated)];
	const notes = [];
	if (shipped.layoutFindings.length > 0) {
		notes.push(
			`${shipped.layoutFindings.length} frame(s) overflow under the SHIPPED breaking rules; recorded as an open editorial decision, not as a pass`,
		);
	}
	if (mitigated.layoutFindings.length > 0) {
		notes.push(
			`${mitigated.layoutFindings.length} frame(s) overflow even with the fixture-local overflow-wrap: anywhere, so the frames themselves are broken`,
		);
		findings.push(...mitigated.layoutFindings);
	}
	return {
		ok: findings.length === 0,
		findings: [...new Set(findings)],
		notes,
		shippedOverflow: shipped.layoutFindings,
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const probeOnly = argv.includes('--probe-only');
	const outIndex = argv.indexOf('--out');
	const outPath = outIndex >= 0 ? argv[outIndex + 1] : undefined;
	if (outIndex >= 0 && !outPath)
		throw new Error('capture-pseudo-locale-stress: --out needs a path');

	const pseudo = await import('../src/i18n/pseudo-locale.ts');
	const { rawTokens } = await import('../src/editorial/tokens.ts');

	/**
	 * The webfont stylesheet the PRODUCT loads, read out of `__root.tsx`.
	 * A report that named its own font would be measuring a second,
	 * fictional product.
	 */
	const rootSource = await readFile(resolve(REPO_ROOT, 'src/routes/__root.tsx'), 'utf8');
	const fontHrefMatch = rootSource.match(/href: '(https:\/\/fonts\.googleapis\.com\/css2[^']*)'/);
	if (!fontHrefMatch) {
		throw new Error(
			'capture-pseudo-locale-stress: no fonts.googleapis.com stylesheet href in src/routes/__root.tsx. ' +
				'Update this script rather than letting the report measure a font the product does not ship.',
		);
	}

	const fonts = {
		heading: rawTokens.fonts.heading.value,
		sans: rawTokens.fonts.sans.value,
		mono: rawTokens.fonts.mono.value,
	};

	// `expandedText` is attached to each audit row here rather than in
	// `src/i18n/`: the audit returns findings, the report needs the
	// string it measured. Both come from the same expander.
	const audit = pseudo.auditPseudoSamples();
	const samples = pseudo.PSEUDO_STRESS_SAMPLES;
	const rows = audit.samples.map((row) => {
		const sample = pseudo.pseudoSampleById(row.id);
		return {
			...row,
			// The SAME helper the Storybook preview renders, so the
			// picture and the preview cannot show different strings.
			expandedText: pseudo.pseudoExpandedText(sample, row.ratioTarget),
		};
	});

	const model = buildReportModel({
		audit: { ...audit, samples: rows },
		samples,
		surfaceIds: pseudo.PSEUDO_SURFACE_SAMPLE_IDS,
		fonts,
		fontHref: fontHrefMatch[1],
		limits: pseudo.PSEUDO_LOCALE_LIMITS,
	});

	await mkdir(dirname(OUT_HTML), { recursive: true });
	await writeFile(OUT_HTML, renderReportHtml(model), 'utf8');

	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
	let measurement = {
		ok: false,
		findings: ['measurement did not run'],
		notes: [],
		shippedOverflow: [],
	};
	let webfontLoaded = false;
	/**
	 * The families the PRODUCT's webfont stylesheet declares — parsed
	 * out of the href read from `__root.tsx`, not restated here. A
	 * stack entry the stylesheet does not serve (the mono role falls
	 * back to a local face) is not a webfont claim this run can make.
	 */
	const webfontFamilies = [
		...new Set(
			[...fontHrefMatch[1].matchAll(/family=([^&:]+)/g)].map(([, raw]) =>
				decodeURIComponent(raw.replace(/\+/g, ' ')),
			),
		),
	];
	try {
		await page.goto(`file://${OUT_HTML}`, { waitUntil: 'load' });
		// `document.fonts.status` is `'loaded'` even when the stylesheet
		// fetch FAILED, so asking it alone would have printed "the
		// shipped webfont resolved" for a run that measured the platform
		// fallback. Ask the question that matters instead: did the
		// stylesheet contribute a real face for each family it declared,
		// and is that face usable for the text on screen?
		const webfontFacts = await page.evaluate(async (families) => {
			await document.fonts.ready;
			const plain = (value) => value.replace(/['"]/g, '').trim().toLowerCase();
			return families.map((family) => {
				const faces = [...document.fonts].filter((face) => plain(face.family) === plain(family));
				return {
					family,
					faces: faces.length,
					loaded:
						faces.some((face) => face.status === 'loaded') &&
						document.fonts.check(`1em "${family}"`),
				};
			});
		}, webfontFamilies);
		webfontLoaded = webfontFacts.length > 0 && webfontFacts.every((fact) => fact.loaded);

		const measureFrames = () =>
			page.evaluate(() =>
				[...document.querySelectorAll('[data-pseudo-frame]')].map((node) => {
					const heading = node.querySelector('h3');
					const headingText = heading?.textContent ?? node.textContent ?? '';
					const count = (character) => headingText.split(character).length - 1;
					return {
						id: node.dataset.pseudoId ?? '',
						phase: node.dataset.pseudoFrame ?? '',
						scrollWidth: node.scrollWidth,
						clientWidth: node.clientWidth,
						headingText,
						isolates: { lri: count('\u2066'), pdi: count('\u2069') },
					};
				}),
			);

		const setMitigation = (on) =>
			page.evaluate((enabled) => {
				document.documentElement.classList.toggle('breaks-anywhere', enabled);
			}, on);

		const pageFacts = await page.evaluate(() => ({
			viewportWidth: document.documentElement.clientWidth,
			documentScrollWidth: document.documentElement.scrollWidth,
		}));

		const meaningTokens = rows
			.filter((row) => (pseudo.pseudoSampleById(row.id).meaningTokens ?? []).length > 0)
			.flatMap((row) =>
				pseudo.pseudoSampleById(row.id).meaningTokens.map((token) => ({ id: row.id, token })),
			)
			.filter(({ id }) => pseudo.PSEUDO_SURFACE_SAMPLE_IDS.includes(id));

		const isolates = rows
			.filter((row) => row.direction === 'rtl')
			.filter((row) => pseudo.PSEUDO_SURFACE_SAMPLE_IDS.includes(row.id))
			.map((row) => ({ id: row.id, ...row.bidi.isolates }));

		// Pass 1: the shipped breaking rules, exactly as the report
		// stylesheet declares them.
		const shippedFrames = await measureFrames();
		const shippedVerdict = evaluateMeasurement({
			page: pageFacts,
			frames: shippedFrames,
			meaningTokens,
			isolates,
			webfontLoaded,
			audit,
		});

		// Pass 2: the same frames with the fixture-local mitigation on,
		// so the report can say what a freer break rule would buy.
		await setMitigation(true);
		const mitigatedFrames = await measureFrames();
		const mitigatedVerdict = evaluateMeasurement({
			page: pageFacts,
			frames: mitigatedFrames,
			meaningTokens,
			isolates,
			webfontLoaded,
			audit,
		});
		await setMitigation(false);

		measurement = evaluateRun({ shipped: shippedVerdict, mitigated: mitigatedVerdict });

		await page.evaluate(
			({ run, webfont, families, frameWidth, ratio }) => {
				const banner = document.querySelector('[data-role="verdict"]');
				if (banner) {
					banner.textContent = run.ok
						? `measurement: every ${frameWidth} px frame held at source and at ${ratio}x expansion under the fixture-local overflow-wrap: anywhere; no horizontal page overflow; every declared meaning token reached the rendered heading; rendered isolate counts match the declared ones`
						: `measurement FAILED: ${run.findings.join('; ')}`;
					banner.classList.add(run.ok ? 'ok' : 'bad');
				}
				const overflow = document.querySelector('[data-role="shipped-overflow"]');
				if (overflow) {
					overflow.textContent = '';
					const lines = [
						{
							ok: run.shippedOverflow.length === 0,
							text:
								run.shippedOverflow.length === 0
									? `shipped breaking rules (src/styles.css body rule + SectionHeading): every ${frameWidth} px frame held`
									: `shipped breaking rules (src/styles.css body rule + SectionHeading): ${run.shippedOverflow.length} frame(s) overflow — ${run.shippedOverflow.join('; ')}`,
						},
						{
							ok: true,
							text: `same frames + fixture-local overflow-wrap: anywhere (NOT a shipped recipe): ${
								run.ok
									? 'every frame held'
									: `${run.findings.length} finding(s): ${run.findings.join('; ')}`
							}`,
						},
						...run.notes.map((note) => ({ ok: false, text: note })),
					];
					for (const line of lines) {
						const item = document.createElement('li');
						item.textContent = line.text;
						item.className = line.ok ? 'ok' : 'bad';
						overflow.appendChild(item);
					}
				}
				const fontBanner = document.querySelector('[data-role="webfont"]');
				if (fontBanner) {
					const missing = families.filter((fact) => !fact.loaded).map((fact) => fact.family);
					fontBanner.textContent = webfont
						? `webfont: the shipped fonts.googleapis.com stack resolved in this browser (${families
								.map((fact) => fact.family)
								.join(', ')})`
						: `webfont UNAVAILABLE: ${missing.join(', ')} did not load, so this run measured the platform fallback only`;
					fontBanner.classList.add(webfont ? 'ok' : 'bad');
				}
			},
			{
				run: measurement,
				webfont: webfontLoaded,
				families: webfontFacts,
				frameWidth: FRAME_WIDTH,
				ratio: pseudo.DEFAULT_EXPANSION_RATIO,
			},
		);

		await writeFile(
			OUT_JSON,
			`${JSON.stringify(
				{
					page: pageFacts,
					shipped: { frames: shippedFrames, verdict: shippedVerdict },
					mitigated: { frames: mitigatedFrames, verdict: mitigatedVerdict },
					measurement,
					webfont: webfontFacts,
					viewport: VIEWPORT,
				},
				null,
				2,
			)}\n`,
			'utf8',
		);

		if (!probeOnly) {
			const png = resolve(REPO_ROOT, '.tmp/pseudo-locale-stress.png');
			await mkdir(dirname(png), { recursive: true });
			await page.screenshot({ path: png, fullPage: true });
			const target = outPath
				? resolve(REPO_ROOT, outPath)
				: resolve(REPO_ROOT, 'docs/verification/i18n/pseudo-locale-stress.webp');
			await mkdir(dirname(target), { recursive: true });
			// Moderately compressed WebP at the repository's conventional
			// quality, narrowed so the artefact stays under the
			// verification-image cap. Quality is the convention and is not
			// the lever: the report is a 3000+ px document, so the width
			// is what buys the budget (1280 px at quality 80 is ~291 kB of
			// the 300 kB cap).
			const info = await sharp(png)
				.resize({ width: 1280, withoutEnlargement: true })
				.webp({ quality: 80, effort: 6 })
				.toFile(target);
			if (info.size > MAX_BYTES) {
				process.stderr.write(
					`capture-pseudo-locale-stress: ${relative(REPO_ROOT, target)} is ${info.size} bytes, over the ` +
						`${MAX_BYTES} byte cap — narrow the report or lower the quality.\n`,
				);
				process.exitCode = 1;
			} else {
				console.log(
					`capture-pseudo-locale-stress: wrote ${relative(REPO_ROOT, target)} (${info.width}x${info.height}, ${info.size} bytes)`,
				);
			}
		}
	} finally {
		await browser.close();
	}

	console.log(
		[
			`capture-pseudo-locale-stress: ${audit.samples.length} rows audited (${audit.passing} ok / ${audit.failing} failing)`,
			`webfont loaded: ${webfontLoaded}`,
			`shipped breaking rules: ${measurement.shippedOverflow.length === 0 ? 'every frame held' : `${measurement.shippedOverflow.length} frame(s) overflow (${measurement.shippedOverflow.join('; ')})`}`,
			`measurement: ${measurement.ok ? 'every frame held with the fixture-local overflow-wrap: anywhere' : measurement.findings.join('; ')}`,
			`capture-pseudo-locale-stress: wrote ${relative(REPO_ROOT, OUT_HTML)} and ${relative(REPO_ROOT, OUT_JSON)}`,
		].join('\n'),
	);

	for (const note of measurement.notes) {
		process.stderr.write(`capture-pseudo-locale-stress: recorded observation — ${note}\n`);
	}
	if (!measurement.ok) {
		process.stderr.write(
			`capture-pseudo-locale-stress: ${measurement.findings.length} finding(s): ${measurement.findings.join('; ')}\n`,
		);
		process.exitCode = 1;
	}
}

// Only run the browser capture when this file is executed directly; the
// unit test imports the pure helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
