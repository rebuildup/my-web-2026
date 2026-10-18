import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `check-log-redaction.mjs` unit tests (Issue #467).
 *
 * The gate is a repository-wide rule with two halves — "src/** may
 * only log through src/logging" and "scripts/** may not print a
 * secret-named value" — and both halves are easy to get subtly wrong:
 * a regex that flags a message which merely NAMES a secret, or one
 * that misses `console.log(`${token}`)` because the secret is
 * interpolated rather than passed as an identifier.
 *
 * So the gate is exercised end-to-end against isolated fixture trees
 * rather than through extracted helpers: a fixture repo is built in a
 * temp dir, the real script is copied into it, and the process exit
 * code plus stderr are asserted. That also keeps the test honest
 * about the paths the gate actually walks.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_SOURCE = readFileSync(resolve(HERE, 'check-log-redaction.mjs'), 'utf8');

/**
 * Build an isolated `<repo>/scripts/...` tree and run the gate there.
 *
 * `files` maps repo-relative paths to their contents; every file gets
 * its parent directory created.
 */
function runGate(files) {
	const repo = mkdtempSync(join(tmpdir(), 'check-log-redaction-'));
	try {
		const scriptsDir = join(repo, 'scripts');
		mkdirSync(scriptsDir, { recursive: true });
		writeFileSync(join(scriptsDir, 'check-log-redaction.mjs'), SCRIPT_SOURCE);
		for (const [path, content] of Object.entries(files)) {
			const target = join(repo, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content);
		}
		try {
			const stdout = execFileSync(process.execPath, [join(scriptsDir, 'check-log-redaction.mjs')], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			return { status: 0, stdout, stderr: '' };
		} catch (error) {
			return {
				status: typeof error.status === 'number' ? error.status : 1,
				stdout: error.stdout ?? '',
				stderr: error.stderr ?? '',
			};
		}
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
}

/** Minimal fixture set that must always be present for the gate to run. */
const BASELINE = {
	'src/logging/logger.ts': 'export function log(message) {\n\tconsole.log(message);\n}\n',
	'scripts/operator.mjs': "console.log('done');\n",
};

describe('check-log-redaction.mjs — runtime console gate', () => {
	it('passes when every runtime log goes through src/logging', () => {
		const result = runGate({
			...BASELINE,
			'src/http/hono.ts':
				"import { createAuditLogger } from '../logging/logger';\nexport const l = createAuditLogger('boundary');\n",
		});
		assert.equal(result.status, 0);
		assert.match(result.stdout, /log redaction OK/);
	});

	it('fails when a runtime module calls console.* directly', () => {
		const result = runGate({
			...BASELINE,
			'src/http/hono.ts':
				"export function onError(err) {\n\tconsole.error('[boundary] unhandled', err);\n}\n",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /src\/http\/hono\.ts:2/);
		assert.match(result.stderr, /runtime-console/);
		assert.match(result.stderr, /createAuditLogger/);
	});

	it('flags every console method, not just console.log', () => {
		const result = runGate({
			...BASELINE,
			'src/home/status/panel.tsx':
				"export const P = () => {\n\tconsole.warn('a');\n\tconsole.debug('b');\n\tconsole.trace('c');\n\treturn null;\n};\n",
		});
		assert.equal(result.status, 1);
		assert.equal((result.stderr.match(/runtime-console/g) ?? []).length, 3);
	});

	it('exempts test files, which assert ON console output', () => {
		const result = runGate({
			...BASELINE,
			'src/http/hono.test.ts':
				"import { it, vi } from 'vitest';\nit('logs', () => {\n\tconst spy = vi.spyOn(console, 'error');\n\tconsole.error('inside test');\n\texpect(spy).toHaveBeenCalled();\n});\n",
		});
		assert.equal(result.status, 0);
	});

	it('exempts src/logging/logger.ts (it IS the logging surface)', () => {
		// BASELINE already carries a `console.log` there; a second
		// logging entry point would defeat the single-redaction-
		// contract the exemption exists to protect.
		const result = runGate(BASELINE);
		assert.equal(result.status, 0);
	});

	it('does NOT exempt a sibling module inside src/logging', () => {
		const result = runGate({
			...BASELINE,
			'src/logging/raw.ts':
				"export function audit(message) {\n\tconsole.error('[raw] ' + message);\n}\n",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /src\/logging\/raw\.ts:2/);
		assert.match(result.stderr, /runtime-console/);
	});
});

describe('check-log-redaction.mjs — operator script gate', () => {
	it('passes when a script prints a secret NAME (the status-only contract)', () => {
		const result = runGate({
			...BASELINE,
			'scripts/check-secrets.mjs':
				"console.log('  ✓ BETTER_AUTH_SECRET');\nconsole.log(`uploaded: ${REQUIRED_RUNTIME_SECRETS.join(', ')}`);\n",
		});
		assert.equal(result.status, 0);
	});

	it('passes when a script prints a COUNT of secrets', () => {
		const result = runGate({
			...BASELINE,
			'scripts/deploy.mjs':
				'console.log(`secrets.json holds ${Object.keys(secrets).length} keys`);\n',
		});
		assert.equal(result.status, 0);
	});

	it('fails when a script prints a secret-named variable', () => {
		const result = runGate({
			...BASELINE,
			'scripts/leaky.mjs': "const secret = await readSecret();\nconsole.log('value', secret);\n",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /operator-output/);
	});

	it('fails when a script interpolates a secret into a message', () => {
		const result = runGate({
			...BASELINE,
			'scripts/leaky.mjs':
				'const token = process.env.INFISICAL_TOKEN;\nconsole.log(`using ${token}`);\n',
		});
		assert.equal(result.status, 1);
	});

	it('fails when a script prints a runtime secret binding read', () => {
		const result = runGate({
			...BASELINE,
			'scripts/leaky.mjs': 'console.log(process.env.MY_WEB_2026_CONSUMER_API_KEY);\n',
		});
		assert.equal(result.status, 1);
	});

	it('fails when a script prints a secret-named response field', () => {
		const result = runGate({
			...BASELINE,
			'scripts/leaky.mjs':
				'const secret = await api.getSecret();\nconsole.log(secret.secretValue);\n',
		});
		assert.equal(result.status, 1);
	});

	it('fails on a process.stdout.write sink, not only console', () => {
		const result = runGate({
			...BASELINE,
			'scripts/leaky.mjs': 'process.stdout.write(`${clientSecret}\\n`);\n',
		});
		assert.equal(result.status, 1);
	});

	it('honours the one documented one-shot plaintext print', () => {
		// The bootstrap script mints the key, so there is no prior copy
		// to show instead; the exception is recorded with its reason in
		// ALLOWED_SECRET_VALUE_PRINTS rather than matched by a glob.
		const result = runGate({
			...BASELINE,
			'scripts/bootstrap-home-api-key.mjs':
				'const plaintext = await mintKey();\nconsole.log(plaintext);\n',
		});
		assert.equal(result.status, 0);
	});

	it('does NOT extend that exception to another script', () => {
		const result = runGate({
			...BASELINE,
			'scripts/other.mjs': 'const plaintext = await mintKey();\nconsole.log(plaintext);\n',
		});
		assert.equal(result.status, 1);
	});
});

describe('check-log-redaction.mjs — CLI surface', () => {
	it('prints usage and exits 0 for --help', () => {
		const result = runGate(BASELINE);
		assert.equal(result.status, 0);
	});

	it('exits 2 when the tree it should inspect is missing', () => {
		const repo = mkdtempSync(join(tmpdir(), 'check-log-redaction-empty-'));
		try {
			const scriptsDir = join(repo, 'scripts');
			mkdirSync(scriptsDir, { recursive: true });
			writeFileSync(join(scriptsDir, 'check-log-redaction.mjs'), SCRIPT_SOURCE);
			assert.throws(
				() =>
					execFileSync(process.execPath, [join(scriptsDir, 'check-log-redaction.mjs')], {
						encoding: 'utf8',
						stdio: ['ignore', 'pipe', 'pipe'],
					}),
				(error) => error.status === 2,
			);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});
