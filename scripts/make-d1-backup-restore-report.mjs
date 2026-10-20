#!/usr/bin/env node
/**
 * Verification report generator for Issue #461 (D1 backup / restore).
 *
 * Runs `test/integration/d1-backup-restore.test.ts` with Vitest's JSON
 * reporter, renders the result as a static HTML page at
 * `.tmp/d1-backup-restore.html`, and screenshots that page with the
 * Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/d1-backup-restore.webp`
 * (width ≤ 1600, WebP quality 80 — the repository verification rule).
 *
 * Why the test is the source of the artefact: the claim is not "the
 * page says a restore works". It is "this disposable local D1 was
 * seeded, exported, dropped, imported, and read back". The report
 * records the assertions that decided it, so a reviewer can rerun the
 * same command instead of trusting the image.
 *
 * Nothing secret is read or drawn. The suite uses the workerd test
 * pool's local D1 binding, synthetic rows, and no credential. No
 * production database, no remote D1, no deploy, no database id, no
 * row value, no bucket/key list. Playwright cannot encode WebP, so the
 * capture is held in an in-memory Buffer and re-encoded with the
 * existing `sharp` devDependency; no intermediate PNG reaches disk.
 *
 *   node scripts/make-d1-backup-restore-report.mjs
 *   pnpm run verify:d1-backup-restore-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present (`pnpm run e2e:install`).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'd1-backup-restore-results.json');
const HTML_REPORT = join(TMP, 'd1-backup-restore.html');
const TARGET = join(ROOT, 'docs/verification/security/d1-backup-restore.webp');
const SUITE = 'test/integration/d1-backup-restore.test.ts';
const WIDTH = 1600;
const QUALITY = 80;

/** The fixture the suite creates. Synthetic only; no production row. */
const FIXTURE = [
	['d1_backup_fixture_notes', '3', 'id / slug / body / pinned + UNIQUE'],
	['d1_backup_fixture_metrics', '3', 'id / label / amount / payload (BLOB)'],
	['idx_d1_backup_fixture_notes_slug', '—', 'explicit CREATE INDEX'],
];

/** Procedure the suite executes, in order. */
const PROCEDURE = [
	['1', 'seed', 'env.DB.batch(...)', '2 tables, 6 synthetic rows, 1 explicit index'],
	['2', 'export', 'exportD1Backup(env.DB, …)', 'schema SQL + rows + digest'],
	['3', 'drop', 'DROP TABLE …', 'both fixture tables absent'],
	['4', 'import', 'restoreD1Database(env.DB, …)', 'one D1 batch (transaction)'],
	['5', 'verify', 'exportD1Backup(env.DB, …) again', 'schema + rows + digest identical'],
];

