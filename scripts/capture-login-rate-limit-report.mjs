#!/usr/bin/env node

/**
 * Capture the login-throttle verification artefact (Issue #443).
 *
 * The table is **measured**, not declared: it is printed by
 * `test/integration/auth-login-hardening.test.ts`, which drives real HTTP
 * requests through the production `externalBoundary` inside the local
 * workerd pool against the local Miniflare D1. This script runs that
 * suite, extracts the matrix it prints, renders it as a self-contained
 * HTML report (a "CI report" view), and screenshots it with the
 * Playwright Chromium the E2E suite already uses.
 *
 * Safety posture: the suite prints status codes, Better Auth error codes,
 * and the retry hint — nothing else. This script refuses to render a row
 * that looks like a credential, and the refusal itself reports only the
 * row number: the rejected cell may *be* the credential, so echoing it
 * would copy the leak into the terminal and into whatever CI log
 * captured that terminal. The suite itself asserts that no email,
 * password, or address reached the block. Nothing here reads a
 * secret, a real credential, or a deployed environment.
 *
 * For the same reason a *failed* suite is reported by exit code only:
 * a failing assertion (for example the suite's own
 * `not.toContain(credential)`) makes Vitest print the received value in
 * its diagnostics, so replaying the child's raw output here would put
 * exactly the value the capture exists to exclude into stderr and the
 * CI log. Operators re-run the suite directly when they need details.
 *
 * The Chromium screenshot is taken as PNG (lossless raster) and then
 * **converted to WebP** before it is committed: the artefact is a flat
 * page of text, which WebP q80 encodes at a fraction of the PNG size
 * with no visible loss, and a committed screenshot must not bloat the
 * repository. The PNG intermediate stays in `.tmp/` (gitignored) and is
 * deleted after the conversion.
 *
 * Output: `docs/verification/security/login-rate-limit.webp`
 * Scratch: `.tmp/login-rate-limit-report.html`,
 *         `.tmp/login-rate-limit-report.png`,
 *         `.tmp/login-rate-limit-report.webp` (all gitignored, ephemeral).
 *         The encoded WebP is written to the scratch path first and moved
 *         into place only after the size ceiling passes, so an over-limit
 *         run can never leave an over-budget file in `docs/`.
 *
 * Usage:
 *   pnpm run verification:login-rate-limit
 *
 * Exits non-zero when the suite fails, when the matrix is empty, when a
 * row would leak a credential into the artefact, or when the encoded
 * artefact exceeds `MAX_ARTEFACT_BYTES`.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = 'test/integration/auth-login-hardening.test.ts';
const START = '<!-- login-rate-limit-matrix:start -->';
const END = '<!-- login-rate-limit-matrix:end -->';
export const OUTPUT = 'docs/verification/security/login-rate-limit.webp';
const SCRATCH_HTML = '.tmp/login-rate-limit-report.html';
const SCRATCH_PNG = '.tmp/login-rate-limit-report.png';
const SCRATCH_WEBP = '.tmp/login-rate-limit-report.webp';

/**
 * Chromium viewport for the capture. The committed artefact is exactly
 * this wide (the page is rendered at it and `withoutEnlargement` never
 * upscales), so the encode width below is derived from it rather than
 * being an independent constant that could disagree.
 */
export const CAPTURE_VIEWPORT = Object.freeze({ width: 1280, height: 900 });

/** Encoding contract for the committed artefact (see the header). */
export const ARTEFACT_ENCODE_OPTIONS = Object.freeze({
	width: CAPTURE_VIEWPORT.width,
	quality: 80,
});
/** Hard ceiling so a bigger matrix cannot quietly bloat the repository. */
export const MAX_ARTEFACT_BYTES = 300 * 1024;

/**
 * Anything matching these must never reach a committed artefact.
 *
 * The measured rows legitimately contain the word `X-Retry-After` and
 * Better Auth's `INVALID_EMAIL_OR_PASSWORD`, neither of which matches.
 * The guard is a backstop for the *inputs* of the render step — a future
 * suite edit that starts printing a token or a session cookie fails the
 * capture instead of quietly committing it.
 */
