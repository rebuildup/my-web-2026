#!/usr/bin/env node
/**
 * Verification report generator for Issue #416.
 *
 * `scripts/check-layout-stress.mjs` answers "does the fixture break at
 * 320px with a visible scrollbar?" in a terminal. This script renders
 * the same run as a reviewable static report and screenshots it into
 * `docs/verification/compat/stress-story.webp` — the path Issue #416
 * requires in the PR body, with the `.webp` extension substituted for
 * the Issue's literal `.png` (a rendered PNG of a 320px-wide story is
 * not worth the repository weight; the exact encoded size is printed
 * here and reported per commit in the PR body instead of being baked
 * into a comment).
 *
 * The report is not a picture of a green run. It contains:
 *
 *   1. the healthy fixture captured at 320px — one legible capture per
 *      declared story, taken from `STRESS_STORY_IDS` so a story cannot
 *      be added to the fixture and stay out of the evidence,
 *   2. the deliberately broken `control-overflow` variant captured at
 *      the same width with the document scrolled to the injected 1200px
 *      block, so the failing path is visible and not only described,
 *   3. the per-rule verdict table, the environment the numbers came
 *      from, and the commands that reproduce all of it.
 *
 * A caption is a claim about the pixels next to it, so the control
 * capture is checked: the fixture paints its defect `#0ea5e9`, and the
 * generator refuses to write the report unless that colour is actually
 * present in the capture. Without that check a screenshot taken at
 * scroll 0 (the defect sits below the fold) would still be captioned
 * "意図的 defect" and committed as evidence.
 *
 *   node scripts/make-layout-stress-report.mjs
 *   pnpm run verify:compat-stress-screenshot   # same thing
 *
 * The generator refuses to render when the gate did not pass: a
 * verification image of a broken fixture must not be committed as if it
 * were evidence of a healthy one.
 *
 * Playwright can only encode PNG/JPEG, so each capture is taken into a
 * Buffer (never a file) and the final report is re-encoded with the
 * existing `sharp` devDependency as
 * `resize({ width: WEBP_WIDTH, withoutEnlargement: true })` +
 * `webp({ quality: WEBP_QUALITY })`. `WEBP_QUALITY` is below the 80 the
 * single-figure reports use because this report embeds eleven viewport
 * captures; 80 does not fit the shared 300 KB budget and a shorter report
 * is worse evidence than a slightly softer one. The target extension is asserted to
 * be `.webp` and the size is checked against the shared evidence budget
 * (`scripts/_lazy-media-image.mjs`), so a longer report fails loudly
 * instead of quietly doubling the blob. `sharp` and `@playwright/test`
 * stay devDependencies and are never imported by the Worker / SSR.
 *
 * Chromium must be present — `pnpm run e2e:install`. The generator
 * reads no secret, touches no network, no D1 and no R2.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAX_EVIDENCE_WIDTH, assertEvidenceSize } from './_lazy-media-image.mjs';
import { runLayoutStressCheck } from './check-layout-stress.mjs';
import { STRESS_STORY_IDS, STRESS_VIEWPORT, TOLERANCE_PX } from './layout-stress.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const HTML_REPORT = join(TMP, 'layout-stress-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/compat/stress-story.webp');
/**
 * Render width. The shared cap is 1600px; this report renders slightly
 * under it because eleven 320px viewport captures do not fit the 300 KB
 * evidence budget at 1600 (measured: 309 KB at quality 45, 321 KB at 50).
 * Shrinking the page keeps the small type legible; shrinking the font
 * would not.
 */
const WEBP_WIDTH = Math.min(MAX_EVIDENCE_WIDTH, 1500);
const WEBP_QUALITY = 45;

/**
 * Every declared story is captured, in declaration order. This is derived
 * from the fixture spec on purpose: a hand-written list of story names is
 * how a story ends up in the fixture but not in the evidence.
 */
const CAPTURED_STORIES = STRESS_STORY_IDS;

/** The colour `FIXTURE_CSS` paints the injected `control-overflow` block. */
const CONTROL_DEFECT_RGB = { r: 14, g: 165, b: 233 };

