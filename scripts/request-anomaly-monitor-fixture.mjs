#!/usr/bin/env node

/**
 * Request anomaly monitor — fixture proof (Issue #481).
 *
 * The claim it exercises
 * ----------------------
 * "When the rate of 401 / 403 / 429 / 5xx answers on a watched surface
 * crosses its threshold, a DETECTION EVENT is generated — and when it
 * does not, nothing is." The Issue asks for the threshold crossing to be
 * reproduced from a test fixture, so that is exactly what this command
 * is: seven recorded traffic fixtures in
 * `quality/fixtures/request-anomaly-monitor/`, pushed through the SHIPPED
 * monitor (`src/http/middleware/anomaly-monitor.ts` — the same module
 * `src/server.ts` feeds), with each fixture's declared expectation
 * checked against what the monitor actually emitted.
 *
 * What it runs against
 * --------------------
 * **Recorded observations, in this process.** A fixture is a list of
 * status codes and an instant per code: no request is issued, no binding
 * is read, no credential exists, and there is no code path here that
 * could reach Cloudflare. The traffic is synthetic by construction, so
 * the "no production credential is ever exercised" rule of the Issue is
 * satisfied structurally rather than by care.
 *
 * Status-only output
 * ------------------
 * Same contract as the R2 key-set audit (Issue #577) and the R2 restore
 * proof (Issue #462): a verdict, counts, and reason codes — never an
 * address, a request header, a path, a credential, or a raw CLI error.
 * The fixture vocabulary cannot carry personal data (it is statuses and
 * counts), and the command additionally scans every rendered byte for
 * address / e-mail / token shapes before writing it, so a future fixture
 * that smuggles one in fails the command instead of publishing it.
 *
 * Usage:
 *   node scripts/request-anomaly-monitor-fixture.mjs
 *   node scripts/request-anomaly-monitor-fixture.mjs --html=.tmp/anomaly-monitor-fixture.html
 *
 * Exit codes:
 *   0  every fixture produced the events it declares (the monitor holds)
 *   1  at least one fixture deviated — the monitor does NOT hold
 *   2  bad input (unreadable fixture, malformed fixture, usage error)
 *
 * A fixture whose expectation says "no event" is a PASSING case: the
 * claim under test is that the monitor is quiet when it should be. What
 * must never happen is a deviation — a reported crossing nobody declared
 * or a missing declared one.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANOMALY_WINDOW_MS, createAnomalyMonitor } from '../src/http/middleware/anomaly-monitor.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = resolve(REPO_ROOT, 'quality', 'fixtures', 'request-anomaly-monitor');

/**
 * Fixed instant every fixture starts from.
 *
 * A recorded fixture must not depend on the clock, or the same file
 * would report different windows on a different day. It is a plain
 * date with no operational meaning: these timestamps exist to place a
 * request inside one window, never to describe when something happened.
 */
export const FIXTURE_EPOCH_MS = Date.UTC(2026, 0, 15, 3, 0, 0);

/** Gap between two consecutive recorded requests (1 second). */
export const FIXTURE_SPACING_MS = 1000;

/**
 * Spacing ceiling. A fixture whose requests straddle a window boundary
 * would be measuring two windows with one expectation; the command
 * refuses such a fixture as bad input rather than quietly diluting it.
 */
export const MAX_FIXTURE_SPACING_MS = ANOMALY_WINDOW_MS - 1;

/**
 * Fields a fixture may declare for a detection event.
 *
 * The list is repeated on purpose: the event type in
 * `src/http/middleware/anomaly-monitor.ts` is the source of truth for
 * the SHIPPED record, and this is the (narrower) set a recorded
 * expectation is allowed to pin. A fixture asserts the numbers an
 * operator reads; timestamps are deliberately not declared, so a
 * fixture edited to move in time cannot silently change a verdict.
 */
const DECLARABLE_FIELDS = [
	'event',
	'surface',
	'signal',
	'status',
	'samples',
	'hits',
	'rate',
	'threshold',
	'minSamples',
];

export const FIXTURE_VERDICT = Object.freeze({ pass: 'pass', fail: 'fail' });

