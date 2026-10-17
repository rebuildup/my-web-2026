#!/usr/bin/env node

/**
 * Capture the write-rate-limit verification artefact (Issue #456).
 *
 * The table is **measured**, not declared: it is printed by
 * `test/integration/write-rate-limit.test.ts`, which drives real HTTP
 * requests through the production `externalBoundary` inside the local
 * workerd pool against the Miniflare rate-limit binding declared in
 * `vitest.config.ts`. This script runs that suite, extracts the table
 * it prints, renders it as a self-contained HTML report (a "CI
 * report" view), and screenshots it with the Playwright Chromium the
 * E2E suite already uses.
 *
 * The Chromium screenshot is taken as PNG (lossless raster) and then
 * **converted to WebP** before it is committed: the artefact is a flat
 * page of text, which WebP q80 encodes at a fraction of the PNG size
 * with no visible loss, and a committed screenshot must not bloat the
 * repository. The PNG intermediate stays in `.tmp/` (gitignored) and is
 * deleted after the conversion.
 *
 * Output: `docs/verification/security/reactions-rate-limit.webp`
 * Scratch: `.tmp/write-rate-limit-report.html`,
 *         `.tmp/write-rate-limit-report.png` (both gitignored, ephemeral)
 *
 * Usage:
 *   pnpm run verification:write-rate-limit
 *
 * Exits non-zero when the suite fails, when the table is empty, when a
 * row would leak a credential into the artefact, or when the encoded
 * artefact exceeds `MAX_ARTEFACT_BYTES`.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = 'test/integration/write-rate-limit.test.ts';
const START = '<!-- write-rate-limit-matrix:start -->';
const END = '<!-- write-rate-limit-matrix:end -->';
export const OUTPUT = 'docs/verification/security/reactions-rate-limit.webp';
const SCRATCH_HTML = '.tmp/write-rate-limit-report.html';
const SCRATCH_PNG = '.tmp/write-rate-limit-report.png';

/** Encoding contract for the committed artefact (see the header). */
export const ARTEFACT_ENCODE_OPTIONS = Object.freeze({ width: 1600, quality: 80 });
/** Hard ceiling so a bigger matrix cannot quietly bloat the repository. */
export const MAX_ARTEFACT_BYTES = 300 * 1024;

/** Anything matching these must never reach a committed artefact. */
const SECRET_PATTERNS = [/bearer\s/i, /mk_[a-z0-9_]+/i, /secret/i, /token/i];

/**
 * The row that would leak a credential into the artefact, if any.
 * Exported so the guard is unit-tested rather than only observable by
 * running the whole capture.
 */
export function findSecretRow(rows) {
	return rows.find((row) => SECRET_PATTERNS.some((pattern) => pattern.test(JSON.stringify(row))));
}

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

/** Extract the Markdown table the suite prints between the markers. */
export function extractTable(output) {
	const start = output.indexOf(START);
	const end = output.indexOf(END);
	if (start === -1 || end === -1) return null;
	return output.slice(start + START.length, end).trim();
}

const escapeHtml = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** `a | b | `c`` → `a`, `b`, `c` (inline code markers are decorative). */
function splitRow(line) {
	return line
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim().replace(/^`(.*)`$/, '$1'));
}

/**
 * Markdown rows → structured rows. The first line is the header; a
 * Markdown separator line is optional (the suite prints one, but a
 * missing separator must not silently drop the first measurement).
 */
