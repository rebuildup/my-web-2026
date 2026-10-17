#!/usr/bin/env node
/**
 * Verification report generator for Issue #459 (R2 public / private
 * object boundary).
 *
 * Runs the boundary suite with Vitest's JSON reporter, renders the
 * result as a static HTML page (a "CI report" view) at
 * `.tmp/r2-media-visibility-report.html`, and screenshots that page
 * with the Playwright chromium already installed for the E2E suite
 * into `docs/verification/security/r2-public-private.webp` — the path
 * Issue #459 requires in the PR body, with the `.webp` extension
 * substituted for the Issue's literal `.png` (a committed PNG is
 * several times larger for no evidentiary gain).
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the
 * capture is taken into a Buffer and re-encoded with the existing
 * `sharp` devDependency as `resize({ width: 1600, withoutEnlargement:
 * true })` followed by `webp({ quality: 80 })`. No intermediate PNG
 * reaches disk (`sharp` only sees the in-memory Buffer), and the
 * target extension is asserted to be `.webp` so a PNG can never drift
 * back into `docs/`. `sharp` stays a devDependency and is never
 * imported by the Worker / SSR.
 *
 * This script is committed so the required screenshot has a
 * reviewable, reproducible source instead of an uncommitted helper.
 * It reads no secret: the suite seeds a local Miniflare R2 fixture
 * with synthetic 1x1 PNG bytes and uses the workerd pool's dummy
 * bindings. It never touches a production bucket and never deploys.
 *
 *   node scripts/make-r2-visibility-verification-report.mjs
 *   pnpm run r2:visibility:report   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP
 * is committed. Chromium must be present (`pnpm run e2e:install`).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'r2-media-visibility-results.json');
const HTML_REPORT = join(TMP, 'r2-media-visibility-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/r2-public-private.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;

const SUITE = 'test/integration/r2-media-visibility.test.ts';

/**
 * The fixture the suite seeds into the local R2 bucket. Declared here
 * so the report can show what was probed and what the boundary is
 * supposed to answer — the pass/fail column is NOT taken from this
 * table, it comes from the JSON reporter output of the real run.
 */
const FIXTURE = [
	['portfolio/aulymo/cover.webp', 'public', 'published', '200 served'],
	['portfolio/aulymo/cover-3.webp', 'public', 'not published', '404 refused_unapproved'],
	['portfolio/aulymo/cover-17.webp', 'public', 'not published', '404 refused_unapproved'],
	['private/draft/secret.webp', 'private', 'n/a', '404 private_namespace'],
	['staging/wip.webp', 'private', 'n/a', '404 private_namespace'],
	['wip/unlisted.webp', 'undeclared', 'n/a', '404 unlisted_namespace'],
	['reactions/<sha256>.png', 'public', 'uploaded via uploadImage', '200 served'],
];

/** The two attack legs the suite runs, and what they may observe. */
const ATTACKS = [
	[
		'object listing',
		'bucket.list() をそのまま辿る',
		'private / 未公開 key が返る（対照実験）',
		'listPublicMediaKeys は公開 key だけを返し、抑止分は件数のみ',
	],
	[
		'sequential guessing',
		'portfolio/aulymo/cover-1〜40 を順にprobe',
		'未公開 object をそのまま横切る',
		'全 404。同一 namespace の公開 1 枚だけが 200（対照）',
	],
	[
		'HTTP route',
		'GET /api/v1/reaction-images/:id',
		'行が private namespace を指す',
		'404 refused / 200 never（403 は返さない）',
	],
];

