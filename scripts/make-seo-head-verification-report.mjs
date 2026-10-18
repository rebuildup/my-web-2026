#!/usr/bin/env node
/**
 * Verification report generator for Issue #418.
 *
 * Runs the public-route head-metadata gate with Vitest's JSON reporter,
 * renders the result as a static HTML page (a "CI report" view) at
 * `.tmp/seo-head-report.html`, and screenshots that page with the
 * Playwright chromium already installed for the E2E suite into
 * `docs/verification/seo/head-metadata-check.webp` — the path Issue #418
 * requires in the PR body, with the `.webp` extension substituted for
 * the Issue's literal `.png` (a committed PNG screenshot of this report
 * is roughly twice the size of the WebP and bloats the repository for no
 * evidentiary gain; the exact sizes are reported per commit in the PR
 * body rather than hard-coded here, so this comment cannot drift on
 * regeneration).
 *
 * What the report shows, and why it is not a screenshot of prose:
 *
 *   1. the gate's own per-route cases (one row per discovered public
 *      route, named by the request path) with pass/fail and duration —
 *      this is the actual `SELF.fetch` run, not a re-render;
 *   2. the inventory those cases came from (route id, policy class,
 *      expected canonical), read from `src/routes/**` through the same
 *      contract module the gate uses;
 *   3. the policy rules, so a reader can tell what "PASS" means.
 *
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper. It reads no
 * secret: the suite runs in the workerd pool with dummy bindings and
 * fetches nothing but the Worker under test.
 *
 *   node scripts/make-seo-head-verification-report.mjs
 *   pnpm run verify:seo-head-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	CANONICAL_ORIGIN,
	DYNAMIC_ROUTE_SAMPLES,
	INDEX_EXCLUSIONS,
	NOT_FOUND_PROBES,
	QUERY_STRING_PROBES,
	buildInventory,
	discoverRouteModules,
} from './seo-head-contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'seo-head-results.json');
const HTML_REPORT = join(TMP, 'seo-head-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/seo/head-metadata-check.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;

const SUITE = 'test/integration/seo-head.test.ts';

/** The policy, in the words a reviewer needs to judge a verdict. */
const RULES = [
	[
		'public',
		'title / description / canonical の3点が存在し、canonical は origin + path の絶対 URL',
	],
	['public', 'title は公開surface全体で一意'],
	['public', 'canonical にクエリ・フラグメントを含まない（検索クエリURLはクエリ無しへ寄せる）'],
	['public', 'robots=noindex は INDEX_EXCLUSIONS 宣言済みrouteのみ許可'],
	['non-public', 'robots=noindex を宣言し、canonical を宣言しない（/admin/*）'],
	['not-found', 'canonical を宣言しない・index を要求しない（notFound() 応答）'],
	['coverage', '発見されたrouteに未観測があれば finding（無言の合格にしない）'],
	['coverage', '動的routeにサンプル宣言が無ければ finding'],
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

	const inventory = buildInventory(discoverRouteModules(join(ROOT, 'src/routes')));
	const inventoryRows = inventory
		.map((entry) => {
			const exclusion = INDEX_EXCLUSIONS[entry.routeId];
			const notes = [
				entry.dynamic ? `sample=${entry.sample?.segment ?? '(未宣言)'}` : null,
				exclusion ? `index-excluded (${exclusion.robots})` : null,
				entry.kind === 'non-public' ? 'anonymous: noindex policy は /admin/login で検証' : null,
			]
				.filter(Boolean)
				.join(' / ');
			return `<tr>
    <td><code>${escapeHtml(entry.routeId)}</code></td>
    <td><span class="tag ${entry.kind}">${escapeHtml(entry.kind)}</span></td>
    <td><code>${escapeHtml(entry.expectedCanonical ?? '(サンプル未宣言)')}</code></td>
    <td>${escapeHtml(notes)}</td>
  </tr>`;
		})
		.join('\n');

	const testRows = assertions
		.map(
			(test) => `<tr class="${escapeHtml(test.status)}">
    <td class="status">${test.status === 'passed' ? 'PASS' : escapeHtml(test.status.toUpperCase())}</td>
    <td>${escapeHtml(test.title)}</td>
    <td class="ms">${Math.round(test.ms)} ms</td>
  </tr>`,
		)
		.join('\n');

	const ruleRows = RULES.map(
		([scope, text]) =>
			`<tr><td><code>${escapeHtml(scope)}</code></td><td>${escapeHtml(text)}</td></tr>`,
	).join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>public-route head metadata — Issue #418</title>
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
  .bad { color: #a12020; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 64px; }
  tr.passed .status { color: #1c6b3a; }
  tr.failed .status { color: #a12020; }
  .ms { text-align: right; color: #77776a; width: 80px; }
  .tag { font-size: 11px; border: 1px solid #cfd8c9; color: #1c6b3a; padding: 0 6px; border-radius: 3px; }
  .tag.non-public { border-color: #d8cfc9; color: #8a5a20; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>公開route の &lt;head&gt; メタデータ検証 — Issue #418</h1>
  <p class="sub">local worker（workerd test pool）上の <code>${escapeHtml(SUITE)}</code> を実行した結果。全routeは framework の route tree から発見し、実 SSR 応答の <code>&lt;head&gt;</code> を同じポリシーで評価している。canonical origin は <code>${escapeHtml(CANONICAL_ORIGIN)}</code>。</p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v ${failed === 0 ? 'ok' : 'bad'}">${failed}</div></div>
    <div class="card"><div class="k">routes</div><div class="v">${inventory.length}</div></div>
    <div class="card"><div class="k">duration</div><div class="v">${durationMs}<span style="font-size:13px"> ms</span></div></div>
  </div>

  <h2>検証した inventory</h2>
  <table>
    <thead><tr><th style="width:220px">route id</th><th style="width:110px">policy</th><th style="width:280px">expected canonical</th><th>備考</th></tr></thead>
    <tbody>
${inventoryRows}
    </tbody>
  </table>

  <h2>404 / 検索クエリ probe</h2>
  <table>
    <thead><tr><th style="width:220px">probe</th><th style="width:340px">path</th><th>期待</th></tr></thead>
    <tbody>
${NOT_FOUND_PROBES.map(
	(probe) =>
		`<tr><td><code>${escapeHtml(probe.id)}</code></td><td><code>${escapeHtml(probe.path)}</code></td><td>HTTP ${probe.expectStatus} / canonical なし</td></tr>`,
).join('\n')}
${QUERY_STRING_PROBES.map(
	(probe) =>
		`<tr><td><code>query</code></td><td><code>${escapeHtml(`${probe.routeId}?${probe.query}`)}</code></td><td>canonical は <code>${escapeHtml(`${CANONICAL_ORIGIN}${probe.routeId}`)}</code> に一致</td></tr>`,
).join('\n')}
    </tbody>
  </table>

  <h2>ポリシー</h2>
  <table>
    <thead><tr><th style="width:140px">scope</th><th>判定内容</th></tr></thead>
    <tbody>
${ruleRows}
    </tbody>
  </table>

  <h2>実行結果</h2>
  <table>
    <thead><tr><th style="width:64px">result</th><th>test</th><th style="width:80px">time</th></tr></thead>
    <tbody>
${testRows}
    </tbody>
  </table>

  <footer>my-web-2026 · Issue #418 · report generated locally from the workerd test pool by scripts/make-seo-head-verification-report.mjs (no CI token, no production access) · dynamic samples: ${escapeHtml(
		Object.entries(DYNAMIC_ROUTE_SAMPLES)
			.map(([route, sample]) => `${route} → ${sample.segment}`)
			.join(', '),
	)} · committed as docs/verification/seo/head-metadata-check.webp (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
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
