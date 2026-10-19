#!/usr/bin/env node
/**
 * Viewport diff-grid verification report for Issue #417.
 *
 * Reads what `pnpm run e2e:viewport` produced —
 * `.tmp/viewport-results.json` (Playwright JSON report),
 * `.tmp/viewport-roster.json` (the closed route × viewport roster the
 * gate asserts), `.tmp/viewport-cells/*.json` (per-cell layout
 * fingerprints) and `.tmp/viewport-controls/*.json` (the three
 * visual-diff controls) — renders a route × viewport grid as a static
 * HTML page, and screenshots that page into
 * `docs/verification/compat/viewport-diff-grid.webp`: the path Issue
 * #417 requires in the PR body, with the `.webp` extension substituted
 * for the Issue's literal `.png` (a committed PNG of this grid is
 * roughly twice the bytes for no evidentiary gain — the same decision
 * Issue #415 took for `browsers-matrix.webp`).
 *
 * What makes the grid more than a screenshot of green ticks
 * -----------------------------------------------------------
 *   1. Every cell shows the LAYOUT NUMBERS the judge asserted
 *      (overflow px, body font size, nav mode), not just a tick, so a
 *      reader can see what was measured without trusting the badge.
 *   2. A roster cell that did not PASS (skipped, flaky, failing, or
 *      never executed) is reported as 「未実行（no silent pass）」 in
 *      its own band, and the script exits non-zero while that band is
 *      non-empty — the Issue's
 *      「未実装routeを無言の合格にしない」 requirement.
 *   3. The visual-diff controls are rendered WITH their measured
 *      ratios, including the deliberate break and its red overlay, so
 *      「意図的破損に赤いdiffが出る」 is evidenced rather than claimed.
 *   4. Runs of this suite that are NOT the route × viewport grid
 *      (the negative controls, the diff controls) are listed
 *      separately, so a failure outside the grid cannot hide behind a
 *      green grid.
 *   5. The environment block records OS / Node / Playwright /
 *      chromium build, because "works on my machine" is not a
 *      responsive claim.
 *
 * Usage
 * -----
 *   pnpm run build
 *   pnpm run e2e:viewport                   # produce the JSON report + captures
 *   pnpm run verify:viewport-diff-grid      # render the grid + write the WebP
 *
 * Options (validation flags are parsed, never interpolated into a shell):
 *   --results <path>       default .tmp/viewport-results.json
 *   --html <path>          default .tmp/viewport-diff-grid.html
 *   --out <path>           default docs/verification/compat/viewport-diff-grid.webp
 *   --screenshots <dir>    default .tmp/viewport-screenshots
 *   --cells <dir>          default .tmp/viewport-cells
 *   --controls <dir>       default .tmp/viewport-controls
 *   --skip-versions        do not launch chromium to read its build
 *
 * The script reads nothing but the run artefacts and the local
 * toolchain: no secret, no network, no production origin.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, platform, release, type } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;

/**
 * The gate's own cell title: `<path> @ <width>px satisfies the layout
 * contract`. Matched against `spec.title` — the test title alone —
 * because Playwright puts the describe path in the enclosing suites,
 * and a regex anchored on the joined path would never match a real
 * report.
 */
const CELL_TITLE = /^(?<path>\S+) @ (?<width>\d+)px satisfies the layout contract$/;

/** Human label for a captured cell screenshot. */
export function cellScreenshotName(routeSlug, viewportStem) {
	return `${routeSlug}-${viewportStem}.png`;
}

/**
 * Playwright test-level outcome → grid cell state.
 *
 * `expected` is the pass case. `flaky` is deliberately NOT green: a
 * cell that only passes after a retry is a defect report waiting to
 * happen, and the Issue asks for failures to be visible.
 */
export function resolveCellState(test) {
	switch (test?.status) {
		case 'expected':
			return 'pass';
		case 'flaky':
			return 'flaky';
		case 'skipped':
			return 'skip';
		default:
			return 'fail';
	}
}

const CELL_LABEL = { pass: 'PASS', fail: 'FAIL', flaky: 'FLAKY', skip: 'SKIP' };

