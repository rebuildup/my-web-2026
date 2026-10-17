#!/usr/bin/env node
/**
 * Regenerate the Issue #457 verification screenshot.
 *
 *   docs/verification/security/error-redaction-page.png
 *
 * What it does, in order:
 *
 *   1. Runs `test/integration/error-redaction.test.ts` in the local
 *      workerd pool. That suite drives the REAL external boundary —
 *      real request-id middleware, real auth middleware, real rate
 *      limit binding, real D1 — and asserts the redaction contract
 *      for accepted, rejected, and failed requests.
 *   2. Reads the `[capture]` lines the suite prints. Each is one
 *      client-visible response: status, body, correlation id, and
 *      the result of scanning the body for forbidden substrings
 *      (`SQLITE_ERROR`, table names, secret names, `.ts:` stack
 *      frames, …).
 *   3. Renders those responses as a static HTML report in `.tmp/`
 *      and screenshots it with the installed Playwright chromium.
 *
 * Safety: nothing here reads a secret. The suite authenticates with
 * a literal stub key (`mk_home_capture_stub`) through the DI seam in
 * `src/http/api-keys/middleware.ts`, and only statuses, bodies, and
 * correlation ids are rendered. No env var, no `.dev.vars`, no
 * Worker secret is opened.
 *
 * Usage:
 *   node scripts/capture-error-redaction-report.mjs
 *   node scripts/capture-error-redaction-report.mjs --skip-tests   # re-render only
 *
 * Exit codes: 0 = screenshot written, 1 = the suite failed, a case
 * leaked a forbidden substring, or the screenshot could not be taken.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const TEST_FILE = 'test/integration/error-redaction.test.ts';
const CAPTURE_PREFIX = '[capture]';
const HTML_PATH = resolve(repoRoot, '.tmp/error-redaction-report.html');
const SCREENSHOT_PATH = resolve(repoRoot, 'docs/verification/security/error-redaction-page.png');

const MEANING_LABELS = {
	accepted: {
		label: '成功 (accepted)',
		tone: '#0f766e',
		note: '有効な入力。公開契約どおりのレスポンスを返す。',
	},
	rejected: {
		label: '拒否 (rejected)',
		tone: '#b45309',
		note: '拒否された入力。stable code のみで理由を返す。',
	},
	failed: {
		label: '失敗・秘匿 (failed)',
		tone: '#b91c1c',
		note: '内部エラー。stack / SQL / secret / binding 名を出さない。',
	},
};

/** Run the verification suite and return its captured cases. */
export function runVerificationSuite(skipTests) {
	if (skipTests) return [];
	// `pnpm exec` resolves the vitest bin through the package
	// manager's own layout, so this documented `pnpm run` entry point
	// keeps working if the store layout changes (the previous
	// hard-coded `node node_modules/vitest/vitest.mjs` path only works
	// because pnpm hoists that entry there).
	const result = spawnSync(
		'pnpm',
		['exec', 'vitest', 'run', TEST_FILE, '--disableConsoleIntercept'],
		{
			cwd: repoRoot,
			encoding: 'utf8',
		},
	);
	const stdout = `${result.stdout ?? ''}`;
	if (result.status !== 0) {
		process.stderr.write(`${stdout}\n`);
		throw new Error(`${TEST_FILE} failed (exit ${result.status})`);
	}
	const cases = [];
	for (const line of stdout.split('\n')) {
		const index = line.indexOf(CAPTURE_PREFIX);
		if (index === -1) continue;
		cases.push(JSON.parse(line.slice(index + CAPTURE_PREFIX.length)));
	}
	if (cases.length === 0) throw new Error('no [capture] lines in the suite output');
	return cases;
}

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderBody(body) {
	return escapeHtml(JSON.stringify(body, null, 2))
		.split('\n')
		.join('\n');
}

