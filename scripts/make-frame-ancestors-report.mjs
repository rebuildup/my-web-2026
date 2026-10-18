#!/usr/bin/env node

/**
 * Verification report generator for Issue #448 (CSP frame-ancestors).
 *
 * Runs the two halves of the inbound embed policy — the workerd suite
 * (`test/integration/frame-ancestors.test.ts`) and the static
 * Static-Assets gate (`scripts/check-frame-ancestors-policy.mjs`) —
 * renders both as a static HTML "CI report" view at
 * `.tmp/frame-ancestors-report.html`, and screenshots that page with
 * the Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/frame-ancestors-test.webp` — the path
 * Issue #448 requires in the PR body, with the `.webp` extension
 * substituted for the Issue's literal `.png` (a committed PNG of a
 * mostly-text report is several times larger for no evidentiary gain).
 * The exact byte size is reported per commit in the PR body rather than
 * hard-coded here, so this docstring cannot drift on regeneration.
 *
 * The report deliberately shows the FAILING direction too: the Tool
 * artefact rule flipped to `'none'` and the third-party-permissive `*`
 * are rendered from fixtures the gate rejects, so a reader can see what
 * "denied" looks like without reading the source. A fourth fixture — the
 * Tool-only rule set evaluated against the real `public/` scan, i.e. the
 * shipped file with its `/share/*` rule removed — renders the coverage
 * direction the review raised.
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the capture
 * is taken into a Buffer and re-encoded with the existing `sharp`
 * devDependency as `resize({ width: 1600, withoutEnlargement: true })`
 * followed by `webp({ quality: 80 })`. No intermediate PNG is written to
 * disk, and the target extension is asserted to be `.webp`. `sharp` stays
 * a devDependency and is never imported by the Worker / SSR.
 *
 *   node scripts/make-frame-ancestors-report.mjs
 *   pnpm run verify:frame-ancestors-screenshot   # same thing
 *
 * This script reads no secret: everything runs against the local
 * workerd pool's dummy bindings and a static file.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	evaluateEmbedPolicy,
	findStaticHtmlDocuments,
	parseHeadersFile,
} from './check-frame-ancestors-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'frame-ancestors-results.json');
const HTML_REPORT = join(TMP, 'frame-ancestors-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/frame-ancestors-test.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;

const SUITE = 'test/integration/frame-ancestors.test.ts';

/** Surface -> directive -> who owns the response. */
const POLICY = [
	[
		'/admin/login',
		"frame-ancestors 'none'",
		'Worker',
		'Admin document。第三方 iframe 埋め込みは拒否',
	],
	[
		'/admin（匿名アクセス）',
		"frame-ancestors 'none'",
		'Worker',
		'307 redirect（content-type 無し）でも path のみで拒否',
	],
	['/admin/keys', "frame-ancestors 'none'", 'Worker', '認証済み前提の子ルートも拒否'],
	[
		'/administrator（lookalike）',
		"frame-ancestors 'self'",
		'Worker',
		'前方一致でないため Admin の拒否を継承しない（404）',
	],
	[
		'/api/v1/auth/get-session',
		"frame-ancestors 'none'",
		'Worker → Hono',
		'Account surface（受理された入力）',
	],
	[
		'/api/v1/auth/sign-in/email（認証失敗 401）',
		"frame-ancestors 'none'",
		'Worker → Hono',
		'拒否された入力。方針は status ではなく path で決まる',
	],
	[
		'/api/v1/authentication（lookalike）',
		"frame-ancestors 'self'",
		'Worker → Hono',
		'Account の拒否を継承しない（404）',
	],
	[
		'/tools/prototype（shell）',
		"frame-ancestors 'self'",
		'Worker',
		'Tool iframe shell。同一 origin の埋め込みは許可',
	],
	[
		'/tools/prototype/app/index.html（artifact）',
		"frame-ancestors 'self'",
		'public/_headers',
		'Static Assets 側。shell だけが祖先になり得る',
	],
	[
		'/share/*（public 静的 HTML）',
		"frame-ancestors 'self'",
		'public/_headers',
		'Static Assets が Worker より先に返すため Worker の既定値は届かない',
	],
	[
		'/contact, /tools, /api/v1/health',
		"frame-ancestors 'self'",
		'Worker',
		'公開 surface は同一 origin のみ許可',
	],
];

/** What "allowed" means here — the same-origin ancestors a browser accepts. */
const ACCEPTED = [
	["frame-ancestors 'self'", '祖先が保護対象の origin と同一である場合のみ許可'],
	[
		'shell -> Tool artifact',
		'祖先は /tools/<slug>（同一 origin）。allow-scripts sandbox は文書側を opaque origin にするが、判定は祖先 origin に対して行われる',
	],
];