/** First line of a Playwright error, or '' when the test passed. */
function failureSummary(test) {
	const error = test?.results?.at(-1)?.error;
	if (!error) return '';
	return (
		String(error.message ?? '')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)[0] ?? ''
	);
}

/**
 * Flatten a Playwright JSON report into the route × viewport grid.
 *
 * A cell is only a cell if its title matches the gate's own naming
 * rule; every other row is returned separately as `other`, because a
 * failure in the negative controls or the diff controls must not be
 * invisible behind a green grid.
 *
 * A row whose cells were never filled renders as SKIP, so a partially
 * executed suite cannot look identical to one that covers everything
 * and passes.
 */
export function collectCells(report) {
	const projects = (report?.config?.projects ?? []).map((project) => project.name);
	const cells = new Map();
	const other = [];

	const walk = (suite, describePath) => {
		const nextPath =
			suite.title && suite.title !== '' ? [...describePath, suite.title] : [...describePath];
		for (const spec of suite.specs ?? []) {
			const title = [...nextPath, spec.title ?? ''].filter(Boolean).join(' \u203a ');
			const match = CELL_TITLE.exec(spec.title ?? '');
			const runs = spec.tests ?? [];

			if (!match?.groups) {
				const state = mergeStates(runs.map((test) => resolveCellState(test)));
				other.push({
					title,
					state,
					detail: runs.map(failureSummary).find(Boolean) ?? '',
				});
				continue;
			}

			const key = `${match.groups.path}@${Number(match.groups.width)}`;
			const state = mergeStates(runs.map((test) => resolveCellState(test)));
			const detail = runs.map(failureSummary).find(Boolean) ?? '';
			const previous = cells.get(key);
			// A cell that already ran merges with the worse of the two
			// states, so a second project cannot downgrade a failure.
			// The first run is NOT merged against the empty-cell default:
			// 'skip' outranks 'pass', so a fresh cell would stay grey.
			cells.set(key, {
				state: previous ? worstState(previous.state, state) : state,
				detail: detail || previous?.detail || '',
			});
		}
		for (const child of suite.suites ?? []) walk(child, nextPath);
	};

	for (const suite of report?.suites ?? []) walk(suite, []);

	return {
		projects,
		cells,
		other,
		totals: countStates([...cells.values()]),
	};
}

const STATE_RANK = { pass: 0, skip: 1, flaky: 2, fail: 3 };

function worstState(a, b) {
	return STATE_RANK[b] > STATE_RANK[a] ? b : a;
}

function mergeStates(states) {
	// Seeded with the BEST state so any worse outcome wins, and
	// explicitly SKIP for a spec that reported no run at all — an
	// unexecuted spec is not a pass.
	if (states.length === 0) return 'skip';
	return states.reduce((worst, state) => worstState(worst, state), 'pass');
}

function countStates(cells) {
	const totals = { pass: 0, fail: 0, flaky: 0, skip: 0 };
	for (const cell of cells) totals[cell.state] += 1;
	return totals;
}

/**
 * Roster cells that did not PASS (never executed, skipped, flaky, or
 * failing).
 *
 * The roster is the closed list of route × viewport cells the gate
 * claims to hold; the executed rows are what the run actually
 * asserted. Only a `pass` counts as covered: a SKIP is a cell that ran
 * nothing, and it must never turn the coverage band green — Playwright
 * itself exits 0 for skipped tests, so this is the only layer that
 * catches a silently unexecuted cell. Failures and flakes are already
 * visible in the grid, but counting them here also keeps a standalone
 * `verify:viewport-diff-grid` run from exiting 0 on a stale report.
 */
export function findUncoveredCells(roster, cells) {
	if (!roster) return [];
	const uncovered = [];
	for (const route of roster.routes ?? []) {
		for (const viewport of roster.viewports ?? []) {
			const cell = cells.get(`${route.path}@${viewport.width}`);
			if (cell?.state !== 'pass') {
				uncovered.push(`${route.path} @ ${viewport.width}px`);
			}
		}
	}
	return uncovered;
}

