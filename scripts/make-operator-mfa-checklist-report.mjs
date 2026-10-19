#!/usr/bin/env node
/**
 * Operator MFA checklist verification report (Issue #469).
 *
 * Why a report at all
 * -------------------
 * The gate's own output is status-only by contract, so a CI log holds
 * three verdict words and a table of service ids. This page renders the
 * same verdicts as something a reviewer can read: the shipped operator
 * ledger (the real checklist, still 未確認) next to six recorded cases
 * covering pass / 未確認 / missing / stale / self-contradictory /
 * identifier-bearing, and the status-only CLI text for each of them.
 *
 * Every row is produced by RUNNING the audit over
 * `quality/fixtures/operator-mfa/` through the same seam the CLI uses, and
 * the report refuses to be written unless each fixture still decides the
 * verdict it declares — so a number on the page cannot drift from the
 * assertions that produced it (`scripts/check-operator-mfa.test.mjs`).
 *
 * What is on the page, and what is not
 * -----------------------------------
 * A service id, a state, an ISO date, a factor kind, a reason code. No
 * account identifier, no enrolment list, no credential, no recovery code:
 * the ledger schema has no field for one, and the page plus every CLI
 * transcript it embeds go through the anonymization guard before a byte
 * is written. A finding fails the command instead of producing a page.
 *
 * The production verdict is deliberately ABSENT in the same sense the R2
 * key-set audit is: reading a provider console is not something this
 * repository may do, so the page states the command an operator runs and
 * never fakes its result. The shipped ledger row is therefore an honest
 * 未確認, not a green tick this repository cannot earn.
 *
 * Usage:
 *   node scripts/make-operator-mfa-checklist-report.mjs [--out=<path>]
 *                                                        [--skip-screenshot]
 *                                                        [--fixtures=<dir>]
 *                                                        [--ledger=<path>]
 *
 * Output: `.tmp/operator-mfa-checklist-report.html` (gitignored) and
 * `docs/verification/security/operator-mfa-checklist.webp` — the path
 * Issue #469 requires in the PR body, with the `.webp` extension
 * substituted for the Issue's literal `.png`.
 *
 * Exit codes: 0 = page written, 1 = a fixture drifted from its declared
 * verdict, 2 = the anonymization guard refused the page.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	VERDICT,
	assertNoSensitiveInText,
	auditLedger,
	exitCodeFor,
	formatAuditReport,
	readFixture,
} from './_operator-mfa-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = resolve(ROOT, 'quality', 'fixtures', 'operator-mfa');
const SHIPPED_LEDGER = resolve(ROOT, 'quality', 'operator-mfa-ledger.json');
const DEFAULT_OUT = resolve(ROOT, '.tmp', 'operator-mfa-checklist-report.html');
const WEBP_TARGET = resolve(
	ROOT,
	'docs',
	'verification',
	'security',
	'operator-mfa-checklist.webp',
);
const WEBP_WIDTH = 1280;

/**
 * The page is text-dense, so it is encoded near-lossless: a lossy WebP
 * keeps the byte count down only by smearing the very characters a
 * reviewer is reading. The ladder starts at the sharpest step that fits
 * the budget and steps down.
 */
const WEBP_QUALITY_LADDER = [
	{ quality: 80, nearLossless: true, grayscale: false },
	{ quality: 70, nearLossless: true, grayscale: false },
	{ quality: 60, nearLossless: true, grayscale: false },
	{ quality: 50, nearLossless: true, grayscale: false },
	{ quality: 40, nearLossless: true, grayscale: false },
	{ quality: 48, nearLossless: false, grayscale: true },
	{ quality: 40, nearLossless: false, grayscale: true },
	{ quality: 32, nearLossless: false, grayscale: true },
];
const WEBP_MAX_BYTES = 300 * 1024;

/** Rendered in this order: the real ledger first, then pass → 未確認 → fail-closed. */
const FIXTURES = [
	'all-confirmed.json',
	'one-unconfirmed.json',
	'missing-service.json',
	'stale-confirmation.json',
	'self-inconsistent.json',
	'account-identifier.json',
];

function projectVersion() {
	try {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
		return typeof pkg.version === 'string' ? pkg.version : 'unknown';
	} catch {
		return 'unknown';
	}
}

function headSha() {
	try {
		return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
			cwd: ROOT,
			encoding: 'utf8',
		}).trim();
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

