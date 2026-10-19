#!/usr/bin/env node
/**
 * R2 key-set audit verification report (Issue #577, owner option (a)).
 *
 * Why a report at all
 * -------------------
 * The gate's own output is status-only by contract, so there is
 * nothing to read in a CI log beyond three verdict words. This page
 * renders the same verdicts as a reviewable artefact: what the gate
 * decides for a clean bucket, for a bucket holding one object the
 * allowlist does not cover, and for the two states in which it must
 * refuse to decide at all.
 *
 * What is on the page, and what is not
 * -----------------------------------
 * Every row is produced by RUNNING the audit over a recorded listing in
 * `quality/fixtures/r2-media-key-set/` — the expected values in those
 * fixtures are what the unit test asserts, so a number on the page
 * cannot drift from the assertions that produced it. No object key, no
 * key fragment, no credential, and no bucket listing appear anywhere on
 * the page: the fixtures' keys are run through the same leak guard the
 * CLI uses before a single byte is written, and a leak fails the
 * command rather than producing a page.
 *
 * The production verdict is deliberately **absent** from this page. It
 * needs an R2-scoped credential, and no GitHub Actions workflow in this
 * repository holds one (`docs/runbook/cloudflare-workers-builds.md`),
 * so the production run is an operator step; the page states the exact
 * command instead of faking its output.
 *
 * Usage:
 *   node scripts/make-r2-media-key-set-report.mjs [--out=<path>]
 *
 * Exit codes: 0 = page written, 1 = a key reached the page.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_MEDIA_PREFIXES, isPublicMediaKey } from '../src/cloudflare/media-visibility.ts';
import {
	VERDICT,
	assertNoKeyInText,
	auditKeySet,
	exitCodeFor,
	formatAuditReport,
	readPageKeys,
	undecidableAudit,
} from './_r2-media-key-set.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = resolve(ROOT, 'quality', 'fixtures', 'r2-media-key-set');
const DEFAULT_OUT = resolve(ROOT, '.tmp', 'r2-media-key-set-report.html');

/** Fixtures are rendered in this order: pass, fail, then fail-closed. */
const CASES = [
	'clean.json',
	'out-of-allowlist.json',
	'empty-listing.json',
	'unparseable-listing.json',
];

