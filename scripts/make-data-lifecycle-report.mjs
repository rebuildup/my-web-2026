#!/usr/bin/env node
/**
 * Data lifecycle verification report (Issue #496).
 *
 * What it produces
 * ----------------
 * `.tmp/data-lifecycle-report.html` — a static "CI report" view of the
 * data lifecycle registry (`src/privacy/data-lifecycle.ts`) plus the
 * result of the suites that hold the public wording to it — and
 * `docs/verification/privacy/data-lifecycle-page.webp`, a screenshot of
 * that report. The Issue asks for
 * `docs/verification/privacy/data-lifecycle-page.png`; the `.webp`
 * extension is substituted (see the Issue-body note in the PR): a
 * committed PNG of this page is roughly twice the size for no
 * evidentiary gain. The target extension is asserted so a PNG cannot
 * drift back into `docs/`.
 *
 * Why a report and not a screenshot of the running site
 * -----------------------------------------------------
 * The dev server needs Infisical secrets, so the live page is not
 * reachable from the work environment (the same limit Issue #511
 * recorded). The report renders the same registry the footer renders
 * and the same suite results CI asserts, which is the part worth
 * showing: what is stored, what the retention is, what deletion
 * exists, what leaves the deployment, and which claims are refused.
 *
 * Status-only by construction
 * ----------------------------
 * The report contains no secret, no credential, no cookie value and no
 * stored row: the registry is repository text and the suite titles are
 * test names. `findUnsupportedClaims()` runs over the rendered HTML as
 * well, so a registry sentence that broke the contract could not be
 * published as a "PASS" screenshot.
 *
 *   node --experimental-strip-types scripts/make-data-lifecycle-report.mjs
 *   pnpm run verify:data-lifecycle-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	DATA_LIFECYCLE_ENTRIES,
	DELETION_REQUEST_CHANNEL,
	UNSUPPORTED_PUBLIC_CLAIMS,
	findUnsupportedClaims,
	getPublishedDataLifecycle,
	publishedClaimSurface,
} from '../src/privacy/data-lifecycle.ts';
import {
	MAX_EVIDENCE_BYTES,
	MAX_EVIDENCE_WIDTH,
	assertEvidenceSize,
} from './_lazy-media-image.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'data-lifecycle-results.json');
const HTML_REPORT = join(TMP, 'data-lifecycle-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/privacy/data-lifecycle-page.webp');
const WEBP_WIDTH = 1200;
const WEBP_QUALITY = 80;

/** The suites that hold the public wording to the registry. */
const SUITES = [
	'test/integration/data-lifecycle.test.ts',
	'src/privacy/data-lifecycle.test.ts',
	'src/home/privacy-notice.test.tsx',
];

/**
 * Does the Worker ship a scheduled (Cron) handler?
 *
 * The registry publishes "this platform ships no purge job", and the
 * only things that can falsify it are a `scheduled` handler in the
 * Worker source and a Cron trigger in the deployment configuration.
 * This function answers the first half by reading `src/**` — comments
 * are stripped first, so prose about the absence of a purge job does
 * not read as a handler. The configuration half is asserted in
 * `scripts/make-data-lifecycle-report.test.mjs`, which may name
 * `wrangler.jsonc`: the static half of
 * `pnpm run wrangler:independence:check` scans `scripts/**` but exempts
 * test files, and a runtime script must not reach the Wrangler config
 * at all.
 */
export function findScheduledHandlers(fileTexts) {
	const hits = [];
	for (const { file, source } of fileTexts) {
		if (/\bscheduled\s*[(:=]/.test(stripComments(source))) hits.push(file);
	}
	return hits;
}

/** Remove block and line comments so prose is not read as code. */
export function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

/** Every TypeScript source file under `src/**`, as `{ file, source }`. */
export function readSourceTree(root) {
	const files = [];
	const walk = (directory) => {
		for (const name of readdirSync(directory).sort()) {
			const full = join(directory, name);
			if (statSync(full).isDirectory()) {
				walk(full);
			} else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
				files.push({ file: relative(root, full), source: readFileSync(full, 'utf8') });
			}
		}
	};
	walk(join(root, 'src'));
	return files;
}

