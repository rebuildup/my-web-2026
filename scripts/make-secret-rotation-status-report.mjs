#!/usr/bin/env node
/**
 * Secret drift / rotation-deadline verification report (Issue #477).
 *
 * Why a report at all
 * -------------------
 * The gate's own output is status-only by contract, so a CI log carries
 * three words per row. This page renders the same verdicts as a
 * reviewable artefact: what the tool decides for an inventory that
 * matches, for one whose recorded observation reports a name missing,
 * for a rotation past its cadence, for a name the environment holds but
 * the Worker does not bind, for the state this repository is actually
 * in today (no observation, no recorded rotation date), and for the
 * fail-closed state where a recorded listing carries something that is
 * not a name.
 *
 * What is on the page, and what is not
 * -----------------------------------
 * Every row is produced by RUNNING the same pure seam the CLI uses over
 * the recorded cases in `quality/fixtures/secret-rotation-status/`. The
 * `expect` block each case declares is what
 * `scripts/check-secret-rotation-status.test.mjs` asserts, so a number
 * on the page cannot drift from the assertions behind it. No secret
 * value appears anywhere: the fixtures hold names only, and the page is
 * run through the same leak guard the CLI applies to its own output
 * before a byte is written — a leak fails the command rather than
 * producing a page.
 *
 * The production observation is deliberately absent. It needs an
 * Infisical credential and an operator, so this page states the exact
 * commands instead of faking their output — the same rule the R2
 * key-set report follows (Issue #577).
 *
 * Usage:
 *   node scripts/make-secret-rotation-status-report.mjs [--out=<path>]
 *
 * Exit codes: 0 = page written, 1 = a case contradicted its own
 * expectation, or a value reached the page.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_ONLY_SECRETS, REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';
import {
	VERDICT,
	assertNoValueInText,
	collectNonNameTokens,
	evaluateSecretStatus,
	exitCodeForReport,
	formatStatusReport,
	parseLedger,
	parseObservation,
	undecidableStatus,
} from './_secret-rotation-status.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = resolve(ROOT, 'quality', 'fixtures', 'secret-rotation-status');
const LEDGER_PATH = resolve(ROOT, 'quality', 'secret-rotation-ledger.json');
const DEFAULT_OUT = resolve(ROOT, '.tmp', 'secrets-status-only-report.html');
const CONTRACT = { required: REQUIRED_RUNTIME_SECRETS, auditOnly: AUDIT_ONLY_SECRETS };

/** Rendered in this order: pass, advisory, then the two failure shapes. */
const CASES = [
	'in-sync.json',
	'unexpected-name.json',
	'unrecorded.json',
	'name-missing.json',
	'overdue.json',
	'malformed-observation.json',
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
	return String(value).replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
	);
}

/**
 * Run one recorded case through the same seam the CLI uses, and return
 * the report, its rendered text, and the tokens the leak guard must
 * refuse to see on the page.
 */
function evaluateCase(fileName) {
	const fixture = JSON.parse(readFileSync(resolve(FIXTURE_DIR, fileName), 'utf8'));
	const ledger = parseLedger(JSON.stringify(fixture.ledger));
	if (!ledger.ok) {
		const report = undecidableStatus(ledger.reason, fixture.now ?? '-');
		return { fileName, fixture, report, keys: [], observed: fixture.observation ?? null };
	}
	let observation = null;
	if (fixture.observation) {
		const parsed = parseObservation(fixture.observation);
		if (!parsed.ok) {
			return {
				fileName,
				fixture,
				report: undecidableStatus(parsed.reason, fixture.now ?? '-'),
				keys: [],
				observed: fixture.observation,
			};
		}
		observation = parsed.observation;
	}
	const report = evaluateSecretStatus({
		ledger: ledger.ledger,
		contract: CONTRACT,
		observation,
		now: fixture.now,
	});
	return { fileName, fixture, report, keys: [], observed: fixture.observation ?? null };
}

function renderCase(entry) {
	const { report } = entry;
	const klass =
		report.verdict === VERDICT.ok
			? 'ok'
			: report.verdict === VERDICT.undecidable
				? 'unknown'
				: 'fail';
	return `<tr>
  <th scope="row">${escapeHtml(entry.fixture.case)}</th>
  <td><code>${escapeHtml(entry.fileName)}</code></td>
  <td class="verdict ${klass}">${escapeHtml(report.verdict)}</td>
  <td><code>${escapeHtml(exitCodeForReport(report))}</code></td>
  <td>${report.counts.driftFailures}</td>
  <td>${report.counts.overdue}</td>
  <td>${report.counts.advisory}</td>
  <td><code>${escapeHtml(report.reason)}</code></td>
</tr>`;
}

