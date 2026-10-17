#!/usr/bin/env node

/**
 * Capture the boundary input-validation matrix artefact (Issue #450).
 *
 * The matrix is **measured**, not declared: it is printed by
 * `test/integration/input-validation.test.ts`, which drives real HTTP
 * requests through the production `externalBoundary` app inside the
 * local workerd pool (real D1 / R2 bindings, fixture API key). This
 * script runs that suite, extracts the table it prints, renders it as a
 * self-contained HTML report, and screenshots it with the Playwright
 * Chromium that the E2E suite already uses.
 *
 * Output: `docs/verification/security/input-validation-matrix.png`
 * Scratch: `.tmp/input-validation-matrix.html` (gitignored, ephemeral)
 *
 * Usage:
 *   pnpm run verification:input-matrix
 *
 * Exits non-zero when the suite fails, when the table is empty, or when
 * a row would leak a credential into the artefact.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = 'test/integration/input-validation.test.ts';
const START = '<!-- input-validation-matrix:start -->';
const END = '<!-- input-validation-matrix:end -->';
const OUTPUT = 'docs/verification/security/input-validation-matrix.png';
const SCRATCH_HTML = '.tmp/input-validation-matrix.html';

/** Anything matching these must never reach a committed artefact. */
const SECRET_PATTERNS = [/bearer\s/i, /mk_[a-z0-9_]+/i, /secret/i, /token/i];

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
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `a | b | `c`` → `a`, `b`, `c` (inline code markers are decorative). */
function splitRow(line) {
	return line
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim().replace(/^`(.*)`$/, '$1'));
}

export function renderHtml(rows) {
	const body = rows
		.map((row) => {
			const status = Number(row.status);
			const tone = status >= 200 && status < 300 ? 'ok' : status >= 500 ? 'bad' : 'reject';
			return `<tr class="${tone}">
				<td class="num">${escapeHtml(row.index)}</td>
				<td><code>${escapeHtml(row.endpoint)}</code></td>
				<td>${escapeHtml(row.dimension)}</td>
				<td>${escapeHtml(row.input)}</td>
				<td class="status">${escapeHtml(row.status)}</td>
				<td>${
					row.code === '—' ? '<span class="muted">—</span>' : `<code>${escapeHtml(row.code)}</code>`
				}</td>
			</tr>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Boundary input-validation matrix — Issue #450</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
         margin: 0; padding: 32px; background: #ffffff; color: #111111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { margin: 0 0 20px; color: #444444; max-width: 80ch; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  caption { text-align: left; padding-bottom: 8px; color: #444444; }
  th, td { border-bottom: 1px solid #d8d8d8; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; }
  td.num { width: 28px; color: #666666; text-align: right; }
  td.status { font-weight: 600; text-align: right; }
  code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f2f2f2;
         padding: 1px 4px; border-radius: 3px; }
  tr.ok .status { color: #0a6b2d; }
  tr.reject .status { color: #8a4b00; }
  tr.bad .status { color: #a11212; }
  .muted { color: #888888; }
  .legend { margin-top: 20px; border: 1px solid #d8d8d8; padding: 12px 14px; max-width: 100ch; }
  .legend h2 { font-size: 14px; margin: 0 0 6px; }
  .legend ul { margin: 0; padding-left: 18px; }
  footer { margin-top: 16px; color: #666666; font-size: 12px; }
</style>
</head>
<body>
  <h1>Boundary input-validation matrix — Issue #450</h1>
  <p class="lede">Every row is a real HTTP request executed against the production Hono
  external boundary inside the local workerd pool (Miniflare D1 / R2, fixture API key via the
  <code>withVerifyApiKey</code> seam). Status codes and <code>error</code> codes are read back
  from the responses, not copied from the contract.</p>
  <table>
    <caption><code>${escapeHtml(TEST_FILE)}</code> — ${rows.length} cases</caption>
    <thead><tr>
      <th>#</th><th>endpoint</th><th>dimension</th><th>input</th><th>status</th><th>error code</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <div class="legend">
    <h2>How to read this table</h2>
    <ul>
      <li><strong>accepted</strong> — the request passed every guard and reached the handler
      (2xx, or the documented 404 for a well-formed resource that simply has no row).</li>
      <li><strong>type / format / size / protocol</strong> — the request was refused by
      <code>src/http/validation.ts</code> before it could touch D1. The body is always
      <code>{ "error": &lt;stable code&gt;, "reason": &lt;human string&gt; }</code>.</li>
      <li><strong>auth rows</strong> — unchanged by this Issue; they exist to show that the
      validation layer runs <em>after</em> the API-key check.</li>
      <li>No credential, cookie, or response payload appears in this artefact: only the status
      line and the <code>error</code> code of each response are rendered.</li>
    </ul>
  </div>
  <footer>Regenerate with <code>pnpm run verification:input-matrix</code>. Contract:
  <code>docs/security/input-validation.md</code>.</footer>
</body>
</html>
`;
}

async function main() {
	const { code, output } = await runVitest();
	if (code !== 0) {
		process.stderr.write(output);
		process.stderr.write('\n[input-matrix] the matrix suite failed; artefact not written\n');
		return 1;
	}

	const table = extractTable(output);
	if (!table) {
		process.stderr.write(output);
		process.stderr.write('\n[input-matrix] the suite printed no matrix block\n');
		return 1;
	}

	const lines = table.split('\n').filter((line) => line.trim().startsWith('|'));
	const rows = lines.slice(2).map((line, index) => {
		const cells = splitRow(line);
		return {
			index: String(index + 1),
			endpoint: cells[1],
			dimension: cells[2],
			input: cells[3],
			status: cells[4],
			code: cells[5],
		};
	});
	if (rows.length === 0) {
		process.stderr.write('[input-matrix] the matrix table is empty\n');
		return 1;
	}

	const leak = rows.find((row) =>
		SECRET_PATTERNS.some((pattern) => pattern.test(JSON.stringify(row))),
	);
	if (leak) {
		process.stderr.write(
			`[input-matrix] refusing to render a row that looks like a secret: ${leak.endpoint}\n`,
		);
		return 1;
	}

	const html = renderHtml(rows);
	mkdirSync(dirname(resolve(repoRoot, SCRATCH_HTML)), { recursive: true });
	writeFileSync(resolve(repoRoot, SCRATCH_HTML), html, 'utf8');

	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		await page.goto(`file://${resolve(repoRoot, SCRATCH_HTML)}`);
		await page.waitForLoadState('load');
		const target = resolve(repoRoot, OUTPUT);
		mkdirSync(dirname(target), { recursive: true });
		await page.screenshot({ path: target, fullPage: true });
	} finally {
		await browser.close();
	}

	process.stdout.write(`[input-matrix] wrote ${OUTPUT} (${rows.length} cases)\n`);
	return 0;
}

process.exit(await main());