/** Read one `--name=<value>` flag, or `undefined` when it was not passed. */
function argValue(argv, name) {
	const found = argv.find((arg) => arg.startsWith(name));
	return found ? found.slice(name.length) : undefined;
}

/** Audit one recorded fixture through the same seam the CLI uses. */
function auditFixture(fileName, fixtureDir = FIXTURE_DIR) {
	const path = resolve(fixtureDir, fileName);
	const text = readFileSync(path, 'utf8');
	const read = readFixture(text);
	if ('reason' in read) throw new Error(`fixture ${fileName} is not readable: ${read.reason}`);
	const audit = auditLedger(read.fixture.ledger, { now: read.fixture.now });
	return {
		kind: 'fixture',
		label: read.fixture.case,
		note: read.fixture.note,
		fileName,
		expect: read.fixture.expect,
		audit,
		text: formatAuditReport(audit, { source: `fixture ${fileName}` }),
	};
}

/** Audit the shipped ledger against the real clock. */
function auditShippedLedger(path = SHIPPED_LEDGER) {
	const text = readFileSync(path, 'utf8');
	const audit = auditLedger(text, { now: new Date() });
	return {
		kind: 'ledger',
		label: 'この repository が持つ運用者チェック表（未記入）',
		note:
			'Agent は provider console を読めません。したがって日付を埋めず、空の記録のまま出荷しています。' +
			'運用者が `quality/operator-mfa-ledger.json` を記入するまで、この行は 未確認 のままです。',
		fileName: 'quality/operator-mfa-ledger.json',
		expect: null,
		audit,
		text: formatAuditReport(audit, { source: 'ledger quality/operator-mfa-ledger.json' }),
	};
}

function verdictClass(verdict) {
	if (verdict === VERDICT.ok) return 'ok';
	if (verdict === VERDICT.undecidable) return 'unknown';
	return 'warn';
}

function renderSummary(entry) {
	const { audit } = entry;
	return `<tr>
  <th scope="row">${escapeHtml(entry.label)}</th>
  <td><code>${escapeHtml(entry.fileName)}</code></td>
  <td class="verdict ${verdictClass(audit.verdict)}">${escapeHtml(audit.verdict)}</td>
  <td><code>${escapeHtml(exitCodeFor(audit))}</code></td>
  <td>${audit.counts.confirmed}</td>
  <td>${audit.counts.unconfirmed}</td>
  <td>${audit.counts.stale}</td>
  <td>${audit.counts.missing}</td>
  <td><code>${escapeHtml(audit.reason)}</code></td>
</tr>`;
}

