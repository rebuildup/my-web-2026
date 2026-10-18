/**
 * Render the Issue #463 fixture verification report as HTML.
 *
 * Split from `scripts/webhook-signature-fixture-report.mjs` so the
 * renderer can be unit-tested without spawning a process: the CLI runs
 * the fixtures and writes the file, this module turns outcomes into
 * rows. Nothing here reads a fixture, a secret, or the network — the
 * caller hands the outcomes in.
 *
 * The rows come from `runWebhookFixtures()`, the SAME builder the
 * Vitest contract test asserts on, so a hand-edited table cannot drift
 * from the test. `fixtureFailures()` is the exact predicate the CLI
 * turns into exit code 1, which is what keeps "the screenshot says
 * PASS" and "the suite is green" the same statement.
 */

import {
	DEFAULT_TOLERANCE_SECONDS,
	GITHUB_WEBHOOK_SCHEME,
	TIMESTAMPED_WEBHOOK_SCHEME,
	schemeTimestampHeader,
	webhookReplayTtlMs,
} from '../src/http/webhooks/signature.ts';

/**
 * Outcomes whose observed verdict differs from the declared one.
 *
 * Empty for a healthy tree; a non-empty list is the exit-1 condition.
 */
export function fixtureFailures(outcomes) {
	return outcomes.filter((outcome) => !outcome.matches);
}

/** `accepted`, or `rejected: <reason> → <status>` — one line per fixture. */
export function verdictText(result) {
	return result.accepted ? 'accepted' : `rejected: ${result.reason} → ${result.status}`;
}

/** Status-only stdout line. Carries no key material and no body. */
export function outcomeSummaryLine({ fixture, result, matches }) {
	const verdict = result.accepted
		? `ACCEPTED (replayChecked=${result.replayChecked})`
		: `REJECTED ${result.reason} -> ${result.status}`;
	return `${matches ? 'ok  ' : 'FAIL'} ${fixture.id.padEnd(26)} ${verdict}`;
}

/** Human-readable summary of every fixture that deviated. Never echoes a key. */
export function failureReport(failures) {
	if (failures.length === 0) return '';
	return `\n${failures.length} fixture(s) did not match their declared verdict:\n${failures
		.map((failure) => `  - ${failure.fixture.id}: ${JSON.stringify(failure.result)}`)
		.join('\n')}\n`;
}

export function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const ROWS = (outcomes) =>
	outcomes
		.map(({ fixture, result, matches }) => {
			const expected = fixture.expected.accepted
				? 'accepted'
				: `rejected: ${fixture.expected.reason} → ${fixture.expected.status}`;
			return `<tr class="${matches ? 'pass' : 'fail'}">
			<td class="id">${escapeHtml(fixture.id)}</td>
			<td>${escapeHtml(fixture.label)}<div class="muted">${escapeHtml(fixture.input)}</div></td>
			<td class="verdict">${escapeHtml(expected)}</td>
			<td class="verdict">${escapeHtml(verdictText(result))}</td>
			<td class="mark">${matches ? 'PASS' : 'FAIL'}</td>
		</tr>`;
		})
		.join('\n');

/**
 * @param {object} input
 * @param {Array<{fixture: object, result: object, matches: boolean}>} input.outcomes
 * @param {string} input.version project version, derived by the caller
 * @param {number} input.frozenClockSeconds frozen clock the fixtures ran at
 */
