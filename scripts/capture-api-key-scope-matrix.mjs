#!/usr/bin/env node

/**
 * Capture the API key scope / revocation matrix artefact (Issue #442).
 *
 * The matrix is **measured**, not declared: it is printed by
 * `test/integration/api-key-scope.test.ts`, which mints real keys with
 * `auth.api.createApiKey` against the local Miniflare D1 binding and
 * drives real requests through the Worker entry (`src/server.ts` →
 * Hono `externalBoundary`). This script runs that suite, extracts the
 * table it prints, renders it as a self-contained HTML report, and
 * screenshots it with the Playwright Chromium the E2E suite already
 * uses.
 *
 * Output: `docs/verification/security/api-key-scope-matrix.webp`
 * Scratch: `.tmp/api-key-scope-matrix.html` (gitignored, ephemeral)
 *
 * Usage:
 *   pnpm run verification:api-key-scope
 *
 * Playwright cannot encode WebP, so the page is screenshotted into a
 * Buffer and re-encoded with the `sharp` devDependency already used by
 * `scripts/generate-counter-digits.mjs`: width-capped and moderately
 * compressed (quality 80), because a committed PNG screenshot is the
 * single largest artefact class in this repository.
 *
 * Exits non-zero when the suite fails, when the table is empty, or when
 * a row would put credential-shaped material into a committed artefact.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = 'test/integration/api-key-scope.test.ts';
const START = '<!-- api-key-scope-matrix:start -->';
const END = '<!-- api-key-scope-matrix:end -->';
const OUTPUT = 'docs/verification/security/api-key-scope-matrix.webp';
const SCRATCH_HTML = '.tmp/api-key-scope-matrix.html';

/** Artefact encoding contract (mirrored in docs/security/api-key-scope.md). */
const MAX_WIDTH_PX = 1600;
const WEBP_QUALITY = 80;

/**
 * Material that must never reach a committed artefact.
 *
 * Deliberately **shape-based, not word-based**: the table legitimately
 * contains the words "key", "token", and "revoked", so a keyword ban
 * would be useless here (and would force the table to stop describing
 * what it measures). These patterns match the shapes a credential
 * actually has:
 *
 *   - `mk_` + at least 4 key characters — an issued Better Auth key.
 *   - `Bearer` / `Basic` + a value of at least 8 characters — an
 *     Authorization header value.
 *   - 43+ base64url characters — a SHA-256 hash, i.e. what
 *     `apikey.key` stores. Showing the stored hash is not a plaintext
 *     leak, but it is a verification oracle; keep it out of the repo.
 *   - an e-mail address — operator / invitee identity.
 *
 * Every pattern is **cell-anchored**: the table legitimately contains
 * cells like `non-Bearer header`, so the guard must match a whole cell
 * rather than a substring inside a sentence.
 */
const SECRET_PATTERNS = [
	/^mk_[A-Za-z0-9]{4,}$/,
	/^(bearer|basic)\s+\S{8,}$/i,
	/^[A-Za-z0-9_-]{43,}$/,
	/^[\w.+-]+@[\w-]+\.[\w.]+$/,
];

function runVitest() {
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

/** Extract the Markdown table the suite prints between the markers. */
export function extractTable(output) {
	const start = output.indexOf(START);
	const end = output.indexOf(END);
	if (start === -1 || end === -1) return null;
	return output.slice(start + START.length, end).trim();
}

const escapeHtml = (value) =>
	String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `| a | b |` → `['a', 'b']` (inline code markers are decorative). */
function splitRow(line) {
	return line
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim().replace(/^`(.*)`$/, '$1'));
}

/** Parse the printed Markdown table into renderable rows. */
export function parseRows(table) {
	const lines = table.split('\n').filter((line) => line.trim().startsWith('|'));
	return lines.slice(2).map((line, index) => {
		const cells = splitRow(line);
		return {
			index: String(index + 1),
			fixture: cells[1] ?? '',
			request: cells[2] ?? '',
			expected: cells[3] ?? '',
			status: cells[4] ?? '',
			code: cells[5] ?? '',
		};
	});
}

/**
 * Return the first row that looks like it carries credential material,
 * or `null`. Exported so the refusal is unit-tested rather than trusted
 * — an artefact renderer that quietly starts publishing a hash is the
 * kind of regression no reviewer sees.
 */
export function findSecretRow(rows) {
	for (const row of rows) {
		for (const value of Object.values(row)) {
			const cell = String(value ?? '').trim();
			if (SECRET_PATTERNS.some((pattern) => pattern.test(cell))) return row;
		}
	}
	return null;
}

