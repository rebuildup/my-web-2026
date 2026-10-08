#!/usr/bin/env node
/**
 * Run the REAL production deploy argv against `cf` in dry-run mode.
 *
 * Issue #247, item 4: no fake stand-in command. This imports the same
 * `buildDeployArgv` the production deploy uses and appends `--dry-run`,
 * so CI exercises the actual `cf` CLI over:
 *
 *   - Build Output parsing
 *   - production mode
 *   - Worker config
 *   - assets
 *   - bundle
 *   - `--secrets-file` parsing
 *   - the `pnpm exec` executable resolution
 *
 * `cf deploy --dry-run` sends no API request and needs no Cloudflare
 * credential, so this is safe in CI. The secret values are DUMMIES:
 * a real deploy would source them from Infisical, and nothing here
 * reads or writes a real secret.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	RUNTIME_SECRET_NAMES,
	assertNoAuditOnlySecrets,
	buildDeployArgv,
} from './_cf-build-output.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function main() {
	// Dummy, clearly-fake values. Their SHAPE is what `cf` parses.
	const dummy = Object.fromEntries(
		RUNTIME_SECRET_NAMES.map((name) => [name, `dummy-not-a-real-secret-${name}`]),
	);
	// The audit-only legacy secret is never in this file (#243).
	assertNoAuditOnlySecrets(dummy);

	const dir = mkdtempSync(join(tmpdir(), 'my-web-2026-cf-selftest-'));
	const secretsFile = join(dir, 'secrets.json');
	writeFileSync(secretsFile, `${JSON.stringify(dummy, null, 2)}\n`, { mode: 0o600 });

	try {
		const argv = buildDeployArgv({ secretsFile, dryRun: true });
		console.log(`[cf-prebuilt-dry-run] pnpm exec ${argv.join(' ')}`);
		execFileSync('pnpm', ['exec', ...argv], {
			cwd: REPO_ROOT,
			stdio: 'inherit',
			timeout: 600_000,
		});
		console.log('[cf-prebuilt-dry-run] OK — the production deploy path is valid');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
