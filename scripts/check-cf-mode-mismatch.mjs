#!/usr/bin/env node
/**
 * Regression gate: a production Build Output must be rejected when it
 * is deployed under a different mode (Issue #247).
 *
 * The `cf` toolchain fails closed on a mode mismatch, and that is a
 * property worth pinning rather than assuming — a silent fallback to
 * "deploy it anyway" would ship a development build, or skip the
 * production-only bindings (`domains`, `BETTER_AUTH_URL`,
 * `MEDIA_PUBLIC_BASE_URL`).
 *
 * The invocation is `--dry-run`, so this performs no production
 * mutation; the check is the non-zero exit.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_BUILD = process.env.CF_MODE_MISMATCH_BUILD ?? '.cloudflare/output/v0';

function main() {
	const result = spawnSync(
		'cf',
		[
			'deploy',
			'--prebuilt',
			'--mode',
			'development',
			'--dry-run',
			'--outdir',
			'.tmp/cf-mode-mismatch',
		],
		{ cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 },
	);

	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

	if (result.status === 0) {
		console.error(
			'[check-cf-mode-mismatch] FAIL: a production Build Output was accepted under --mode development. ' +
				'The deploy path would accept a mismatched artifact.',
		);
		process.exit(1);
	}

	// Reject for the RIGHT reason. An unrelated failure (missing
	// credentials, no Build Output) must not read as a passing gate.
	const mentionsMode = /mode/i.test(output);
	if (!mentionsMode) {
		console.error(
			`[check-cf-mode-mismatch] FAIL: the deploy was rejected, but not because of a mode mismatch. Output:\n${output.slice(0, 500)}`,
		);
		process.exit(1);
	}

	console.log(
		`[check-cf-mode-mismatch] OK — ${PRODUCTION_BUILD} (mode=production) correctly rejected under --mode development`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