/**
 * Shapes that must never reach stdout, the HTML report, or a committed
 * artefact.
 *
 * The fixture vocabulary (surfaces, statuses, counts, ISO instants) does
 * not contain any of these by construction, so the guard is a backstop
 * for the inputs: a future fixture that smuggles a request header or a
 * note in the shape of a credential fails the command instead of
 * quietly committing it. The shapes are deliberately VALUE-shaped
 * rather than word-shaped — an earlier draft rejected a fixture simply
 * because its case name contained the English word "credential", which
 * is how a leak guard becomes a gate nobody trusts.
 */
const ADDRESS_PATTERN = /\d{1,3}(?:\.\d{1,3}){3}/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const AUTH_SCHEME_PATTERN = /\b(?:bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{8,}/i;
const KEY_PREFIX_PATTERN = /\b(?:mk_|sk-|ghp_|github_pat_|xox[abprs]-|AKIA|ASIA)[A-Za-z0-9._-]{3,}/;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/;

/**
 * Shapes that must never reach stdout, the HTML report, or a committed
 * artefact — a VALUE, wherever it came from.
 */
const VALUE_LEAK_PATTERNS = [
	ADDRESS_PATTERN,
	EMAIL_PATTERN,
	AUTH_SCHEME_PATTERN,
	KEY_PREFIX_PATTERN,
	JWT_PATTERN,
];

/**
 * Request header and credential FIELD names.
 *
 * Scanned on fixture ROWS only, never on the whole report page: a row is
 * data a fixture contributed, while a page also carries prose this
 * repository writes (which discusses exactly these fields). Splitting
 * the two is what keeps a leak guard from failing on the document that
 * explains the leak rule.
 */
const CALLER_CONTEXT_PATTERNS = [
	/\b(?:cookie|set-cookie|authorization|x-forwarded-for|x-real-ip|user-agent|api[-_]?key|secret|password)\b/i,
];

/**
 * The fixture file whose rendered row would leak, or `null`.
 *
 * The row NUMBER is reported instead of the row text (see
 * `leakMessage`): the offending content may itself be the leak.
 */
export function findLeakingRow(rows) {
	return rows.find((row) =>
		[...VALUE_LEAK_PATTERNS, ...CALLER_CONTEXT_PATTERNS].some((pattern) =>
			pattern.test(row.rendered),
		),
	);
}

/**
 * The rendered page that would carry a value-shaped leak, or `null`.
 * Returns the page itself so the caller can refuse by length, never by
 * quoting the offending fragment.
 */
export function findLeakingPage(html) {
	return VALUE_LEAK_PATTERNS.some((pattern) => pattern.test(html)) ? html : null;
}

/** The refusal line. Echoes the row index only, never the content. */
export function leakMessage(row) {
	return `[anomaly-monitor] refusing to render row ${row.index} — it matches identifier-shaped material (row content not echoed)\n`;
}

/** Fields of a detection event a fixture is allowed to declare. */
export function pickDeclaredFields(event) {
	const picked = {};
	for (const field of DECLARABLE_FIELDS) picked[field] = event[field];
	return picked;
}

/** Parse one fixture file, rejecting anything the runner cannot drive. */
export function parseFixture(raw, source) {
	let fixture;
	try {
		fixture = JSON.parse(raw);
	} catch (error) {
		throw new Error(`${source}: not valid JSON`);
	}
	const where = (reason) => new Error(`${source}: ${reason}`);
	if (typeof fixture.case !== 'string' || fixture.case.length === 0) throw where('missing "case"');
	if (fixture.surface !== 'admin' && fixture.surface !== 'external-api') {
		throw where('"surface" must be "admin" or "external-api"');
	}
	if (!Array.isArray(fixture.runs) || fixture.runs.length === 0) throw where('missing "runs"');
	const spacing = fixture.spacingMs ?? FIXTURE_SPACING_MS;
	if (!Number.isInteger(spacing) || spacing <= 0 || spacing > MAX_FIXTURE_SPACING_MS) {
		throw where(`"spacingMs" must be an integer in 1..${MAX_FIXTURE_SPACING_MS}`);
	}
	for (const run of fixture.runs) {
		if (!Number.isInteger(run?.status) || run.status < 100 || run.status > 599) {
			throw where('every run needs an integer "status" in 100..599');
		}
		if (!Number.isInteger(run?.count) || run.count <= 0) {
			throw where('every run needs a positive integer "count"');
		}
	}
	const expected = fixture.expect;
	if (expected === undefined || !Number.isInteger(expected?.eventCount)) {
		throw where('"expect.eventCount" must be an integer');
	}
	if (!Array.isArray(expected.events) || expected.events.length !== expected.eventCount) {
		throw where('"expect.events" must hold exactly "expect.eventCount" entries');
	}
	return { ...fixture, spacingMs: spacing, source };
}

/** Every fixture in the directory, in a stable order. */
export function loadFixtures(directory = FIXTURE_DIR) {
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name) => parseFixture(readFileSync(resolve(directory, name), 'utf8'), name));
}