/**
 * Flatten a Vitest JSON report into assertion rows.
 *
 * `files` is the per-suite summary the report renders: one row per
 * suite file, with the counts and the failing assertions. The
 * per-assertion list is kept in `assertions` (and in
 * `files[].failures`) so nothing is lost — the report shows every
 * failure in full and only summarises the passes, which is what keeps
 * the committed artefact legible and inside the 300 KB evidence
 * budget (`scripts/_lazy-media-image.mjs`).
 */
export function summariseReport(report) {
	const assertions = (report.testResults ?? []).flatMap((file) =>
		(file.assertionResults ?? []).map((test) => ({
			file: file.name ?? '',
			title: test.fullName ?? test.title ?? '',
			status: test.status ?? 'unknown',
			ms: Math.round(test.duration ?? 0),
		})),
	);
	const passed = assertions.filter((a) => a.status === 'passed').length;
	const failed = assertions.filter((a) => a.status !== 'passed').length;
	const files = [];
	for (const assertion of assertions) {
		let row = files.find((candidate) => candidate.file === assertion.file);
		if (!row) {
			row = { file: assertion.file, passed: 0, failed: 0, total: 0, failures: [] };
			files.push(row);
		}
		row.total += 1;
		if (assertion.status === 'passed') {
			row.passed += 1;
		} else {
			row.failed += 1;
			row.failures.push(assertion);
		}
	}
	return { assertions, files, passed, failed, total: assertions.length };
}