function renderRows(entry) {
	return entry.report.rows
		.map(
			(row) => `<tr>
  <th scope="row"><code>${escapeHtml(row.name)}</code></th>
  <td>${escapeHtml(row.tier)}</td>
  <td>${escapeHtml(row.drift)}</td>
  <td>${escapeHtml(row.deadline)}</td>
  <td><code>${escapeHtml(row.cadence)}</code></td>
  <td><code>${escapeHtml(row.due ?? '-')}</code></td>
  <td>${escapeHtml(row.remainingDays ?? '-')}</td>
</tr>`,
		)
		.join('\n');
}

function renderOutput(entry) {
	const text = formatStatusReport(entry.report, {
		source: 'fixture',
		ledger: `quality/fixtures/secret-rotation-status/${entry.fileName}`,
		contract: 'scripts/_cloudflare-contract.mjs',
	});
	return `<figure>
  <figcaption>${escapeHtml(entry.fixture.case)} — CLI 出力（status-only）</figcaption>
  <pre>${escapeHtml(text.trim())}</pre>
  <p class="note">${escapeHtml(entry.fixture.note ?? '')}</p>
</figure>`;
}

function renderState() {
	const ledger = parseLedger(readFileSync(LEDGER_PATH, 'utf8'));
	if (!ledger.ok) {
		return `<p class="lede">repository ledger is unreadable (${escapeHtml(ledger.reason)}).</p>`;
	}
	const report = evaluateSecretStatus({
		ledger: ledger.ledger,
		contract: CONTRACT,
		now: new Date(),
	});
	const text = formatStatusReport(report, {
		source: 'repository',
		ledger: 'quality/secret-rotation-ledger.json',
		contract: 'scripts/_cloudflare-contract.mjs',
	});
	return `<pre>${escapeHtml(text.trim())}</pre>`;
}

