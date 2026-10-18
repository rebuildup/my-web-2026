#!/usr/bin/env node
/**
 * Browser-matrix verification report for Issue #415.
 *
 * Reads the Playwright JSON report written by
 * `playwright.compat.config.ts` (`.tmp/compat-results.json`), renders
 * an engine × test matrix as a static HTML page (a "CI report" view),
 * and screenshots that page into
 * `docs/verification/compat/browsers-matrix.webp` — the path Issue #415
 * requires in the PR body, with the `.webp` extension substituted for
 * the Issue's literal `.png`: a committed PNG of this report is roughly
 * twice the bytes for no evidentiary gain, and the same decision was
 * taken for `docs/verification/security/d1-parameter-tests.webp`
 * (Issue #452).
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the
 * capture is taken into a Buffer and re-encoded with the existing
 * `sharp` devDependency as `resize({ width: 1600, withoutEnlargement:
 * true })` followed by `webp({ quality: 80 })`. No intermediate PNG is
 * written to disk, and the target extension is asserted so a PNG can
 * never drift back into `docs/`. `sharp` stays a devDependency and is
 * never imported by the Worker / SSR.
 *
 * What makes the matrix more than a screenshot of green ticks
 * -----------------------------------------------------------
 *   1. Every engine is a COLUMN, so a single-engine regression is
 *      visible as a single red cell rather than a collapsed total.
 *   2. A roster route with no executed test is reported as
 *      「未実行（no silent pass）」 in its own band. A suite that
 *      silently stopped covering a route must not look identical to a
 *      suite that covers it and passes.
 *   3. The environment block records OS / arch / Node / Playwright /
 *      per-engine browser build, because "works on my machine" is not
 *      a compatibility claim.
 *   4. Per-route screenshots captured by the spec
 *      (`.tmp/compat-screenshots/<engine>/<slug>.png`) are embedded
 *      side by side, so the visual comparison the Issue asks for does
 *      not depend on trusting the pass/fail cells.
 *
 * Usage
 * -----
 *   pnpm run e2e:compat                      # produce the JSON report + screenshots
 *   node scripts/make-compat-matrix-report.mjs
 *
 * Options (validation flags are parsed, never interpolated into a shell):
 *   --results <path>       default .tmp/compat-results.json
 *   --html <path>          default .tmp/compat-matrix.html
 *   --out <path>           default docs/verification/compat/browsers-matrix.webp
 *   --screenshots <dir>    default .tmp/compat-screenshots
 *   --skip-versions        do not launch the engines to read their build
 *
 * The script reads nothing but the run artefacts and the local
 * toolchain: no secret, no network, no production origin.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, platform, release, type } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;

/** Roster snapshot the spec writes next to the screenshots. */
const ROSTER_FILE = join('.tmp', 'compat-routes.json');

/**
 * Playwright test-level outcome → matrix cell state.
 *
 * `expected` is the pass case. `flaky` is deliberately NOT green: a
 * route that only passes after a retry is a defect report waiting to
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

const CELL_LABEL = {
	pass: 'PASS',
	flaky: 'FLAKY',
	skip: 'SKIP',
	fail: 'FAIL',
};

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
 * Flatten a Playwright JSON report into a matrix.
 *
 * Playwright nests suites per `describe` block, so the walk is
 * recursive and the row title is the FULL path
 * (`describe › describe › test`). Short titles collide across the
 * three describe blocks this suite has, and a matrix that silently
 * merges two different checks into one row is exactly the kind of
 * quiet green the Issue forbids.
 *
 * A row whose cells were never filled still renders (as SKIP), so an
 * empty or partially-executed suite cannot look identical to a suite
 * that covers everything and passes.
 */
