#!/usr/bin/env node
/**
 * d1-query-plan-report — render the Issue #491 D1 N+1 measurement
 * as a self-contained HTML report.
 *
 * Why this exists
 * ---------------
 * The measurement itself lives in
 * `src/portfolio/load.query-budget.test.ts` (workerd pool, real D1
 * binding, real migration). That test prints one machine-readable
 * record per run, prefixed with `D1_QUERY_PLAN_V1 `. This script is
 * the only piece that turns those numbers into something a reviewer
 * can look at: `docs/verification/perf/d1-query-plan.webp` is a
 * screenshot of the HTML this produces.
 *
 * It is deliberately dumb: it renders numbers it did not measure and
 * fails loudly when they are missing. It never invents a threshold,
 * never averages, and never rounds away a regression.
 *
 * Usage
 * -----
 *   pnpm exec vitest run src/portfolio/load.query-budget.test.ts \
 *     | node scripts/d1-query-plan-report.mjs --out .tmp/perf/d1-query-plan.html
 *
 *   node scripts/d1-query-plan-report.mjs --input capture.log --out report.html
 *
 * Options:
 *   --input <file>   read the measurement from a file (default: stdin)
 *   --out <file>     write the HTML here (default: stdout)
 *   --title <text>   report heading (default: derived from the record)
 *   --source-sha <s> record the measured commit in the report header
 *
 * Exit codes: 0 = rendered, 1 = bad input / no measurement record,
 *             2 = bad usage.
 *
 * `main(argv, io)` is the test seam: every input and output path goes
 * through `io` (`readFile`, `readStdin`, `writeFile`, `writeStdout`),
 * so a caller can render a report without touching the filesystem.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, type as osType, release, totalmem } from 'node:os';
import { dirname } from 'node:path';

export const RECORD_PREFIX = 'D1_QUERY_PLAN_V1 ';

/**
 * Pull the measurement record out of a vitest capture.
 *
 * Vitest prefixes console output with the task name on some
 * reporters, so the parser takes the JSON that FOLLOWS the marker on
 * each line rather than assuming the line starts with it.
 */
export function parseRecord(text) {
	const lines = text.split('\n');
	const records = [];
	for (const line of lines) {
		const at = line.indexOf(RECORD_PREFIX);
		if (at === -1) continue;
		const json = line.slice(at + RECORD_PREFIX.length).trim();
		if (!json.startsWith('{')) continue;
		try {
			records.push(JSON.parse(json));
		} catch {
			// A truncated line (interleaved reporter output) is not a
			// record. Ignoring it is safe: a run that produced no
			// complete record fails below with an explicit message.
		}
	}
	const series = records.find((r) => r.kind === 'series');
	if (!series) {
		throw new Error(
			'no D1_QUERY_PLAN_V1 series record found — run `pnpm exec vitest run src/portfolio/load.query-budget.test.ts` and capture its stdout',
		);
	}
	if (!Array.isArray(series.rows) || series.rows.length === 0) {
		throw new Error('series record carries no rows — the measurement did not run');
	}
	return series;
}

/**
 * Host facts a re-runner needs in order to reproduce the numbers.
 * Auto-detected so a screenshot can never claim an environment
 * nobody actually measured on.
 */
