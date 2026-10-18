#!/usr/bin/env node
/**
 * capture-glyph-coverage — glyph-display verification for the Issue #432
 * heading fixture.
 *
 * Usage:
 *   node --experimental-strip-types scripts/capture-glyph-coverage.mjs [options]
 *
 *   --probe-only     run the measurement, skip the screenshot
 *   --out <webp>     screenshot path (default docs/verification/i18n/diacritic-cyrillic-font.webp)
 *
 * What it does
 * ------------
 * 1. Renders the fr / de / pt / ru heading fixture
 *    (`src/i18n/glyphs.fixture.ts`) as a self-contained HTML report, using
 *    the SHIPPED font stack read from `src/editorial/tokens.ts` and the
 *    webfont stylesheet href read from `src/routes/__root.tsx`. Neither is
 *    restated here: a report that declared its own font would be measuring a
 *    second, fictional product.
 * 2. Loads that report in headless Chromium, force-loads the webfont faces,
 *    and MEASURES every non-ASCII code point the fixture carries:
 *      - **missing glyph** — the raster is pixel-identical to the `.notdef`
 *        box the same stack draws for a Private Use code point. This is a
 *        rendering measurement, not a font-table lookup.
 *      - **webfont vs fallback** — differential raster. The code point is
 *        drawn under `"<family>", monospace` and under `monospace` alone;
 *        identical rasters mean the family had no glyph and the platform
 *        fallback answered, different rasters mean the family supplied it.
 *      - **advance width** — recorded so a fallback metric difference is
 *        visible, not just asserted.
 * 3. Round-trips the rendered headings through the DOM selection and the
 *    system clipboard, and compares the code points that come back with the
 *    bytes the fixture stores. Copy/paste preserving the original Unicode is
 *    a property of the pipeline, so it is measured, not assumed.
 * 4. Writes the probe result as JSON and screenshots the report as WebP.
 *
 * What it deliberately does NOT do
 * ---------------------------------
 * It does not proofread anything, translate anything, or judge any sentence.
 * `docs/domain/i18n.md` §5 splits copy quality (the editor's obligation, not
 * measured here) from typography (the font stack's obligation, measured
 * here). No proofreading tool — yomiyasu or otherwise — is part of this
 * capture, and it adds no Python runtime: it is Node + Chromium only.
 *
 * `--experimental-strip-types` is what lets plain Node load the TypeScript
 * fixture and tokens. It is a no-op on Node >= 23 and required on the
 * repository's minimum (Node 22.18).
 *
 * Honesty rules baked into the output
 * -----------------------------------
 * If the webfont cannot be fetched, the report says so in a banner and every
 * webfont verdict reads `unavailable`. A run without the webfont measures
 * the platform fallback only, and claiming coverage it did not measure would
 * make the artefact worthless.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_HTML = resolve(REPO_ROOT, '.tmp/glyph-coverage.html');
const OUT_JSON = resolve(REPO_ROOT, '.tmp/glyph-coverage-probe.json');
const MAX_BYTES = 300 * 1024;
const VIEWPORT = { width: 1600, height: 1000 };

const argv = process.argv.slice(2);
const probeOnly = argv.includes('--probe-only');
const outIndex = argv.indexOf('--out');
const OUT_WEBP = resolve(
	REPO_ROOT,
	outIndex >= 0
		? (argv[outIndex + 1] ?? '')
		: 'docs/verification/i18n/diacritic-cyrillic-font.webp',
);
if (!OUT_WEBP) throw new Error('capture-glyph-coverage: --out needs a path');

const { GLYPH_HEADING_FIXTURES, glyphCodePointUsage, glyphSamples } = await import(
	'../src/i18n/glyphs.fixture.ts'
);
const { describeCodePoint, findNonAscii } = await import('../src/i18n/unicode.ts');
const { rawTokens } = await import('../src/editorial/tokens.ts');

/**
 * The webfont stylesheet the PRODUCT loads, read out of `__root.tsx`.
 *
 * The product loads it asynchronously (`media="print"` + an inline flip
 * script, Issue #291); a static report has no hydration to wait for, so it
 * loads the same href directly. Same URL, same faces.
 */