function run() {
	mkdirSync(TMP, { recursive: true });
	execFileSync('npx', ['vitest', 'run', SUITE, '--reporter=json', `--outputFile=${JSON_REPORT}`], {
		cwd: ROOT,
		stdio: 'inherit',
	});
	return JSON.parse(readFileSync(JSON_REPORT, 'utf8'));
}

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function render(report) {
	const results = report.testResults ?? [];
	const assertions = results.flatMap((file) =>
		(file.assertionResults ?? []).map((test) => ({
			title: test.fullName ?? test.title,
			status: test.status,
			ms: test.duration ?? 0,
		})),
	);
	const passed = assertions.filter((a) => a.status === 'passed').length;
	const failed = assertions.filter((a) => a.status === 'failed').length;
	const durationMs = Math.round(
		results.reduce((sum, file) => sum + (file.endTime - file.startTime), 0),
	);

	const fixtureRows = FIXTURE.map(
		([key, namespace, publication, expected]) =>
			`<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(namespace)}</td><td>${escapeHtml(publication)}</td><td><code>${escapeHtml(expected)}</code></td></tr>`,
	).join('\n');

	const attackRows = ATTACKS.map(
		([name, how, what, outcome]) =>
			`<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(how)}</td><td>${escapeHtml(what)}</td><td>${escapeHtml(outcome)}</td></tr>`,
	).join('\n');

	const testRows = assertions
		.map(
			(test) => `<tr class="${escapeHtml(test.status)}">
    <td class="status">${test.status === 'passed' ? 'PASS' : escapeHtml(test.status.toUpperCase())}</td>
    <td>${escapeHtml(test.title)}</td>
    <td class="ms">${test.ms} ms</td>
  </tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>R2 public / private object boundary — Issue #459</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 20px; font-size: 13px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 150px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 64px; }
  tr.passed .status { color: #1c6b3a; }
  tr.failed .status { color: #a12020; }
  .ms { text-align: right; color: #77776a; width: 80px; }
  .legend { margin-top: 8px; color: #3d3d33; font-size: 13px; }
  .legend b { color: #14140f; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>R2 public / private object boundary — 未承認オブジェクト参照の遮断 (Issue #459)</h1>
  <p class="sub">local worker (Miniflare / workerd pool) + <code>${escapeHtml(SUITE)}</code> の実行結果。MEDIA bucket は public R2 custom domain で配信されるため key が分かれば誰でも取得でき、namespace が境界になる。secret は含まれない（fixture は 1x1 の合成 PNG、binding は test 用の dummy）。</p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v">${failed}</div></div>
    <div class="card"><div class="k">duration</div><div class="v">${durationMs}<span style="font-size:13px"> ms</span></div></div>
  </div>

  <h2>投入した key（local R2 fixture）</h2>
  <table>
    <thead><tr><th style="width:300px">key</th><th style="width:110px">namespace</th><th style="width:170px">公開状態</th><th>期待結果</th></tr></thead>
    <tbody>
${fixtureRows}
    </tbody>
  </table>

  <h2>実行した攻撃面</h2>
  <table>
    <thead><tr><th style="width:150px">攻撃</th><th style="width:270px">手順</th><th style="width:250px">見ええては困るもの</th><th>観測された結果</th></tr></thead>
    <tbody>
${attackRows}
    </tbody>
  </table>

  <h2>実行結果</h2>
  <table>
    <thead><tr><th style="width:64px">result</th><th>test</th><th style="width:80px">time</th></tr></thead>
    <tbody>
${testRows}
    </tbody>
  </table>

  <p class="legend">
    <b>200 の意味:</b> 公開 namespace にあり、公開承認済みで、bucket に実在する object だけが 200。
    <b>404 の意味:</b> private / 未宣言 namespace、未承認、不在のいずれも<b>同じ 404</b> で返す（403 を返さないのは、存在 oracle を作らないため）。
  </p>

  <footer>my-web-2026 · Issue #459 · report generated locally from the workerd test pool by scripts/make-r2-visibility-verification-report.mjs (no CI token, no production D1/R2, no deploy) · committed as docs/verification/security/r2-public-private.webp (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
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
		// Playwright cannot emit WebP, so capture into a Buffer (never a
		// file) and re-encode with sharp. The PNG bytes stay in memory.
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

const report = run();
writeFileSync(HTML_REPORT, render(report));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
const info = await shoot(HTML_REPORT, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