/** What "denied" means — inputs the policy must reject or not over-apply. */
const DENIED = [
	["frame-ancestors 'none'", '祖先が 1 つでも存在したら拒否。Admin / Account の clickjacking 対策'],
	[
		"frame-ancestors 'self' on a Tool artifact",
		'同一 origin 以外の祖先は拒否。Tool 文書を第三者が iframe 埋め込みできない',
	],
	[
		"'none' on a Tool artifact (fixture)",
		'静音の回帰：shell は描画されるが iframe が一度も mount されない',
	],
	["'*' on any static rule (fixture)", '静音の回帰：第三者埋め込みが再度開く'],
	[
		'/admin* or /api/v1/auth* in _headers',
		'Worker 生成レスポンスには _headers が適用されないため到達不能な設定',
	],
	[
		'public/*.html に _headers ルールが無い状態',
		'Static Assets は Worker より先に返すため Worker の frame-ancestors は効かない',
	],
];

/** Run the workerd suite with Vitest's JSON reporter. */
function runSuite() {
	mkdirSync(TMP, { recursive: true });
	execFileSync('npx', ['vitest', 'run', SUITE, '--reporter=json', `--outputFile=${JSON_REPORT}`], {
		cwd: ROOT,
		stdio: 'inherit',
	});
	return JSON.parse(readFileSync(JSON_REPORT, 'utf8'));
}

