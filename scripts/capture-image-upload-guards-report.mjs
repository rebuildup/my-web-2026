#!/usr/bin/env node

/**
 * Capture the image-upload guard verification artefact (Issue #458).
 *
 * The table is **measured**, not declared: it is printed by
 * `test/integration/upload-guards.test.ts`, which drives the real admin
 * upload path (`uploadReactionImageImpl` → `uploadImage`) inside the
 * local workerd pool against the Miniflare D1 / R2 bindings declared
 * in `vitest.config.ts`. This script runs that suite, extracts the
 * matrix it prints, renders it as a self-contained HTML report, and
 * screenshots it with the Playwright Chromium the E2E suite uses.
 *
 * Output: `docs/verification/security/image-upload-guards.png`
 * Scratch: `.tmp/image-upload-guards-report.html` (gitignored)
 *
 * Usage:
 *   pnpm run verification:image-upload-guards
 *
 * Exits non-zero when the suite fails, when the matrix block is
 * missing or empty, or when a row would leak a credential into the
 * artefact. No secret is read, and no production resource is touched:
 * every input in the suite is a hand-written byte fixture.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = 'test/integration/upload-guards.test.ts';
const START = '<!-- image-upload-guards-matrix:start -->';
const END = '<!-- image-upload-guards-matrix:end -->';
const OUTPUT = 'docs/verification/security/image-upload-guards.png';
const SCRATCH_HTML = '.tmp/image-upload-guards-report.html';

/** Anything matching these must never reach a committed artefact. */
const SECRET_PATTERNS = [
	/bearer\s/i,
	/mk_[a-z0-9_]+/i,
	/\bsecret\b/i,
	/\btoken\b/i,
	/\bkey\s*[:=]/i,
];

/** Longest cell rendered before it is ellipsised (a 256-char name is noise). */
const MAX_CELL = 40;

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

/**
 * Extract the Markdown table the suite prints between the markers.
 *
 * Vitest echoes test-process writes as `stdout: <line>`, so each line
 * of the block is un-prefixed here. Without this the parser would see
 * zero table rows and the capture would fail loudly rather than emit
 * an empty artefact.
 */