export function renderHtml(rows) {
	const body = rows
		.map((row) => {
			const status = Number(row.status);
			const tone = status >= 200 && status < 300 ? 'ok' : status === 403 ? 'scope' : 'reject';
			const code =
				row.code === '—' ? '<span class="muted">—</span>' : `<code>${escapeHtml(row.code)}</code>`;
			return `<tr class="${tone}">
				<td class="num">${escapeHtml(row.index)}</td>
				<td>${escapeHtml(row.fixture)}</td>
				<td><code>${escapeHtml(row.request)}</code></td>
				<td>${escapeHtml(row.expected)}</td>
				<td class="status">${escapeHtml(row.status)}</td>
				<td>${code}</td>
			</tr>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>API key scope / revocation matrix — Issue #442</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
         margin: 0; padding: 32px; background: #ffffff; color: #111111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { margin: 0 0 20px; color: #444444; max-width: 92ch; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  caption { text-align: left; padding-bottom: 8px; color: #444444; }
  th, td { border-bottom: 1px solid #d8d8d8; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; }
  td.num { width: 28px; color: #666666; text-align: right; }
  td.status { font-weight: 600; text-align: right; }
  code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f2f2f2;
         padding: 1px 4px; border-radius: 3px; }
  tr.ok .status { color: #0a6b2d; }
  tr.scope .status { color: #6b3c00; }
  tr.reject .status { color: #a11212; }
  .muted { color: #888888; }
  .legend { margin-top: 20px; border: 1px solid #d8d8d8; padding: 12px 14px; max-width: 110ch; }
  .legend h2 { font-size: 14px; margin: 0 0 6px; }
  .legend ul { margin: 0; padding-left: 18px; }
  footer { margin-top: 16px; color: #666666; font-size: 12px; }
</style>
</head>
<body>
  <h1>API key scope / revocation matrix — Issue #442</h1>
  <p class="lede">Every row is a real HTTP request executed against the production Worker entry
  (<code>src/server.ts</code> → Hono <code>externalBoundary</code>) inside the local workerd pool.
  Keys are minted by the real <code>auth.api.createApiKey</code> call against the local Miniflare D1
  binding — nothing on the auth path is stubbed. Status codes and <code>error</code> codes are read
  back from the responses, not copied from the contract.</p>
  <table>
    <caption><code>${escapeHtml(TEST_FILE)}</code> — ${rows.length} measured cases</caption>
    <thead><tr>
      <th>#</th><th>fixture</th><th>request</th><th>contract</th><th>status</th><th>error code</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <div class="legend">
    <h2>How to read this table</h2>
    <ul>
      <li><strong>2xx</strong> — the key held the scope the endpoint requires and the request
      reached the handler.</li>
      <li><strong>403 missing_scope</strong> — the key is valid but its permission block does not
      contain <code>resource:action</code> for that endpoint. The refusal happens before any D1
      write, and the body is exactly <code>{ "error": "missing_scope" }</code>.</li>
      <li><strong>401 invalid_api_key</strong> — Better Auth refused the key: revoked (row
      deleted), disabled (<code>enabled = 0</code>), expired, or wrong hash. All four return the
      same body, so the response is not an oracle.</li>
      <li><strong>401 missing_authorization</strong> — the header was absent, not Bearer, or empty.
      The verifier is never called in that case.</li>
      <li>No credential, hash, or account address appears in this artefact: only the status line and
      the <code>error</code> code of each response are rendered, and the capture script refuses to
      render a row whose shape matches credential material.</li>
      <li>Fixtures are local only — an isolated Miniflare D1 database per run. No production
      endpoint, secret, or account is read or written.</li>
    </ul>
  </div>
  <footer>Regenerate with <code>pnpm run verification:api-key-scope</code>. Contract:
  <code>docs/security/api-key-scope.md</code>.</footer>
</body>
</html>
`;
}

async function main() {
	const { code, output } = await runVitest();
	if (code !== 0) {
		process.stderr.write(output);
		process.stderr.write('\n[api-key-scope] the matrix suite failed; artefact not written\n');
		return 1;
	}

	const table = extractTable(output);
	if (!table) {
		process.stderr.write(output);
		process.stderr.write('\n[api-key-scope] the suite printed no matrix block\n');
		return 1;
	}

	const rows = parseRows(table);
	if (rows.length === 0) {
		process.stderr.write('[api-key-scope] the matrix table is empty\n');
		return 1;
	}

	const leak = findSecretRow(rows);
	if (leak) {
		process.stderr.write(
			`[api-key-scope] refusing to render row ${leak.index} — it matches credential-shaped material\n`,
		);
		return 1;
	}

	const html = renderHtml(rows);
	mkdirSync(dirname(resolve(repoRoot, SCRATCH_HTML)), { recursive: true });
	writeFileSync(resolve(repoRoot, SCRATCH_HTML), html, 'utf8');

	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		await page.goto(`file://${resolve(repoRoot, SCRATCH_HTML)}`);
		await page.waitForLoadState('load');
		const target = resolve(repoRoot, OUTPUT);
		mkdirSync(dirname(target), { recursive: true });
		const png = await page.screenshot({ fullPage: true });
		const { size } = await sharp(png)
			.resize({ width: MAX_WIDTH_PX, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
		process.stdout.write(
			`[api-key-scope] wrote ${OUTPUT} (${rows.length} cases, ${Math.round(size / 1024)} KiB WebP)\n`,
		);
	} finally {
		await browser.close();
	}

	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(await main());
}
