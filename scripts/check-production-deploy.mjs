#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'my-web-2026-prod-dry-run-'));
const secretsFile = join(dir, 'secrets.json');

try {
	writeFileSync(
		secretsFile,
		JSON.stringify({
			BETTER_AUTH_SECRET: 'dry-run-better-auth-secret',
			MY_WEB_2026_CONSUMER_API_KEY: `mk_home_${'A'.repeat(32)}`,
		}),
		{ mode: 0o600 },
	);
	execFileSync(
		'pnpm',
		[
			'exec',
			'wrangler',
			'deploy',
			'--dry-run',
			'--outdir',
			'.tmp/wrangler-production',
			'-c',
			'wrangler.production.jsonc',
			'--secrets-file',
			secretsFile,
		],
		{ stdio: 'inherit' },
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
