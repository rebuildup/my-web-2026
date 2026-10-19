#!/usr/bin/env node
/**
 * Verification report generator for Issue #634 (public media delivery
 * gate at `/media/<key>`).
 *
 * Runs the two suites that decide and wire the route with Vitest's JSON
 * reporter, renders the result as a static HTML page at
 * `.tmp/r2-public-delivery-gate.html`, and screenshots that page with
 * the Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/r2-public-delivery-gate.webp`
 * (width ≤ 1600, WebP quality 80 — the repository verification rule).
 *
 * Why two suites: `src/http/media/router.test.ts` states each gate with
 * fakes, and `test/integration/media-delivery.test.ts` issues real
 * requests through the Worker entry against a local D1 + R2 fixture.
 * The artefact is evidence for the *pair* — the decision and the path a
 * visitor actually reaches — so neither run alone is enough.
 *
 * Nothing secret is read or drawn: the fixture uses synthetic bytes and
 * the workerd pool's dummy bindings. No production D1, R2, or deploy is
 * involved. Playwright cannot encode WebP, so the capture is held in an
 * in-memory Buffer and re-encoded with the existing `sharp`
 * devDependency; no intermediate PNG reaches disk.
 *
 *   node scripts/make-r2-public-delivery-gate-report.mjs
 *   pnpm run r2:public-delivery:report   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present (`pnpm run e2e:install`).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'r2-public-delivery-gate-results.json');
const HTML_REPORT = join(TMP, 'r2-public-delivery-gate.html');
const TARGET = join(ROOT, 'docs/verification/security/r2-public-delivery-gate.webp');
const WIDTH = 1600;
const QUALITY = 80;

const SUITES = ['src/http/media/router.test.ts', 'test/integration/media-delivery.test.ts'];

/**
 * What the request-level fixture puts in the bucket. Declared here so
 * the report can show what was probed; the observed column comes from
 * the real run, not from this table.
 */
const REQUESTS = [
	['portfolio/published/cover.webp', 'published project', '200 + stored metadata', 'Worker が配信'],
	['reactions/&lt;sha256&gt;.webp', 'reaction_images の行あり', '200 immutable', 'Worker が配信'],
	['portfolio/draft/cover.webp', 'draft project（object は実在）', '404', 'approval gate'],
	['portfolio/published/cover-2.webp', '連番の推測（object は実在）', '404', 'approval gate'],
	['private/secret.webp', '宣言済み private namespace', '404', 'namespace gate'],
	['unlisted/thing.webp', '未宣言 namespace', '404', 'namespace gate'],
	['reactions/&lt;sha256&gt;.webp', '行の無い reaction object', '404', 'approval gate'],
	['portfolio/published/page.html', '承認済みだが text/html', '404', 'content-type gate'],
	['GET /media/（key 無し）', 'prefix のみ', '404', 'listing 面を作らない'],
];

const GATES = [
	[
		'1. key grammar / namespace',
		'createPublicMediaDelivery → classifyMediaKey',
		'404（bucket に触れない）',
	],
	[
		'2. 所有者の承認',
		'isApprovedMediaKey → media-approval.ts / images.ts',
		'404（bucket に触れない）',
	],
	['3. bucket read', 'c.env.MEDIA.get(key)', '404'],
	['4. content type', 'isDeliverableMediaContentType', '404（415 ではない）'],
	['5. 配信', 'route response', '200 + nosniff'],
];

function run() {
	mkdirSync(TMP, { recursive: true });
	execFileSync(
		'npx',
		['vitest', 'run', ...SUITES, '--reporter=json', `--outputFile=${JSON_REPORT}`],
		{ cwd: ROOT, stdio: 'inherit' },
	);
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

	const requestRows = REQUESTS.map(
		([request, state, expected, gate]) =>
			`<tr><td><code>${request}</code></td><td>${state}</td><td><code>${expected}</code></td><td>${gate}</td></tr>`,
	).join('\n');

	const gateRows = GATES.map(
		([step, code, refusal]) =>
			`<tr><td>${step}</td><td><code>${code}</code></td><td><code>${refusal}</code></td></tr>`,
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
<title>R2 public delivery gate — /media/&lt;key&gt; (Issue #634)</title>
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
  <h1>公開配信ゲート — <code>GET /media/&lt;key&gt;</code> (Issue #634)</h1>
  <p class="sub">local workerd pool（<code>SELF.fetch</code>）+ local D1 / R2 fixture。Worker entry が <code>/media/*</code> を Hono boundary へ渡し、namespace ゲートと所有者の承認ゲートを通った object だけを返す。fixture の bucket には<b>拒否ケースごとに object を置いてある</b>ため、404 が「object が無い」ことの偶然ではない。secret / 本番 binding / key 一覧は含まない。custom domain 経由の edge 配信（Cloudflare アカウント側の設定）は本 report の対象外で、残課題として runbook / security doc に記載している。</p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v">${failed}</div></div>
    <div class="card"><div class="k">duration</div><div class="v">${durationMs}<span style="font-size:13px"> ms</span></div></div>
  </div>

  <h2>ゲートの順序</h2>
  <table>
    <thead><tr><th style="width:220px">段</th><th>code</th><th style="width:220px">拒否</th></tr></thead>
    <tbody>
${gateRows}
    </tbody>
  </table>

  <h2>投入したリクエスト（local fixture）</h2>
  <table>
    <thead><tr><th style="width:300px">request</th><th style="width:210px">fixture の状態</th><th style="width:180px">期待</th><th>拒否したゲート</th></tr></thead>
    <tbody>
${requestRows}
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
    <b>404 の意味:</b> malformed / private / 未宣言 / 未承認 / 不在 / 非メディア型のいずれも<b>空 body + no-store の同一 404</b>（403 も reason code も返さない。存在 oracle を作らないため）。<br/>
    <b>200 の意味:</b> 公開 namespace にあり、所有者が「公開中」と答え、object が実在し、content type がメディア型のときだけ 200。<code>x-content-type-options: nosniff</code> を常時付与。<br/>
    <b>cache:</b> object の stored Cache-Control が最優先。無い場合は <code>reactions/</code> が <code>public, max-age=31536000, immutable</code>、<code>portfolio/</code> が <code>public, max-age=3600</code>。拒否は <code>no-store</code>。
  </p>

  <footer>my-web-2026 · Issue #634 · report generated locally from the workerd test pool by scripts/make-r2-public-delivery-gate-report.mjs (no CI token, no production D1/R2, no deploy) · committed artefact: ${escapeHtml(relative(ROOT, TARGET))} (width ≤ ${WIDTH}, ${escapeHtml(extname(TARGET).slice(1))} quality ${QUALITY}).</footer>
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
		const capture = await page.screenshot({ fullPage: true });
		const image = sharp(capture).resize({ width: WIDTH, withoutEnlargement: true });
		return extension === '.webp'
			? image.webp({ quality: QUALITY }).toFile(target)
			: image.png({ compressionLevel: 9 }).toFile(target);
	} finally {
		await browser.close();
	}
}

const report = run();
writeFileSync(HTML_REPORT, render(report));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
const info = await shoot(HTML_REPORT, TARGET);
process.stdout.write(
	`wrote ${relative(ROOT, TARGET)} (${extname(TARGET).slice(1)} ${info.width}x${info.height}, ${info.size} B)\n`,
);