/**
 * Replay one fixture through a FRESH monitor.
 *
 * Fresh per fixture on purpose: the counters are module state by
 * design, and a shared monitor would let one case's denominator decide
 * the next case's verdict.
 */
export function runFixture(fixture) {
	const emitted = [];
	const monitor = createAnomalyMonitor();
	let index = 0;
	for (const run of fixture.runs) {
		for (let served = 0; served < run.count; served += 1) {
			const at = FIXTURE_EPOCH_MS + index * fixture.spacingMs;
			index += 1;
			emitted.push(...monitor.record({ surface: fixture.surface, status: run.status, at }));
		}
	}
	const observed = emitted.map(pickDeclaredFields);
	return { observed, expected: fixture.expect.events, totalRequests: index };
}

/** Compare observed events with the fixture's declaration, field by field. */
export function diffCase(fixture, outcome) {
	const problems = [];
	if (outcome.observed.length !== outcome.expected.length) {
		problems.push(
			`event count: declared ${outcome.expected.length}, observed ${outcome.observed.length}`,
		);
	}
	const length = Math.min(outcome.observed.length, outcome.expected.length);
	for (let index = 0; index < length; index += 1) {
		for (const field of DECLARABLE_FIELDS) {
			const want = outcome.expected[index]?.[field];
			const got = outcome.observed[index]?.[field];
			if (want !== got)
				problems.push(`event ${index + 1} ${field}: declared ${want}, observed ${got}`);
		}
	}
	return problems;
}

/**
 * The one-line-per-fixture table the command prints and the report
 * renders. Only the status vocabulary, the counts, and the verdict —
 * the row text is built here, which is what the leak guard scans.
 */
export function renderRows(fixtures) {
	return fixtures.map((fixture, index) => {
		const outcome = fixture.outcome;
		const problems = outcome.problems;
		const traffic = fixture.runs.map((run) => `${run.count}x${run.status}`).join(' + ');
		const events = outcome.observed.length;
		const detail =
			events === 0
				? '—'
				: outcome.observed
						.map(
							(event) =>
								`${event.signal} ${event.hits}/${event.samples}=${event.rate} >= ${event.threshold}`,
						)
						.join('; ');
		const verdict = problems.length === 0 ? FIXTURE_VERDICT.pass : FIXTURE_VERDICT.fail;
		const row = {
			index: String(index + 1),
			case: fixture.case,
			surface: fixture.surface,
			traffic,
			requests: String(outcome.totalRequests),
			events: String(events),
			detail,
			verdict,
			reason: problems.length === 0 ? '-' : problems.join('; '),
		};
		row.rendered = Object.values(row).join(' | ');
		return row;
	});
}

const escapeHtml = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const START = '<!-- anomaly-monitor-matrix:start -->';
const END = '<!-- anomaly-monitor-matrix:end -->';

/** The Markdown table the terminal prints, markers included. */
export function renderTable(rows) {
	const header =
		'| # | fixture | surface | traffic | requests | events | detection | verdict | reason |';
	const separator = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
	const body = rows
		.map(
			(row) =>
				`| ${row.index} | ${row.case} | ${row.surface} | ${row.traffic} | ${row.requests} | ` +
				`${row.events} | ${row.detail} | ${row.verdict} | ${row.reason} |`,
		)
		.join('\n');
	return `${START}\n${header}\n${separator}\n${body}\n${END}\n`;
}

