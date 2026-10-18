import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { FIXTURE_SECRET, runWebhookFixtures } from '../src/http/webhooks/fixtures.ts';
import {
	failureReport,
	fixtureFailures,
	outcomeSummaryLine,
	renderReportHtml,
	verdictText,
} from './_webhook-signature-fixture-report.mjs';

/**
 * Regression guard for the Issue #463 report generator.
 *
 * The report is the PR's evidence, so its own safety claims need a
 * gate rather than a comment:
 *   - every real fixture matches its declared verdict (the exit-0 path);
 *   - a fixture that deviates IS reported, rendered as FAIL, and named
 *     in the failure summary (the exit-1 path the CLI turns into a
 *     non-zero exit);
 *   - neither the page nor stdout carries key material;
 *   - `--out` is the only way to name an output path.
 *
 * Run through `node --experimental-strip-types --test` because the
 * renderer and the fixtures are TypeScript (same reason the report
 * script itself needs type stripping).
 */

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'scripts', 'webhook-signature-fixture-report.mjs');
// Derived, never a literal: `version:check` forbids release literals in
// scripts/, and `package.json#version` is the single source of truth.
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Run the CLI and capture its status instead of throwing on non-zero. */
async function runCli(args) {
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
			cwd: ROOT,
		});
		return { code: 0, stdout, stderr };
	} catch (error) {
		return {
			code: error.code ?? 1,
			stdout: error.stdout ?? '',
			stderr: error.stderr ?? '',
		};
	}
}

test('every fixture matches its declared verdict (the exit-0 condition)', async () => {
	const outcomes = await runWebhookFixtures();
	assert.deepEqual(
		fixtureFailures(outcomes).map((failure) => failure.fixture.id),
		[],
	);
	assert.ok(outcomes.length >= 16, 'the fixture table must not silently shrink');
});

test('a deviating fixture is reported and rendered as FAIL (the exit-1 condition)', async () => {
	const outcomes = await runWebhookFixtures();
	// A delivery that verifies when its declared verdict says it must not:
	// the mutation a future refactor of `fixtures.ts` could plausibly make.
	const mutated = outcomes.map((outcome, index) =>
		index === 0
			? {
					...outcome,
					matches: false,
					result: { accepted: false, reason: 'signature_mismatch', status: 401 },
				}
			: outcome,
	);

	const failures = fixtureFailures(mutated);
	assert.deepEqual(
		failures.map((failure) => failure.fixture.id),
		[outcomes[0].fixture.id],
	);

	const html = renderReportHtml({
		outcomes: mutated,
		version,
		frozenClockSeconds: 0,
	});
	assert.match(html, /<tr class="fail">/);
	assert.match(html, /<td class="mark">FAIL<\/td>/);

	// The failure summary names the fixture and its reason, and never the
	// key or the body.
	const summary = failureReport(failures);
	assert.match(summary, /signature_mismatch/);
	assert.doesNotMatch(summary, new RegExp(FIXTURE_SECRET));
	assert.match(outcomeSummaryLine(mutated[0]), /^FAIL /);
	assert.equal(verdictText(mutated[0].result), 'rejected: signature_mismatch → 401');
});

test('the rendered report contains no key material', async () => {
	const outcomes = await runWebhookFixtures();
	const html = renderReportHtml({ outcomes, version, frozenClockSeconds: 0 });
	assert.ok(!html.includes(FIXTURE_SECRET));
	assert.ok(!html.includes('local-fixture-hmac-key'));
});

test('the CLI writes the report and exits 0', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'webhook-report-'));
	try {
		const out = join(dir, 'report.html');
		const { code, stdout, stderr } = await runCli(['--out', out]);
		assert.equal(code, 0, stderr);
		const outcomes = await runWebhookFixtures();
		assert.match(stdout, new RegExp(`${outcomes.length}/${outcomes.length} fixtures matched`));
		assert.ok(stdout.includes(out));
		assert.ok(!stdout.includes(FIXTURE_SECRET));
		const html = readFileSync(out, 'utf8');
		assert.match(html, /<td class="mark">PASS<\/td>/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the CLI refuses a --out flag with no path instead of writing to it', async () => {
	// The old parser took `args[0]` as the path whenever `--out` was
	// absent, so `… --foo` silently wrote a file called `--foo`.
	const { code, stderr } = await runCli(['--out']);
	assert.equal(code, 2);
	assert.match(stderr, /--out requires a path/);
});
