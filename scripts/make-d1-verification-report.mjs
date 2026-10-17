#!/usr/bin/env node
/**
 * Verification report generator for Issue #452.
 *
 * Runs the D1 parameter-binding suite with Vitest's JSON reporter,
 * renders the result as a static HTML page (a "CI report" view) at
 * `.tmp/d1-parameter-report.html`, and screenshots that page with the
 * Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/d1-parameter-tests.webp` — the path Issue
 * #452 requires in the PR body, with the `.webp` extension substituted for
 * the Issue's literal `.png` (a committed PNG screenshot is 450 KB and
 * bloats the repository for no evidentiary gain).
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
 * secret: the suite stubs the API key through the existing DI seam and
 * uses the workerd pool's dummy bindings.
 *
 *   node scripts/make-d1-verification-report.mjs
 *   pnpm run verify:d1-binding-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'd1-parameter-results.json');
const HTML_REPORT = join(TMP, 'd1-parameter-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/d1-parameter-tests.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;

const SUITE = 'test/integration/d1-parameter-binding.test.ts';

const PAYLOADS = [
	['tautology', "' OR '1'='1", '引用符を閉じて常に真の比較を追加する'],
	['comment-tail', "' OR 1=1 --", 'コメントで後続をコメントアウトする古典形'],
	['union-select', "' UNION SELECT 1,2,3 --", '3列 SELECT に結果集合を splice する'],
	['stacked-delete', "x'; DELETE FROM reactions; --", '複数ステートメント連結の試行'],
	['backslash-quote', "\\' OR 1=1 --", '素朴なバックスラッシュ引用符エスケープを検査'],
	['like-wildcard', "%' OR slug LIKE '%", '= を LIKE に差し替える形を検査'],
	['tautology-compact', "'OR'1'='1", '空白なしの tautology（counter バリデータを通過する形）'],
	['union-compact', "'UNIONSELECT1,2,3--", '空白なしの UNION 試行'],
	['wildcard-compact', "%'OR'%", '空白なしの LIKE ワイルドカード対'],
];

const REJECTED = [
	['over-length', `${'x'.repeat(12)}…`, 'length 上限（256）超過で 400'],
	['embedded-whitespace', 'home page', '空白を含む counter key/session は拒否'],
	['control-char', 'home-page\\u0000', '制御文字を含む counter key/session は拒否'],
];

const SURFACES = [
	['POST /api/v1/access/hit', 'counter key + session_id 書き込み'],
	['GET /api/v1/access/count/:key', 'counter key 読み取り（path param）'],
	['PUT /api/v1/reactions', 'target_key / actor_id / value 書き込み'],
	['DELETE /api/v1/reactions', '同一 tuple の削除（tautology では何も消えない）'],
	['GET /api/v1/reactions?target&actor_id', 'aggregate + viewer スコープ読み取り'],
	['GET /api/v1/reaction-images/:id', 'image id 読み取り（path param）'],
	['portfolio loader', 'slug 検索（loadPortfolioProject / loadPortfolioAdjacent）'],
	['emoji catalog', 'slug 検索（getCatalogEntry）'],
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

	const rows = (items) =>
		items
			.map(
				([id, value, note]) =>
					`<tr><td><code>${escapeHtml(id)}</code></td><td><code>${escapeHtml(value)}</code></td><td>${escapeHtml(note)}</td></tr>`,
			)
			.join('\n');

	const surfaceRows = SURFACES.map(
		([path, note]) =>
			`<tr><td><code>${escapeHtml(path)}</code></td><td>${escapeHtml(note)}</td></tr>`,
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
<title>D1 parameter binding — Issue #452</title>
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
  <h1>D1 parameter binding — SQL injection テスト (Issue #452)</h1>
  <p class="sub">local worker (Miniflare / workerd pool) + <code>test/integration/d1-parameter-binding.test.ts</code> の実行結果。secret は含まれない（API key は DI seam でスタブ、binding は test 用の dummy）。</p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v">${failed}</div></div>
    <div class="card"><div class="k">duration</div><div class="v">${durationMs}<span style="font-size:13px"> ms</span></div></div>
  </div>

  <h2>攻撃入力（bind される値として到達）</h2>
  <table>
    <thead><tr><th style="width:150px">id</th><th style="width:220px">payload</th><th>意図</th></tr></thead>
    <tbody>
${rows(PAYLOADS)}
    </tbody>
  </table>

  <h2>拒否される入力（D1 に到達しない）</h2>
  <table>
    <thead><tr><th style="width:150px">id</th><th style="width:220px">payload</th><th>期待結果</th></tr></thead>
    <tbody>
${rows(REJECTED)}
    </tbody>
  </table>

  <h2>対象 surface</h2>
  <table>
    <thead><tr><th style="width:320px">endpoint / loader</th><th>検証内容</th></tr></thead>
    <tbody>
${surfaceRows}
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
    <b>PASS の意味:</b> 攻撃入力でも <code>prepare()</code> に渡る SQL テキストが正常入力と<b>完全に同一</b>（クエリ構造が変わらない）、payload は SQL テキストに現れず <code>bind</code> 値としてのみ D1 に届き、tautology でも述語は拡大されず 0 件になる。かつ、投入前のテーブル内容が維持される。
    <b>拒否の意味:</b> バリデータが 400 等で拒否し、D1 ステートメントが 1 件も実行されない（= SQLite に到達していない）。
  </p>

  <footer>my-web-2026 · Issue #452 · report generated locally from the workerd test pool by scripts/make-d1-verification-report.mjs (no CI token, no production D1/R2) · committed as docs/verification/security/d1-parameter-tests.webp (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
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
writeFileSync(HTML_REPORT, render(report));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
const info = await shoot(HTML_REPORT, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