/** Extract the printed table from a child's output. */
export function extractTable(output) {
	const start = output.indexOf(START);
	const end = output.indexOf(END);
	if (start === -1 || end === -1) return null;
	return output.slice(start + START.length, end).trim();
}

/** The rows of a printed table, recognised by their own shape. */
export function parseCells(line) {
	const parts = line.split('|');
	// Nine columns plus the two empty edges a Markdown row always has.
	if (parts.length < 11) return null;
	if ((parts.at(-1) ?? '').trim() !== '') return null;
	return parts.slice(1, 10).map((cell) => cell.trim());
}

export function parseRows(table) {
	const rows = [];
	for (const line of table.split('\n')) {
		const cells = parseCells(line.trim());
		if (cells === null) continue;
		if (rows.length === 0 && cells[0] === '#') continue;
		if (/^:?-{3,}:?$/.test(cells[0] ?? '')) continue;
		rows.push({
			index: cells[0] ?? '',
			case: cells[1] ?? '',
			surface: cells[2] ?? '',
			traffic: cells[3] ?? '',
			requests: cells[4] ?? '',
			events: cells[5] ?? '',
			detail: cells[6] ?? '',
			verdict: cells[7] ?? '',
			reason: cells[8] ?? '',
		});
	}
	return rows;
}