export function extractMatrix(output) {
	const start = output.indexOf(START);
	const end = output.indexOf(END);
	if (start === -1 || end === -1) return null;
	return output
		.slice(start + START.length, end)
		.split('\n')
		.map((line) => line.replace(/^\s*(?:stdout|stderr):\s?/, ''))
		.join('\n')
		.trim();
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

function shorten(value) {
	return value.length > MAX_CELL ? `${value.slice(0, MAX_CELL - 1)}…` : value;
}

/**
 * Markdown rows → structured rows. The first line is the header; the
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
			label: cells[1] ?? '',
			declared: cells[2] ?? '',
			detected: cells[3] ?? '',
			filename: cells[4] ?? '',
			size: cells[5] ?? '',
			verdict: cells[6] ?? '',
			code: cells[7] ?? '',
			r2Key: cells[8] ?? '',
		};
	});
}

export function renderHtml(rows) {
	const body = rows
		.map((row) => {
			const accepted = row.verdict === 'accepted';
			const tone = accepted ? 'ok' : 'reject';
			const cell = (value) =>
				value === '—'
					? '<span class="muted">—</span>'
					: `<code>${escapeHtml(shorten(value))}</code>`;
			return `<tr class="${tone}">
				<td class="num">${escapeHtml(row.index)}</td>
				<td>${escapeHtml(row.label)}</td>
				<td>${cell(row.declared)}</td>
				<td>${cell(row.detected)}</td>
				<td class="name">${cell(row.filename)}</td>
				<td>${escapeHtml(row.size)}</td>
				<td class="verdict">${escapeHtml(row.verdict)}</td>
				<td>${cell(row.code)}</td>
				<td>${cell(row.r2Key)}</td>
			</tr>`;
		})
		.join('\n');

	const accepted = rows.filter((row) => row.verdict === 'accepted').length;

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>画像アップロード検査 検証レポート — Issue #458</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.6 "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
         margin: 0; padding: 32px; background: #ffffff; color: #111111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { margin: 0 0 20px; color: #444444; max-width: 100ch; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  caption { text-align: left; padding-bottom: 8px; color: #444444; }
  th, td { border-bottom: 1px solid #d8d8d8; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; }
  td.num { width: 28px; color: #666666; text-align: right; }
  td.verdict { width: 72px; font-weight: 600; }
  td.name { word-break: break-all; }
  code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f2f2f2;
         padding: 1px 4px; border-radius: 3px; }
  tr.ok .verdict { color: #0a6b2d; }
  tr.reject .verdict { color: #8a4b00; }
  .muted { color: #888888; }
  .legend { margin-top: 20px; border: 1px solid #d8d8d8; padding: 12px 14px; max-width: 118ch; }
  .legend h2 { font-size: 14px; margin: 0 0 6px; }
  .legend ul { margin: 0; padding-left: 18px; }
  footer { margin-top: 16px; color: #666666; font-size: 12px; }
</style>
</head>
<body>
  <h1>画像アップロード検査 検証レポート — Issue #458</h1>
  <p class="lede">各行はローカル workerd プールの中で admin の実アップロード経路
  （<code>uploadReactionImageImpl</code> → <code>uploadImage</code>）に投入した実測結果である。
  binding は <code>vitest.config.ts</code> が宣言する Miniflare D1 / R2、入力は全て
  <code>test/helpers/image-fixtures.ts</code> の手書きバイト列であり、本番 D1 / R2 への書き込みは一切行わない。
  判定は宣言 MIME だけでなく先頭バイト（PNG / JPEG / GIF87a / GIF89a / RIFF+WEBP、<code>&lt;svg&gt;</code> は明示検出）に
  一致するかで行う。拒否行は D1 行・R2 オブジェクトを一切増やさないことも同時に検証している。</p>
  <table>
    <caption><code>${escapeHtml(TEST_FILE)}</code> — ${rows.length} ケース（登録 ${accepted} / 拒否 ${rows.length - accepted}）</caption>
    <thead><tr>
      <th>#</th><th>入力</th><th>宣言 MIME</th><th>実体(署名)</th><th>ファイル名</th>
      <th>サイズ</th><th>結果</th><th>コード</th><th>R2 key</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <div class="legend">
    <h2>この表の読み方</h2>
    <ul>
      <li><strong>accepted</strong> — 宣言 MIME と署名が一致し、256 KiB 以下で、ファイル名が安全。
          R2 key は <code>reactions/&lt;sha256&gt;.&lt;ext&gt;</code> の content-addressed 形で、
          ファイル名（日本語名・空白を含むもの）は key に一切影響しない。</li>
      <li><strong>unrecognized_signature</strong> — 先頭バイトがどの許可署名とも一致しない（テキスト / HTML / ZIP の偽装）。</li>
      <li><strong>content_type_mismatch</strong> — 署名は recognised だが宣言 MIME と食い違う（GIF を png と申告など）。</li>
      <li><strong>svg_not_allowed</strong> — SVG 本体を png と申告。宣言が <code>image/svg+xml</code> の場合は
          <code>unsupported_content_type</code> で先に拒否される。SVG はアクティブコンテンツを持ち、常時拒否。</li>
      <li><strong>oversize / empty_payload</strong> — 256 KiB の上限（境界値は登録）と空ファイル。</li>
      <li><strong>invalid_filename</strong> — <code>../</code>・<code>..\\</code>・絶対パス・<code>.</code>・
          前後空白・制御文字（<code>\\u0000</code> / <code>\\u000a</code> / <code>\\u007f</code>）・255 byte 超。
          ファイル名は保存も key 生成にも使われないが、トラバーサル意図は無言で通さず拒否する。</li>
      <li>本レポートには credential・cookie・秘密値・本番識別子は含まれない（描画するのは検証入力と結果コードのみ）。</li>
    </ul>
  </div>
  <footer>再生成: <code>pnpm run verification:image-upload-guards</code> ／ 運用契約:
  <code>docs/security/image-upload-guards.md</code></footer>
</body>
</html>
`;
}

async function main() {
	const { code, output } = await runVitest();
	if (code !== 0) {
		process.stderr.write(output);
		process.stderr.write('\n[image-upload-guards] the suite failed; artefact not written\n');
		return 1;
	}

	const matrix = extractMatrix(output);
	if (!matrix) {
		process.stderr.write(output);
		process.stderr.write('\n[image-upload-guards] the suite printed no matrix block\n');
		return 1;
	}

	const rows = parseRows(matrix);
	if (rows.length === 0) {
		process.stderr.write('[image-upload-guards] the matrix table is empty\n');
		return 1;
	}

	const leak = findSecretRow(rows);
	if (leak) {
		process.stderr.write(
			`[image-upload-guards] refusing to render a row that looks like a secret: ${leak.index}\n`,
		);
		return 1;
	}

	const html = renderHtml(rows);
	mkdirSync(dirname(resolve(repoRoot, SCRATCH_HTML)), { recursive: true });
	writeFileSync(resolve(repoRoot, SCRATCH_HTML), html, 'utf8');

	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
		await page.goto(`file://${resolve(repoRoot, SCRATCH_HTML)}`);
		await page.waitForLoadState('load');
		const target = resolve(repoRoot, OUTPUT);
		mkdirSync(dirname(target), { recursive: true });
		await page.screenshot({ path: target, fullPage: true });
	} finally {
		await browser.close();
	}

	process.stdout.write(`[image-upload-guards] wrote ${OUTPUT} (${rows.length} cases)\n`);
	return 0;
}

// Only run the capture when executed directly; the unit test imports
// the pure helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await main());
}
