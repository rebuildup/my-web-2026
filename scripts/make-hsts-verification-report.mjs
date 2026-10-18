#!/usr/bin/env node

/**
 * Verification report generator for Issue #446.
 *
 * Runs the HSTS contract suite with Vitest's JSON reporter, runs the
 * static policy gate, renders the result as a static HTML page (a "CI
 * report" view) at `.tmp/hsts-report.html`, and screenshots that page with
 * the Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/hsts-response.webp` — the path Issue #446
 * requires in the PR body, with the `.webp` extension substituted for
 * the Issue's literal `.png` (the PNG of this report was roughly twice
 * the size for no evidentiary gain; the exact size is reported per
 * commit in the PR body rather than hard-coded here, so this comment
 * cannot drift on regeneration).
 *
 * The directive shown in the report is READ FROM `src/server.ts` by the
 * same function the gate uses (`readCanonicalDirective`), so the report
 * cannot advertise a value the runtime does not ship.
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the capture is
 * taken into a Buffer and re-encoded with the existing `sharp`
 * devDependency as `resize({ width: 1600, withoutEnlargement: true })`
 * followed by `webp({ quality: 80 })`. No intermediate PNG is written to disk
 * (`sharp` only sees the in-memory Buffer), and the target extension is
 * asserted to be `.webp` so a PNG can never drift back into `docs/`.
 * `sharp` stays a devDependency and is never imported by the Worker / SSR.
 *
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper. It reads no
 * secret and touches no production resource: the suite runs in the local
 * workerd pool with the test-only dummy bindings from `vitest.config.ts`,
 * and nothing here makes a network call.
 *
 *   node scripts/make-hsts-verification-report.mjs
 *   pnpm run verify:hsts-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCanonicalDirective, runGate } from './check-hsts-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'hsts-results.json');
const HTML_REPORT = join(TMP, 'hsts-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/hsts-response.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;

const SUITE = 'test/integration/hsts-transport-security.test.ts';

/**
 * The contract each test pins. `match` is a substring of the Vitest test
 * title; a case whose title is absent is reported as MISSING rather than
 * silently dropped, so a renamed test cannot quietly delete a row.
 */
const CASES = [
	[
		'positive',
		'HTTPS で届いた SSR ドキュメント',
		'1 個の意図した値だけを持つ',
		'https https://rebuildup.test/contact carries the intended HSTS directive',
	],
	[
		'positive',
		'HTTPS で届いた外部境界 /api/v1/health',
		'1 個の意図した値だけを持つ',
		'https https://rebuildup.test/api/v1/health carries the intended HSTS directive',
	],
	[
		'positive',
		'HTTPS で届いた認証リダイレクト（/admin → /admin/login）',
		'body / content-type が無くても 1 個だけ持つ',
		'https https://rebuildup.test/admin carries the intended HSTS directive',
	],
	[
		'positive',
		'HTML と JSON で dispatch 分岐が違うこと',
		'両分岐とも 1 個だけ持つ',
		'covers a document and a JSON response on different dispatch branches',
	],
	[
		'negative',
		'http で届いた SSR ドキュメント',
		'ヘッダー 0 個（RFC 6797 §7.2）',
		'a plaintext http request to the SSR document carries no HSTS header',
	],
	[
		'negative',
		'http で届いた外部境界',
		'ヘッダー 0 個（RFC 6797 §7.2）',
		'a plaintext http request to the external boundary carries no HSTS header',
	],
	[
		'negative',
		'HTTPS 応答（3 surface すべて）',
		'includeSubDomains を含まない',
		'carries no includeSubDomains directive',
	],
	[
		'negative',
		'HTTPS 応答（3 surface すべて）',
		'preload を含まない',
		'carries no preload directive',
	],
];

/** Surfaces the runtime suite exercises, and what each one must show. */
const SURFACES = [
	['SSR ドキュメント', '/contact', 'https', '意図した値を 1 個'],
	['外部境界 (Hono)', '/api/v1/health', 'https', '意図した値を 1 個'],
	['認証リダイレクト', '/admin → /admin/login', 'https', '意図した値を 1 個'],
	['SSR ドキュメント', '/contact', 'http', 'ヘッダーなし'],
	['外部境界 (Hono)', '/api/v1/health', 'http', 'ヘッダーなし'],
	['Static Assets', '/assets/*', '—', 'Worker の対象外（`_headers` の責務）'],
];