const SECRET_PATTERNS = [/bearer\s/i, /mk_[a-z0-9_]+/i, /secret/i, /token/i, /set-cookie/i];

/**
 * The row that would leak a credential into the artefact, if any.
 * Exported so the guard is unit-tested rather than only observable by
 * running the whole capture.
 */
export function findSecretRow(rows) {
	return rows.find((row) => SECRET_PATTERNS.some((pattern) => pattern.test(JSON.stringify(row))));
}

/**
 * The refusal line printed when the guard rejects a row.
 *
 * Only the row **number** is reported. The rejected cell may itself be
 * the credential the guard exists to keep out of the artefact, so
 * interpolating it into the message would re-emit the leak on stderr —
 * into the terminal, and into whatever CI log captured that terminal.
 * (`capture-api-key-scope-matrix.mjs` already refuses the same way.)
 * Exported so "the refusal does not echo the row" is unit-testable
 * rather than only observable by running the whole capture.
 */
export function refusalMessage(row) {
	return `[login-rate-limit] refusing to render row ${row.index} — it matches credential-shaped material (row content not echoed)\n`;
}

/**
 * The line printed when the suite exits non-zero.
 *
 * The child's stdout/stderr is deliberately **not** replayed: a failing
 * assertion can echo the received value in Vitest's diagnostics, so
 * forwarding `output` would leak the credential the suite is proving
 * stays out of the report. Only the exit code is reported; the operator
 * can re-run the suite directly to inspect the failure. Exported so the
 * "no raw output on failure" contract is unit-testable.
 */
export function failureMessage(code) {
	return `[login-rate-limit] the suite exited with code ${code}; raw output withheld (it can echo credential material) — re-run \`pnpm exec vitest run ${TEST_FILE}\` to inspect\n`;
}

/** Printed when the suite passed but never emitted the measurement block. */
export const MISSING_MATRIX_MESSAGE =
	'[login-rate-limit] the suite printed no matrix block; raw output withheld (it can echo credential material)\n';

export function runVitest() {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn('pnpm', ['exec', 'vitest', 'run', '--reporter=verbose', TEST_FILE], {
			cwd: repoRoot,
			env: process.env,
		});
		let output = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
		});
		child.stderr.on('data', (chunk) => {
			output += chunk;
		});
		child.on('error', rejectPromise);
		child.on('close', (code) => resolvePromise({ code, output }));
	});
}

/**
 * Extract the Markdown table the suite prints between the markers.
 *
 * Only the lines between the markers are kept; whatever the test runner
 * interleaved around them is irrelevant, because `parseRows` recognises
 * a row by its own shape (see below) rather than by its position.
 */
export function extractTable(output) {
	const start = output.indexOf(START);
	const end = output.indexOf(END);
	if (start === -1 || end === -1) return null;
	return output
		.slice(start + START.length, end)
		.split('\n')
		.map((line) => line.trim())
		.join('\n')
		.trim();
}

const escapeHtml = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Column count of the measured matrix. */
const COLUMN_COUNT = 5;

/**
 * The five cells of a matrix row, or `null` when the line is not one.
 *
 * A row is recognised by its **tail**: five `|`-separated cells closed by
 * a trailing `|`. Reading from the end rather than the start is what
 * makes this immune to the test runner's own `stdout | <file> > <name>`
 * chatter — that prefix is simply part of the discarded head. Cells never
 * contain `|`, which the suite's fixed vocabulary guarantees.
 */
export function parseCells(line) {
	const parts = line.split('|');
	if (parts.length < COLUMN_COUNT + 1) return null;
	if ((parts.at(-1) ?? '').trim() !== '') return null;
	return parts.slice(parts.length - COLUMN_COUNT - 1, parts.length - 1).map((cell) => cell.trim());
}

/**
 * Markdown rows → structured rows. The first row is the header; a
 * Markdown separator row is optional (the suite prints one, but a
 * missing separator must not silently drop the first measurement).
 *
 * `index` is the row number, added here rather than in the printed table
 * so the measured output stays exactly what the suite observed.
 */