const rootSource = await readFile(resolve(REPO_ROOT, 'src/routes/__root.tsx'), 'utf8');
const fontHrefMatch = rootSource.match(/href: '(https:\/\/fonts\.googleapis\.com\/css2[^']*)'/);
if (!fontHrefMatch) {
	throw new Error(
		'capture-glyph-coverage: no fonts.googleapis.com stylesheet href in src/routes/__root.tsx. ' +
			'Update this script rather than letting the report measure a font the product does not ship.',
	);
}
const FONT_HREF = fontHrefMatch[1];

const FONT_STACKS = {
	heading: rawTokens.fonts.heading.value,
	body: rawTokens.fonts.sans.value,
	mono: rawTokens.fonts.mono.value,
};
const HEADING_FAMILY = rawTokens.fonts.heading.value.split(',')[0].replaceAll('"', '').trim();
const BODY_FAMILY = rawTokens.fonts.sans.value.split(',')[0].replaceAll('"', '').trim();

const escapeHtml = (value) =>
	String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

// ---------------------------------------------------------------------------
// Report HTML
// ---------------------------------------------------------------------------

function renderSample(sample) {
	const claimed = new Set(sample.probe);
	const chips = findNonAscii(sample.heading)
		.map(
			(fact) =>
				`<span class="chip${claimed.has(fact.hex) ? ' chip-claimed' : ''}" title="${escapeHtml(fact.label)}">${escapeHtml(fact.hex)}</span>`,
		)
		.join('');
	const guards = sample.guards
		.map(
			(guard) =>
				`<li><b>${escapeHtml(guard.kind)}</b> <span class="tok">${escapeHtml(guard.token)}</span></li>`,
		)
		.join('');
	const element = sample.tier === 'heading' ? 'h3' : 'p';
	return `<article class="sample" data-sample="${escapeHtml(sample.id)}">
	<header class="row-head"><span class="mono id">${escapeHtml(sample.id)}</span><span class="mono tag">${escapeHtml(sample.locale)} · ${escapeHtml(sample.focus)} · ${escapeHtml(sample.tier)} · lang=${escapeHtml(sample.lang)} · ${escapeHtml(sample.form)}</span></header>
	<${element} class="copy tier-${escapeHtml(sample.tier)}" lang="${escapeHtml(sample.lang)}">${escapeHtml(sample.heading)}</${element}>
	<div class="chips">${chips}</div>
	<ul class="guards">${guards}</ul>
</article>`;
}

function renderLocale(fixture) {
	const notes = fixture.typography
		.map(
			(note) =>
				`<li><b>${escapeHtml(note.claim)}</b><br><span class="muted">${escapeHtml(note.note)}</span></li>`,
		)
		.join('');
	return `<section class="locale">
	<h2>${escapeHtml(fixture.locale)} <span class="mono muted">${escapeHtml(fixture.lang)}</span></h2>
	<ul class="notes">${notes}</ul>
	<div class="samples">${fixture.samples.map(renderSample).join('\n')}</div>
</section>`;
}

function renderCoverageTable(entries) {
	const rows = entries
		.map((entry) => {
			const samples = entry.sampleIds
				.map((id) => `<span class="mono muted">${escapeHtml(id)}</span>`)
				.join(' ');
			return `<tr data-codepoint="${escapeHtml(entry.hex)}">
	<td class="mono">${escapeHtml(entry.hex)}</td>
	<td class="glyph tier-heading">${escapeHtml(entry.char)}</td>
	<td class="mono name" title="${escapeHtml(describeCodePoint(entry.codePoint))}">${escapeHtml(describeCodePoint(entry.codePoint))}</td>
	<td class="where" data-role="heading-webfont">—</td>
	<td class="where" data-role="body-webfont">—</td>
	<td class="mono adv" data-role="advance">—</td>
	<td class="mono samples">${samples}</td>
</tr>`;
		})
		.join('\n');
	return `<table>
		<thead>
			<tr>
				<th>code point</th><th>glyph</th><th>name</th><th>heading webfont</th><th>body webfont</th><th>advance</th><th>rows</th>
			</tr>
		</thead>
		<tbody>
${rows}
		</tbody>
	</table>`;
}

/**
 * Two half-width tables instead of one full-width one: the row count is fixed
 * by the fixture, and a single column would make the artefact taller than the
 * screenshot cap allows without adding information.
 */