/** The self-contained HTML report the committed screenshot is taken from. */
export function renderHtml(rows, meta) {
	const body = rows
		.map((row) => {
			const tone = row.verdict === FIXTURE_VERDICT.pass ? 'ok' : 'bad';
			const cell = (value) => (value === '—' ? '<span class="muted">—</span>' : escapeHtml(value));
			return `<tr class="${tone}">
				<td class="num">${escapeHtml(row.index)}</td>
				<td><code>${escapeHtml(row.case)}</code></td>
				<td>${escapeHtml(row.surface)}</td>
				<td class="traffic">${cell(row.traffic)}</td>
				<td class="num">${escapeHtml(row.requests)}</td>
				<td class="num">${cell(row.events)}</td>
				<td>${cell(row.detail)}</td>
				<td class="verdict ${tone}">${escapeHtml(row.verdict)}</td>
			</tr>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>リクエスト異常監視の fixture proof — Issue #481</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.6 "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
         margin: 0; padding: 32px; background: #ffffff; color: #111111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { margin: 0 0 20px; color: #444444; max-width: 96ch; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  caption { text-align: left; padding-bottom: 8px; color: #444444; }
  th, td { border-bottom: 1px solid #d8d8d8; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; }
  td.num { text-align: right; color: #555555; }
  td.traffic { white-space: nowrap; }
  td.verdict { font-weight: 600; text-align: center; }
  tr.ok td.verdict { color: #0a6b2d; }
  tr.bad td.verdict { color: #a11212; }
  code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f2f2f2;
         padding: 1px 4px; border-radius: 3px; }
  .muted { color: #888888; }
  .legend { margin-top: 22px; border: 1px solid #d8d8d8; padding: 12px 14px; max-width: 110ch; }
  .legend h2 { font-size: 14px; margin: 0 0 6px; }
  .legend ul { margin: 0; padding-left: 18px; }
  footer { margin-top: 16px; color: #666666; font-size: 12px; }
</style>
</head>
<body>
  <h1>リクエスト異常監視の fixture proof — Issue #481</h1>
  <p class="lede">Admin と外部 API の 401 / 403 / 429 / 5xx 発生率を <strong>秘密・IP などの
  個人情報を一切含まない</strong>形で集計し、しきい値超過時に検知イベントが発生するかを
  記録済み fixture で確認した結果。集計は <code>(surface, window)</code> のみをキーとするので、
  IP・API key・cookie・パス・User-Agent を保持する余地が型に存在しない。
  判定は 5 分固定ウィンドウ・分母下限 20・信号ごとのしきい値で、1 ウィンドウ 1 信号につき
  1 回だけ通知される（ラッチ）。</p>
  <table>
    <caption><code>quality/fixtures/request-anomaly-monitor/</code> — ${rows.length} ケース / ${escapeHtml(String(meta.totalRequests))} リクエスト再生</caption>
    <thead><tr>
      <th>#</th><th>fixture</th><th>surface</th><th>トラフィック</th><th>req</th><th>events</th><th>検知内容</th><th>verdict</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <div class="legend">
    <h2>この表の読み方</h2>
    <ul>
      <li><strong>normal-session / quiet-window（verdict pass, events 0）</strong> — 正常時は無音。
          404 は監視対象外なので、件数が多くても検知にならない（分母を汚さない）。</li>
      <li><strong>credential-storm / throttle-burst / server-error-spike / forbidden-sweep</strong> —
          しきい値を超えた瞬間の 1 行だけが <code>events 1</code> になる。しきい値は信号ごとに異なり
          （401/403 = 25%、429 = 50%、5xx = 5%）、検知行の <code>hits/samples=rate &gt;= threshold</code> は
          そのまま検算できる。</li>
      <li><strong>sustained-forbidden</strong> — 異常が 40 件続いてもイベントは 1 件だけ。監視が
          ログ増幅になると、誰も読まなくなる。</li>
      <li>検知イベントには <code>surface / signal / status / windowStart / samples / hits / rate /
          threshold / minSamples</code> のみが入る。配送先は未承認のため、実行時には
          <code>boundary</code> の監査レコード 1 行だけが書かれる（通知は行わない）。</li>
      <li>この proof はリクエストを発行せず、credential も本番 binding も読まない。
          実行先はプロセス内のカウンタのみ。</li>
    </ul>
  </div>
  <footer>再生成: <code>pnpm run anomaly:fixture:proof</code> ／ 運用契約:
  <code>docs/security/request-anomaly-monitor.md</code></footer>
</body>
</html>
`;
}

/**
 * Run every fixture and return the rows plus the failure count.
 * Pure with respect to the filesystem: the caller decides what to print.
 */
export function runProof(directory = FIXTURE_DIR) {
	const fixtures = loadFixtures(directory).map((fixture) => {
		const outcome = runFixture(fixture);
		return { ...fixture, outcome: { ...outcome, problems: diffCase(fixture, outcome) } };
	});
	const rows = renderRows(fixtures);
	return {
		rows,
		failures: fixtures.filter((fixture) => fixture.outcome.problems.length > 0),
		totalRequests: fixtures.reduce((total, fixture) => total + fixture.outcome.totalRequests, 0),
	};
}

/** The usage error line. */
export const USAGE =
	'Usage: node scripts/request-anomaly-monitor-fixture.mjs [--html=<path>]\n' +
	'  --html=<path>  also write the self-contained HTML report (used for the committed screenshot)\n';

export async function main(argv = process.argv.slice(2)) {
	const htmlFlag = argv.find((arg) => arg.startsWith('--html='));
	if (argv.some((arg) => arg !== '--help' && !arg.startsWith('--html='))) {
		process.stderr.write(USAGE);
		return 2;
	}

	let proof;
	try {
		proof = runProof();
	} catch (error) {
		process.stderr.write(`[anomaly-monitor] ${error.message}\n`);
		return 2;
	}

	const leak = findLeakingRow(proof.rows);
	if (leak) {
		process.stderr.write(leakMessage(leak));
		return 1;
	}

	const table = renderTable(proof.rows);
	process.stdout.write(table);

	if (htmlFlag) {
		const target = resolve(REPO_ROOT, htmlFlag.slice('--html='.length));
		const html = renderHtml(parseRows(extractTable(table) ?? ''), proof);
		if (findLeakingPage(html)) {
			process.stderr.write(
				'[anomaly-monitor] refusing to render the HTML page — it matches identifier-shaped material (page content not echoed)\n',
			);
			return 1;
		}
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, html, 'utf8');
	}

	if (proof.failures.length > 0) {
		const names = proof.failures.map((fixture) => fixture.source).join(', ');
		process.stderr.write(
			`[anomaly-monitor] ${proof.failures.length} fixture(s) deviated from their declaration: ${names}\n`,
		);
		return 1;
	}
	process.stdout.write(
		`[anomaly-monitor] ${proof.rows.length} fixtures hold (${proof.totalRequests} recorded requests)\n`,
	);
	return 0;
}

// Only run the proof when executed directly; the operator test imports
// the pure helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await main());
}