/**
 * How many defect pixels the control capture must contain. The block is
 * 1200x8 CSS px and 320px of it are on screen when the defect is framed,
 * so this is a wide margin over "one stray pixel".
 */
const MIN_CONTROL_DEFECT_PIXELS = 100;

/** Context kept above and below the defect block so the capture reads as a page. */
const CONTROL_CONTEXT_PX = 150;

const REPRODUCTION = [
	'pnpm run compat:stress:check                                # the gate (exit 0, two controls caught)',
	'node scripts/check-layout-stress.mjs --json                 # machine-readable result',
	'node --test scripts/check-layout-stress.test.mjs            # fixture suite for the fail-closed rules',
	'pnpm run verify:compat-stress-screenshot                    # regenerate this report + WebP',
	'file://$PWD/.tmp/layout-stress/baseline.html                # the fixture itself (320px wide)',
];

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/* ------------------------------------------------------------------ *
 * captures
 * ------------------------------------------------------------------ */

/**
 * Count pixels close to a colour, so a caption can be checked against the
 * image it describes.
 *
 * @param {Buffer} buffer encoded image
 * @param {{r: number, g: number, b: number}} rgb colour to look for
 * @returns {Promise<number>}
 */
async function countPixelsNear(buffer, rgb) {
	const { default: sharp } = await import('sharp');
	const { data, info } = await sharp(buffer)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	let hits = 0;
	for (let offset = 0; offset + 2 < data.length; offset += info.channels) {
		if (
			Math.abs(data[offset] - rgb.r) <= 12 &&
			Math.abs(data[offset + 1] - rgb.g) <= 12 &&
			Math.abs(data[offset + 2] - rgb.b) <= 12
		) {
			hits += 1;
		}
	}
	return hits;
}

/**
 * Capture the fixture in a real browser.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {object} result the gate result the captures belong to
 * @returns {Promise<{captures: object, sizes: string[]}>}
 */
async function capture(browser, result) {
	const { default: sharp } = await import('sharp');
	const sizes = [];

	/**
	 * The fixture HTML the gate actually measured. Taken from the run that
	 * wrote it, not re-derived from a path: a stale `.tmp` from an earlier
	 * `--width 375` run must not become this report's evidence.
	 *
	 * @param {string} variant
	 * @returns {string}
	 */
	function fixturePath(variant) {
		const run = result.runs.find((entry) => entry.id === variant);
		if (!run?.htmlPath) throw new Error(`the gate reported no fixture HTML for "${variant}"`);
		return join(ROOT, run.htmlPath);
	}

	/**
	 * @param {string} variant
	 * @param {{frame?: (page: import('@playwright/test').Page) => Promise<import('@playwright/test').PageScreenshotOptions>, scale?: number}} [shot]
	 * @returns {Promise<{base64: string, buffer: Buffer, width: number, height: number, bytes: number}>}
	 */
	async function shoot(variant, shot = {}) {
		const context = await browser.newContext({
			viewport: { width: result.viewport.width, height: result.viewport.height },
			deviceScaleFactor: shot.scale ?? 1,
			colorScheme: 'light',
			reducedMotion: 'reduce',
		});
		try {
			const page = await context.newPage();
			await page.goto(pathToFileURL(fixturePath(variant)).href, { waitUntil: 'load' });
			await page.evaluate(() => document.fonts.ready);
			// `frame` picks the region to shoot, so the caption and the pixels
			// cannot drift apart: nothing here relies on "scroll 0 happens to
			// be the interesting part".
			const buffer = await page.screenshot(
				shot.frame
					? await shot.frame(page)
					: {
							fullPage: true,
							clip: { x: 0, y: 0, width: result.viewport.width, height: result.viewport.height },
						},
			);
			const meta = await sharp(buffer).metadata();
			sizes.push(
				`${variant} ${meta.width}x${meta.height} ${Math.round(buffer.length / 1024)} KB PNG`,
			);
			return {
				base64: buffer.toString('base64'),
				buffer,
				width: meta.width,
				height: meta.height,
				bytes: buffer.length,
			};
		} finally {
			await context.close();
		}
	}

	const captures = {};
	for (const section of CAPTURED_STORIES) {
		captures[section] = await shoot('baseline', {
			// The story itself, never the fold: a viewport-height frame from
			// scroll 0 says nothing about story 07.
			frame: async (page) => {
				const box = await page.locator(`[data-stress-section="${section}"]`).boundingBox();
				if (!box) throw new Error(`the fixture did not render the "${section}" story`);
				const top = Math.max(0, Math.floor(box.y));
				return {
					fullPage: true,
					clip: {
						x: 0,
						y: top,
						width: result.viewport.width,
						height: Math.min(result.viewport.height, Math.ceil(box.y + box.height) - top),
					},
				};
			},
		});
	}

	// The injected block is the last child of <body>, roughly eight
	// viewports below the fold, so an unframed capture shows the healthy
	// fixture's first screen and nothing about the defect. Frame the
	// document's leftmost 320px around it instead: the 1200px block starts
	// at x=0, so it fills the frame and is cut off at its right edge.
	captures.control = await shoot('control-overflow', {
		frame: async (page) => {
			const box = await page.locator('[data-stress-control="overflow"]').boundingBox();
			if (!box) throw new Error('the control-overflow fixture did not render its defect block');
			const top = Math.max(0, Math.floor(box.y) - CONTROL_CONTEXT_PX);
			return {
				fullPage: true,
				clip: {
					x: 0,
					y: top,
					width: result.viewport.width,
					height: Math.min(
						result.viewport.height,
						Math.ceil(box.y + box.height) - top + CONTROL_CONTEXT_PX,
					),
				},
			};
		},
	});
	const defectPixels = await countPixelsNear(captures.control.buffer, CONTROL_DEFECT_RGB);
	if (defectPixels < MIN_CONTROL_DEFECT_PIXELS) {
		throw new Error(
			`the control-overflow capture shows only ${defectPixels} px of the injected defect (#0ea5e9, need ${MIN_CONTROL_DEFECT_PIXELS}) — it is not the evidence its caption claims`,
		);
	}
	sizes.push(`control defect px ${defectPixels}`);

	return { captures, sizes };
}

