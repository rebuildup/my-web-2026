#!/usr/bin/env node
/**
 * Verification report generator for Issue #414.
 *
 * The Web feature adoption gate (`scripts/check-browser-baseline.mjs`) is
 * machine-readable, but a gate that is only readable by running it is
 * hard to review. This script renders the same result as a static HTML
 * "CI report" and screenshots it with the Playwright chromium already
 * installed for the E2E suite into
 * `docs/verification/standards/browser-baseline.webp` — the path Issue
 * #414 requires in the PR body, with the `.webp` extension substituted
 * for the Issue's literal `.png` (the exact encoded size is reported per
 * commit in the PR body rather than hard-coded here, so this comment
 * cannot drift on regeneration).
 *
 * The report is not a screenshot of a green run: it also executes two
 * synthetic fixtures through the same checker so a reader can see the
 * failing path, not only the passing one.
 *
 *   fixture A — WebGPU adopted with no fallback declaration → FAIL
 *   fixture B — the same adoption with a declared, verified fallback → WARN
 *
 * Fixture A is the acceptance condition from the Issue ("adopting a
 * non-standard / limited-availability feature without a fallback must
 * fail"), and fixture B is the boundary next to it (below the bar is
 * allowed once the fallback requirement is explicit).
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the capture
 * is taken into a Buffer and re-encoded with the existing `sharp`
 * devDependency as `resize({ width: 1600, withoutEnlargement: true })`
 * followed by `webp({ quality: 80 })`. No intermediate PNG is written to
 * disk, and the target extension is asserted to be `.webp` so a PNG can
 * never drift back into `docs/`. `sharp` stays a devDependency and is
 * never imported by the Worker / SSR.
 *
 *   node scripts/make-browser-baseline-report.mjs
 *   pnpm run verify:browser-baseline-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`. The
 * generator reads no secret and touches no network, no D1 and no R2.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runCheck } from './check-browser-baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const HTML_REPORT = join(TMP, 'browser-baseline-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/standards/browser-baseline.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 68;

const REPRODUCTION = [
	'pnpm run compat:check                              # the gate itself (exit 0 + warnings)',
	'node --test scripts/check-browser-baseline.test.mjs # the fixture suite behind this report',
	'pnpm run verify:browser-baseline-screenshot         # regenerate this report + WebP',
	'node scripts/check-browser-baseline.mjs --json      # machine-readable result',
];

/* ------------------------------------------------------------------ *
 * fixture scenarios — the failing path and the boundary next to it
 * ------------------------------------------------------------------ */

const SUPPORT = {
	chrome: '144',
	edge: '144',
	firefox: null,
	safari: '26',
	safari_ios: '26',
};

function fixtureManifest(fallback) {
	return {
		schema_version: 1,
		policy: {
			bar: 'baseline-widely-available',
			target_browsers: [
				{ id: 'chrome', label: 'Chrome', role: 'Baseline core (desktop)', floor: '129' },
				{ id: 'edge', label: 'Edge', role: 'Baseline core (desktop)', floor: '129' },
				{ id: 'firefox', label: 'Firefox', role: 'Baseline core (desktop)', floor: '131' },
				{ id: 'safari', label: 'Safari', role: 'Baseline core (desktop)', floor: '18' },
				{
					id: 'safari_ios',
					label: 'Safari on iOS',
					role: 'mobile Baseline representative',
					floor: '18',
				},
			],
		},
		dataset: {
			name: 'web-features',
			source_url: 'https://github.com/web-platform-dx/web-features/blob/main/data.json',
			snapshot_date: '2026-10-18',
			browsers: {
				chrome: { name: 'Chrome', releases: [{ date: '2024-09-17', version: '129' }] },
				edge: { name: 'Edge', releases: [{ date: '2024-09-19', version: '129' }] },
				firefox: { name: 'Firefox', releases: [{ date: '2024-10-01', version: '131' }] },
				safari: { name: 'Safari', releases: [{ date: '2024-09-16', version: '18' }] },
				safari_ios: { name: 'Safari iOS', releases: [{ date: '2024-09-16', version: '18' }] },
			},
		},
		scan: {
			coverage_root: 'src',
			extensions: ['.ts', '.tsx', '.css'],
			exclude: ['**/*.test.ts'],
		},
		surfaces: [{ id: 'routes', root: 'src/routes', min_files: 1, role: 'fixture routes' }],
		features: [
			{
				id: 'webgpu',
				label: '`navigator.gpu` (fixture — WebGPU adoption under evaluation)',
				kind: 'web-api',
				detect: ['navigator\\.gpu'],
				dataset: {
					feature_id: 'webgpu',
					baseline: false,
					baseline_low_date: null,
					baseline_high_date: null,
					support: SUPPORT,
				},
				fallback,
			},
		],
		guarded_features: [],
	};
}