export function renderReportHtml({ outcomes, version, frozenClockSeconds }) {
	const failures = fixtureFailures(outcomes);
	const githubTimestampHeader = schemeTimestampHeader(GITHUB_WEBHOOK_SCHEME);
	const timestampedHeader = schemeTimestampHeader(TIMESTAMPED_WEBHOOK_SCHEME);

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Webhook signature fixture verification — Issue #463</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f6f6f4; color: #16150f;
  }
  main { max-width: 1180px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: #6b6a60; font-size: 13px; margin-bottom: 20px; }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }
  .card {
    background: #fff; border: 1px solid #e2e1da; border-radius: 8px;
    padding: 12px 16px; min-width: 170px;
  }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a887c; }
  .card .v { font-size: 15px; font-weight: 600; margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e1da; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; font-size: 12.5px; border-bottom: 1px solid #eeede7; vertical-align: top; }
  th { background: #f1f0ea; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #55534a; }
  tr:last-child td { border-bottom: none; }
  td.id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; white-space: nowrap; }
  td.verdict { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
  td.mark { font-weight: 700; white-space: nowrap; }
  tr.pass td.mark { color: #1f6f43; }
  tr.fail td.mark { color: #a4232c; }
  .muted { color: #8a887c; font-size: 11.5px; margin-top: 2px; }
  .note { margin-top: 22px; font-size: 12.5px; color: #55534a; background: #fff; border: 1px solid #e2e1da; border-left: 3px solid #16150f; border-radius: 8px; padding: 14px 16px; }
  .note code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .badge { display: inline-block; background: #16150f; color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 11px; letter-spacing: 0.04em; }
</style>
</head>
<body>
<main>
  <h1>Inbound webhook signature / freshness / replay — fixture verification</h1>
  <div class="sub">
    my-web-2026 · Issue #463 · project version ${escapeHtml(version)} (derived from
    <code>package.json#version</code>)
    &nbsp;<span class="badge">no production route mounted</span>
  </div>

  <div class="cards">
    <div class="card"><div class="k">fixtures</div><div class="v">${outcomes.length}</div></div>
    <div class="card"><div class="k">matched</div><div class="v">${outcomes.length - failures.length}/${outcomes.length}</div></div>
    <div class="card"><div class="k">digest</div><div class="v">sha256=&lt;hex&gt;</div></div>
    <div class="card"><div class="k">signed material</div><div class="v">body · ts.body</div></div>
    <div class="card"><div class="k">freshness window</div><div class="v">±${DEFAULT_TOLERANCE_SECONDS}s</div></div>
    <div class="card"><div class="k">replay claim TTL</div><div class="v">${Math.round(webhookReplayTtlMs(DEFAULT_TOLERANCE_SECONDS) / 1000)}s</div></div>
    <div class="card"><div class="k">frozen clock</div><div class="v">${escapeHtml(frozenClockSeconds)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>fixture</th>
        <th>input</th>
        <th>expected verdict</th>
        <th>observed verdict</th>
        <th>result</th>
      </tr>
    </thead>
    <tbody>
${ROWS(outcomes)}
    </tbody>
  </table>

  <div class="note">
    <strong>Scope of this report.</strong> Every row is produced by
    <code>src/http/webhooks/fixtures.ts</code> running through
    <code>verifyWebhookDelivery()</code> in
    <code>src/http/webhooks/signature.ts</code> — the same code path the Vitest
    contract test asserts. Inputs are local fixtures: frozen clock, literal
    non-credential keys, no binding, no network, no D1/R2, nothing sent to
    production. No key material is rendered at all — not even a fingerprint.
    <br /><br />
    <strong>Two signed materials.</strong> GitHub signs the raw body alone
    (<code>${escapeHtml(GITHUB_WEBHOOK_SCHEME.signatureHeader)}</code>,
    <code>${escapeHtml(GITHUB_WEBHOOK_SCHEME.deliveryHeader)}</code>, no timestamp header${
			githubTimestampHeader === undefined ? '' : ` — ${escapeHtml(githubTimestampHeader)}`
		}), so its freshness bound is the replay claim window; the adapter refuses a
    body-only delivery verified with no replay guard. The generic sender signs
    <code>&lt;timestamp&gt;.&lt;body&gt;</code>
    (<code>${escapeHtml(timestampedHeader)}</code>), which is what makes
    <code>stale_timestamp</code> / <code>future_timestamp</code> reachable. The claim
    TTL is derived from the freshness window in use, and a TTL shorter than the
    window is refused (<code>invalid_replay_ttl</code>) rather than clamped.
    <br /><br />
    <strong>Not published.</strong> <code>/webhooks/*</code> is dispatched to the
    external HTTP boundary but has no mounted handler, so a signed delivery
    still answers <code>404 {"not_found"}</code>
    (<code>src/http/webhooks/boundary.test.ts</code>,
    <code>test/integration/webhook-entry.test.ts</code>).
    <br /><br />
    <strong>Reproduce.</strong> <code>node scripts/webhook-signature-fixture-report.mjs</code>
    · <code>pnpm exec vitest run src/http/webhooks</code>
  </div>
</main>
</body>
</html>
`;
}