function buildPage({ entries, outPath, generatedAt }) {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Secret drift / rotation deadline status report — Issue #477</title>
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
    --warn: #8a6d1f;
    --warn-bg: #fdf6e3;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 44px 56px; background: var(--canvas); color: var(--ink);
    font: 15px/1.65 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 18px; margin-bottom: 26px; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: 0.01em; }
  h2 { font-size: 16px; margin: 32px 0 10px; letter-spacing: 0.02em; }
  h3 { font-size: 13px; margin: 22px 0 8px; letter-spacing: 0.04em; color: var(--muted); }
  .meta { color: var(--muted); font-size: 13px; margin: 0; }
  p.lede { margin: 0 0 10px; color: var(--muted); max-width: 78ch; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); font-size: 13px; margin-bottom: 14px; }
  th, td { border: 1px solid var(--line); padding: 8px 11px; text-align: left; vertical-align: top; }
  thead th { background: #eef0f2; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  tbody th { font-weight: 600; }
  .verdict { font-weight: 700; }
  .verdict.ok { color: var(--ok); background: var(--ok-bg); }
  .verdict.fail { color: var(--fail); background: var(--fail-bg); }
  .verdict.unknown { color: var(--warn); background: var(--warn-bg); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: #eef0f2; padding: 1px 5px; border-radius: 4px; word-break: break-all; }
  pre { background: var(--surface); border: 1px solid var(--line); padding: 12px 14px; overflow-x: auto; }
  figure { margin: 0 0 22px; }
  figcaption { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  p.note { color: var(--muted); font-size: 12px; margin: 6px 0 0; max-width: 78ch; }
  footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Secret drift / rotation 期限 ステータスレポート</h1>
  <p class="meta">Issue #477 · my-web-2026 ${escapeHtml(projectVersion())} · 生成: ${escapeHtml(generatedAt)} · ${escapeHtml(outPath)}</p>
</header>

<p class="lede">
  <code>pnpm run infisical:check:coverage</code> と rotation runbook の status-only 出力を
  一つの判定にまとめ、<strong>drift（不一致）</strong>・<strong>不足</strong>・
  <strong>期限切れ</strong>を名前・件数・日付だけで可視化する。secret 値は読み取らず、
  どこにも保存しない（AGENTS.md §4）。
</p>

<h2>1. 判定表（記録済みケースを実際に実行した結果）</h2>
<table>
  <thead><tr><th>ケース</th><th>fixture</th><th>verdict</th><th>exit</th><th>drift_failures</th><th>overdue</th><th>advisory</th><th>reason</th></tr></thead>
  <tbody>
${entries.map(renderCase).join('\n')}
  </tbody>
</table>

<h2>2. 名前ごとの判定</h2>
${entries
	.map(
		(entry) => `<h3>${escapeHtml(entry.fixture.case)} — ${escapeHtml(entry.fileName)}</h3>
<table>
  <thead><tr><th>name</th><th>tier</th><th>drift</th><th>deadline</th><th>cadence</th><th>due</th><th>remaining_days</th></tr></thead>
  <tbody>
${renderRows(entry)}
  </tbody>
</table>`,
	)
	.join('\n')}

<h2>3. CLI 出力（status-only）</h2>
${entries.map(renderOutput).join('\n')}

<h2>4. このリポジトリが今日持つ状態</h2>
<p class="lede">
  <code>quality/secret-rotation-ledger.json</code>（=<code>docs/runbook/infisical-secrets.md</code> §2.1 の
  cadence 列の機械可読投影）を観測ファイル無しで走らせた結果。観測が無いので環境側は
  判定できておらず、各行が <code>NOT_OBSERVED</code> と出る。これは「一致」ではない。
</p>
${renderState()}

<h2>5. 観測手順（operator）</h2>
<p class="lede">
  環境側は credential が要るので operator が既存スクリプトの status-only 出力を記録して渡す。
  本 gate は Infisical を直接読まない。
</p>
<pre>pnpm run infisical:check:cf -- --execute --environment=prod &gt; .tmp/cf-secrets-prod.txt
pnpm run secrets:status:check -- --observation=.tmp/cf-secrets-prod.txt</pre>

<h2>6. 修復手順</h2>
<table>
  <thead><tr><th>観測</th><th>意味</th><th>対応</th></tr></thead>
  <tbody>
    <tr><th scope="row"><code>MISSING</code></th><td>契約の required name を観測した環境が持っていない</td><td>契約の canonical path で再投入する（<code>docs/runbook/cloudflare-workers-builds.md</code>）。値の貼付けは禁止。投入後は同じ観測を取り直す。</td></tr>
    <tr><th scope="row"><code>MISSING_ROW</code> / <code>EXTRA_ROW</code></th><td><code>quality/secret-rotation-ledger.json</code> が契約の inventory を正確に覆っていない</td><td>行を追加 / 削除する。runtime secret の追加手順は <code>docs/runbook/infisical-secrets.md</code> §4.1。</td></tr>
    <tr><th scope="row"><code>OVERDUE</code></th><td>cadence を超過</td><td>runbook の driver を operator 承認付きで実行し、rotation と同じ PR で <code>last_rotated_at</code> を更新する。</td></tr>
    <tr><th scope="row"><code>DUE_SOON</code> / <code>UNRECORDED</code></th><td>期限が近い / 記録が無い（advisory）</td><td>rotation 実施日の記録と、必要なら rotation。運用の判断であり gate は fail させない。</td></tr>
    <tr><th scope="row"><code>UNEXPECTED</code></th><td>環境が契約に無い name を持つ</td><td>ADR-0015 §1.4 上は正常。削除要否は owner 判断。gate は報告のみ。</td></tr>
    <tr><th scope="row"><code>UNDECIDABLE</code></th><td>ledger / observation を読めない、または parse できない</td><td>exit 2。まず入力を直す（値は貼らない。記録された name の形だけで直す）。実行手順は <code>docs/runbook/secret-rotation-status.md</code> §5。</td></tr>
  </tbody>
</table>

<h2>7. この gate がしないこと</h2>
<p class="lede">
  secret 値の照合はしない。Cloudflare の Worker binding 値も読み戻せない（Cloudflare API に
  値読み取り endpoint が無い）ため、この gate が扱うのは既存の status-only な name parity と、
  runbook の cadence から計算した期限だけ。rotation の実行・運用承認・本番 deploy は
  <code>docs/runbook/cloudflare-workers-builds.md</code> の operator flow に残る。
</p>

<footer>
  status-only 契約: secret 値・値断片・credential・生のエラー本文は出力しない。
  書き出し前に同じ leak guard を通しており、1 件でも通れば本コマンドは非ゼロ終了する。
</footer>
</body>
</html>
`;
}

function main() {
	const outArg = process.argv.slice(2).find((arg) => arg.startsWith('--out='));
	const outPath = outArg ? resolve(process.cwd(), outArg.slice('--out='.length)) : DEFAULT_OUT;

	const entries = CASES.map(evaluateCase);

	// The expectation each case declares is what the unit test asserts;
	// a mismatch means the page would show a verdict the suite does not
	// believe.
	for (const entry of entries) {
		const expect = entry.fixture.expect ?? {};
		const actual = {
			verdict: entry.report.verdict,
			exit_code: exitCodeForReport(entry.report),
			advisory: entry.report.counts.advisory,
			drift_failures: entry.report.counts.driftFailures,
			overdue: entry.report.counts.overdue,
		};
		for (const [key, value] of Object.entries(expect)) {
			if (actual[key] !== value) {
				process.stderr.write(
					`fixture ${entry.fileName} expected ${key}=${value} but the status decided ${key}=${actual[key]}\n`,
				);
				return 1;
			}
		}
	}

	const page = buildPage({ entries, outPath, generatedAt: new Date().toISOString() });
	try {
		assertNoValueInText(
			page,
			entries.flatMap((entry) => collectNonNameTokens(entry.observed)),
		);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 1;
	}

	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, page);
	process.stdout.write(
		`[secrets-status-report] wrote ${outPath} (${entries.length} cases, no secret value on the page)\n`,
	);
	return 0;
}

process.exit(main());