export function collectMatrix(report) {
	const engines = (report?.config?.projects ?? []).map((project) => project.name);
	const rows = new Map();

	const walk = (suite, describePath) => {
		const nextPath =
			suite.title && suite.title !== '' ? [...describePath, suite.title] : [...describePath];
		for (const spec of suite.specs ?? []) {
			// The reporter emits ONE spec entry per project, so entries
			// that share (file, describe path, title) are the same row and
			// must be merged — otherwise a 3-engine run renders as 3
			// single-engine rows and the matrix loses its whole point.
			const title = [...nextPath, spec.title ?? ''].filter(Boolean).join(' \u203a ');
			const key = `${spec.file ?? suite.file ?? ''}|${title}`;
			if (!rows.has(key)) {
				rows.set(key, {
					file: spec.file ?? suite.file ?? '',
					title,
					cells: new Map(engines.map((engine) => [engine, { state: 'skip', detail: '' }])),
					durationMs: 0,
				});
			}
			const row = rows.get(key);

			for (const test of spec.tests ?? []) {
				const engine = test.projectName ?? 'unknown';
				if (!row.cells.has(engine)) row.cells.set(engine, { state: 'skip', detail: '' });
				const state = resolveCellState(test);
				const detail = failureSummary(test);
				const previous = row.cells.get(engine);
				// A retry that passes after a failure is `flaky`; a retry
				// that fails after a pass is still a failure. Never
				// overwrite a `fail` with a later `pass`.
				const merged =
					previous.state === 'fail' || state === 'fail'
						? 'fail'
						: previous.state === 'flaky' || state === 'flaky'
							? 'flaky'
							: state;
				row.cells.set(engine, { state: merged, detail: detail || previous.detail });
				row.durationMs += test.results?.at(-1)?.duration ?? 0;
			}
		}
		for (const child of suite.suites ?? []) walk(child, nextPath);
	};

	for (const suite of report?.suites ?? []) walk(suite, []);

	const list = [...rows.values()];
	const totals = { pass: 0, fail: 0, flaky: 0, skip: 0 };
	for (const row of list) {
		for (const cell of row.cells.values()) totals[cell.state] += 1;
	}

	return {
		engines,
		rows: list,
		totals,
		durationMs: list.reduce((sum, row) => sum + row.durationMs, 0),
		tests: list.reduce((sum, row) => sum + row.cells.size, 0),
	};
}

/**
 * Roster routes that no executed test covers.
 *
 * The roster is the closed list of public routes the compat gate claims
 * to hold; the executed rows are what the run actually asserted. The
 * difference is the 「未実装routeを無言の合格にしない」 band: an
 * uncovered route is reported, never folded into a pass.
 */
export function findUncoveredRoutes(roster, rows) {
	const covered = new Set(rows.flatMap((row) => [...row.cells.values()].map((cell) => cell.state)));
	if (covered.size === 0) return roster.map((route) => route.path);
	const titles = rows.map((row) => row.title).join('\n');
	return roster
		.filter((route) => !titles.includes(`${route.path} satisfies the public display contract`))
		.map((route) => route.path);
}

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Render the matrix HTML.
 *
 * `screenshotPrefix` is the path of the screenshots directory
 * RELATIVE to the directory the HTML is written into, so the page is
 * portable and the image `src` stays checkable.
 */