function renderCoverageTables() {
	const entries = glyphCodePointUsage();
	const half = Math.ceil(entries.length / 2);
	return `<div class="coverage">${renderCoverageTable(entries.slice(0, half))}${renderCoverageTable(entries.slice(half))}</div>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Issue #432 — diacritics / combining marks / Cyrillic in headings</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="${escapeHtml(FONT_HREF)}" />
<style>
	:root {
		--font-heading: ${FONT_STACKS.heading};
		--font-body: ${FONT_STACKS.sans};
		--font-mono: ${FONT_STACKS.mono};
		--canvas: #ffffff;
		--text: #0b1020;
		--muted: #5b6472;
		--rule: #e3e6ec;
		--ok: #146c43;
		--warn: #8a5a00;
		--bad: #a01b2b;
	}
	* { box-sizing: border-box; }
	body {
		margin: 0;
		padding: 36px 44px 44px;
		background: var(--canvas);
		color: var(--text);
		font-family: var(--font-body);
		font-size: 14px;
		line-height: 1.6;
	}
	.mono { font-family: var(--font-mono); font-size: 12px; }
	.muted { color: var(--muted); }
	.wrap { max-width: 1520px; margin: 0 auto; }
	.eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); }
	h1 { margin: 8px 0 0; font-family: var(--font-heading); font-size: 30px; line-height: 1.25; }
	.lede { margin: 10px 0 0; max-width: 96ch; color: var(--muted); }
	.banner { margin: 18px 0 0; padding: 10px 14px; border: 1px solid var(--rule); border-radius: 4px; font-size: 13px; }
	.banner.bad { border-color: var(--bad); color: var(--bad); }
	h2.section { margin: 34px 0 0; padding-bottom: 6px; border-bottom: 2px solid var(--rule); font-family: var(--font-heading); font-size: 20px; }
	.locale { margin-top: 22px; }
	.locale > h2 { margin: 0 0 6px; font-family: var(--font-heading); font-size: 17px; }
	.notes { margin: 0 0 10px; padding-left: 18px; font-size: 12px; }
	.notes li { margin-bottom: 3px; }
	.samples { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 26px; }
	.sample { border-top: 1px solid var(--rule); padding-top: 8px; }
	.row-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
	.id { color: var(--text); letter-spacing: 0.04em; }
	.tag { color: var(--muted); font-size: 11px; }
	.copy { margin: 6px 0 6px; }
	.tier-heading { font-family: var(--font-heading); font-size: 22px; line-height: 1.35; font-weight: 700; }
	.tier-body { font-family: var(--font-body); font-size: 17px; line-height: 1.7; }
	.chips { display: flex; flex-wrap: wrap; gap: 4px; }
	.chip { font-family: var(--font-mono); font-size: 10px; color: var(--muted); border-bottom: 1px dashed var(--rule); }
	.chip-claimed { color: var(--text); border-bottom: 1px solid var(--muted); }
	.guards { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0 0; padding: 0; list-style: none; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
	.guards .tok { color: var(--text); }
	.coverage { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 26px; margin-top: 14px; }
	table { width: 100%; border-collapse: collapse; }
	th { text-align: left; font-family: var(--font-mono); font-size: 11px; font-weight: 400; color: var(--muted); border-bottom: 1px solid var(--rule); padding: 4px 6px; }
	td { padding: 3px 6px; vertical-align: top; border-bottom: 1px solid #f2f4f7; }
	td.glyph { font-family: var(--font-heading); font-size: 20px; line-height: 1.2; width: 34px; text-align: center; }
	td.name { color: var(--muted); font-size: 11px; }
	td.where { font-family: var(--font-mono); font-size: 11px; white-space: nowrap; }
	td.samples { font-size: 10px; color: var(--muted); }
	td.adv { font-size: 11px; color: var(--muted); }
	.ok { color: var(--ok); }
	.fallback { color: var(--warn); }
	.missing { color: var(--bad); font-weight: 700; }
	.unavailable { color: var(--muted); }
	.verdict-summary { margin: 10px 0 0; font-family: var(--font-mono); font-size: 12px; }
	footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 12px; }
	code { font-family: var(--font-mono); }
</style>
</head>
<body>
<div class="wrap">
	<p class="eyebrow">Issue #432 — diacritics / combining marks / Cyrillic in headings</p>
	<h1>One shipped font stack, four locales, ${glyphCodePointUsage().length} measured code points</h1>
	<p class="lede">
		Every heading below is a synthetic fixture from <code>src/i18n/glyphs.fixture.ts</code> —
		written to exercise a character class, not to publish anything. The rows are rendered with the
		<strong>product's</strong> font stack, read from <code>src/editorial/tokens.ts</code>
		(<code>${escapeHtml(HEADING_FAMILY)}</code> for headings), and the webfont stylesheet is the
		href <code>src/routes/__root.tsx</code> loads. Locale is opt-in per row through its own
		<code>lang</code>; nothing here negotiates a locale from the visitor.
	</p>
	<div id="banner" class="banner">Measuring…</div>

	<h2 class="section">01 — Headings, rendered with the shipped stack</h2>
	${GLYPH_HEADING_FIXTURES.map(renderLocale).join('\n')}

	<h2 class="section">02 — Measured coverage per code point</h2>
	<p class="verdict-summary" id="verdict-summary">—</p>
	<p class="lede" id="clipboard-summary">—</p>
	${renderCoverageTables()}

	<footer>
		Generated by <code>scripts/capture-glyph-coverage.mjs</code>. Missing glyph = the raster is
		pixel-identical to the <code>.notdef</code> box the same stack draws for a Private Use code
		point. "fallback" = the shipped family has no glyph and the platform fallback answered.
		Copy quality is <strong>not</strong> measured here: no proofreading tool runs in this capture,
		and it adds no Python runtime to the project. Provenance is in
		<code>.tmp/glyph-coverage-probe.json</code>.
	</footer>
</div>
</body>
</html>
`;

await mkdir(dirname(OUT_HTML), { recursive: true });
await writeFile(OUT_HTML, html, 'utf8');

// ---------------------------------------------------------------------------
// Browser probe
// ---------------------------------------------------------------------------

const { chromium } = await import('@playwright/test');

/** Runs inside the page. Kept self-contained: it is serialised into Chromium. */
async function probeInPage(input) {
	const { headingStack, bodyStack, headingFamily, bodyFamily, codePoints, samples } = input;
	const canvas = document.createElement('canvas');
	canvas.width = 96;
	canvas.height = 96;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });

	/** Ink pixels + a hash of the alpha channel: a shape fingerprint. */
	const raster = (font, char) => {
		ctx.clearRect(0, 0, 96, 96);
		ctx.font = `48px ${font}`;
		ctx.fillStyle = '#000';
		ctx.textBaseline = 'top';
		ctx.fillText(char, 6, 6);
		const data = ctx.getImageData(0, 0, 96, 96).data;
		let hash = 0;
		let ink = 0;
		for (let i = 3; i < data.length; i += 4) {
			const a = data[i];
			if (a > 8) ink += 1;
			hash = (hash * 31 + a) | 0;
		}
		return { hash, ink, advance: Math.round(ctx.measureText(char).width * 100) / 100 };
	};

	// A Private Use code point: no shipped font has a glyph for it, so the
	// stack draws its `.notdef` box. That box is the reference for "missing".
	const NOTDEF = '\uE0FF';
	const sentinelFont = 'monospace';
	const notdef = raster(headingStack, NOTDEF);
	const sentinelNotdef = raster(sentinelFont, NOTDEF);

	const loaded = (family) => {
		const faces = [...document.fonts].filter((face) => face.family === family);
		return { total: faces.length, ready: faces.filter((face) => face.status === 'loaded').length };
	};

	const rows = codePoints.map((entry) => {
		const stack = raster(headingStack, entry.char);
		const sentinel = raster(sentinelFont, entry.char);
		const headingOnly = raster(`"${headingFamily}", ${sentinelFont}`, entry.char);
		const bodyOnly = raster(`"${bodyFamily}", ${sentinelFont}`, entry.char);
		return {
			hex: entry.hex,
			char: entry.char,
			combining: entry.combining,
			// Missing glyph = identical to the .notdef the same stack draws.
			missing: stack.hash === notdef.hash,
			// Webfont coverage = differential against a sentinel family that
			// definitely has the glyph. Identical rasters mean the family
			// contributed nothing and the fallback answered.
			headingWebfont: headingOnly.hash !== sentinel.hash,
			bodyWebfont: bodyOnly.hash !== sentinel.hash,
			advance: stack.advance,
			sentinelAdvance: sentinel.advance,
			ink: stack.ink,
		};
	});

	// Clipboard round trip over the RENDERED text, not over the fixture
	// strings: selection -> clipboard -> code points.
	const host = document.createElement('div');
	host.setAttribute('contenteditable', 'plaintext-only');
	host.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre-wrap;';
	for (const sample of samples) {
		const line = document.createElement('div');
		line.setAttribute('data-clip-sample', sample.id);
		line.textContent = sample.heading;
		host.appendChild(line);
	}
	document.body.appendChild(host);
	const domTexts = [...host.children].map((node) => node.textContent ?? '');
	const range = document.createRange();
	range.selectNodeContents(host);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	const selected = selection.toString().replace(/\n/g, '');
	let clipboard = 'unavailable';
	let clipboardError = '';
	try {
		if (!navigator.clipboard) throw new Error('navigator.clipboard is undefined');
		await navigator.clipboard.writeText(selection.toString());
		clipboard = await navigator.clipboard.readText();
	} catch (error) {
		clipboardError = error instanceof Error ? error.message : String(error);
	}
	host.remove();

	return {
		notdef: { ink: notdef.ink, advance: notdef.advance },
		sentinelNotdefInk: sentinelNotdef.ink,
		faces: {
			heading: loaded(headingFamily),
			body: loaded(bodyFamily),
		},
		secureContext: window.isSecureContext,
		rows,
		domTexts,
		selected,
		clipboard,
		clipboardError,
		userAgent: navigator.userAgent,
	};
}

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: VIEWPORT,
	deviceScaleFactor: 1,
	permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
