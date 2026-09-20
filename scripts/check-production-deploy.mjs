#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'my-web-2026-prod-dry-run-'));
const secretsFile = join(dir, 'secrets.json');
const outDir = '.tmp/wrangler-production';
const wranglerCli = join(
	dirname(require.resolve('wrangler/package.json')),
	'bin',
	'wrangler.js',
);

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
		process.execPath,
		[
			wranglerCli,
			'deploy',
			'--dry-run',
			'--outdir',
			outDir,
			'-c',
			'wrangler.production.jsonc',
			'--secrets-file',
			secretsFile,
		],
		{ stdio: 'inherit' },
	);

	const entryPath = resolve(outDir, 'index.js');
	const entrySource = readFileSync(entryPath, 'utf8');
	const relativeModuleSpecifiers = [
		...entrySource.matchAll(
			/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g,
		),
	].map((match) => match[1]);
	const missingModules = relativeModuleSpecifiers.filter(
		(specifier) => !existsSync(resolve(dirname(entryPath), specifier)),
	);

	if (missingModules.length > 0) {
		throw new Error(
			`Production dry-run omitted imported modules: ${missingModules.join(', ')}`,
		);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
