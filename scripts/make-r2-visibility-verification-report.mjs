#!/usr/bin/env node
/**
 * Verification report generator for Issue #459 (R2 public / private
 * object boundary).
 *
 * Runs the boundary suite with Vitest's JSON reporter, renders the
 * result as a static HTML page (a "CI report" view) at
 * `.tmp/r2-media-visibility-report.html`, and screenshots that page
 * with the Playwright chromium already installed for the E2E suite
 * into `docs/verification/security/r2-public-private.webp`.
 *
 * Issue #459 names the artefact `…/r2-public-private.png`. This
 * repository's verification-pipeline rule commits screenshots as
 * moderately compressed WebP (a committed PNG is several times larger
 * for no evidentiary gain), so only the extension is substituted —
 * a documented deviation, not a silent one. The script therefore
 * accepts **either** extension and encodes to match
 * (`R2_VISIBILITY_TARGET=…png` writes a PNG); it does not hard-code
 * the deviation as the only possible outcome. The default target is
 * `.webp`.
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the
 * capture is taken into a Buffer and re-encoded with the existing
 * `sharp` devDependency as `resize({ width: 1600, withoutEnlargement:
 * true })` followed by `webp({ quality: 80 })`. No intermediate file
 * reaches disk (`sharp` only sees the in-memory Buffer). `sharp`
 * stays a devDependency and is never imported by the Worker / SSR.
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
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'r2-media-visibility-results.json');
const HTML_REPORT = join(TMP, 'r2-media-visibility-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/r2-public-private.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;

/**
 * Where the artefact goes. `.webp` is the repository default (see the
 * header); `R2_VISIBILITY_TARGET` exists so the Issue's literal `.png`
 * path stays reachable instead of being locked out by this script.
 */
const TARGET = process.env.R2_VISIBILITY_TARGET
	? resolve(ROOT, process.env.R2_VISIBILITY_TARGET)
	: WEBP_TARGET;

const SUITE = 'test/integration/r2-media-visibility.test.ts';

/**
 * The fixture the suite seeds into the local R2 bucket. Declared here
 * so the report can show what was probed and what the boundary is
 * supposed to answer — the pass/fail column is NOT taken from this
 * table, it comes from the JSON reporter output of the real run.
 */
const FIXTURE = [
	['portfolio/aulymo/cover.webp', 'public', 'published', '200（配信）'],
	['portfolio/aulymo/cover-3.webp', 'public', 'not published', '404（承認ゲート）'],
	['portfolio/aulymo/cover-17.webp', 'public', 'not published', '404（承認ゲート）'],
	['private/draft/secret.webp', 'private', 'n/a', '404（namespace ゲート）'],
	['staging/wip.webp', 'private', 'n/a', '404（namespace ゲート）'],
	['wip/unlisted.webp', 'undeclared', 'n/a', '404（namespace ゲート）'],
	['reactions/<sha256>.png', 'public', 'uploaded via uploadImage', '200（配信）'],
];

/** The two attack legs the suite runs, and what they may observe. */
const ATTACKS = [
	[
		'object listing',
		'bucket.list() をそのまま辿る',
		'private / 未公開 key が返る（対照実験）',
		'listPublicMediaKeys は公開 key だけを返す（抑止 key も件数も返さない）',
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
		'404 / 200 never（403 は返さない）',
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
  <h1>R2 media key の公開可否契約 — namespace / approval gate (Issue #459)</h1>
  <p class="sub">local worker (Miniflare / workerd pool) + <code>${escapeHtml(SUITE)}</code> の実行結果。MEDIA bucket に public R2 custom domain が接続されると edge が key 存在=status で配信するため（その接続は Cloudflare アカウント側の release 前提であり本 repo は確認できない）、namespace 契約をコード側で固定する。secret は含まれない（fixture は 1x1 の合成 PNG、binding は test 用の dummy）。本 report が証明するのは repository 内のゲートであり、custom domain 経路そのものは Worker を経由しない。</p>

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
    <b>200 の意味:</b> 公開 namespace にあり、公開承認済みで、bucket に実在する object だけが 200。<br/>
    <b>404 の意味:</b> private / 未宣言 namespace、未承認、不在のいずれも<b>同一の 404 値</b>で返す（403 も reason code も返さないのは、存在 oracle を作らないため）。
  </p>

  <footer>my-web-2026 · Issue #459 · report generated locally from the workerd test pool by scripts/make-r2-visibility-verification-report.mjs (no CI token, no production D1/R2, no deploy) · committed artefact: ${escapeHtml(relative(ROOT, TARGET))} (width ≤ ${WEBP_WIDTH}, ${escapeHtml(extname(TARGET).slice(1))} quality ${WEBP_QUALITY}).</footer>
</body>
</html>
`;
}

async function shoot(htmlPath, target) {
	const extension = extname(target);
	if (extension !== '.webp' && extension !== '.png') {
		throw new Error(`verification artefact must be .webp or .png: ${target}`);
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
		const image = sharp(capture).resize({ width: WEBP_WIDTH, withoutEnlargement: true });
		const info =
			extension === '.webp'
				? await image.webp({ quality: WEBP_QUALITY }).toFile(target)
				: await image.png({ compressionLevel: 9 }).toFile(target);
		return info;
	} finally {
		await browser.close();
	}
}

const report = run();
writeFileSync(HTML_REPORT, render(report));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
const info = await shoot(HTML_REPORT, TARGET);
process.stdout.write(
	`wrote ${TARGET} (${extname(TARGET).slice(1)} ${info.width}x${info.height}, ${info.size} B)\n`,
);