function projectVersion() {
	try {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
		return typeof pkg.version === 'string' ? pkg.version : 'unknown';
	} catch {
		return 'unknown';
	}
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Audit one recorded listing through the same seam the CLI uses.
 * Returns the report text, the verdict, and the keys — the keys are
 * returned only so the caller can prove they never reached the page.
 */
function auditFixture(fileName) {
	const fixture = JSON.parse(readFileSync(resolve(FIXTURE_DIR, fileName), 'utf8'));
	const read = readPageKeys(fixture.listing);
	const audit =
		'reason' in read
			? undecidableAudit(read.reason)
			: read.keys.length === 0
				? undecidableAudit('listing_empty')
				: auditKeySet(read.keys, isPublicMediaKey);
	const text = formatAuditReport(audit, {
		source: 'fixture',
		target: 'fixture',
		bucket: 'my-web-2026',
		prefixCount: PUBLIC_MEDIA_PREFIXES.length,
		prefixSource: 'src/cloudflare/media-visibility.ts',
	});
	return {
		fileName,
		label: fixture.case,
		expect: fixture.expect,
		audit,
		text,
		keys: 'keys' in read ? read.keys : [],
	};
}

function renderCase(entry) {
	return `<tr>
  <th scope="row">${escapeHtml(entry.label)}</th>
  <td><code>${escapeHtml(entry.fileName)}</code></td>
  <td class="verdict ${entry.audit.verdict === VERDICT.ok ? 'ok' : 'fail'}">${escapeHtml(entry.audit.verdict)}</td>
  <td><code>${escapeHtml(exitCodeFor(entry.audit))}</code></td>
  <td>${entry.audit.keysTotal === null ? 'unknown' : escapeHtml(entry.audit.keysTotal)}</td>
  <td>${entry.audit.keysOutsideAllowlist === null ? 'unknown' : escapeHtml(entry.audit.keysOutsideAllowlist)}</td>
  <td><code>${escapeHtml(entry.audit.reason)}</code></td>
</tr>`;
}

function renderOutput(entry) {
	return `<figure>
  <figcaption>${escapeHtml(entry.label)} — CLI 出力（status-only）</figcaption>
  <pre>${escapeHtml(entry.text.trim())}</pre>
</figure>`;
}

function buildPage({ entries, outPath }) {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>R2 key-set audit verification report — Issue #577</title>
<style>
  :root {
    color-scheme: light;
    --ink: #14171a;
    --muted: #5d646b;
    --line: #d9dde1;
    --surface: #ffffff;
    --canvas: #f6f7f8;
    --ok: #14663c;
    --ok-bg: #e8f5ee;
    --fail: #8c1d1d;
    --fail-bg: #fdecec;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 44px 56px; background: var(--canvas); color: var(--ink);
    font: 15px/1.65 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 18px; margin-bottom: 26px; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: 0.01em; }
  h2 { font-size: 16px; margin: 32px 0 10px; letter-spacing: 0.02em; }
  .meta { color: var(--muted); font-size: 13px; margin: 0; }
  p.lede { margin: 0 0 10px; color: var(--muted); max-width: 76ch; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); font-size: 13px; }
  th, td { border: 1px solid var(--line); padding: 9px 11px; text-align: left; vertical-align: top; }
  thead th { background: #eef0f2; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  tbody th { font-weight: 600; }
  .verdict { font-weight: 700; }
  .verdict.ok { color: var(--ok); background: var(--ok-bg); }
  .verdict.fail { color: var(--fail); background: var(--fail-bg); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: #eef0f2; padding: 1px 5px; border-radius: 4px; word-break: break-all; }
  pre { background: var(--surface); border: 1px solid var(--line); padding: 12px 14px; overflow-x: auto; }
  figure { margin: 0 0 18px; }
  figcaption { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>R2 key-set 監査レポート</h1>
  <p class="meta">Issue #577 · my-web-2026 ${escapeHtml(projectVersion())} · 生成: ${escapeHtml(new Date().toISOString())} · ${escapeHtml(outPath)}</p>
</header>

<p class="lede">
  公開 R2 custom domain は Worker を迂回するため、<code>MEDIA</code> bucket に存在する key は
  匿名で取得できます。本 gate は bucket の key 集合を読み取り専用で列挙し、
  <code>PUBLIC_MEDIA_PREFIXES</code>（<code>src/cloudflare/media-visibility.ts</code> が所有、外側に再宣言なし）
  の外側に 1 件でもあれば release gate を fail させます。判定できない状態
  （credential 無し / API 失敗 / 解析不能 / 空の production key 集合 / 列挙不完全）も
  fail-closed で fail します。
</p>

<h2>1. 判定表（記録済み listing を実際に実行した結果）</h2>
<table>
  <thead><tr><th>ケース</th><th>fixture</th><th>verdict</th><th>exit</th><th>keys_total</th><th>keys_outside_allowlist</th><th>reason</th></tr></thead>
  <tbody>
${entries.map(renderCase).join('\n')}
  </tbody>
</table>

<h2>2. CLI 出力（status-only）</h2>
${entries.map(renderOutput).join('\n')}

<h2>3. 本番 gate の実行方法</h2>
<p class="lede">
  本番 verdict はこの repo のどの CI workflow にも出自しません。GitHub Actions は
  Cloudflare credential を保持しないため（<code>docs/runbook/cloudflare-workers-builds.md</code>）、
  R2 スコープ credential を保持した operator が release 前に実行します。出力は
  verdict / 件数 / reason code のみで、object key・key 断片・credential を出しません。
</p>
<pre>CLOUDFLARE_R2_API_TOKEN=… pnpm run r2:media:audit      # 本番 read-only 監査（release gate）
pnpm run r2:media:audit:local                          # ローカル store（配線確認のみ）
pnpm run r2:media:audit -- --fixture=&lt;path&gt;         # デモ用途（release verdict ではない）</pre>

<h2>4. この gate が強制しないこと</h2>
<p class="lede">
  namespace allowlist の外にある object がないことしか強制しません。allowlist の
  <em>内</em>にある未公開 object（draft project の cover など）は custom domain から
  取得できるままで、判定には D1 の公開状態を読みません。bucket 分割（owner 案 b）や
  Worker 経由配信（同 c）を採るまでは、この残差はドキュメント上の期待事項として
  <code>docs/security/r2-media-visibility.md</code> に明記されています。
</p>

<footer>
  status-only 契約: object key・key 断片・credential・bucket の一覧は出力しません。
  実行前に同じ leak guard を通しており、1 件でも通れば本コマンドは非ゼロ終了します。
</footer>
</body>
</html>
`;
}

function main() {
	const outArg = process.argv.slice(2).find((arg) => arg.startsWith('--out='));
	const outPath = outArg ? resolve(process.cwd(), outArg.slice('--out='.length)) : DEFAULT_OUT;

	const entries = CASES.map(auditFixture);
	// The expectation each fixture declares is what the unit test
	// asserts; a mismatch here means the page would show a verdict the
	// suite does not believe.
	for (const entry of entries) {
		if (
			entry.audit.verdict !== entry.expect.verdict ||
			exitCodeFor(entry.audit) !== entry.expect.exitCode
		) {
			process.stderr.write(
				`fixture ${entry.fileName} expected ${entry.expect.verdict}/${entry.expect.exitCode} but the audit decided ${entry.audit.verdict}/${exitCodeFor(entry.audit)}\n`,
			);
			return 1;
		}
	}

	const page = buildPage({ entries, outPath });
	// Same guard the CLI applies to its own output: the page may not
	// name an object key.
	try {
		assertNoKeyInText(
			page,
			entries.flatMap((entry) => entry.keys),
		);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 1;
	}

	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, page);
	process.stdout.write(
		`[r2-key-set-report] wrote ${outPath} (${entries.length} cases, no object key on the page)\n`,
	);
	return 0;
}

process.exit(main());