/** Percentage string for a diff ratio, at a precision a human can read. */
export function formatRatio(ratio) {
	if (!Number.isFinite(ratio)) return '—';
	const percent = ratio * 100;
	return `${percent >= 10 ? percent.toFixed(1) : percent.toFixed(3)}%`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** Read every JSON document in a directory into a Map keyed by stem. */
export function readJsonDir(directory) {
	const entries = new Map();
	if (!existsSync(directory)) return entries;
	for (const name of readdirSync(directory)) {
		if (!name.endsWith('.json')) continue;
		entries.set(
			name.replace(/\.json$/, ''),
			JSON.parse(readFileSync(join(directory, name), 'utf8')),
		);
	}
	return entries;
}

/**
 * Re-key the per-cell fingerprint files by the same `<slug>@<width>`
 * key the grid uses.
 *
 * The files are named `<slug>-<stem>.png`'s stem (route-first), which
 * is not the key the grid looks up; re-keying from the DOCUMENT rather
 * than parsing the file name keeps the two sides from drifting when a
 * viewport stem is renamed.
 */
export function keyFingerprints(entries) {
	const keyed = new Map();
	for (const doc of entries.values()) {
		const slug = doc?.slug;
		const width = doc?.viewport?.width;
		if (slug === undefined || width === undefined) continue;
		keyed.set(`${slug}@${width}`, doc);
	}
	return keyed;
}

/**
 * Render the grid HTML.
 *
 * `screenshotPrefix` is the path of the screenshots directory RELATIVE
 * to the directory the HTML is written into, so the page is portable
 * and every image `src` stays checkable.
 */
export function renderGridHtml({
	roster,
	cells,
	totals,
	other,
	controls,
	fingerprints,
	environment,
	uncovered,
	screenshotPrefix,
	screenshotRoot,
}) {
	const routes = roster?.routes ?? [];
	const viewports = roster?.viewports ?? [];

	const cellBlock = (route, viewport) => {
		const key = `${route.path}@${viewport.width}`;
		const cell = cells.get(key) ?? { state: 'skip', detail: '' };
		const fingerprint = fingerprints.get(`${route.slug}@${viewport.width}`);
		const observation = fingerprint?.observation;
		const shot = `${screenshotPrefix}/${cellScreenshotName(route.slug, viewport.stem)}`;
		const hasShot = existsSync(join(screenshotRoot, cellScreenshotName(route.slug, viewport.stem)));
		const facts = observation
			? [
					`overflow ${observation.overflowPx}px`,
					`body ${observation.bodyFontSize}px`,
					`nav ${observation.desktopNavVisible ? 'wide' : observation.mobileToggleVisible ? 'compact' : '—'}`,
				].join(' · ')
			: 'no fingerprint';
		const title = cell.detail ? ` title="${escapeHtml(cell.detail)}"` : '';
		return `<td class="cell ${cell.state}"${title}>
  <div class="badge">${CELL_LABEL[cell.state]}</div>
  ${
		hasShot
			? `<img src="${escapeHtml(shot)}" alt="${escapeHtml(`${route.path} — ${viewport.width}px`)}" />`
			: '<div class="missing">no capture</div>'
	}
  <div class="facts">${escapeHtml(facts)}</div>
</td>`;
	};

	const gridRows = routes
		.map((route) => {
			const tds = viewports.map((viewport) => cellBlock(route, viewport)).join('\n');
			return `<tr><th class="rowhead"><code>${escapeHtml(route.path)}</code><span class="label">${escapeHtml(
				route.group,
			)} · ${escapeHtml(route.label)}</span></th>${tds}</tr>`;
		})
		.join('\n');

	const head = viewports
		.map(
			(viewport) =>
				`<th>${viewport.width}px<span class="label">${escapeHtml(viewport.label)}</span></th>`,
		)
		.join('');

	const controlBlocks = controls
		.map((control) => {
			const tone =
				control.verdict === 'stable'
					? 'pass'
					: control.verdict === 'no-diff' || control.verdict === 'unstable'
						? 'fail'
						: 'diff';
			const panels = ['baselinePath', 'currentPath', 'overlayPath']
				.filter((key) => control[key])
				.map((key) => {
					const rel = `${screenshotPrefix}/${control[key]}`;
					if (!existsSync(join(screenshotRoot, control[key]))) return '';
					return `<figure><img src="${escapeHtml(rel)}" alt="${escapeHtml(
						`${control.label} — ${key}`,
					)}" /><figcaption>${escapeHtml(CONTROL_PANEL_LABEL[key])}</figcaption></figure>`;
				})
				.join('\n');
			return `<article class="control ${tone}">
  <h3>${escapeHtml(control.label)}</h3>
  <p class="meta"><span class="badge ${tone}">${escapeHtml(control.verdict)}</span> 期待: ${escapeHtml(
		control.expectation ?? '—',
	)} · 実測: <code>${escapeHtml(formatRatio(control.ratio))}</code> (${escapeHtml(
		String(control.changedPixels ?? 0),
	)} / ${escapeHtml(String(control.totalPixels ?? 0))} px)</p>
  ${control.judgeRejected === false ? '<p class="fail-note">layout judge accepted the broken page — the pixel and geometry layers disagree</p>' : ''}
  ${control.judgeDetail ? `<p class="meta">judge: <code>${escapeHtml(control.judgeDetail)}</code></p>` : ''}
  ${panels ? `<div class="strip">${panels}</div>` : '<p class="meta">no capture written</p>'}
</article>`;
		})
		.join('\n');

	const otherRows = other
		.map(
			(row) =>
				`<tr><td><code>${escapeHtml(row.title)}</code></td><td class="cell ${row.state}">${CELL_LABEL[row.state]}</td><td>${escapeHtml(
					row.detail,
				)}</td></tr>`,
		)
		.join('\n');

	const uncoveredBlock =
		uncovered.length === 0
			? `<p class="ok-note">全 ${routes.length * viewports.length} セルが実行済み（未実行セルなし）。</p>`
			: `<p class="fail-note">未実行セル（無言の合格にしない）: ${uncovered
					.map((cell) => `<code>${escapeHtml(cell)}</code>`)
					.join(' ')}</p>`;

	const envRows = Object.entries(environment)
		.map(
			([key, value]) =>
				`<tr><td>${escapeHtml(key)}</td><td><code>${escapeHtml(value)}</code></td></tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>viewport 視覚回帰グリッド — Issue #417</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  h3 { font-size: 14px; margin: 0 0 4px; }
  .sub { color: #5a5a4e; margin: 0 0 20px; font-size: 13px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 120px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  thead th { background: #f3f1e8; font-size: 12px; letter-spacing: 0.04em; color: #5a5a4e; }
  thead th .label { display: block; font-weight: 400; font-size: 11px; color: #77776a; text-transform: none; }
  .rowhead { width: 190px; background: #fbfbf9; }
  .rowhead .label { display: block; font-weight: 400; font-size: 11px; color: #77776a; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  .cell { width: 25%; }
  .cell img { width: 100%; display: block; border: 1px solid #eceadf; }
  .facts { font-size: 11px; color: #77776a; margin-top: 4px; }
  .badge { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; margin-bottom: 4px; }
  .pass { color: #1c6b3a; }
  .fail { color: #a12020; }
  .flaky { color: #8a5a00; }
  .skip { color: #77776a; }
  .cell.fail { background: #fbeeee; }
  .cell.flaky { background: #fdf6e6; }
  .diff { color: #a12020; }
  .missing { display: grid; place-items: center; height: 120px; background: #fbeeee; color: #a12020; font-size: 12px; }
  .ok-note { color: #1c6b3a; font-size: 13px; }
  .fail-note { color: #a12020; font-size: 13px; font-weight: 700; }
  .control { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; margin-bottom: 12px; }
  .control.fail { border-color: #e0b4b4; }
  .meta { font-size: 12px; color: #5a5a4e; margin: 2px 0; }
  .strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
  figure { margin: 0; border: 1px solid #dedcd2; background: #fff; overflow: hidden; display: flex; flex-direction: column; }
  /* Panels stay whole (no crop) but are capped in height: a 390x844
     phone capture at full column width made the committed WebP larger
     than it needs to be for evidence that is read at thumbnail size. */
  .strip figure img { width: 100%; max-height: 340px; object-fit: contain; object-position: top; display: block; }
  figcaption { font-size: 11px; padding: 4px 8px; color: #77776a; border-top: 1px solid #eceadf; }
  footer { margin-top: 24px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>viewport 視覚回帰グリッド — Issue #417</h1>
  <p class="sub"><code>playwright.viewport.config.ts</code> が Chromium で代表 route を 390 / 768 / 1024 / 1440 に展開した結果。セルごとに PASS / FAIL / FLAKY / SKIP を区別し、判定根拠（overflow・本文サイズ・nav モード）を併記する。未実行セルは別帯で明示する。</p>

  <div class="cards">
    <div class="card"><div class="k">cells</div><div class="v">${cells.size}</div></div>
    <div class="card"><div class="k">pass</div><div class="v pass">${totals.pass}</div></div>
    <div class="card"><div class="k">fail</div><div class="v fail">${totals.fail}</div></div>
    <div class="card"><div class="k">flaky</div><div class="v">${totals.flaky}</div></div>
    <div class="card"><div class="k">skip</div><div class="v">${totals.skip}</div></div>
    <div class="card"><div class="k">uncovered</div><div class="v ${uncovered.length > 0 ? 'fail' : 'pass'}">${uncovered.length}</div></div>
  </div>

  <h2>実行環境</h2>
  <table>
    <thead><tr><th style="width:220px">item</th><th>value</th></tr></thead>
    <tbody>
${envRows}
    </tbody>
  </table>

  <h2>route × viewport グリッド</h2>
  <table>
    <thead><tr><th class="rowhead">route</th>${head}</tr></thead>
    <tbody>
${gridRows}
    </tbody>
  </table>

  ${uncoveredBlock}

  <h2>視覚diff コントロール（意図的破損が赤いdiffになることの証跡）</h2>
${controlBlocks || '<p class="fail-note">control record なし（suite が実行されていない）</p>'}

  <h2>グリッド以外のゲート結果</h2>
  <table>
    <thead><tr><th style="width:52%">test</th><th style="width:90px">state</th><th>detail</th></tr></thead>
    <tbody>
${otherRows || '<tr><td colspan="3">（なし）</td></tr>'}
    </tbody>
  </table>

  <footer>my-web-2026 · Issue #417 · scripts/make-viewport-diff-grid-report.mjs がローカル実行結果から生成（secret / production origin には触れない）· committed as docs/verification/compat/viewport-diff-grid.webp (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
</body>
</html>
`;
}

const CONTROL_PANEL_LABEL = {
	baselinePath: 'baseline（無変更）',
	currentPath: 'current（比較対象）',
	overlayPath: 'diff（赤 = 差分）',
};

/** Refuse anything that is not WebP before a byte is written. */
export function assertWebpTarget(target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
}

async function shoot(htmlPath, target) {
	assertWebpTarget(target);
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1180, height: 1600 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Playwright cannot emit WebP, so capture into a Buffer (never a
		// file) and re-encode with sharp. The PNG bytes stay in memory.
		const capture = await page.screenshot({ fullPage: true });
		return await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
	} finally {
		await browser.close();
	}
}

/** Launch chromium once and report the build the gate actually ran. */
async function chromiumVersion(skip) {
	if (skip) return 'skipped';
	try {
		const { chromium } = await import('@playwright/test');
		const browser = await chromium.launch();
		try {
			return browser.version();
		} finally {
			await browser.close();
		}
	} catch (error) {
		return `unavailable (${String(error.message).split('\n')[0]})`;
	}
}

function parseFlags(argv) {
	const flags = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		// `--` is the pnpm/npm separator, not a flag.
		if (!arg.startsWith('--') || arg === '--') continue;
		const [key, inlineValue] = arg.slice(2).split('=');
		if (inlineValue !== undefined) {
			flags.set(key, inlineValue);
		} else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
			flags.set(key, argv[i + 1]);
			i += 1;
		} else {
			flags.set(key, 'true');
		}
	}
	return flags;
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	const resultsPath = resolve(ROOT, flags.get('results') ?? '.tmp/viewport-results.json');
	const htmlPath = resolve(ROOT, flags.get('html') ?? '.tmp/viewport-diff-grid.html');
	const outPath = resolve(
		ROOT,
		flags.get('out') ?? 'docs/verification/compat/viewport-diff-grid.webp',
	);
	const screenshots = resolve(ROOT, flags.get('screenshots') ?? '.tmp/viewport-screenshots');
	const cellDir = resolve(ROOT, flags.get('cells') ?? '.tmp/viewport-cells');
	const controlDir = resolve(ROOT, flags.get('controls') ?? '.tmp/viewport-controls');

	if (!existsSync(resultsPath)) {
		throw new Error(
			`Playwright JSON report not found: ${resultsPath}\n\nRun the suite first:\n  pnpm run build\n  pnpm run e2e:viewport\n`,
		);
	}
	assertWebpTarget(outPath);

	const report = JSON.parse(readFileSync(resultsPath, 'utf8'));
	const { cells, other, totals, projects } = collectCells(report);
	const roster = existsSync(resolve(ROOT, '.tmp/viewport-roster.json'))
		? JSON.parse(readFileSync(resolve(ROOT, '.tmp/viewport-roster.json'), 'utf8'))
		: null;
	const uncovered = findUncoveredCells(roster, cells);
	const fingerprints = keyFingerprints(readJsonDir(cellDir));
	const controls = readJsonDir(controlDir);

	const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	const build = await chromiumVersion(flags.get('skip-versions') === 'true');
	// A run without a usable chromium binary says nothing about
	// layout; refuse to overwrite the committed evidence with an
	// `unavailable` environment block.
	if (build.startsWith('unavailable (')) {
		throw new Error(
			`Chromium could not be launched (${build}). Refusing to overwrite ${outPath}. Run \`pnpm run e2e:install\` first.`,
		);
	}
	const environment = {
		OS: `${type()} ${platform()} ${release()} (${arch()})`,
		Node: process.version,
		Playwright: pkg.devDependencies['@playwright/test'],
		'chromium build': build,
		project: projects.join(',') || 'chromium',
		report: basename(resultsPath),
		'capture scale': 'CSS px (deviceScaleFactor 1)',
		capturedAt: new Date().toISOString(),
	};

	if (cells.size === 0) {
		throw new Error(`The Playwright report contains no executed cell: ${resultsPath}`);
	}
	if (!roster) {
		throw new Error(
			`Roster snapshot missing (.tmp/viewport-roster.json). The gate did not run, so the grid has no contract to render against: ${resultsPath}`,
		);
	}

	// Validate before writing: CI uploads the HTML with `if: always()`,
	// so a rejected run must not leave a fresh partial artifact behind.
	writeFileSync(
		htmlPath,
		renderGridHtml({
			roster,
			cells,
			totals,
			other,
			controls: [...controls.values()],
			fingerprints,
			environment,
			uncovered,
			screenshotPrefix: relative(dirname(htmlPath), screenshots) || '.',
			screenshotRoot: screenshots,
		}),
	);
	process.stdout.write(`wrote ${htmlPath}\n`);

	if (uncovered.length > 0) {
		process.stderr.write(
			`[viewport grid] ${uncovered.length} roster cell(s) did NOT pass: ${uncovered.join(', ')}\n`,
		);
		// The report is not a green signal while a roster cell is
		// skipped, flaky, failing, or never executed.
		process.exitCode = 1;
	}

	const info = await shoot(htmlPath, outPath);
	process.stdout.write(
		`wrote ${outPath} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
	);

	process.stdout.write(
		`[viewport grid] projects=${projects.join(',')} cells=${cells.size} pass=${totals.pass} fail=${totals.fail} flaky=${totals.flaky} skip=${totals.skip} uncovered=${uncovered.length} other=${other.length}\n`,
	);
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	await main();
}
