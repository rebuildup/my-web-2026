#!/usr/bin/env node
/**
 * Build the Issue #460 verification report (static HTML) from the
 * vitest JSON report produced by:
 *
 *   pnpm exec vitest run --reporter=json --outputFile=.tmp/cache-isolation-results.json \
 *     test/integration/cache-isolation.test.ts src/http/middleware/cache-policy.test.ts
 *
 * The report renders ONLY what that JSON contains (suite names,
 * assertion names, pass/fail, durations) plus the cache contract the
 * suites assert. No environment values, no header dumps of live
 * responses, no credentials: the fixtures are local literals.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const INPUT = resolve(REPO_ROOT, '.tmp/cache-isolation-results.json');
const OUTPUT = resolve(REPO_ROOT, '.tmp/cache-isolation-report.html');

const results = JSON.parse(readFileSync(INPUT, 'utf8'));

/** Contract rows — the same table as docs/security/cache-isolation.md. */
const CONTRACT = [
	['Caller-specific API response', 'private, no-store', 'Cookie, Authorization'],
	['Caller-specific SSR document', 'private, no-cache', 'Cookie, Authorization'],
	['Public SSR document', 'no-cache', '—'],
	['/admin* (any response)', 'no-store', 'Cookie, Authorization'],
	['/_serverFn/* payload', 'private, no-store', 'Cookie, Authorization'],
	['Public immutable image', 'public, max-age=31536000, immutable', '—'],
];

const esc = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const suites = results.testResults
	.map((suite) => {
		const file = relative(REPO_ROOT, suite.name);
		const rows = suite.assertionResults
			.map((assertion) => {
				const [, ...rest] = assertion.fullName.split(' ');
				const label = rest.join(' ').replaceAll(' (Issue #460)', '');
				const ok = assertion.status === 'passed';
				return `<tr>
          <td class="badge ${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : esc(assertion.status)}</td>
          <td>${esc(label)}</td>
          <td class="num">${Math.round(assertion.duration)} ms</td>
        </tr>`;
			})
			.join('\n        ');
		return `<section>
      <h2>${esc(file)} <span class="muted">${esc(suite.status)}</span></h2>
      <table>
        <thead><tr><th>result</th><th>assertion</th><th>duration</th></tr></thead>
        <tbody>
        ${rows}
        </tbody>
      </table>
    </section>`;
	})
	.join('\n');

const contractRows = CONTRACT.map(
	(row) =>
		`<tr><td>${esc(row[0])}</td><td><code>${esc(row[1])}</code></td><td><code>${esc(row[2])}</code></td></tr>`,
).join('\n        ');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Cache isolation contract — Issue #460</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 40px 48px;
    font: 15px/1.55 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #14171a; background: #ffffff;
  }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 16px; margin: 32px 0 10px; letter-spacing: -0.01em; }
  p.lede { margin: 0 0 24px; color: #4a5157; max-width: 78ch; }
  .summary {
    display: flex; gap: 28px; margin: 0 0 8px; padding: 16px 20px;
    border: 1px solid #dfe3e6; border-radius: 10px; background: #f7f9fa;
  }
  .summary div { display: flex; flex-direction: column; }
  .summary b { font-size: 22px; font-weight: 650; }
  .summary span { font-size: 12px; color: #5a6169; text-transform: uppercase; letter-spacing: 0.06em; }
  table { border-collapse: collapse; width: 100%; max-width: 1100px; font-size: 14px; }
  th, td { text-align: left; padding: 7px 12px; border-bottom: 1px solid #e8ebed; vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a6169; }
  td.num, th.num { text-align: right; white-space: nowrap; color: #5a6169; }
  .badge { display: inline-block; min-width: 54px; padding: 2px 8px; border-radius: 999px;
           font-size: 11px; font-weight: 650; text-align: center; }
  .pass { background: #e3f5e9; color: #14683a; }
  .fail { background: #fdeaea; color: #8c1c1c; }
  .muted { color: #8a9199; font-weight: 400; font-size: 13px; }
  code { background: #f2f4f5; padding: 1px 6px; border-radius: 5px; font-size: 13px; }
  pre { background: #14171a; color: #e9edef; padding: 14px 18px; border-radius: 10px;
        font-size: 13px; overflow-x: auto; }
  footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e8ebed;
           font-size: 13px; color: #5a6169; max-width: 90ch; }
</style>
</head>
<body>
  <h1>Cache isolation contract — Issue #460</h1>
  <p class="lede">
    Per-caller responses must not be usable by a cache shared between visitors. This report
    is rendered from the vitest JSON report of the two contract suites; every row below is a
    real assertion from that run. All fixtures are local literals on workerd / Miniflare
    bindings — no remote resource and no credential is involved.
  </p>

  <div class="summary">
    <div><b>${results.numPassedTests} / ${results.numTotalTests}</b><span>assertions passed</span></div>
    <div><b>${results.numFailedTests}</b><span>failed</span></div>
    <div><b>${results.numPassedTestSuites} / ${results.numTotalTestSuites}</b><span>suites passed</span></div>
    <div><b>${results.success ? 'success' : 'failure'}</b><span>run result</span></div>
  </div>

  <h2>Commands</h2>
  <pre>pnpm exec vitest run test/integration/cache-isolation.test.ts
pnpm exec vitest run src/http/middleware/cache-policy.test.ts
pnpm run architecture:check</pre>

  <h2>Cache contract asserted by these suites</h2>
  <table>
    <thead><tr><th>response class</th><th>Cache-Control</th><th>Vary</th></tr></thead>
    <tbody>
        ${contractRows}
    </tbody>
  </table>

  ${suites}

  <footer>
    Modelled shared cache: RFC 9111 §3 storage rules, driven by two API-key auth contexts
    (<code>test-key-alpha</code> → principal <code>key-alpha</code>, <code>test-key-beta</code> →
    principal <code>key-beta</code>). The negative control asserts that the public immutable
    reaction image IS stored and replayed, so a refuse-everything policy cannot pass this
    report. Image contains no secret values, no personal data, and no bucket or key listing.
  </footer>
</body>
</html>
`;

writeFileSync(OUTPUT, html, 'utf8');
process.stdout.write(`${OUTPUT}\n`);