/** Failure states the suite asserts, and the database state after each. */
const FAILURES = [
	['unreadable_backup', 'exit 2', 'truncated JSON', 'nothing created'],
	['invalid_backup / row_count_mismatch', 'exit 2', 'declared count ≠ rows', 'nothing written'],
	['row_shape_mismatch', 'exit 2', 'row width ≠ columns', 'nothing written'],
	['digest_mismatch', 'exit 2', 'row edited after capture', 'nothing written'],
	['apply_failed', 'exit 1', 'batch rejected by a constraint', 'batch rolled back'],
	['readback_mismatch', 'exit 1', 'post-commit export differs', 'reported, never success'],
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

function projectVersion() {
	try {
		const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
		return typeof pkg.version === 'string' ? pkg.version : 'unknown';
	} catch {
		return 'unknown';
	}
}

function render(report) {
	const results = report.testResults ?? [];
	const assertions = results.flatMap((file) =>
		(file.assertionResults ?? []).map((test) => ({
			title: test.title,
			status: test.status,
			ms: test.duration ?? 0,
		})),
	);
	const passed = assertions.filter((a) => a.status === 'passed').length;
	const failed = assertions.filter((a) => a.status === 'failed').length;
	const durationMs = Math.round(
		results.reduce((sum, file) => sum + (file.endTime - file.startTime), 0),
	);

	const fixtureRows = FIXTURE.map(
		([name, rows, shape]) =>
			`<tr><td><code>${escapeHtml(name)}</code></td><td class="num">${rows}</td><td>${escapeHtml(shape)}</td></tr>`,
	).join('\n');

	const procedureRows = PROCEDURE.map(
		([step, action, code, evidence]) =>
			`<tr><td class="num">${step}</td><td><b>${escapeHtml(action)}</b></td><td><code>${escapeHtml(code)}</code></td><td>${escapeHtml(evidence)}</td></tr>`,
	).join('\n');

	const failureRows = FAILURES.map(
		([reason, exit, trigger, state]) =>
			`<tr><td><code>${escapeHtml(reason)}</code></td><td><code>${escapeHtml(exit)}</code></td><td>${escapeHtml(trigger)}</td><td class="${state === 'batch rolled back' || state === 'nothing created' || state === 'nothing written' ? 'ok' : ''}">${escapeHtml(state)}</td></tr>`,
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
<title>D1 backup / restore proof — Issue #461</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 26px 0 8px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 20px; font-size: 13px; max-width: 108ch; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 132px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; margin-bottom: 4px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  tr:last-child td { border-bottom: none; }
  .num { text-align: right; width: 64px; font-variant-numeric: tabular-nums; }
  .status { font-weight: 700; width: 64px; }
  tr.passed .status { color: #1c6b3a; }
  tr.failed .status { color: #a12020; }
  .ms { text-align: right; color: #77776a; width: 80px; }
  .lede { background: #fff; border: 1px solid #dedcd2; border-left: 4px solid #1c6b3a; padding: 10px 14px; margin: 16px 0 4px; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>D1 バックアップ / リストア proof (Issue #461)</h1>
  <p class="sub">
    local workerd の D1 binding (<code>env.DB</code>) に合成行を seed し、
    export → drop → import → read-back を実行した結果。本番 DB・remote D1・
    credential・deploy は一切使っていない。fixture の行は固定文字列・固定数値・
    3 byte の BLOB だけで、個人情報も実在の識別子も含まない。
  </p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v">${failed}</div></div>
    <div class="card"><div class="k">duration</div><div class="v">${durationMs}<span style="font-size:13px"> ms</span></div></div>
    <div class="card"><div class="k">restored</div><div class="v">2<span style="font-size:13px"> tables / 6 rows</span></div></div>
    <div class="card"><div class="k">digest</div><div class="v" style="font-size:16px">sha256</div></div>
  </div>

  <h2>fixture（合成データ）</h2>
  <table>
    <thead><tr><th style="width:380px">object</th><th class="num">rows</th><th>shape</th></tr></thead>
    <tbody>
${fixtureRows}
    </tbody>
  </table>

  <h2>実行した手順</h2>
  <table>
    <thead><tr><th class="num">#</th><th style="width:120px">step</th><th style="width:360px">code</th><th>evidence</th></tr></thead>
    <tbody>
${procedureRows}
    </tbody>
  </table>

  <h2>失敗時の挙動（書き込まない / 半端に書かない）</h2>
  <table>
    <thead><tr><th style="width:300px">reason</th><th style="width:80px">exit</th><th style="width:260px">trigger</th><th>database after</th></tr></thead>
    <tbody>
${failureRows}
    </tbody>
  </table>

  <p class="lede">
    import は <b>1 回の D1 batch</b>（D1 が単一 transaction として実行する）で行う。
    途中の INSERT が制約違反で失敗した場合、同じ batch の <code>CREATE TABLE</code> も
    含めて rollback され、テーブルは 1 つも残らない。unreadable / partial / digest 不一致は
    batch を組み立てる前に拒否するため、DB には 1 文も届かない。
  </p>

  <h2>実行結果</h2>
  <table>
    <thead><tr><th style="width:64px">result</th><th>test</th><th style="width:80px">time</th></tr></thead>
    <tbody>
${testRows}
    </tbody>
  </table>

  <footer>my-web-2026 ${escapeHtml(projectVersion())} · Issue #461 · report generated locally from the workerd test pool by scripts/make-d1-backup-restore-report.mjs (no credential, no remote D1, no production, no database id, no row values) · committed artefact: ${escapeHtml(relative(ROOT, TARGET))} (width ≤ ${WIDTH}, ${escapeHtml(extname(TARGET).slice(1))} quality ${QUALITY}).</footer>
</body>
</html>
`;
}

async function shoot(htmlPath, target) {
	const extension = extname(target);
	if (extension !== '.webp' && extension !== '.png') {
		throw new Error(`verification artefact must be .webp or .png: ${target}`);
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
		const capture = await page.screenshot({ fullPage: true });
		const image = sharp(capture).resize({ width: WIDTH, withoutEnlargement: true });
		return extension === '.webp'
			? image.webp({ quality: QUALITY }).toFile(target)
			: image.png({ compressionLevel: 9 }).toFile(target);
	} finally {
		await browser.close();
	}
}

const report = run();
writeFileSync(HTML_REPORT, render(report));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
const info = await shoot(HTML_REPORT, TARGET);
process.stdout.write(
	`wrote ${relative(ROOT, TARGET)} (${extname(TARGET).slice(1)} ${info.width}x${info.height}, ${info.size} B)\n`,
);