/** Render the verification report as a standalone HTML document. */
export function renderHtml(cases) {
	const rows = cases
		.map((entry) => {
			const meaning = MEANING_LABELS[entry.meaning] ?? MEANING_LABELS.failed;
			const clean = entry.leaked.length === 0;
			return `<section class="case">
  <header>
    <span class="pill" style="background:${meaning.tone}">${meaning.label}</span>
    <span class="status">HTTP ${entry.status}</span>
    <span class="req">${escapeHtml(entry.request)}</span>
  </header>
  <p class="case-name">${escapeHtml(entry.case)}</p>
  <p class="note">${meaning.note}</p>
  <div class="grid">
    <div><h3>クライアントが見るレスポンス</h3><pre>${renderBody(entry.body)}</pre></div>
    <div>
      <h3>相関ID</h3>
      <pre>${escapeHtml(entry.request_id ?? '(none)')}</pre>
      <h3>秘匿チェック</h3>
      <pre class="${clean ? 'ok' : 'ng'}">${
				clean
					? 'internal leak patterns: 0 件\nstack / SQL / secret / binding 名の流出なし'
					: `LEAK: ${entry.leaked.join(', ')}`
			}</pre>
    </div>
  </div>
</section>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>公開API エラー秘匿検証 — Issue #457</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; background: #f6f5f2; color: #1c1917;
         font-family: "Helvetica Neue", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: 0.01em; }
  h2 { font-size: 17px; margin: 36px 0 4px; }
  h3 { font-size: 12px; margin: 0 0 6px; color: #57534e; letter-spacing: 0.08em; text-transform: uppercase; }
  p { margin: 0 0 6px; }
  .lead { font-size: 14px; color: #44403c; max-width: 1100px; line-height: 1.7; }
  .legend { display: flex; gap: 18px; margin: 18px 0 26px; font-size: 13px; }
  .legend div { display: flex; align-items: center; gap: 8px; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .case { background: #fff; border: 1px solid #e7e5e4; border-radius: 10px; padding: 18px 20px; margin-bottom: 18px; }
  .case header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .pill { color: #fff; font-size: 12px; padding: 3px 10px; border-radius: 999px; }
  .status { font-size: 13px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .req { font-size: 13px; color: #57534e; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .case-name { font-size: 15px; font-weight: 600; }
  .note { font-size: 12px; color: #78716c; }
  .grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; margin-top: 12px; }
  pre { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px;
        font-size: 12px; line-height: 1.55; margin: 0; white-space: pre-wrap; word-break: break-all;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre.ok { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
  pre.ng { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
  footer { margin-top: 28px; font-size: 12px; color: #78716c; line-height: 1.8;
           border-top: 1px solid #e7e5e4; padding-top: 14px; }
</style>
</head>
<body>
  <h1>公開API エラー秘匿検証</h1>
  <p class="lead">Issue #457 — ローカル workerd 上で実際の外部HTTP境界 (<code>src/http/hono.ts</code>) と、
  公開 server function の実SSR画面 (<code>/portfolio</code> / <code>/about</code> / <code>/</code>) を駆動した結果。
  成功・拒否・内部失敗のそれぞれについて、クライアントへ出るレスポンスだけを表示している。
  同じ相関IDが内部ログにも記録されるため、利用者が報告した request_id から Worker ログを追える。</p>
  <div class="legend">
    <div><span class="swatch" style="background:#0f766e"></span>成功: 公開契約どおり</div>
    <div><span class="swatch" style="background:#b45309"></span>拒否: stable code のみ</div>
    <div><span class="swatch" style="background:#b91c1c"></span>失敗: 内部情報を秘匿</div>
  </div>
  ${rows}
  <footer>
    生成: <code>node scripts/capture-error-redaction-report.mjs</code>（<code>${TEST_FILE}</code> の実行結果をそのまま表示）<br>
    撮影対象に secret は含まれない（認証は DI seam の固定スタブキー、実運用 credential には触れない）。<br>
    保持する契約: HTTP 5xx は <code>error</code> / <code>message</code> / <code>request_id</code> のみ、
    server function の失敗画面 (<code>/portfolio</code>・<code>/about</code>) は <code>portfolio_unavailable (ref)</code> のみ、
    <code>/</code> の widget 入力失敗は縮退表示。
    stack・SQL・secret 名・binding 名は内部ログに閉じる。
  </footer>
</body>
</html>
`;
}

async function shoot() {
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		await page.goto(`file://${HTML_PATH}`);
		await page.waitForLoadState('load');
		mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
		await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
	} finally {
		await browser.close();
	}
}

async function main() {
	const skipTests = process.argv.includes('--skip-tests');
	const cases = runVerificationSuite(skipTests);
	const leaking = cases.filter((entry) => entry.leaked.length > 0);
	if (leaking.length > 0) {
		for (const entry of leaking) {
			process.stderr.write(`LEAK in ${entry.case}: ${entry.leaked.join(', ')}\n`);
		}
		throw new Error('a captured response carried internal detail');
	}
	if (!skipTests) {
		mkdirSync(dirname(HTML_PATH), { recursive: true });
		writeFileSync(HTML_PATH, renderHtml(cases));
		await shoot();
	}
	process.stdout.write(`[capture] ${cases.length} cases, 0 leaks\n`);
	process.stdout.write(`[capture] screenshot: ${SCREENSHOT_PATH}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().catch((error) => {
		process.stderr.write(`${error.message}\n`);
		process.exit(1);
	});
}