await page.goto(`file://${OUT_HTML}`, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

const probeText = glyphSamples()
	.map((sample) => sample.heading)
	.join(' ');
await page.evaluate(
	async ({ text, headingFamily, bodyFamily }) => {
		await document.fonts.load(`48px "${headingFamily}"`, text);
		await document.fonts.load(`48px "${bodyFamily}"`, text);
		await document.fonts.ready;
		// Webfonts are lazily fetched; the DOM rows above already request the
		// same faces, so a short settle is enough to catch the late ones.
		await new Promise((resolve) => setTimeout(resolve, 600));
	},
	{ text: probeText, headingFamily: HEADING_FAMILY, bodyFamily: BODY_FAMILY },
);

const probe = await page.evaluate(probeInPage, {
	headingStack: FONT_STACKS.heading,
	bodyStack: FONT_STACKS.body,
	headingFamily: HEADING_FAMILY,
	bodyFamily: BODY_FAMILY,
	codePoints: glyphCodePointUsage().map((entry) => ({
		hex: entry.hex,
		char: entry.char,
		combining: entry.combining,
	})),
	samples: glyphSamples().map((sample) => ({ id: sample.id, heading: sample.heading })),
});

const webfontLoaded = probe.faces.heading.ready > 0 && probe.faces.body.ready > 0;
probe.faces.body.ready > 0;

// Verdicts the probe produced, in the order the report lists them.
const missing = probe.rows.filter((row) => row.missing);
const headingFallback = probe.rows.filter((row) => !row.missing && !row.headingWebfont);
const bodyFallback = probe.rows.filter((row) => !row.missing && !row.bodyWebfont);

/** Did the rendered rows hand back the code points the fixture stores? */
const domMatchesFixture =
	JSON.stringify(probe.domTexts) === JSON.stringify(glyphSamples().map((sample) => sample.heading));
/** Did the DOM selection preserve them? */
const selectionMatchesFixture = probe.selected.replace(/\n/g, '') === probe.domTexts.join('');

/**
 * Did the system clipboard preserve them?
 *
 * Compared with the line breaks removed, because Chromium's plain-text
 * clipboard serialisation INSERTS one between block-level rows. That is the
 * platform's text serialisation, not a Unicode change: no row carries a line
 * break, and the question here is whether a code point was rewritten.
 */
const clipboardAvailable = probe.clipboard !== 'unavailable';
const stripLineBreaks = (value) => value.replace(/[\r\n]/g, '');
const clipboardMatchesSelection =
	clipboardAvailable &&
	stripLineBreaks(probe.clipboard) === stripLineBreaks(probe.domTexts.join(''));
const clipboardLineBreaks = clipboardAvailable
	? probe.clipboard.length - stripLineBreaks(probe.clipboard).length
	: 0;

const summary =
	`${probe.rows.length} code points measured · ${missing.length} missing glyph(s) · ` +
	`${headingFallback.length} answered by the platform fallback in the heading stack · ` +
	`${probe.rows.filter((row) => row.combining).length} combining marks (zero advance of their own)`;

const clipboardVerdict = clipboardAvailable
	? clipboardMatchesSelection
		? 'yes'
		: 'NO'
	: `not available (${probe.clipboardError || 'unknown reason'})`;
const clipboardSummary = `Copy/paste round trip over the rendered rows — DOM selection preserved the code points: ${selectionMatchesFixture ? 'yes' : 'NO'}; system clipboard preserved them: ${clipboardVerdict}${clipboardLineBreaks ? ` (${clipboardLineBreaks} line separator(s) added by the platform's plain-text serialisation, no code point changed)` : ''}`;

const bannerText = !webfontLoaded
	? 'Webfont NOT loaded in this run (fonts.googleapis.com unreachable or blocked). Every column ' +
		'below reports the PLATFORM FALLBACK measurement only; the webfont verdicts are unavailable ' +
		'and must not be read as coverage evidence.'
	: `Webfont loaded: ${probe.faces.heading.ready}/${probe.faces.heading.total} "${HEADING_FAMILY}" faces, ` +
		`${probe.faces.body.ready}/${probe.faces.body.total} "${BODY_FAMILY}" faces. ` +
		`Reference .notdef box drawn at ${probe.notdef.advance}px advance. Missing glyphs: ${missing.length} of ${probe.rows.length}.`;

const bannerBad = !webfontLoaded || missing.length > 0;

// --- inject the measured results into the report ---------------------------

const injected = await page.evaluate(
	({ rows, loaded, summary, clipboardSummary, bannerText, bannerBad }) => {
		const byHex = new Map(rows.map((row) => [row.hex, row]));
		const label = (row, webfont) => {
			if (!loaded) return 'unavailable';
			if (row.missing) return 'missing';
			return webfont ? 'webfont' : 'fallback';
		};
		const paint = (node, row, webfont) => {
			if (!node) return;
			node.textContent = label(row, webfont);
			node.classList.add(
				!loaded ? 'unavailable' : row.missing ? 'missing' : webfont ? 'ok' : 'fallback',
			);
		};
		for (const cell of document.querySelectorAll('[data-codepoint]')) {
			const row = byHex.get(cell.dataset.codepoint);
			if (!row) continue;
			paint(cell.querySelector('[data-role="heading-webfont"]'), row, row.headingWebfont);
			paint(cell.querySelector('[data-role="body-webfont"]'), row, row.bodyWebfont);
			const advance = cell.querySelector('[data-role="advance"]');
			if (advance) advance.textContent = row.combining ? '0 (mark)' : `${row.advance}px`;
		}
		document.getElementById('verdict-summary').textContent = summary;
		document.getElementById('clipboard-summary').textContent = clipboardSummary;
		const banner = document.getElementById('banner');
		banner.textContent = bannerText;
		banner.classList.toggle('bad', bannerBad);
		// Integrity check: a cell the probe could not fill would still read
		// the placeholder, which is exactly how a report ends up looking
		// complete while measuring nothing.
		const unfilled = [...document.querySelectorAll('[data-role]')].filter(
			(cell) => (cell.textContent ?? '').trim() === '\u2014',
		).length;
		return { unfilled, rows: byHex.size };
	},
	{ rows: probe.rows, loaded: webfontLoaded, summary, clipboardSummary, bannerText, bannerBad },
);

await mkdir(dirname(OUT_JSON), { recursive: true });
await writeFile(
	OUT_JSON,
	`${JSON.stringify(
		{
			generatedBy: 'scripts/capture-glyph-coverage.mjs',
			issue: '#432',
			viewport: VIEWPORT,
			fontStack: FONT_STACKS,
			fontHref: FONT_HREF,
			webfontLoaded,
			missing: missing.map((row) => row.hex),
			headingFallback: headingFallback.map((row) => row.hex),
			bodyFallback: bodyFallback.map((row) => row.hex),
			clipboard: {
				available: clipboardAvailable,
				error: probe.clipboardError,
				domMatchesFixture,
				selectionMatchesFixture,
				clipboardMatchesSelection,
				lineBreaksAddedByClipboard: clipboardLineBreaks,
			},
			probe,
		},
		null,
		2,
	)}\n`,
	'utf8',
);

if (probeOnly) {
	await browser.close();
} else {
	const { default: sharp } = await import('sharp');
	const png = resolve(REPO_ROOT, '.tmp/glyph-coverage.png');
	const contentHeight = await page.evaluate(() =>
		Math.ceil(document.body.getBoundingClientRect().bottom),
	);
	await page.setViewportSize({
		width: VIEWPORT.width,
		height: Math.min(Math.max(contentHeight, 400), 5000),
	});
	await page.waitForTimeout(150);
	await page.screenshot({ path: png, fullPage: true });
	await browser.close();
	// Narrowed to 1440 and quality 76 so the artefact stays under the cap.
	// The measurement itself is resolution-independent: it happens in the
	// page at the 1600px viewport, before any resampling.
	const info = await sharp(png)
		.resize({ width: 1440, withoutEnlargement: true })
		.webp({ quality: 76, effort: 6 })
		.toFile(OUT_WEBP);
	if (info.size > MAX_BYTES) {
		process.stderr.write(
			`capture-glyph-coverage: ${relative(REPO_ROOT, OUT_WEBP)} is ${info.size} bytes, over the ` +
				`${MAX_BYTES} byte cap — narrow the viewport or lower the quality.\n`,
		);
		process.exitCode = 1;
	} else {
		console.log(
			`capture-glyph-coverage: wrote ${relative(REPO_ROOT, OUT_WEBP)} (${info.width}x${info.height}, ${info.size} bytes)`,
		);
	}
}

console.log(
	[
		`capture-glyph-coverage: ${probe.rows.length} code points measured`,
		`webfont loaded: ${webfontLoaded} (heading ${probe.faces.heading.ready}/${probe.faces.heading.total}, body ${probe.faces.body.ready}/${probe.faces.body.total})`,
		`missing glyphs: ${missing.length}${missing.length ? ` — ${missing.map((row) => row.hex).join(', ')}` : ''}`,
		`heading stack answered by the platform fallback: ${headingFallback.length}${headingFallback.length ? ` — ${headingFallback.map((row) => row.hex).join(', ')}` : ''}`,
		`body stack answered by the platform fallback: ${bodyFallback.length}${bodyFallback.length ? ` — ${bodyFallback.map((row) => row.hex).join(', ')}` : ''}`,
		clipboardSummary,
		`capture-glyph-coverage: wrote ${relative(REPO_ROOT, OUT_HTML)} and ${relative(REPO_ROOT, OUT_JSON)}`,
	].join('\n'),
);

/*
 * Exit codes
 * ----------
 * 0  the measurement completed and the rendered text kept its code points
 * 1  the artefact would be misleading: the webfont did not load, a code
 *    point rendered as `.notdef`, or the copy/paste round trip lost a code
 *    point. The screenshot is still written so a human can look at it.
 */
if (injected.unfilled > 0 || injected.rows !== probe.rows.length) {
	process.stderr.write(
		`capture-glyph-coverage: ${injected.unfilled} verdict cell(s) were left unfilled ` +
			`(${injected.rows}/${probe.rows.length} rows rendered) — the artefact would look complete while measuring nothing.\n`,
	);
	process.exitCode = 1;
}

if (!webfontLoaded) {
	process.stderr.write(
		'capture-glyph-coverage: the shipped webfont did not load, so this run measured the platform fallback only.\n',
	);
	process.exitCode = 1;
}
if (missing.length > 0) {
	process.stderr.write(
		`capture-glyph-coverage: ${missing.length} code point(s) rendered as .notdef — ${missing.map((row) => row.hex).join(', ')}\n`,
	);
	process.exitCode = 1;
}
if (!selectionMatchesFixture || !domMatchesFixture) {
	process.stderr.write(
		'capture-glyph-coverage: the rendered rows did not hand back the code points the fixture stores.\n',
	);
	process.exitCode = 1;
}
if (clipboardAvailable && !clipboardMatchesSelection) {
	process.stderr.write(
		'capture-glyph-coverage: the system clipboard changed the code points on the way through.\n',
	);
	process.exitCode = 1;
}
