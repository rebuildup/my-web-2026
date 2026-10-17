#!/usr/bin/env node
/**
 * webhook-signature-fixture-report — render the Issue #463 fixture
 * verification report as a standalone HTML page.
 *
 * Why a script and not a hand-written table
 * ---------------------------------------
 * The PR screenshot has to be evidence, not illustration. This script
 * imports `src/http/webhooks/fixtures.ts` — the SAME builder the Vitest
 * contract test asserts on — runs every fixture through the adapter,
 * and writes one row per input. A table typed by hand could drift from
 * the test; this cannot. Node runs the TypeScript module directly
 * (`"type": "module"` + type stripping, both required by the repo's
 * `engines` field), which is why `tsconfig.json` enables
 * `allowImportingTsExtensions`.
 *
 * Safety properties
 * -----------------
 *   - No binding, no `env`, no network, no D1/R2. The fixtures cannot
 *     reach production even in principle.
 *   - No secret is printed. The fixture keys are non-credential
 *     literals and are shown in the report only as a length + prefix
 *     fingerprint, so the page stays safe to attach to a public PR.
 *   - Exit code 1 if any fixture deviates from its declared verdict, so
 *     the script is usable as a check, not just as a renderer.
 *
 * Usage:
 *   node scripts/webhook-signature-fixture-report.mjs [--out <path>]
 *
 * Default output: .tmp/webhook-signature-fixture-report.html
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { FIXTURE_NOW_SECONDS, runWebhookFixtures } from '../src/http/webhooks/fixtures.ts';
import {
	DEFAULT_REPLAY_TTL_MS,
	DEFAULT_TOLERANCE_SECONDS,
	GITHUB_WEBHOOK_SCHEME,
} from '../src/http/webhooks/signature.ts';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = isAbsolute(args[outIndex + 1] ?? '')
	? (args[outIndex + 1] ?? '')
	: resolve(process.cwd(), args[outIndex + 1] ?? '.tmp/webhook-signature-fixture-report.html');

// Derived, never literal: `version:check` forbids release literals in
// scripts/ and `package.json#version` is the single source of truth.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const outcomes = await runWebhookFixtures();
const failures = outcomes.filter((outcome) => !outcome.matches);

/** Status-only summary for stdout. Never prints a key or a body. */
for (const { fixture, result, matches } of outcomes) {
	const verdict = result.accepted
		? `ACCEPTED (replayChecked=${result.replayChecked})`
		: `REJECTED ${result.reason} -> ${result.status}`;
	process.stdout.write(`${matches ? 'ok  ' : 'FAIL'} ${fixture.id.padEnd(24)} ${verdict}\n`);
}
process.stdout.write(
	`\n${outcomes.length - failures.length}/${outcomes.length} fixtures matched their declared verdict\n`,
);

const rows = outcomes
	.map(({ fixture, result, matches }) => {
		const expected = fixture.expected.accepted
			? 'accepted'
			: `rejected: ${fixture.expected.reason} → ${fixture.expected.status}`;
		const observed = result.accepted ? 'accepted' : `rejected: ${result.reason} → ${result.status}`;
		return `<tr class="${matches ? 'pass' : 'fail'}">
			<td class="id">${escapeHtml(fixture.id)}</td>
			<td>${escapeHtml(fixture.label)}<div class="muted">${escapeHtml(fixture.input)}</div></td>
			<td class="verdict">${escapeHtml(expected)}</td>
			<td class="verdict">${escapeHtml(observed)}</td>
			<td class="mark">${matches ? 'PASS' : 'FAIL'}</td>
		</tr>`;
	})
	.join('\n');

const html = `<!doctype html>
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
    <div class="card"><div class="k">signature scheme</div><div class="v">sha256=&lt;hex&gt;</div></div>
    <div class="card"><div class="k">freshness window</div><div class="v">±${DEFAULT_TOLERANCE_SECONDS}s</div></div>
    <div class="card"><div class="k">replay claim TTL</div><div class="v">${Math.round(DEFAULT_REPLAY_TTL_MS / 1000)}s</div></div>
    <div class="card"><div class="k">frozen clock</div><div class="v">${FIXTURE_NOW_SECONDS}</div></div>
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
${rows}
    </tbody>
  </table>

  <div class="note">
    <strong>Scope of this report.</strong> Every row is produced by
    <code>src/http/webhooks/fixtures.ts</code> running through
    <code>verifyWebhookDelivery()</code> in
    <code>src/http/webhooks/signature.ts</code> — the same code path the Vitest
    contract test asserts. Inputs are local fixtures: frozen clock, literal
    non-credential keys, no binding, no network, no D1/R2, nothing sent to
    production. Keys are shown as a fingerprint only.
    <br /><br />
    <strong>Not published.</strong> <code>/webhooks/*</code> is dispatched to the
    external HTTP boundary but has no mounted handler, so a signed delivery
    still answers <code>404 {"not_found"}</code>
    (<code>src/http/webhooks/boundary.test.ts</code>,
    <code>test/integration/webhook-entry.test.ts</code>).
    Headers read: <code>${GITHUB_WEBHOOK_SCHEME.signatureHeader}</code>,
    <code>${GITHUB_WEBHOOK_SCHEME.timestampHeader}</code>,
    <code>${GITHUB_WEBHOOK_SCHEME.deliveryHeader}</code>.
    <br /><br />
    <strong>Reproduce.</strong> <code>node scripts/webhook-signature-fixture-report.mjs</code>
    · <code>pnpm exec vitest run src/http/webhooks</code>
  </div>
</main>
</body>
</html>
`;

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
process.stdout.write(`report written: ${outPath}\n`);

if (failures.length > 0) {
	process.stderr.write(
		`\n${failures.length} fixture(s) did not match their declared verdict:\n${failures
			.map((failure) => `  - ${failure.fixture.id}: ${JSON.stringify(failure.result)}`)
			.join('\n')}\n`,
	);
	process.exit(1);
}
