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
 *   1. the healthy fixture captured at 320px — legible captures of the
 *      heading / table / gutter stories plus a full-page strip,
 *   2. the deliberately broken `control-overflow` variant captured at
 *      the same width, so the failing path is visible and not only
 *      described,
 *   3. the per-rule verdict table, the environment the numbers came
 *      from, and the commands that reproduce all of it.
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
 * `webp({ quality: WEBP_QUALITY })`. The target extension is asserted to
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
import { STRESS_VIEWPORT, TOLERANCE_PX } from './layout-stress.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const HTML_REPORT = join(TMP, 'layout-stress-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/compat/stress-story.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 50;

/** Stories captured legibly at 320px (the whole story is 10 sections tall). */
const FEATURED_SECTIONS = [
	'heading',
	'link',
	'identifier',
	'multilingual',
	'grid',
	'table',
	'code',
	'cta',
	'gutter',
];

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
 * Capture the fixture in a real browser.
 *
 * @returns {Promise<{captures: object[], sizes: string[]}>}
 */
async function capture(result) {
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	const browser = await chromium.launch();
	const sizes = [];

	/**
	 * @param {string} variant
	 * @param {{prepare?: (page: import('@playwright/test').Page) => Promise<void>, scale?: number, options?: import('@playwright/test').PageScreenshotOptions}} [shot]
	 * @returns {Promise<{base64: string, width: number, height: number, bytes: number}>}
	 */
	async function shoot(variant, shot = {}) {
		const htmlPath = join(ROOT, '.tmp/layout-stress', `${variant}.html`);
		const context = await browser.newContext({
			viewport: { width: result.viewport.width, height: result.viewport.height },
			deviceScaleFactor: shot.scale ?? 1,
			colorScheme: 'light',
			reducedMotion: 'reduce',
		});
		try {
			const page = await context.newPage();
			await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
			await page.evaluate(() => document.fonts.ready);
			if (shot.prepare) await shot.prepare(page);
			const buffer = await page.screenshot(shot.options ?? {});
			const meta = await sharp(buffer).metadata();
			sizes.push(
				`${variant} ${meta.width}x${meta.height} ${Math.round(buffer.length / 1024)} KB PNG`,
			);
			return {
				base64: buffer.toString('base64'),
				width: meta.width,
				height: meta.height,
				bytes: buffer.length,
			};
		} finally {
			await context.close();
		}
	}

	const captures = {};
	for (const section of FEATURED_SECTIONS) {
		captures[section] = await shoot('baseline', {
			prepare: async (page) => {
				await page.locator(`[data-stress-section="${section}"]`).scrollIntoViewIfNeeded();
			},
		});
	}
	captures.control = await shoot('control-overflow');

	await browser.close();
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
    control の期待ルール: ${controls
			.map(
				(run) =>
					`<code>${escapeHtml(run.id)}</code> → ${escapeHtml(run.errors.map((error) => error.rule).join(', ') || '—')}`,
			)
			.join(' · ')}
  </p>

  <h2>healthy fixture の実測（320px · 各ストーリーの実画面）</h2>
  <div class="shots">
${FEATURED_SECTIONS.map((section) => figure(captures[section], `${section} ストーリー`)).join('\n')}
${figure(captures.control, 'control-overflow — 固定幅 1200px ブロック（意図的 defect）', 'control')}
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

const { captures, sizes } = await capture(result);
mkdirSync(TMP, { recursive: true });
writeFileSync(HTML_REPORT, render(result, captures, sizes));
process.stdout.write(`wrote ${HTML_REPORT}\n`);

const { chromium } = await import('@playwright/test');
const { default: sharp } = await import('sharp');
if (!WEBP_TARGET.endsWith('.webp')) {
	process.stderr.write(`refusing to write a non-WebP verification artefact: ${WEBP_TARGET}\n`);
	process.exit(1);
}
const browser = await chromium.launch();
let encoded;
try {
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
for (const size of sizes) process.stdout.write(`capture: ${size}\n`);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${encoded.width}x${encoded.height}, ${encoded.size} B, quality ${WEBP_QUALITY})\n`,
);