export function parseRows(table) {
	const lines = table.split('\n').filter((line) => line.trim().startsWith('|'));
	const body = lines.slice(1).filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim()));
	return body.map((line, index) => {
		const cells = splitRow(line);
		return {
			index: String(index + 1),
			endpoint: cells[1] ?? '',
			input: cells[2] ?? '',
			status: cells[3] ?? '',
			code: cells[4] ?? '',
			retryAfter: cells[5] ?? '',
		};
	});
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
<title>書き込み系 rate limit 検証レポート — Issue #456</title>
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
  <h1>書き込み系 rate limit 検証レポート — Issue #456</h1>
  <p class="lede">各行はローカル workerd プールの中で本番 <code>externalBoundary</code> に流した
  <strong>実 HTTP リクエスト</strong>の応答から読み取った値である（Miniflare の実 rate-limit binding、
  API キーは既存の <code>withVerifyApiKey</code> 継ぎ目によるスタブ）。予算は principal（API key id）
  ごとに 60 リクエスト / 60 秒。書き込みバケットは reactions と counter が共有する 1 個であり、
  read は別バケット（600 / 60 秒）。</p>
  <table>
    <caption><code>${escapeHtml(TEST_FILE)}</code> — ${rows.length} ケース</caption>
    <thead><tr>
      <th>#</th><th>エンドポイント</th><th>入力 / 条件</th><th>status</th><th>error</th><th>Retry-After</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <div class="legend">
    <h2>この表の読み方</h2>
    <ul>
      <li><strong>200</strong> — budget 内の正当なリクエスト。ハンドラまで到達し D1 に書き込まれる。</li>
      <li><strong>400 / 403</strong> — 予算内だが拒否された入力。<code>rateLimit</code> は通過しており、
          body 検証（400）とスコープ検証（403 — handler の先頭で出る）が答えている。<strong>予算は消費される</strong>。</li>
      <li><strong>401</strong> — API キー検証が throttle より先に答えるので middleware に到達しない。
          <strong>予算は消費されない</strong>（throttle 済みの principal でも 429 ではなく 401 が先に返る）。</li>
      <li><strong>429 <code>rate_limited</code></strong> — 上限超過で抑制された要求。
          <code>Retry-After</code> は binding の fixed window（60 秒）。<strong>D1 には到達しない</strong>
          ので counter も reactions も増えない。</li>
      <li><strong>read 行（200 / 404）</strong> — write budget を上限まで使い切った同じ principal でも
          read budget（別 binding）は影響を受けない。404 は「形式は正しいが該当行が無い」拒否。</li>
      <li>認証（401）は throttle より先に評価されるため予算を消費しない。逆にスコープ不足（403）は
          handler の先頭で出るため予算を消費する（read-only な key でも write バケットを消費できる）。
          本レポートには credential・cookie・レスポンス本文は一切含まれない（描画するのは status と
          error コードのみ）。</li>
    </ul>
  </div>
  <footer>再生成: <code>pnpm run verification:write-rate-limit</code> ／ 運用契約:
  <code>docs/security/write-rate-limit.md</code></footer>
</body>
</html>
`;
}

async function main() {
	const { code, output } = await runVitest();
	if (code !== 0) {
		process.stderr.write(output);
		process.stderr.write('\n[write-rate-limit] the suite failed; artefact not written\n');
		return 1;
	}

	const table = extractTable(output);
	if (!table) {
		process.stderr.write(output);
		process.stderr.write('\n[write-rate-limit] the suite printed no matrix block\n');
		return 1;
	}

	const rows = parseRows(table);
	if (rows.length === 0) {
		process.stderr.write('[write-rate-limit] the matrix table is empty\n');
		return 1;
	}

	const leak = findSecretRow(rows);
	if (leak) {
		process.stderr.write(
			`[write-rate-limit] refusing to render a row that looks like a secret: ${leak.endpoint}\n`,
		);
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
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		await page.goto(`file://${resolve(repoRoot, SCRATCH_HTML)}`);
		await page.waitForLoadState('load');
		await page.screenshot({ path: shot, fullPage: true });
	} finally {
		await browser.close();
	}

	// PNG (raster) -> WebP (committed). `withoutEnlargement` keeps the
	// capture at its own 1280 CSS px when the viewport is narrower.
	const { default: sharp } = await import('sharp');
	const target = resolve(repoRoot, OUTPUT);
	mkdirSync(dirname(target), { recursive: true });
	const info = await sharp(shot)
		.resize({ width: ARTEFACT_ENCODE_OPTIONS.width, withoutEnlargement: true })
		.webp({ quality: ARTEFACT_ENCODE_OPTIONS.quality })
		.toFile(target);
	rmSync(shot, { force: true });

	if (info.size > MAX_ARTEFACT_BYTES) {
		const limit = `[write-rate-limit] ${OUTPUT} is ${info.size} bytes (> ${MAX_ARTEFACT_BYTES});`;
		const advice =
			'lower ARTEFACT_ENCODE_OPTIONS.quality or narrow the report instead of committing it\n';
		process.stderr.write(`${limit} ${advice}`);
		return 1;
	}

	process.stdout.write(
		`[write-rate-limit] wrote ${OUTPUT} (${rows.length} cases, ` +
			`${info.width}x${info.height} webp q${ARTEFACT_ENCODE_OPTIONS.quality}, ${info.size} bytes)\n`,
	);
	return 0;
}

// Only run the capture when executed directly; the unit test imports
// the pure helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await main());
}