/* ------------------------------------------------------------------ *
 * HTML rendering
 * ------------------------------------------------------------------ */

function figure(image, caption, extraClass = '') {
	if (!image) return '';
	return `<figure class="shot ${extraClass}">
  <img alt="${escapeHtml(caption)}" src="data:image/png;base64,${image.base64}" />
  <figcaption>${escapeHtml(caption)} · ${image.width}x${image.height}</figcaption>
</figure>`;
}

function render(result, captures, sizes) {
	const baseline = result.runs.find((run) => run.id === 'baseline');
	const controls = result.runs.filter((run) => !run.mustPass);
	const gutterNote = baseline?.stats.gutterObservable
		? 'platform scrollbar の予約幅が実測できたので、gutter 系 2 rule も実測済み。'
		: 'この host は overlay scrollbar（予約幅 0px）で <code>gutter_not_reserved</code> / <code>content_shift</code> が<b>実測できていない</b>。warning のまま残し、PASS の証拠には数えていない。';

	const verdictRows = result.runs
		.map((run) => {
			const gate = run.mustPass ? (run.errors.length === 0 ? 'PASS' : 'FAIL') : 'CONTROL';
			const shifts = (run.stats.shifts ?? [])
				.map(
					(shift) =>
						`<tr><td>gutter probe <code>${escapeHtml(shift.id)}</code></td><td class="num">${shift.withScrollbar?.toFixed(2) ?? '—'}</td><td class="num">${shift.withoutScrollbar?.toFixed(2) ?? '—'}</td><td class="num">${(shift.withScrollbar - shift.withoutScrollbar).toFixed(2)}</td></tr>`,
				)
				.join('');
			const problems = [...run.errors, ...run.warnings]
				.map(
					(entry) =>
						`<div class="${run.errors.includes(entry) ? 'fail' : 'warn'}">${escapeHtml(entry.rule)}: ${escapeHtml(entry.message)}</div>`,
				)
				.join('');
			return `<tr class="${gate === 'PASS' ? 'ok' : gate === 'FAIL' ? 'fail' : 'control'}">
    <td class="status">${gate}</td>
    <td>${escapeHtml(run.id)}${run.defect ? `<div class="sub">${escapeHtml(run.defect)}</div>` : ''}</td>
    <td class="num">${run.stats.sections}</td>
    <td class="num">${run.stats.targets}</td>
    <td class="num">${run.stats.scrollWidth} / ${run.stats.clientWidth}</td>
    <td>${problems || '<span class="ok">(no errors)</span>'}
      <table class="inner">
        <thead><tr><th>probe</th><th class="num">with scrollbar</th><th class="num">without</th><th class="num">Δ</th></tr></thead>
        <tbody>${shifts}</tbody>
      </table>
    </td>
  </tr>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>レイアウト stress fixture (Issue #416)</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #77776a; font-size: 12.5px; }
  .lead { color: #3d3d33; font-size: 13px; margin: 0 0 20px; max-width: 1180px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 150px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  table.inner { margin-top: 6px; font-size: 12px; }
  table.inner th, table.inner td { padding: 3px 8px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  pre { background: #f3f1e8; border: 1px solid #dedcd2; padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
  .status { font-weight: 700; width: 74px; white-space: nowrap; }
  tr.ok .status { color: #1c6b3a; }
  tr.fail .status { color: #a12020; }
  tr.control .status { color: #8a5a12; }
  .num { text-align: right; width: 74px; white-space: nowrap; }
  .ok { color: #1c6b3a; }
  .fail { color: #a12020; }
  .warn { color: #8a5a12; }
  .shots { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  .shot { margin: 0; border: 1px solid #dedcd2; background: #fff; padding: 8px; }
  .shot img { display: block; width: ${result.viewport.width}px; border: 1px solid #eceadf; }
  .shot figcaption { font-size: 11.5px; color: #77776a; margin-top: 6px; width: ${result.viewport.width}px; }
  .shot.control { border-color: #e0b4b4; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>レイアウト stress fixture — 320px / 長文 / スクロールバー常時表示 (Issue #416)</h1>
  <p class="lead">
    独立した静的 fixture（Worker / route / dev server に依存しない）を
    <b>${result.viewport.width}px 幅・スクロールバー常時表示</b> で実測し、
    <b>${escapeHtml(result.chromium ?? 'unknown')}</b> で layout が壊れていないかを判定します。
    同じ fixture に意図的 defect を 1 つずつ注入した 2 つの control を同じ実測経路に通し、
    <b>検出器が必ず失敗すること</b>を同じ実行で証明しています（control が生き残れば
    <code>detector_unproven</code> で exit 2）。
    判定は純関数（<code>evaluateStressRun</code>）なので、fixture suite でも全ルールが
    「落ちるとき」を検証でき、CI（<code>pnpm run test</code>）でもその半分が走ります。
  </p>

  <div class="cards">
    <div class="card"><div class="k">viewport</div><div class="v">${result.viewport.width}px</div></div>
    <div class="card"><div class="k">stories</div><div class="v">${baseline.stats.sections}</div></div>
    <div class="card"><div class="k">targets</div><div class="v">${baseline.stats.targets}</div></div>
    <div class="card"><div class="k">scrollWidth / clientWidth</div><div class="v">${baseline.stats.scrollWidth} / ${baseline.stats.clientWidth}</div></div>
    <div class="card"><div class="k">scrollbar</div><div class="v">${baseline.stats.scrollbarWidth}px</div></div>
    <div class="card"><div class="k">controls caught</div><div class="v ${controls.every((run) => run.errors.length > 0) ? 'ok' : 'fail'}">${controls.filter((run) => run.errors.length > 0).length} / ${controls.length}</div></div>
    <div class="card"><div class="k">errors</div><div class="v ${result.errors.length === 0 ? 'ok' : 'fail'}">${result.errors.length}</div></div>
  </div>

  <h2>判定（${result.runs.map((run) => escapeHtml(run.id)).join(' / ')}）</h2>
  <table>
    <thead><tr><th style="width:74px">gate</th><th>variant</th><th class="num">stories</th><th class="num">targets</th><th class="num">scrollW / clientW</th><th>結果</th></tr></thead>
    <tbody>
${verdictRows}
    </tbody>
  </table>
  <p class="sub">
    environment: ${escapeHtml(result.environment?.userAgent ?? '—')} · language ${escapeHtml(result.environment?.language ?? '—')} ·
    許差は ${TOLERANCE_PX}px（sub-pixel）。platform scrollbar が 0px（overlay scrollbar）なら
    gutter の実効性は観測できないため <code>gutter_not_observable</code> として warning に残す（無言では合格にしない）。
    ${gutterNote}
    control の期待ルール: ${controls
			.map(
				(run) =>
					`<code>${escapeHtml(run.id)}</code> → ${escapeHtml(run.errors.map((error) => error.rule).join(', ') || '—')}`,
			)
			.join(' · ')}
  </p>

  <h2>healthy fixture の実測（320px · 宣言された全 ${CAPTURED_STORIES.length} story の実画面）</h2>
  <div class="shots">
${CAPTURED_STORIES.map((section) => figure(captures[section], `${section} ストーリー`)).join('\n')}
${figure(captures.control, 'control-overflow — 末尾に注入した固定幅 1200px ブロック（意図的 defect。document 幅 1200px に対し viewport は 320px なので、青帯は画面幅いっぱいまで伸びて右端で切れている。数値は上の判定表）', 'control')}
  </div>

  <h2>再現コマンド / URL</h2>
  <pre>${REPRODUCTION.map((line) => escapeHtml(line)).join('\n')}</pre>
  <p class="sub">
    期待結果: <code>pnpm run compat:stress:check</code> が exit 0（baseline = PASS、control 2 件はいずれも想定ルールで捕捉）。
    fixture の URL は <code>file://$PWD/.tmp/layout-stress/baseline.html</code>（<code>--width 375</code> 等で幅を変えても同じ判定経路を通る）。
    生成物: ${escapeHtml(sizes.join(' · '))}
  </p>

  <footer>my-web-2026 · Issue #416 · report generated locally by scripts/make-layout-stress-report.mjs
  (offline, no secret, no production D1/R2) · committed as docs/verification/compat/stress-story.webp
  (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}, budget 300 KB).</footer>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

const result = await runLayoutStressCheck();
if (!result.ok) {
	process.stderr.write(
		`refusing to render a verification report for a failing run (${result.errors.length} problem(s)):\n${result.errors
			.map((entry) => `  - ${entry}`)
			.join('\n')}\n`,
	);
	process.exit(1);
}

const { chromium } = await import('@playwright/test');
const { default: sharp } = await import('sharp');
if (!WEBP_TARGET.endsWith('.webp')) {
	process.stderr.write(`refusing to write a non-WebP verification artefact: ${WEBP_TARGET}\n`);
	process.exit(1);
}

let encoded;
const browser = await chromium.launch();
try {
	const { captures, sizes } = await capture(browser, result);
	mkdirSync(TMP, { recursive: true });
	writeFileSync(HTML_REPORT, render(result, captures, sizes));
	process.stdout.write(`wrote ${HTML_REPORT}\n`);
	for (const size of sizes) process.stdout.write(`capture: ${size}\n`);

	mkdirSync(dirname(WEBP_TARGET), { recursive: true });
	const page = await browser.newPage({
		viewport: { width: WEBP_WIDTH, height: 1400 },
		deviceScaleFactor: 1,
	});
	await page.goto(pathToFileURL(HTML_REPORT).href, { waitUntil: 'load' });
	const buffer = await page.screenshot({ fullPage: true });
	encoded = await sharp(buffer)
		.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
		.webp({ quality: WEBP_QUALITY })
		.toFile(WEBP_TARGET);
} finally {
	await browser.close();
}

try {
	assertEvidenceSize(encoded.size, WEBP_TARGET.replace(`${ROOT}/`, ''));
} catch (error) {
	// The budget message promises that nothing was written; make that true.
	rmSync(WEBP_TARGET, { force: true });
	throw error;
}
process.stdout.write(
	`gate: baseline PASS · ${result.runs.filter((run) => !run.mustPass).length} controls caught · ${result.errors.length} errors\n`,
);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${encoded.width}x${encoded.height}, ${encoded.size} B, quality ${WEBP_QUALITY})\n`,
);
