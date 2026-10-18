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
 * The rendering itself lives in `_webhook-signature-fixture-report.mjs`
 * so `webhook-signature-fixture-report.test.mjs` can exercise it —
 * including the exit-1 path — without spawning a process.
 *
 * Safety properties
 * -----------------
 *   - No binding, no `env`, no network, no D1/R2. The fixtures cannot
 *     reach production even in principle.
 *   - No secret is printed or rendered. The fixture keys are
 *     non-credential literals and the report contains no key material
 *     at all — not even a fingerprint.
 *   - Exit code 1 if any fixture deviates from its declared verdict, so
 *     the script is usable as a check, not just as a renderer. That is
 *     wired into `pnpm run test`, so the property has a regression
 *     guard instead of a comment.
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
	failureReport,
	fixtureFailures,
	outcomeSummaryLine,
	renderReportHtml,
} from './_webhook-signature-fixture-report.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
// Only a `--out <path>` pair names an output path. An unknown flag must
// not be silently taken as a file name.
const rawOut = outIndex >= 0 ? args[outIndex + 1] : undefined;
if (outIndex >= 0 && rawOut === undefined) {
	process.stderr.write('--out requires a path\n');
	process.exit(2);
}
if (args.some((arg) => arg !== '--out' && arg !== rawOut)) {
	process.stderr.write(
		`usage: node ${process.argv[1] ?? 'webhook-signature-fixture-report.mjs'} [--out <path>]\n`,
	);
	process.exit(2);
}
const outPath = isAbsolute(rawOut ?? '')
	? (rawOut ?? '')
	: resolve(process.cwd(), rawOut ?? '.tmp/webhook-signature-fixture-report.html');

// Derived, never literal: `version:check` forbids release literals in
// scripts/ and `package.json#version` is the single source of truth.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const outcomes = await runWebhookFixtures();
const failures = fixtureFailures(outcomes);

/** Status-only summary for stdout. Never prints a key or a body. */
for (const outcome of outcomes) {
	process.stdout.write(`${outcomeSummaryLine(outcome)}\n`);
}
process.stdout.write(
	`\n${outcomes.length - failures.length}/${outcomes.length} fixtures matched their declared verdict\n`,
);

const html = renderReportHtml({ outcomes, version, frozenClockSeconds: FIXTURE_NOW_SECONDS });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
process.stdout.write(`report written: ${outPath}\n`);

if (failures.length > 0) {
	process.stderr.write(failureReport(failures));
	process.exit(1);
}