/** Run the static gate over the shipped file and over the broken fixtures. */
function runStaticGate() {
	const publicHtml = findStaticHtmlDocuments(join(ROOT, 'public'));
	const shipped = parseHeadersFile(readFileSync(join(ROOT, 'public/_headers'), 'utf8'));
	const fixtures = [
		{
			id: "Tool artifact rule switched to 'none'",
			errors: evaluateEmbedPolicy(
				parseHeadersFile("/tools/:slug/app/*\n  Content-Security-Policy: frame-ancestors 'none'\n")
					.rules,
			),
		},
		{
			id: 'Tool artifact rule opened to *',
			errors: evaluateEmbedPolicy(
				parseHeadersFile('/tools/:slug/app/*\n  Content-Security-Policy: frame-ancestors *\n')
					.rules,
			),
		},
		{
			id: 'admin rule added to _headers',
			errors: evaluateEmbedPolicy(
				parseHeadersFile("/admin*\n  Content-Security-Policy: frame-ancestors 'none'\n").rules,
			),
		},
		{
			// The Tool-only rule set evaluated against the real `public/`
			// scan: what the review found, i.e. the shipped file with the
			// `/share/*` rule removed.
			id: 'public/*.html left with no _headers rule',
			errors: evaluateEmbedPolicy(
				parseHeadersFile(
					"/tools/:slug/app/*\n  Access-Control-Allow-Origin: *\n  Content-Security-Policy: frame-ancestors 'self'\n",
				).rules,
				publicHtml,
			),
		},
	];
	return {
		publicHtml,
		shipped: evaluateEmbedPolicy(shipped.rules, publicHtml),
		fixtures,
	};
}

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function render(report, gate) {
	const results = report.testResults ?? [];
	const assertions = results.flatMap((file) =>
		(file.assertionResults ?? []).map((test) => ({
			title: test.fullName ?? test.title,
			status: test.status,
			ms: Math.round(test.duration ?? 0),
		})),
	);
	const passed = assertions.filter((a) => a.status === 'passed').length;
	const failed = assertions.filter((a) => a.status === 'failed').length;
	const durationMs = Math.round(
		results.reduce((sum, file) => sum + (file.endTime - file.startTime), 0),
	);

	const rows = (items, cols) =>
		items
			.map(
				(cells) =>
					`<tr>${cells
						.map((cell, index) =>
							index === cols.codeColumn
								? `<td><code>${escapeHtml(cell)}</code></td>`
								: `<td>${escapeHtml(cell)}</td>`,
						)
						.join('')}</tr>`,
			)
			.join('\n');

	const testRows = assertions
		.map(
			(test) => `<tr class="${escapeHtml(test.status)}">
    <td class="status">${test.status === 'passed' ? 'PASS' : escapeHtml(test.status.toUpperCase())}</td>
    <td>${escapeHtml(test.title)}</td>
    <td class="ms">${test.ms} ms</td>
  </tr>`,
		)
		.join('\n');

	const fixtureRows = gate.fixtures
		.map(
			(fixture) => `<tr class="failed">
    <td class="status">REJECT</td>
    <td>${escapeHtml(fixture.id)}</td>
    <td>${escapeHtml(fixture.errors.join(' — '))}</td>
  </tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>CSP frame-ancestors — Issue #448</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 20px; font-size: 13px; max-width: 900px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 150px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .bad { color: #a12020; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 72px; }
  tr.passed .status { color: #1c6b3a; }
  tr.failed .status { color: #a12020; }
  .ms { text-align: right; color: #77776a; width: 80px; }
  .legend { margin-top: 8px; color: #3d3d33; font-size: 13px; max-width: 900px; }
  .legend b { color: #14140f; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>CSP frame-ancestors — embed 方針（Issue #448）</h1>
  <p class="sub">
    入方向 embed 方針（<code>frame-ancestors</code>）の実行結果。<b>出方向</b>の Tool iframe 方針
    （どの Tool を host が iframe で埋め込むか = <code>src/tools/registry.ts</code> + manifest の
    <code>delivery.iframe</code>）とは別物であり、この 2 つは互いに派生しない。
    local worker（workerd pool）+ 静的 gate の実行結果であり、secret は含まれない。
  </p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v">${failed}</div></div>
    <div class="card"><div class="k">_headers violations</div><div class="v ${gate.shipped.length === 0 ? 'ok' : 'bad'}">${gate.shipped.length}</div></div>
    <div class="card"><div class="k">public HTML docs</div><div class="v ${gate.publicHtml.length === 0 ? '' : 'ok'}">${gate.publicHtml.length}<span style="font-size:13px"> / covered</span></div></div>
    <div class="card"><div class="k">duration</div><div class="v">${durationMs}<span style="font-size:13px"> ms</span></div></div>
  </div>

  <h2>ポリシー表（surface → directive → 所有者）</h2>
  <table>
    <thead><tr><th style="width:300px">path</th><th style="width:190px">directive</th><th style="width:130px">response owner</th><th>意味</th></tr></thead>
    <tbody>
${rows(POLICY, { codeColumn: 1 })}
    </tbody>
  </table>

  <h2>許可される入力（allowed）</h2>
  <table>
    <thead><tr><th style="width:300px">条件</th><th>Browsers の挙動</th></tr></thead>
    <tbody>
${rows(ACCEPTED, { codeColumn: 0 })}
    </tbody>
  </table>

  <h2>拒否される入力（denied）</h2>
  <table>
    <thead><tr><th style="width:300px">条件</th><th>結果</th></tr></thead>
    <tbody>
${rows(DENIED, { codeColumn: 0 })}
    </tbody>
  </table>

  <h2>実行結果 — workerd suite</h2>
  <table>
    <thead><tr><th style="width:72px">result</th><th>test</th><th style="width:80px">time</th></tr></thead>
    <tbody>
${testRows}
    </tbody>
  </table>

  <h2>実行結果 — static gate（public/_headers）</h2>
  <table>
    <thead><tr><th style="width:72px">result</th><th style="width:300px">fixture</th><th>gate の判定</th></tr></thead>
    <tbody>
      <tr class="passed">
        <td class="status">${gate.shipped.length === 0 ? 'PASS' : 'FAIL'}</td>
        <td>shipped public/_headers</td>
        <td>${escapeHtml(
					gate.shipped.length === 0
						? `違反なし。Tool artifact と public 静的 HTML (${gate.publicHtml.map((document) => document.file).join(', ')}) はいずれも frame-ancestors で保護され、Worker 管理 path へのルールなし`
						: gate.shipped.join(' — '),
				)}</td>
      </tr>
${fixtureRows}
    </tbody>
  </table>

  <p class="legend">
    <b>成功の意味:</b> Worker が返す各 surface のレスポンスに、期待した directive が実際に付与されている
    （<code>/admin*</code> と <code>/api/v1/auth*</code> は <code>'none'</code>、公開 surface は <code>'self'</code>）。
    lookalike 経路（<code>/administrator</code>, <code>/api/v1/authentication</code>）は拒否を継承しない。
    Tool shell は同一 origin の artifact を iframe で読み込む状態のまま。
    <b>拒否の意味:</b> gate が fixture を弾いた = その変更は「拒否される入力」。<code>'none'</code> を Tool artifact に
    書くと全 Tool の iframe が mount されない（shell は描画される）、<code>*</code> を書くと第三者埋め込みが再度開く。
    <code>public/</code> 配下の HTML に <code>_headers</code> ルールが無い場合も拒否される。Static Assets が Worker より先に
    返すため、<code>src/server.ts</code> の <code>'self'</code> 既定値は <code>/share/*</code> には届かない。
  </p>

  <footer>my-web-2026 · Issue #448 · report generated locally from the workerd test pool + static gate by scripts/make-frame-ancestors-report.mjs (no CI token, no production origin) · committed as docs/verification/security/frame-ancestors-test.webp (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
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
		viewport: { width: 1280, height: 1500 },
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

const report = runSuite();
const gate = runStaticGate();
writeFileSync(HTML_REPORT, render(report, gate));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
const info = await shoot(HTML_REPORT, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