function renderRows(entry) {
	if (entry.audit.rows.length === 0) {
		return `<p class="note">判定できないため行を出さない（_partial な結果を pass に見せない_）。</p>`;
	}
	const body = entry.audit.rows
		.map(
			(row) => `<tr>
  <th scope="row">${escapeHtml(row.label)}<span class="mono"> ${escapeHtml(row.service)}</span></th>
  <td class="state ${escapeHtml(row.state)}">${escapeHtml(row.state)}</td>
  <td class="mono">${escapeHtml(row.confirmedAt ?? '-')}</td>
  <td class="mono">${escapeHtml(row.factors.length > 0 ? row.factors.join(' / ') : '-')}</td>
  <td class="mono">${escapeHtml(row.reason)}</td>
</tr>`,
		)
		.join('\n');
	return `<table class="rows">
  <thead><tr><th>サービス</th><th>state</th><th>最終確認日</th><th>登録済み factor kind</th><th>reason</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

function renderCase(entry) {
	return `<section class="case">
  <h3>${escapeHtml(entry.label)}</h3>
  <p class="case-note">${escapeHtml(entry.note)}</p>
  ${renderRows(entry)}
  <p class="label">CLI 出力（status-only）</p>
  <pre>${escapeHtml(entry.text.trim())}</pre>
</section>`;
}

function buildPage({ entries, outPath }) {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>運用者 MFA チェックリスト検証レポート — Issue #469</title>
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
    --warn: #8a5a00;
    --warn-bg: #fdf3e0;
    --unknown: #6b2f8a;
    --unknown-bg: #f5ecfa;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 44px 56px;
    background: var(--canvas);
    color: var(--ink);
    font: 15px/1.7 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 18px; margin-bottom: 26px; }
  h1 { font-size: 25px; margin: 0 0 6px; letter-spacing: 0.01em; }
  h2 { font-size: 17px; margin: 34px 0 10px; letter-spacing: 0.02em; }
  h3 { font-size: 15px; margin: 0 0 4px; }
  .meta, .note, .case-note { color: var(--muted); font-size: 13px; }
  p.lede { margin: 0 0 10px; color: var(--muted); max-width: 92ch; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); font-size: 13px; margin: 8px 0 4px; }
  th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
  thead th { background: #eef0f2; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  tbody th { font-weight: 600; }
  .verdict { font-weight: 700; }
  .verdict.ok { color: var(--ok); background: var(--ok-bg); }
  .verdict.warn { color: var(--warn); background: var(--warn-bg); }
  .verdict.unknown { color: var(--unknown); background: var(--unknown-bg); }
  .state { font-weight: 600; }
  .state.confirmed { color: var(--ok); }
  .state.stale, .state.missing { color: var(--warn); }
  .state.unconfirmed { color: var(--unknown); }
  .mono, code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: #eef0f2; padding: 1px 5px; border-radius: 4px; }
  pre { background: var(--surface); border: 1px solid var(--line); padding: 12px 14px; overflow-x: auto; }
  .case { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; margin: 0 0 18px; }
  .case .label { font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); margin: 12px 0 4px; }
  footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<div id="operator-mfa">
<header>
  <h1>運用者 MFA / Passkey 確認チェックリスト — 監査レポート</h1>
  <p class="meta">Issue #469 · my-web-2026 ${escapeHtml(projectVersion())} · head ${escapeHtml(headSha())} · 生成 ${escapeHtml(new Date().toISOString())} · ${escapeHtml(outPath.replace(`${ROOT}/`, ''))}</p>
</header>

<p class="lede">
  GitHub / Cloudflare / Infisical / ドメイン管理の 4 アカウントについて、<strong>運用者がいつ何を確認したか</strong>を
  記録し、その記録が policy を満たしているかを <code>confirmed</code> / <code>unconfirmed</code>（未確認）/
  <code>stale</code> / <code>missing</code> / <code>UNDECIDABLE</code> で表示する。
  判定的政策は <code>scripts/_operator-mfa-audit.mjs</code>、I/O は
  <code>scripts/check-operator-mfa.mjs</code>、チェック表は
  <code>quality/operator-mfa-ledger.json</code>。
</p>
<p class="lede">
  <strong>これは何をしないか:</strong> 4 アカウントの実状態はこの repository から観測できない（provider API も
  binding も持たない）。したがって監査対象は「アカウント」ではなく
  <em>運用者が記入した記録</em> である。credential・enrollment 一覧・recovery code・
  アカウント識別子は schema 上そもそも書けない。
</p>

<h2>1. 判定表（記録済み fixture と出荷済みチェック表を実際に実行した結果）</h2>
<table>
  <thead><tr><th>ケース</th><th>入力</th><th>verdict</th><th>exit</th><th>confirmed</th><th>未確認</th><th>stale</th><th>missing</th><th>reason</th></tr></thead>
  <tbody>
${entries.map(renderSummary).join('\n')}
  </tbody>
</table>
<p class="note">
  fixture の期待値は各ファイルが <code>expect</code> で宣言し、
  <code>node --test scripts/check-operator-mfa.test.mjs</code> が同じ値を assert する。
  乖離があればこのページは生成されない。
</p>

<h2>2. ケース別ステータス（サービス別）</h2>
${entries.map(renderCase).join('\n')}

<h2>3. 運用者の実行手順</h2>
<p class="lede">
  判定は status-only なので、そのまま PR 本文や Issue に貼れる。
</p>
<pre>pnpm run check:operator-mfa                                          # 出荷済みチェック表を監査（exit 0 / 1 / 2）
pnpm run check:operator-mfa -- --fixture=&lt;path&gt;                     # 記録済み fixture のデモ（release verdict ではない）
pnpm run verify:operator-mfa-checklist-screenshot                    # このレポートと WebP を再生成</pre>
<table>
  <thead><tr><th>exit</th><th>verdict</th><th>意味</th></tr></thead>
  <tbody>
    <tr><td><code>0</code></td><td>OK</td><td>4 サービスすべてが policy を満たす記録あり</td></tr>
    <tr><td><code>1</code></td><td>OUTSTANDING</td><td>1 つでも 未確認 / stale / missing。緑ではない</td></tr>
    <tr><td><code>2</code></td><td>UNDECIDABLE</td><td>ledger が読めない・筋が通らない・日付が未来・識別子キーがある。fail-closed</td></tr>
  </tbody>
</table>
<p class="lede">
  記入は <code>quality/operator-mfa-ledger.json</code> に対してだけ行う。
  <code>confirmed_at</code> に最終確認日（ISO 日付）、<code>factors[].kind</code> に
  <code>passkey</code> / <code>security_key</code> / <code>totp_app</code> / <code>otp_sms</code>、
  <code>factors[].confirmed_at</code> にその factor の確認日を書いて保存する。
  手順全文は <code>docs/runbook/operator-mfa-verification.md</code>。
</p>

<h2>4. この gate が強制しないこと</h2>
<p class="lede">
  gate が強制するのは「記録の完全性・整合性・鮮度」であり、
  「そのアカウントに 2 要素が実際に登録されていること」ではない。
  実状態の主張は provider console を確認するという人側の作業であり、
  repository 側の証跡は無いまま <code>policy.status = "proposed"</code> が owner の
  承認を待つ。承認されるまでは <code>OK</code> であっても owner 承認済みとは読めない
  旨を note として出す。ネットワーク・binding・credential store には一切触れない。
</p>

<footer>
  status-only 契約: 出力は service id・state・ISO 日付・factor kind・reason code のみ。
  アカウント識別子・enrollment 一覧・credential は出力せず、ページ生成前に
  anonymization guard を通す。1 件でも通ればコマンドは非ゼロ終了する。
</footer>
</div>
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
	try {
		const page = await browser.newPage({
			viewport: { width: WEBP_WIDTH, height: 1200 },
			deviceScaleFactor: 1,
		});
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		const capture = await page.locator('#operator-mfa').screenshot();
		for (const step of WEBP_QUALITY_LADDER) {
			let pipeline = sharp(capture).resize({ width: WEBP_WIDTH, withoutEnlargement: true });
			if (step.grayscale) pipeline = pipeline.grayscale();
			const buffer = await pipeline
				.webp({ quality: step.quality, nearLossless: step.nearLossless, effort: 6 })
				.toBuffer();
			if (buffer.length <= WEBP_MAX_BYTES) {
				const info = await sharp(buffer).metadata();
				writeFileSync(target, buffer);
				return { width: info.width, height: info.height, bytes: info.size };
			}
		}
		throw new Error(
			`${target} does not fit in ${Math.round(WEBP_MAX_BYTES / 1024)} KB of WebP at width ${WEBP_WIDTH}`,
		);
	} finally {
		await browser.close();
	}
}

async function main() {
	const argv = process.argv.slice(2);
	const outArg = argv.find((arg) => arg.startsWith('--out='));
	const outPath = outArg ? resolve(process.cwd(), outArg.slice('--out='.length)) : DEFAULT_OUT;
	const skipScreenshot = argv.includes('--skip-screenshot');
	const fixtureDir = argValue(argv, '--fixtures=') ?? FIXTURE_DIR;
	const ledgerPath = argValue(argv, '--ledger=') ?? SHIPPED_LEDGER;

	const entries = [
		auditShippedLedger(ledgerPath),
		...FIXTURES.map((name) => auditFixture(name, fixtureDir)),
	];
	for (const entry of entries) {
		if (!entry.expect) continue;
		const { audit, expect } = entry;
		const drift =
			audit.verdict !== expect.verdict ||
			exitCodeFor(audit) !== expect.exitCode ||
			Object.entries(expect.counts).some(([key, value]) => audit.counts[key] !== value) ||
			(expect.reason !== undefined && audit.reason !== expect.reason);
		if (drift) {
			process.stderr.write(
				`fixture ${entry.fileName} drifted from its declared expectation ` +
					`(declared ${expect.verdict}/${expect.exitCode}, decided ${audit.verdict}/${exitCodeFor(audit)})\n`,
			);
			return 1;
		}
	}

	const page = buildPage({ entries, outPath });
	try {
		assertNoSensitiveInText(page);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 2;
	}
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, page);
	process.stdout.write(
		`wrote ${outPath} (${entries.length} cases, no account identifier on the page)\n`,
	);

	if (skipScreenshot) return 0;
	const shot = await shoot(outPath, WEBP_TARGET);
	process.stdout.write(
		`wrote ${WEBP_TARGET.replace(`${ROOT}/`, '')} (webp ${shot.width}x${shot.height}, ${statSync(WEBP_TARGET).size} B)\n`,
	);
	return 0;
}

process.exit(await main());