export function renderMatrixHtml({
	matrix,
	roster,
	environment,
	uncovered,
	screenshotPrefix,
	screenshotRoot,
}) {
	const cells = (row) =>
		matrix.engines
			.map((engine) => {
				const cell = row.cells.get(engine) ?? { state: 'skip', detail: '' };
				const title = cell.detail ? ` title="${escapeHtml(cell.detail)}"` : '';
				return `<td class="cell ${cell.state}"${title}>${CELL_LABEL[cell.state]}</td>`;
			})
			.join('');

	const head = matrix.engines.map((engine) => `<th>${escapeHtml(engine)}</th>`).join('');
	const body = matrix.rows
		.map(
			(row) =>
				`<tr><td class="title"><code>${escapeHtml(row.title)}</code><span class="file">${escapeHtml(
					basename(row.file),
				)}</span></td>${cells(row)}</tr>`,
		)
		.join('\n');

	const rosterRows = roster
		.map(
			(route) =>
				`<tr><td><code>${escapeHtml(route.path)}</code></td><td>${escapeHtml(
					route.label,
				)}</td><td><code>${escapeHtml(route.h1)}</code></td></tr>`,
		)
		.join('\n');

	const strip = roster
		.map((route) => {
			const shots = matrix.engines
				.map((engine) => {
					const rel = `${screenshotPrefix}/${engine}/${route.slug}.png`;
					// Existence is checked against the absolute screenshot
					// root, while `src` stays relative to the HTML file, so
					// the report remains a portable directory.
					return existsSync(join(screenshotRoot, engine, `${route.slug}.png`))
						? `<figure><img src="${escapeHtml(rel)}" alt="${escapeHtml(
								`${route.path} — ${engine}`,
							)}" /><figcaption>${escapeHtml(engine)}</figcaption></figure>`
						: `<figure class="missing"><figcaption>${escapeHtml(engine)}: no capture</figcaption></figure>`;
				})
				.join('\n');
			return `<h3><code>${escapeHtml(route.path)}</code> <span class="label">${escapeHtml(
				route.label,
			)}</span></h3>\n<div class="strip">${shots}</div>`;
		})
		.join('\n');

	const uncoveredBlock =
		uncovered.length === 0
			? `<p class="ok-note">全 ${roster.length} route が実行済み（未実行 route なし）。</p>`
			: `<p class="fail-note">未実行 route（無言の合格にしない）: ${uncovered
					.map((path) => `<code>${escapeHtml(path)}</code>`)
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
<title>公開UI ブラウザ互換マトリクス — Issue #415</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  h3 { font-size: 14px; margin: 18px 0 6px; }
  h3 .label { color: #77776a; font-weight: 400; }
  .sub { color: #5a5a4e; margin: 0 0 20px; font-size: 13px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 130px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  .title { width: 46%; }
  .title .file { display: block; color: #909080; font-size: 11px; }
  .cell { font-weight: 700; text-align: center; width: 96px; }
  .cell.pass { color: #1c6b3a; }
  .cell.fail { color: #a12020; background: #fbeeee; }
  .cell.flaky { color: #8a5a00; background: #fdf6e6; }
  .cell.skip { color: #77776a; }
  .ok { color: #1c6b3a; }
  .fail { color: #a12020; }
  .ok-note { color: #1c6b3a; font-size: 13px; }
  .fail-note { color: #a12020; font-size: 13px; font-weight: 700; }
  .strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  figure { margin: 0; border: 1px solid #dedcd2; background: #fff; overflow: hidden; }
  figure img { width: 100%; display: block; }
  figcaption { font-size: 11px; padding: 4px 8px; color: #77776a; border-top: 1px solid #eceadf; }
  figure.missing { display: grid; place-items: center; min-height: 60px; color: #a12020; }
  footer { margin-top: 24px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>公開UI ブラウザ互換マトリクス — Issue #415</h1>
  <p class="sub"><code>playwright.compat.config.ts</code> が Chromium / Firefox / WebKit の 3 engine で公開 route と基本操作を実行した結果。FAIL / FLAKY / SKIP を区別して表示し、未実行 route は別帯で明示する。</p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${matrix.tests}</div></div>
    <div class="card"><div class="k">pass</div><div class="v ok">${matrix.totals.pass}</div></div>
    <div class="card"><div class="k">fail</div><div class="v fail">${matrix.totals.fail}</div></div>
    <div class="card"><div class="k">flaky</div><div class="v">${matrix.totals.flaky}</div></div>
    <div class="card"><div class="k">skip</div><div class="v">${matrix.totals.skip}</div></div>
    <div class="card"><div class="k">duration</div><div class="v">${Math.round(
			matrix.durationMs / 1000,
		)}<span style="font-size:13px"> s</span></div></div>
  </div>

  <h2>実行環境</h2>
  <table>
    <thead><tr><th style="width:220px">item</th><th>value</th></tr></thead>
    <tbody>
${envRows}
    </tbody>
  </table>

  <h2>engine × test マトリクス</h2>
  <table>
    <thead><tr><th class="title">test</th>${head}</tr></thead>
    <tbody>
${body}
    </tbody>
  </table>

  ${uncoveredBlock}

  <h2>route roster（閉集合）</h2>
  <table>
    <thead><tr><th style="width:180px">path</th><th style="width:160px">label</th><th>h1 契約</th></tr></thead>
    <tbody>
${rosterRows}
    </tbody>
  </table>

  <h2>route ごとの 3 engine キャプチャ</h2>
${strip}

  <footer>my-web-2026 · Issue #415 · scripts/make-compat-matrix-report.mjs がローカル実行結果から生成（secret / production origin には触れない）· committed as docs/verification/compat/browsers-matrix.webp (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
</body>
</html>
`;
}

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
		viewport: { width: 1280, height: 1600 },
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