function runFixture(id, title, fallback, source) {
	const root = mkdtempSync(join(tmpdir(), `browser-baseline-${id}-`));
	try {
		mkdirSync(join(root, 'src/routes'), { recursive: true });
		mkdirSync(join(root, 'quality'), { recursive: true });
		writeFileSync(join(root, 'src/routes/index.tsx'), source);
		writeFileSync(
			join(root, 'quality/browser-baseline.json'),
			`${JSON.stringify(fixtureManifest(fallback), null, '\t')}\n`,
		);
		const result = runCheck({ root, manifestPath: 'quality/browser-baseline.json' });
		return {
			id,
			title,
			exitCode: result.errors.length === 0 ? 0 : 1,
			messages: result.errors.map((entry) => `${entry.rule}: ${entry.message}`),
			warnings: result.warnings.map((entry) => `${entry.rule}: ${entry.message}`),
			source,
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const FIXTURES = [
	runFixture(
		'a',
		'A — WebGPU を fallback 宣言なしで採用',
		null,
		[
			'// fixture: a candidate adoption of WebGPU with no fallback declared',
			'export async function pickAdapter() {',
			'\tconst adapter = await navigator.gpu.requestAdapter();',
			'\treturn adapter;',
			'}',
			'',
		].join('\n'),
	),
	runFixture(
		'b',
		'B — 同じ採用に capability fallback を明示',
		{
			kind: 'capability',
			strategy:
				'Capability fallback: feature-detect `navigator.gpu` behind a Canvas 2D path, so the surface still renders on engines without WebGPU (Firefox has no implementation in this snapshot).',
			evidence: [
				{
					file: 'src/routes/index.tsx',
					pattern: "typeof navigator\\.gpu === 'undefined'",
					proves: 'the non-WebGPU branch is live code, not a comment',
				},
			],
		},
		[
			'// fixture: the same adoption with an explicit capability fallback',
			'export async function pickAdapter() {',
			"\tif (typeof navigator.gpu === 'undefined') return canvas2dPath();",
			'\tconst adapter = await navigator.gpu.requestAdapter();',
			'\treturn adapter;',
			'}',
			'',
		].join('\n'),
	),
];

/* ------------------------------------------------------------------ *
 * HTML rendering
 * ------------------------------------------------------------------ */

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function code(value) {
	return `<code>${escapeHtml(value)}</code>`;
}

const SUPPORT_ORDER = ['chrome', 'edge', 'firefox', 'safari', 'safari_ios'];
const SUPPORT_HEADER = SUPPORT_ORDER.map((browser) => `<th>${browser}</th>`).join('');
const supportCells = (dataset) =>
	SUPPORT_ORDER.map((browser) => `<td>${escapeHtml(dataset.support?.[browser] ?? '—')}</td>`).join(
		'',
	);

function render(result) {
	const { stats, targets, manifest } = result;
	const { rows, guardedRows } = result;

	const adoptedRows = rows
		.map(
			(row) => `<tr class="${row.belowBar ? 'warn' : 'ok'}">
    <td class="status">${row.belowBar ? 'WARN' : 'OK'}</td>
    <td>${escapeHtml(row.id)}<div class="sub">${escapeHtml(row.label)}</div></td>
    <td>${escapeHtml(row.dataset.baseline)}<div class="sub">${escapeHtml(row.baseline)}</div></td>
    <td>${supportCells(row.dataset)}</td>
    <td class="num">${row.hits.length}</td>
    <td>${row.fallback ? `${escapeHtml(row.fallback.kind)}` : '—'}</td>
  </tr>`,
		)
		.join('\n');

	const guardedTable = guardedRows
		.map(
			(row) => `<tr>
    <td class="status ok">GUARD</td>
    <td>${escapeHtml(row.id)}<div class="sub">${escapeHtml(row.label)}</div></td>
    <td>${escapeHtml(row.dataset.baseline)}<div class="sub">${escapeHtml(row.baseline)}</div></td>
    <td>${supportCells(row.dataset)}</td>
    <td class="num">${row.hits.length}</td>
  </tr>`,
		)
		.join('\n');

	const targetRows = targets.floors
		.map(
			(floor) => `<tr>
    <td>${escapeHtml(floor.label)}</td>
    <td>${escapeHtml(floor.role)}</td>
    <td class="num">${escapeHtml(floor.declared)}</td>
    <td class="num">${escapeHtml(floor.implied ?? '—')}</td>
  </tr>`,
		)
		.join('\n');

	const fallbackRows = rows
		.filter((row) => row.belowBar)
		.map(
			(row) => `<tr>
    <td>${escapeHtml(row.id)}</td>
    <td>${escapeHtml(row.fallback.strategy)}
      <ul>${row.fallbackEvidence
				.map(
					(evidence) =>
						`<li>${code(evidence.file)}:${evidence.proofs[0].line} ${code(evidence.pattern)} — ${escapeHtml(evidence.proves)}</li>`,
				)
				.join('')}</ul>
    </td>
  </tr>`,
		)
		.join('\n');

	const fixtureCards = FIXTURES.map(
		(fixture) => `<div class="fixture ${fixture.exitCode === 0 ? 'ok' : 'fail'}">
  <div class="fixture-head">
    <span class="pill ${fixture.exitCode === 0 ? 'ok' : 'fail'}">exit ${fixture.exitCode}</span>
    <b>${escapeHtml(fixture.title)}</b>
  </div>
  <pre>${escapeHtml(fixture.source)}</pre>
  <div class="fixture-out">
    ${
			fixture.messages.length > 0
				? fixture.messages
						.map((message) => `<div class="fail">${escapeHtml(message)}</div>`)
						.join('')
				: '<div class="none">(no errors)</div>'
		}
    ${fixture.warnings.map((message) => `<div class="warn">${escapeHtml(message)}</div>`).join('')}
  </div>
</div>`,
	).join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Web 機能採用ゲート — Baseline (Issue #414)</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #77776a; font-size: 12.5px; }
  .lead { color: #3d3d33; font-size: 13px; margin: 0 0 20px; max-width: 1100px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 150px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .warnc { color: #8a5a12; }
  .failc { color: #a12020; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  pre { background: #f3f1e8; border: 1px solid #dedcd2; padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 74px; white-space: nowrap; }
  tr.ok .status { color: #1c6b3a; }
  tr.warn .status { color: #8a5a12; }
  .num { text-align: right; width: 64px; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  .fixture { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; margin-bottom: 12px; }
  .fixture.fail { border-left: 4px solid #a12020; }
  .fixture.ok { border-left: 4px solid #1c6b3a; }
  .fixture-head { display: flex; align-items: center; gap: 10px; }
  .pill { font-weight: 700; font-size: 12px; padding: 1px 8px; border: 1px solid currentColor; }
  .pill.ok { color: #1c6b3a; }
  .pill.fail { color: #a12020; }
  .fixture-out .fail { color: #a12020; }
  .fixture-out .warn { color: #8a5a12; }
  .fixture-out .none { color: #77776a; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>Web 機能採用ゲート — Baseline 互換性 (Issue #414)</h1>
  <p class="lead">
    <b>採用バー:</b> ${code(`baseline === "${'high'}"`)}（Baseline: Widely available / 新たに利用可能から 30 か月）。
    バー未満の採用は <b>fallback 要件が明示され、evidence が working tree 上で検証できた場合のみ warning</b>、
    fallback 宣言なしの採用は <b>fail</b>。
    データは ${code(`${manifest.dataset.name} @ ${manifest.dataset.snapshot_date}`)} をリポジトリに固定し、
    ゲートは offline / deterministic に動作する。
  </p>

  <div class="cards">
    <div class="card"><div class="k">scanned files</div><div class="v">${stats.files}</div></div>
    <div class="card"><div class="k">surfaces</div><div class="v">${stats.surfaces}</div></div>
    <div class="card"><div class="k">adopted</div><div class="v">${stats.adopted}</div></div>
    <div class="card"><div class="k">below bar (warn)</div><div class="v warnc">${stats.belowBar}</div></div>
    <div class="card"><div class="k">guarded</div><div class="v">${stats.guarded}</div></div>
    <div class="card"><div class="k">errors</div><div class="v ok">0</div></div>
  </div>

  <h2>互換対象ブラウザ（採用集合が Baseline Widely available を満たす範囲: ${escapeHtml(targets.earliest ?? '—')} … ${escapeHtml(targets.latest ?? '—')}）</h2>
  <table>
    <thead><tr><th>browser</th><th>role</th><th style="width:120px">declared floor</th><th style="width:150px">bar-implied floor</th></tr></thead>
    <tbody>
${targetRows}
    </tbody>
  </table>
  <p class="sub">
    declared floor が bar-implied floor を下回る場合は fail。バージョンは vendored リリース表から
    「採用集合の最新の Baseline Widely available 判定日以降の最初のリリース」として導出する（手書きの数字ではない）。
  </p>

  <h2>採用済み機能（${SUPPORT_ORDER.join(' / ')}）</h2>
  <table>
    <thead><tr><th style="width:74px">gate</th><th>feature</th><th style="width:180px">baseline</th>${SUPPORT_HEADER}<th style="width:64px">sites</th><th style="width:120px">fallback</th></tr></thead>
    <tbody>
${adoptedRows}
    </tbody>
  </table>

  <h2>バー未満の採用と fallback 宣言（warning）</h2>
  <table>
    <thead><tr><th style="width:200px">feature</th><th>fallback 要件と evidence</th></tr></thead>
    <tbody>
${fallbackRows}
    </tbody>
  </table>

  <h2>guarded（未採用 — 1 件でも出現すると fail）</h2>
  <table>
    <thead><tr><th style="width:74px">gate</th><th>feature</th><th style="width:180px">baseline</th>${SUPPORT_HEADER}<th style="width:64px">sites</th></tr></thead>
    <tbody>
${guardedTable}
    </tbody>
  </table>

  <h2>fixture — 同じ採用が fail になる場合と warning に留まる場合</h2>
  <p class="sub">
    下の 2 例は同じ WebGPU 採用を同じ checker に通した実結果。gate の判定は「読む anecdote」ではなく
    この fixture 実行結果そのもの。
  </p>
${fixtureCards}

  <h2>再現コマンド</h2>
  <pre>${REPRODUCTION.map((line) => escapeHtml(line)).join('\n')}</pre>
  <p class="sub">
    期待結果: 上記コマンドはすべて exit 0。fixture A を実行した場合のみ <code>compat:check</code> は
    <code>fallback_required</code> で exit 1 になる（= Issue の受け入れ条件「fallback 無し採用は fail」）。
  </p>

  <footer>my-web-2026 · Issue #414 · report generated locally by scripts/make-browser-baseline-report.mjs
  (offline, no secret, no production D1/R2) · committed as docs/verification/standards/browser-baseline.webp
  (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
</body>
</html>
`;
}

async function shoot(htmlPath, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1280, height: 1400 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Playwright cannot emit WebP, so capture into a Buffer (never a file)
		// and re-encode with sharp. The PNG bytes stay in memory only.
		const capture = await page.screenshot({ fullPage: true });
		const info = await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
		return info;
	} finally {
		await browser.close();
	}
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

const result = runCheck();
if (result.errors.length > 0) {
	process.stderr.write(
		`refusing to render a verification report for a failing gate (${result.errors.length} error(s)):\n${result.errors
			.map((entry) => `  - ${entry.rule}: ${entry.message}`)
			.join('\n')}\n`,
	);
	process.exit(1);
}

const failingFixtures = FIXTURES.filter((fixture) => fixture.exitCode !== 0);
if (failingFixtures.length !== 1 || FIXTURES[0].exitCode !== 1) {
	process.stderr.write(
		`fixture expectations changed: fixture A must fail and fixture B must warn, got ${FIXTURES.map(
			(fixture) => `${fixture.id}=${fixture.exitCode}`,
		).join(', ')}\n`,
	);
	process.exit(1);
}

mkdirSync(TMP, { recursive: true });
writeFileSync(HTML_REPORT, render(result));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
process.stdout.write(
	`gate: ${result.stats.adopted} adopted / ${result.stats.belowBar} below bar / ${result.stats.guarded} guarded / 0 errors\n`,
);
for (const fixture of FIXTURES) {
	process.stdout.write(`fixture ${fixture.id}: exit ${fixture.exitCode} (${fixture.title})\n`);
}
const info = await shoot(HTML_REPORT, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