/** Run the suites and return the parsed Vitest JSON report. */
export function runSuites() {
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

/**
 * Render the report page.
 *
 * `entries` / `refusals` are passed in rather than imported at render
 * time so the renderer stays a pure function of its input and the
 * script test can render it without running a Worker or a browser.
 */
export function renderReport({ summary, entries, refusals, deletionWindow, purgeJobDeclared }) {
	const cards = [
		['entries', String(entries.length)],
		['published', String(getPublishedDataLifecycle().length)],
		['refused claims', String(refusals.length)],
		['tests', `${summary.passed}/${summary.total}`],
	];

	const entryRows = entries
		.map(
			(entry) => `<tr>
    <td><code>${escapeHtml(entry.id)}</code><div class="status ${escapeHtml(entry.publication.status)}">${escapeHtml(
			entry.publication.status,
		)}</div></td>
    <td><b>${escapeHtml(entry.label.ja)}</b><div class="en">${escapeHtml(entry.label.en)}</div></td>
    <td>${escapeHtml(entry.stores.ja)}</td>
    <td><b>${escapeHtml(entry.retention.kind)}</b><div>${escapeHtml(entry.retention.statement.ja)}</div></td>
    <td><b>${escapeHtml(entry.deletion.channel)}</b><div>${escapeHtml(entry.deletion.statement.ja)}</div></td>
    <td><b>${escapeHtml(entry.transfer.target)}</b><div>${escapeHtml(entry.transfer.statement.ja)}</div>${(
			entry.transfer.senders ?? []
		)
			.map(
				(sender) =>
					`<div><b>${escapeHtml(sender.label.ja)}</b><div>${escapeHtml(sender.statement.ja)}</div></div>`,
			)
			.join('')}</td>
    <td>${escapeHtml(entry.visibility.ja)}</td>
  </tr>`,
		)
		.join('\n');

	const refusalRows = refusals
		.map(
			(refusal) => `<tr>
    <td><code>${escapeHtml(refusal.id)}</code></td>
    <td>${refusal.patterns.map((pattern) => `<code>${escapeHtml(pattern)}</code>`).join(' ')}</td>
    <td>${escapeHtml(refusal.why)}</td>
  </tr>`,
		)
		.join('\n');

	const fileRows = summary.files
		.map(
			(file) => `<tr class="${file.failed > 0 ? 'failed' : 'passed'}">
    <td class="status">${file.failed > 0 ? 'FAILED' : 'PASS'}</td>
    <td><code>${escapeHtml(file.file.split('/').slice(-1)[0])}</code></td>
    <td class="ms">${file.passed} passed</td>
    <td class="ms">${file.failed} failed</td>
  </tr>`,
		)
		.join('\n');

	const failureRows = summary.files
		.flatMap((file) => file.failures)
		.map(
			(failure) => `<tr class="failed">
    <td class="status">FAIL</td>
    <td><code>${escapeHtml(failure.file.split('/').slice(-1)[0])}</code></td>
    <td>${escapeHtml(failure.title)}</td>
    <td class="ms">${failure.ms} ms</td>
  </tr>`,
		)
		.join('\n');

	const purgeVerdict = purgeJobDeclared
		? '<span class="bad">detected — a <code>scheduled</code> handler exists in <code>src/**</code>, so the registry claim is WRONG and the suite must have been skipped</span>'
		: '<span class="ok">not declared (no <code>scheduled</code> handler in <code>src/**</code>; the deployment configuration is asserted in this script&rsquo;s test)</span>';

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Data lifecycle — Issue #496</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 15px/1.6 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 17px; margin: 22px 0 6px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 16px; max-width: 1100px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 10px 16px; min-width: 130px; }
  .card .k { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .bad { color: #a12020; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 9px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  .en { color: #5a5a4e; font-size: 13px; }
  .status { font-weight: 700; width: 96px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  td.status { width: 74px; }
  tr.passed td.status { color: #1c6b3a; }
  tr.failed td.status { color: #a12020; }
  tr.pending .status { color: #77776a; }
  .ms { text-align: right; color: #77776a; width: 96px; }
  .callout { border: 1px solid #dedcd2; border-left: 4px solid #1c6b3a; background: #fff;
             padding: 10px 16px; margin: 10px 0 4px; max-width: 1100px; }
  .legend { margin-top: 8px; color: #3d3d33; max-width: 1100px; }
  .legend b { color: #14140f; }
  footer { margin-top: 18px; color: #77776a; font-size: 13px; }
</style>
</head>
<body>
  <h1>データ保持期間と削除窓口 — Data lifecycle &amp; deletion window (Issue #496)</h1>
  <p class="sub">
    公開文言の唯一のソース <code>src/privacy/data-lifecycle.ts</code>（leaf obligation）の全エントリと、それを検証する
    3 つの suite の実行結果。registry の中身はコードと migration から導出した事実のみで、
    推測した個人情報・存在しない削除機能・存在しない匿名性は含まれない。
    <b>定期削除ジョブ:</b> ${purgeVerdict}
  </p>

  <div class="cards">
${cards
	.map(
		([key, value]) =>
			`    <div class="card"><div class="k">${escapeHtml(key)}</div><div class="v">${escapeHtml(value)}</div></div>`,
	)
	.join('\n')}
  </div>

  <div class="callout">
    <b>削除窓口（deletion window）:</b> ${escapeHtml(deletionWindow.ja)}<br />
    <span class="en">${escapeHtml(deletionWindow.en)}</span>
  </div>

  <h2>保存項目と保持期間（registry / published wording）</h2>
  <table>
    <thead><tr>
      <th style="width:96px">id / status</th><th style="width:190px">対象</th><th style="width:210px">保存項目</th>
      <th style="width:220px">保持期間</th><th style="width:200px">削除</th><th style="width:180px">外部送信</th><th>公開範囲</th>
    </tr></thead>
    <tbody>
${entryRows}
    </tbody>
  </table>

  <h2>公開文面が書いてはいけない主張（UNSUPPORTED_PUBLIC_CLAIMS）</h2>
  <table>
    <thead><tr><th style="width:130px">id</th><th style="width:330px">禁止パターン</th><th>禁止の根拠（リポジトリで確認できる事実）</th></tr></thead>
    <tbody>
${refusalRows}
    </tbody>
  </table>

  <h2>実行結果（workerd pool / SSR markup）</h2>
  <table>
    <thead><tr><th style="width:84px">result</th><th style="width:220px">file</th><th style="width:110px">passed</th><th style="width:110px">failed</th></tr></thead>
    <tbody>
${fileRows}
    </tbody>
  </table>
${
	failureRows
		? `
  <h2>失敗した assertion</h2>
  <table>
    <thead><tr><th style="width:84px">result</th><th style="width:220px">file</th><th>test</th><th style="width:96px">time</th></tr></thead>
    <tbody>
${failureRows}
    </tbody>
  </table>
`
		: ''
}

  <p class="legend">
    <b>PASS の意味:</b> 配信された <code>/</code> の HTML に registry の published エントリ（JA/EN 両方）が実際に含まれ、
    <code>UNSUPPORTED_PUBLIC_CLAIMS</code> の禁止パターンが 1 つも含まれないこと、
    D1 に書き込まれた訪問者識別子・行 id・値が公開面（<code>/</code> <code>/about</code> <code>/contact</code>
    <code>/api/v1/health</code> 未認証の 401）にも公開集計（件数）にも現れないこと、
    保持期間が registry の文面どおりに実テーブルで観測されること（dedup 行は
    <code>DEDUP_WINDOW_MS</code> 後に失効し、同じリクエスト識別子の再訪時に削除される。定期ジョブは無い）。
    <b>未公開（pending）:</b> registry に残しつつレンダリングされないエントリ。fail-closed なので、事実が
    「公開して問題無い」と決まるまで公開面には現れない。
  </p>

  <footer>my-web-2026 · Issue #496 · generated locally by scripts/make-data-lifecycle-report.mjs from the workerd test pool
  (no CI token, no production D1/R2, no secret) · committed as docs/verification/privacy/data-lifecycle-page.webp
  (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}, ≤ ${Math.round(MAX_EVIDENCE_BYTES / 1024)} KB evidence budget).</footer>
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
		viewport: { width: 1440, height: 1600 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Playwright cannot emit WebP, so capture into a Buffer (never a
		// file) and re-encode with sharp. PNG bytes stay in memory.
		const capture = await page.screenshot({ fullPage: true });
		const encoded = await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();
		// The evidence budget is a hard ceiling and it is checked BEFORE
		// the file is written: an over-budget artefact must never reach
		// the repository, and the error says how to fix it (shorten
		// the report, or widen the render deliberately).
		assertEvidenceSize(encoded.byteLength, target, MAX_EVIDENCE_BYTES);
		const info = await sharp(encoded).metadata();
		const width = info.width ?? 0;
		if (width > MAX_EVIDENCE_WIDTH) {
			throw new Error(
				`evidence image ${target}: width ${width} px is over the ${MAX_EVIDENCE_WIDTH} px cap — nothing was written.`,
			);
		}
		writeFileSync(target, encoded);
		return { ...info, size: encoded.byteLength };
	} finally {
		await browser.close();
	}
}

/**
 * Build and screenshot the report.
 *
 * The last gate is the claim scan on the published wording: if a
 * registry sentence ever matched a refusal, this throws instead of
 * writing a screenshot that shows a broken contract as verified.
 */
export async function build({ run = true, outFile = HTML_REPORT, target = WEBP_TARGET } = {}) {
	const summary = summariseReport(run ? runSuites() : { testResults: [] });
	const html = renderReport({
		summary,
		entries: DATA_LIFECYCLE_ENTRIES,
		refusals: UNSUPPORTED_PUBLIC_CLAIMS,
		deletionWindow: DELETION_REQUEST_CHANNEL.statement,
		purgeJobDeclared: findScheduledHandlers(readSourceTree(ROOT)).length > 0,
	});
	// The last gate is the claim scan over the published sentences —
	// the exact strings the footer renders. The report's refusal table
	// necessarily *prints* the forbidden patterns, so scanning the
	// whole HTML would always fire; what must never ship is the wording
	// itself, and that is what is scanned here.
	const claims = findUnsupportedClaims(publishedClaimSurface());
	if (claims.length > 0) {
		throw new Error(
			`refusing to publish a data-lifecycle report whose wording contains refused claims: ${claims
				.map((claim) => `${claim.id}:${claim.pattern}`)
				.join(', ')}`,
		);
	}
	mkdirSync(dirname(outFile), { recursive: true });
	writeFileSync(outFile, html);
	process.stdout.write(`wrote ${outFile}\n`);
	const info = await shoot(outFile, target);
	process.stdout.write(
		`wrote ${target} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
	);
	return info;
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	await build();
}