export function hostFacts() {
	const list = cpus();
	return {
		os: `${osType()} ${release()}`,
		arch: process.arch,
		cpu: list[0]?.model ?? 'unknown',
		cores: list.length,
		memoryGiB: Math.round(totalmem() / 1024 ** 3),
		node: process.version,
	};
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Compact a statement onto one line for the report body. */
function compact(sql) {
	return String(sql).replace(/\s+/g, ' ').trim();
}

export function renderHtml(series, options = {}) {
	const facts = options.facts ?? hostFacts();
	const sourceSha = options.sourceSha ?? 'not recorded';
	const rows = series.rows;
	const first = rows[0];
	const last = rows[rows.length - 1];
	const budgetBreaches = rows.filter((r) => r.statements > r.budget);
	const nPlusOne = rows.filter((r) => r.legacyStatements > r.budget);
	const growthCurrent =
		(last.statements - first.statements) / Math.max(1, last.pageSize - first.pageSize);
	const growthLegacy =
		(last.legacyStatements - first.legacyStatements) / Math.max(1, last.pageSize - first.pageSize);
	const verdict = budgetBreaches.length === 0 ? 'PASS' : 'FAIL';

	const metricCards = [
		{
			label: 'statement growth / project (after)',
			value: growthCurrent.toFixed(3),
			note: `budget ≤ ${(2 / series.chunkSize).toFixed(3)}`,
		},
		{
			label: 'statement growth / project (before)',
			value: growthLegacy.toFixed(3),
			note: 'N+1 signature: 2 per project',
		},
		{
			label: `statements @ page ${last.pageSize}`,
			value: String(last.statements),
			note: `budget ${last.budget}`,
		},
		{
			label: `statements @ page ${last.pageSize} (before)`,
			value: String(last.legacyStatements),
			note: `over budget by ${last.legacyStatements - last.budget}`,
		},
		{
			label: 'detail surface (/portfolio/<slug>)',
			value: String(series.detail?.[0]?.statements ?? 'n/a'),
			note: `budget ${series.detailBudget}, flat for every fixture size`,
		},
		{
			label: 'id chunk size',
			value: String(series.chunkSize),
			note: 'D1 bound-parameter cap per statement',
		},
	];

	const seriesRows = rows
		.map((r) => {
			const status = r.statements <= r.budget ? 'PASS' : 'FAIL';
			return `<tr>
      <td class="num">${r.pageSize}</td>
      <td class="num">${r.statements}</td>
      <td class="num">${r.budget}</td>
      <td class="num bad">${r.legacyStatements}</td>
      <td class="num">${r.elapsedMs} ms</td>
      <td><span class="pill ${status === 'PASS' ? 'ok' : 'ng'}">${status}</span></td>
    </tr>`;
		})
		.join('\n');

	const planBlocks = Object.entries(series.plans ?? {})
		.map(
			([key, lines]) => `<div class="plan">
      <div class="plan-head">${escapeHtml(key)}</div>
      <pre>${escapeHtml(compact(series.statements?.[key] ?? ''))}</pre>
      <ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
    </div>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(options.title ?? `D1 query budget — Issue #${series.issue}`)}</title>
<style>
  :root {
    color-scheme: light;
    --ink: #14171a;
    --muted: #5b6672;
    --line: #d8dee4;
    --bg: #ffffff;
    --panel: #f6f8fa;
    --ok: #1a7f37;
    --ng: #b42318;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 40px 48px;
    background: var(--bg);
    color: var(--ink);
    font: 14px/1.5 -apple-system, "Helvetica Neue", "Hiragino Sans", "Noto Sans JP", sans-serif;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 12px; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; }
  .verdict { font-weight: 700; font-size: 13px; padding: 3px 10px; border-radius: 999px; display: inline-block; }
  .verdict.ok { background: #e6f4ea; color: var(--ok); }
  .verdict.ng { background: #fdecea; color: var(--ng); }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; background: var(--panel); }
  .card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .card .value { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .card .note { color: var(--muted); font-size: 12px; }
  h2 { font-size: 14px; margin: 28px 0 10px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--muted); }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; }
  th { background: var(--panel); font-size: 12px; }
  td.num { text-align: right; }
  td.bad { color: var(--ng); }
  .pill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.ok { background: #e6f4ea; color: var(--ok); }
  .pill.ng { background: #fdecea; color: var(--ng); }
  .plan { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
  .plan-head { font-weight: 650; margin-bottom: 6px; }
  .plan pre { background: var(--panel); padding: 8px 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; margin: 0 0 8px; }
  .plan ul { margin: 0; padding-left: 18px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .plan li { color: var(--ok); }
  footer { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 12px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>D1 query budget — portfolio list page <span class="verdict ${verdict === 'PASS' ? 'ok' : 'ng'}">${verdict}</span></h1>
  <div class="sub">Issue #${escapeHtml(series.issue)} · ${escapeHtml(series.workload ?? '')} · measured against ${escapeHtml(series.d1Target ?? '')}</div>
  <div class="sub">schema: ${escapeHtml(series.schemaSource ?? '')} · ${escapeHtml(series.linksPerProject)} links + ${escapeHtml(series.mediaPerProject)} media per project</div>
  <div class="sub">host: ${escapeHtml(facts.os)} · ${escapeHtml(facts.arch)} · ${escapeHtml(facts.cpu)} ×${escapeHtml(facts.cores)} · ${escapeHtml(facts.memoryGiB)} GiB · node ${escapeHtml(facts.node)} · source ${escapeHtml(sourceSha)}</div>
</header>

<div class="cards">
${metricCards
	.map(
		(c) => `  <div class="card">
    <div class="label">${escapeHtml(c.label)}</div>
    <div class="value">${escapeHtml(c.value)}</div>
    <div class="note">${escapeHtml(c.note)}</div>
  </div>`,
	)
	.join('\n')}
</div>

<h2>statement count per page size (fixture, public+published rows only)</h2>
<table>
  <thead>
    <tr>
      <th>projects on page</th>
      <th>statements (after)</th>
      <th>budget</th>
      <th>statements (before, N+1)</th>
      <th>elapsed (observation only)</th>
      <th>verdict</th>
    </tr>
  </thead>
  <tbody>
${seriesRows}
  </tbody>
</table>

<h2>EXPLAIN QUERY PLAN</h2>
${planBlocks}

<footer>
  Pass criteria: the loader must stay at or below <code>1 + 2 * ceil(pageSize / ${escapeHtml(series.chunkSize)})</code> statements
  for every page size, and the detail surface at ${escapeHtml(series.detailBudget)} statements.
  ${nPlusOne.length} of ${rows.length} fixture sizes exceed the budget under the pre-fix row-at-a-time shape,
  so the budget is proven to fail on an N+1. Elapsed milliseconds are reported, never gated.
</footer>
</body>
</html>
`;
}

function parseArgs(argv) {
	const options = { input: null, out: null, title: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--input') options.input = argv[++i] ?? null;
		else if (arg === '--out') options.out = argv[++i] ?? null;
		else if (arg === '--title') options.title = argv[++i] ?? null;
		else if (arg === '--source-sha') options.sourceSha = argv[++i] ?? null;
		else if (arg === '--help' || arg === '-h') options.help = true;
		else return null;
	}
	return options;
}

function readStdin() {
	return readFileSync(0, 'utf8');
}

export function main(argv, io = {}) {
	const options = parseArgs(argv);
	if (!options || options.help) {
		process.stderr.write(
			'usage: d1-query-plan-report [--input <file>] [--out <file>] [--title <text>] [--source-sha <sha>]\n',
		);
		return options?.help ? 0 : 2;
	}
	// Every I/O path — stdin, `--input`, `--out`, stdout — goes through
	// `io`, so the renderer can be driven (and asserted) without touching
	// the filesystem or the real stdout.
	const readFile = io.readFile ?? ((path) => readFileSync(path, 'utf8'));
	const readStdinText = io.readStdin ?? readStdin;
	const writeFile = io.writeFile ?? ((path, text) => writeFileSync(path, text));
	const writeStdout = io.writeStdout ?? ((text) => process.stdout.write(text));
	const source = options.input ? readFile(options.input) : readStdinText();
	const series = parseRecord(source);
	const html = renderHtml(series, {
		title: options.title ?? undefined,
		sourceSha: options.sourceSha ?? undefined,
	});
	if (options.out) {
		mkdirSync(dirname(options.out), { recursive: true });
		writeFile(options.out, html);
		process.stderr.write(`d1-query-plan-report: wrote ${options.out}\n`);
	} else {
		writeStdout(html);
	}
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`d1-query-plan-report: ${error.message}\n`);
		process.exitCode = 1;
	}
}