/** Why the two scope directives stay off, in the terms a reviewer checks. */
const PRECONDITIONS = [
	[
		'includeSubDomains',
		'zone 配下の全ホストへ拡張する',
		'HTTPS 応答できないサブドメインが 1 つでもあれば、そのホストは max-age の間だけ到達不能になる',
		'サブドメインごとの HTTPS 到達性監査（docs/security.md に記録）',
		'未実施 → 付けない',
	],
	[
		'preload',
		'browser preload list へ登録する',
		'取り下げに月単位を要する。申請しない限り risk だけが残る',
		'ブラウザ preload list への申請判断',
		'未実施 → 付けない',
	],
];

/** Deliberately not claimed by this Issue. */
const UNOBSERVED = [
	'Cloudflare zone 設定（Always Use HTTPS / Edge Certificates → HSTS / Minimum TLS）— dashboard 側の状態でありリポジトリから観測できない。本 Issue は変更も観測もしない',
	'本番 canonical origin の実測値 — 破壊的操作に触れないという受け入れ条件のため証跡に含めない。実測は e2e/prod-smoke.spec.ts の read-only GET（手動）',
	'サブドメイン（media.rebuildup.dev など）の HTTPS 対応状況 — 未監査',
];

function run() {
	mkdirSync(TMP, { recursive: true });
	execFileSync(
		'pnpm',
		['exec', 'vitest', 'run', SUITE, '--reporter=json', `--outputFile=${JSON_REPORT}`],
		{
			cwd: ROOT,
			stdio: 'inherit',
		},
	);
	return JSON.parse(readFileSync(JSON_REPORT, 'utf8'));
}

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function render(report, directive, gate) {
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

	const statusOf = (match) => {
		const hit = assertions.find((test) => test.title.includes(match));
		if (!hit) return 'missing';
		return hit.status === 'passed' ? 'pass' : hit.status;
	};

	const caseRows = CASES.map(([kind, subject, expectation, match]) => {
		const status = statusOf(match);
		return `<tr class="${escapeHtml(status)}">
    <td class="kind">${escapeHtml(kind)}</td>
    <td>${escapeHtml(subject)}</td>
    <td>${escapeHtml(expectation)}</td>
    <td class="status">${status === 'pass' ? 'PASS' : status === 'missing' ? 'MISSING' : escapeHtml(status.toUpperCase())}</td>
  </tr>`;
	}).join('\n');

	const surfaceRows = SURFACES.map(
		([label, path, scheme, expected]) =>
			`<tr><td>${escapeHtml(label)}</td><td><code>${escapeHtml(path)}</code></td><td><code>${escapeHtml(scheme)}</code></td><td>${escapeHtml(expected)}</td></tr>`,
	).join('\n');

	const preconditionRows = PRECONDITIONS.map(
		([directiveName, effect, risk, precondition, status]) =>
			`<tr><td><code>${escapeHtml(directiveName)}</code></td><td>${escapeHtml(effect)}</td><td>${escapeHtml(risk)}</td><td>${escapeHtml(precondition)}</td><td class="off">${escapeHtml(status)}</td></tr>`,
	).join('\n');

	const unobservedList = UNOBSERVED.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n');

	const testRows = assertions
		.map(
			(test) => `<tr class="${escapeHtml(test.status)}">
    <td class="status">${test.status === 'passed' ? 'PASS' : escapeHtml(test.status.toUpperCase())}</td>
    <td>${escapeHtml(test.title)}</td>
    <td class="ms">${test.ms} ms</td>
  </tr>`,
		)
		.join('\n');

	const gateCard = gate.violations.length === 0 ? 'OK' : `${gate.violations.length} violation(s)`;

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>HTTPS 強制 / HSTS — Issue #446</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 20px; font-size: 13px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 150px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 22px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .bad { color: #a12020; }
  .hdr { border: 1px solid #dedcd2; background: #fff; padding: 14px 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .hdr .name { color: #5a5a4e; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 90px; }
  .kind { width: 90px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.06em; color: #77776a; }
  tr.pass .status, tr.passed .status { color: #1c6b3a; }
  tr.fail .status, tr.failed .status, tr.missing .status { color: #a12020; }
  .off { white-space: nowrap; color: #a12020; font-weight: 600; }
  .ms { text-align: right; color: #77776a; width: 80px; }
  ul { margin: 0; padding-left: 20px; color: #3d3d33; }
  li { margin-bottom: 4px; }
  .legend { margin-top: 8px; color: #3d3d33; font-size: 13px; }
  .legend b { color: #14140f; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>HTTPS 強制 / HSTS 配信ポリシー — Issue #446</h1>
  <p class="sub">local worker (workerd pool) で <code>test/integration/hsts-transport-security.test.ts</code> を実行した結果と、静的 gate <code>scripts/check-hsts-policy.mjs</code> の判定。secret は含まれない（binding は test 用 dummy、ネットワークアクセスなし、本番 D1/R2・CI token には触れていない）。</p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v">${failed}</div></div>
    <div class="card"><div class="k">static gate</div><div class="v ${gate.violations.length === 0 ? 'ok' : 'bad'}">${escapeHtml(gateCard)}</div></div>
    <div class="card"><div class="k">duration</div><div class="v">${durationMs}<span style="font-size:13px"> ms</span></div></div>
  </div>

  <h2>意図したポリシー（src/server.ts の HSTS_DIRECTIVE から読む）</h2>
  <div class="hdr"><span class="name">Strict-Transport-Security: </span>${escapeHtml(directive ?? '(declaration なし)')}</div>

  <h2>positive / negative ケース</h2>
  <table>
    <thead><tr><th style="width:90px">kind</th><th style="width:330px">対象</th><th>期待結果</th><th style="width:90px">result</th></tr></thead>
    <tbody>
${caseRows}
    </tbody>
  </table>

  <h2>到達経路ごとの扱い</h2>
  <table>
    <thead><tr><th style="width:200px">surface</th><th style="width:220px">path</th><th style="width:70px">scheme</th><th>期待</th></tr></thead>
    <tbody>
${surfaceRows}
    </tbody>
  </table>

  <h2>includeSubDomains / preload を付けない理由（監査前の gate）</h2>
  <table>
    <thead><tr><th style="width:150px">directive</th><th style="width:190px">効果</th><th>リスク</th><th style="width:250px">前提</th><th style="width:120px">現状</th></tr></thead>
    <tbody>
${preconditionRows}
    </tbody>
  </table>

  <h2>観測していないもの（捏造しない）</h2>
  <ul>
${unobservedList}
  </ul>

  <h2>実行結果</h2>
  <table>
    <thead><tr><th style="width:90px">result</th><th>test</th><th style="width:80px">time</th></tr></thead>
    <tbody>
${testRows}
    </tbody>
  </table>

  <p class="legend">
    <b>PASS の意味:</b> HTTPS で届いた応答は意図した directive を <b>ちょうど 1 つ</b>持ち、SSR ドキュメント・外部境界 JSON・認証リダイレクトの 3 分岐すべてに載る。http で届いた応答には 1 つも付かない（RFC 6797 §7.2）。値に <code>includeSubDomains</code> / <code>preload</code> は含まれない。
    <b>静的 gate の意味:</b> directive の宣言は <code>src/server.ts</code> の 1 箇所だけ、<code>max-age</code> は許可域（1 日〜2 年）内、コード内の他のリテラルとも一致。
  </p>

  <footer>my-web-2026 · Issue #446 · report generated locally from the workerd test pool by scripts/make-hsts-verification-report.mjs (no CI token, no production D1/R2, no network) · committed as docs/verification/security/hsts-response.webp (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
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

const report = run();
const { directive } = readCanonicalDirective();
const gate = runGate();
writeFileSync(HTML_REPORT, render(report, directive, gate));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
const info = await shoot(HTML_REPORT, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