export function parseRows(table) {
	const rows = [];
	for (const line of table.split('\n')) {
		const cells = parseCells(line.trim());
		if (cells === null) continue;
		if (rows.length === 0 && cells[0] === 'endpoint') continue; // header
		if (/^:?-{3,}:?$/.test(cells[0] ?? '')) continue; // separator
		rows.push({
			index: String(rows.length + 1),
			endpoint: cells[0] ?? '',
			input: cells[1] ?? '',
			status: cells[2] ?? '',
			code: cells[3] ?? '',
			retryAfter: cells[4] ?? '',
		});
	}
	return rows;
}

export function renderHtml(rows) {
	const body = rows
		.map((row) => {
			const status = Number(row.status);
			const tone = status >= 200 && status < 300 ? 'ok' : status === 429 ? 'throttle' : 'reject';
			const cell = (value) => (value === '—' ? '<span class="muted">—</span>' : escapeHtml(value));
			return `<tr class="${tone}">
				<td class="num">${escapeHtml(row.index)}</td>
				<td><code>${escapeHtml(row.endpoint)}</code></td>
				<td>${escapeHtml(row.input)}</td>
				<td class="status">${cell(row.status)}</td>
				<td>${row.code === '—' ? '<span class="muted">—</span>' : `<code>${cell(row.code)}</code>`}</td>
				<td>${cell(row.retryAfter)}</td>
			</tr>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>ログイン列挙・総当たり防御の検証レポート — Issue #443</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.6 "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
         margin: 0; padding: 32px; background: #ffffff; color: #111111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { margin: 0 0 20px; color: #444444; max-width: 92ch; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  caption { text-align: left; padding-bottom: 8px; color: #444444; }
  th, td { border-bottom: 1px solid #d8d8d8; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; }
  td.num { width: 28px; color: #666666; text-align: right; }
  td.status { width: 64px; font-weight: 600; }
  code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f2f2f2;
         padding: 1px 4px; border-radius: 3px; }
  tr.ok .status { color: #0a6b2d; }
  tr.reject .status { color: #8a4b00; }
  tr.throttle .status { color: #7a1fa2; }
  .muted { color: #888888; }
  .legend { margin-top: 20px; border: 1px solid #d8d8d8; padding: 12px 14px; max-width: 108ch; }
  .legend h2 { font-size: 14px; margin: 0 0 6px; }
  .legend ul { margin: 0; padding-left: 18px; }
  footer { margin-top: 16px; color: #666666; font-size: 12px; }
</style>
</head>
<body>
  <h1>ログイン列挙・総当たり防御の検証レポート — Issue #443</h1>
  <p class="lede">各行はローカル workerd プールの中で本番 <code>externalBoundary</code> に流した
  <strong>実 HTTP リクエスト</strong>の応答から読み取った値である（ローカル Miniflare D1、
  RFC 5737 の合成クライアント IP）。資格情報は一切含まれない — 描画するのは status と
  Better Auth の error code、retry ヒントのみ。予算はクライアント IP ごとに
  <strong>3 回 / 10 秒</strong>（<code>src/cloudflare/auth/better-auth.ts</code> で明示固定）。</p>
  <table>
    <caption><code>${escapeHtml(TEST_FILE)}</code> — ${rows.length} ケース</caption>
    <thead><tr>
      <th>#</th><th>エンドポイント</th><th>入力 / 条件</th><th>status</th><th>error</th><th>X-Retry-After</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <div class="legend">
    <h2>この表の読み方</h2>
    <ul>
      <li><strong>200（1 行目 / 最終行）</strong> — 正しい資格情報。否定ケースが「常に 401」でないことの担保であり、セッション cookie が発行される。</li>
      <li><strong>401 <code>INVALID_EMAIL_OR_PASSWORD</code></strong> — 失敗。<strong>既存アカウントの誤パスワードと存在しないアカウントの尝试は完全に同一</strong>
          （status・body・ヘッダー集合まで一致）なので、アカウントの存在を列挙できない。</li>
      <li><strong>401 → 429（バースト行）</strong> — 同一クライアント IP から 4 回目で上限に達し、
          <code>X-Retry-After</code>（秒）が付く。上限は資格情報の検証<strong>前</strong>に評価されるため、
          429 は存在の有無を漏らさない。</li>
      <li><strong>429（正しいパスワードでも）</strong> — 制限中は正しい資格情報でも 429。throttle が存在判定の lever にならないことの担保。</li>
      <li>client IP はリクエストごとに合成値を使い分ける。バーストだけが意図的に同一 IP を共有する
          （=「クライアント IP 単位」の意味そのもの）。上限は per-client なので、攻撃者が他クライアントや
          運用者をロックアウトする lever にはならない。</li>
      <li>429 の body には <code>code</code> が無く汎用メッセージのみ。これは列挙の観点では好ましいが、
          機械可読なコードを期待する consumer は存在しない。</li>
    </ul>
  </div>
  <footer>再生成: <code>pnpm run verification:login-rate-limit</code> ／ 運用契約:
  <code>docs/security/login-enumeration-rate-limit.md</code></footer>
</body>
</html>
`;
}

async function main() {
	const { code, output } = await runVitest();
	if (code !== 0) {
		process.stderr.write(failureMessage(code));
		return 1;
	}

	const table = extractTable(output);
	if (!table) {
		process.stderr.write(MISSING_MATRIX_MESSAGE);
		return 1;
	}

	const rows = parseRows(table);
	if (rows.length === 0) {
		process.stderr.write('[login-rate-limit] the matrix table is empty\n');
		return 1;
	}

	const leak = findSecretRow(rows);
	if (leak) {
		process.stderr.write(refusalMessage(leak));
		return 1;
	}

	const html = renderHtml(rows);
	mkdirSync(dirname(resolve(repoRoot, SCRATCH_HTML)), { recursive: true });
	writeFileSync(resolve(repoRoot, SCRATCH_HTML), html, 'utf8');

	const { chromium } = await import('@playwright/test');
	const shot = resolve(repoRoot, SCRATCH_PNG);
	mkdirSync(dirname(shot), { recursive: true });
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT } });
		await page.goto(`file://${resolve(repoRoot, SCRATCH_HTML)}`);
		await page.waitForLoadState('load');
		await page.screenshot({ path: shot, fullPage: true });
	} finally {
		await browser.close();
	}

	// PNG (raster) -> WebP (committed).
	const { default: sharp } = await import('sharp');
	const encoded = resolve(repoRoot, SCRATCH_WEBP);
	mkdirSync(dirname(encoded), { recursive: true });
	// `withoutEnlargement` keeps the capture at its own capture-width CSS
	// px (see CAPTURE_VIEWPORT), so the artefact is never upscaled.
	const info = await sharp(shot)
		.resize({ width: ARTEFACT_ENCODE_OPTIONS.width, withoutEnlargement: true })
		.webp({ quality: ARTEFACT_ENCODE_OPTIONS.quality })
		.toFile(encoded);
	rmSync(shot, { force: true });

	if (info.size > MAX_ARTEFACT_BYTES) {
		// Fail safe: the over-limit encode stays in `.tmp/` and the
		// previously committed artefact is left untouched.
		rmSync(encoded, { force: true });
		const limit = `[login-rate-limit] ${OUTPUT} is ${info.size} bytes (> ${MAX_ARTEFACT_BYTES});`;
		const advice =
			'lower ARTEFACT_ENCODE_OPTIONS.quality or narrow the report instead of committing it\n';
		process.stderr.write(`${limit} ${advice}`);
		return 1;
	}

	// Only an artefact inside the ceiling reaches the committed path.
	const target = resolve(repoRoot, OUTPUT);
	mkdirSync(dirname(target), { recursive: true });
	renameSync(encoded, target);

	process.stdout.write(
		`[login-rate-limit] wrote ${OUTPUT} (${rows.length} cases, ` +
			`${info.width}x${info.height} webp q${ARTEFACT_ENCODE_OPTIONS.quality}, ${info.size} bytes)\n`,
	);
	return 0;
}

// Only run the capture when executed directly; the unit test imports
// the pure helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await main());
}