/** Launch each engine once and report the build the gate actually ran. */
async function browserVersions(skip) {
	const engines = ['chromium', 'firefox', 'webkit'];
	if (skip) return Object.fromEntries(engines.map((engine) => [engine, 'skipped']));
	const playwright = await import('@playwright/test');
	const versions = {};
	for (const engine of engines) {
		try {
			const browser = await playwright[engine].launch();
			try {
				versions[engine] = browser.version();
			} finally {
				await browser.close();
			}
		} catch (error) {
			versions[engine] = `unavailable (${String(error.message).split('\n')[0]})`;
		}
	}
	return versions;
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
	const resultsPath = resolve(ROOT, flags.get('results') ?? '.tmp/compat-results.json');
	const htmlPath = resolve(ROOT, flags.get('html') ?? '.tmp/compat-matrix.html');
	const outPath = resolve(
		ROOT,
		flags.get('out') ?? 'docs/verification/compat/browsers-matrix.webp',
	);
	const screenshots = resolve(ROOT, flags.get('screenshots') ?? '.tmp/compat-screenshots');

	if (!existsSync(resultsPath)) {
		throw new Error(
			`Playwright JSON report not found: ${resultsPath}\n\nRun the suite first:\n  pnpm run build\n  pnpm run e2e:compat\n`,
		);
	}
	assertWebpTarget(outPath);

	const report = JSON.parse(readFileSync(resultsPath, 'utf8'));
	const matrix = collectMatrix(report);
	const roster = existsSync(resolve(ROOT, ROSTER_FILE))
		? JSON.parse(readFileSync(resolve(ROOT, ROSTER_FILE), 'utf8'))
		: [];
	const uncovered = findUncoveredRoutes(roster, matrix.rows);

	const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	const versions = await browserVersions(flags.get('skip-versions') === 'true');
	const environment = {
		OS: `${type()} ${platform()} ${release()} (${arch()})`,
		Node: process.version,
		Playwright: pkg.devDependencies['@playwright/test'],
		'chromium build': versions.chromium,
		'firefox build': versions.firefox,
		'webkit build': versions.webkit,
		report: basename(resultsPath),
		capturedAt: new Date().toISOString(),
	};

	// The screenshots are addressed relative to the HTML file so the
	// report is a self-contained directory rather than a path guess.
	const screenshotPrefix = relativeToDir(htmlPath, screenshots);
	writeFileSync(
		htmlPath,
		renderMatrixHtml({
			matrix,
			roster,
			environment,
			uncovered,
			screenshotPrefix,
			screenshotRoot: screenshots,
		}),
	);
	process.stdout.write(`wrote ${htmlPath}\n`);

	if (matrix.engines.length === 0) {
		throw new Error(
			`The Playwright report declares no projects, so no engine column could be rendered: ${resultsPath}`,
		);
	}
	if (matrix.rows.length === 0) {
		throw new Error(`The Playwright report contains no executed test: ${resultsPath}`);
	}
	if (uncovered.length > 0) {
		process.stderr.write(
			`[compat matrix] ${uncovered.length} roster route(s) were NOT executed: ${uncovered.join(', ')}\n`,
		);
	}

	const info = await shoot(htmlPath, outPath);
	process.stdout.write(
		`wrote ${outPath} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
	);

	// Status-only summary, safe to read in CI logs.
	process.stdout.write(
		`[compat matrix] engines=${matrix.engines.join(',')} tests=${matrix.tests} pass=${matrix.totals.pass} fail=${matrix.totals.fail} flaky=${matrix.totals.flaky} skip=${matrix.totals.skip} uncovered=${uncovered.length}\n`,
	);
	if (readdirSync(screenshots).length === 0) {
		process.stderr.write('[compat matrix] no screenshot directory content; the strip is empty\n');
	}
}

function relativeToDir(fromFile, dir) {
	const relative = relativePath(dirname(fromFile), dir);
	return relative === '' ? '.' : relative;
}

function relativePath(from, to) {
	const fromParts = from.split('/').filter(Boolean);
	const toParts = to.split('/').filter(Boolean);
	let i = 0;
	while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i += 1;
	return [...fromParts.slice(i).map(() => '..'), ...toParts.slice(i)].join('/');
}

export { relativePath, relativeToDir };

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	await main();
}
