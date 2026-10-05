import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
/**
 * `check-infisical-coverage.mjs` unit tests.
 *
 * Issue #247: the script no longer scrapes `wrangler.jsonc`,
 * `wrangler.production.jsonc`, and `run-deploy-inner.mjs`. It reads the
 * single shared contract module. These tests therefore cover two
 * things: the real script against the real contract, and the script's
 * FAILURE behaviour driven by an isolated copy with a deliberately
 * broken stub contract.
 *
 * The old file's fixtures were wrangler JSONC documents; a test that
 * could only pass by parsing those documents no longer describes
 * anything the repository does.
 */
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	AUDIT_ONLY_SECRETS,
	REQUIRED_RUNTIME_SECRETS,
	WORKER_RUNTIME_SECRET,
} from './_cloudflare-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'check-infisical-coverage.mjs');

/** Run the real script and capture stdout + exit status. */
function runScript() {
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		return {
			status: error.status ?? 1,
			stdout: String(error.stdout ?? ''),
			stderr: String(error.stderr ?? ''),
		};
	}
}

/**
 * Run the script against a STUB contract module in an isolated dir.
 *
 * The script imports `./_cloudflare-contract.mjs` relative to itself, so
 * placing a copy of the script beside a broken contract is enough to
 * drive its failure paths without touching the repository.
 */
function runWithStubContract(contractSource) {
	const repo = mkdtempSync(join(tmpdir(), 'infisical-coverage-'));
	try {
		mkdirSync(join(repo, 'scripts'), { recursive: true });
		writeFileSync(
			join(repo, 'scripts', 'check-infisical-coverage.mjs'),
			readFileSync(SCRIPT, 'utf8'),
		);
		writeFileSync(join(repo, 'scripts', '_cloudflare-contract.mjs'), contractSource);
		try {
			const stdout = execFileSync(
				process.execPath,
				[join(repo, 'scripts', 'check-infisical-coverage.mjs')],
				{
					encoding: 'utf8',
				},
			);
			return { status: 0, stdout, stderr: '' };
		} catch (error) {
			return {
				status: error.status ?? 1,
				stdout: String(error.stdout ?? ''),
				stderr: String(error.stderr ?? ''),
			};
		}
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
}

describe('check-infisical-coverage against the real contract', () => {
	it('exits 0 and reports both tiers', () => {
		const { status, stdout } = runScript();
		assert.equal(status, 0, stdout);
		for (const name of REQUIRED_RUNTIME_SECRETS) {
			assert.ok(stdout.includes(name), `stdout should report ${name}`);
		}
		for (const name of AUDIT_ONLY_SECRETS) {
			assert.ok(stdout.includes(name), `stdout should report audit-only ${name}`);
		}
		assert.ok(stdout.includes('all checks OK'));
	});

	it('labels the audit-only tier as never uploaded', () => {
		// The distinction is the whole point of the split: a name that is
		// retained in Infisical must never reach the Worker.
		const { stdout } = runScript();
		assert.ok(stdout.includes('never uploaded'));
	});

	it('points at the Build Output as the artifact check', () => {
		const { stdout } = runScript();
		assert.ok(stdout.includes('check-cloudflare-contract.mjs --build'));
	});

	it('carries no secret value in its output', () => {
		// Names only. There is nothing else it could print, but the
		// assertion pins that for a future change that adds a lookup.
		const { stdout, stderr } = runScript();
		const combined = stdout + stderr;
		assert.ok(!/sk-|mk_home_|[0-9a-f]{40,}/.test(combined), 'no value-shaped content');
	});
});

describe('the shared contract itself', () => {
	it('exposes the three required runtime secret names', () => {
		assert.deepEqual(REQUIRED_RUNTIME_SECRETS, [
			'BETTER_AUTH_SECRETS',
			'MY_WEB_2026_CONSUMER_API_KEY',
			'GOOGLE_ANALYTICS_MEASUREMENT_ID',
		]);
	});

	it('names each required secret through WORKER_RUNTIME_SECRET', () => {
		// The named constants exist so a call site reads as prose; if a
		// literal ever appears here, the naming has rotted.
		assert.equal(WORKER_RUNTIME_SECRET.BETTER_AUTH_SECRETS, 'BETTER_AUTH_SECRETS');
		assert.equal(WORKER_RUNTIME_SECRET.CONSUMER_API_KEY, 'MY_WEB_2026_CONSUMER_API_KEY');
		assert.equal(WORKER_RUNTIME_SECRET.GA_MEASUREMENT_ID, 'GOOGLE_ANALYTICS_MEASUREMENT_ID');
	});

	it('keeps audit-only names disjoint from required', () => {
		assert.deepEqual(AUDIT_ONLY_SECRETS, ['BETTER_AUTH_SECRET']);
		for (const name of AUDIT_ONLY_SECRETS) {
			assert.ok(!REQUIRED_RUNTIME_SECRETS.includes(name));
		}
	});

	it('freezes both arrays so a caller cannot mutate the contract', () => {
		assert.equal(Object.isFrozen(REQUIRED_RUNTIME_SECRETS), true);
		assert.equal(Object.isFrozen(AUDIT_ONLY_SECRETS), true);
	});
});

describe('check-infisical-coverage failure paths', () => {
	it('fails when an audit-only name leaks into the required set', () => {
		const { status, stdout, stderr } = runWithStubContract(
			"export const REQUIRED_RUNTIME_SECRETS = Object.freeze(['BETTER_AUTH_SECRETS', 'BETTER_AUTH_SECRET']);\n" +
				"export const AUDIT_ONLY_SECRETS = Object.freeze(['BETTER_AUTH_SECRET']);\n",
		);
		assert.equal(status, 1);
		const output = stdout + stderr;
		assert.ok(output.includes('disjoint') || output.includes('must not be in the required set'));
	});

	it('fails on a duplicate name in the inventory', () => {
		const { status } = runWithStubContract(
			"export const REQUIRED_RUNTIME_SECRETS = Object.freeze(['A', 'A']);\n" +
				'export const AUDIT_ONLY_SECRETS = Object.freeze([]);\n',
		);
		assert.equal(status, 1);
	});

	it('fails on a malformed binding name', () => {
		const { status, stdout, stderr } = runWithStubContract(
			"export const REQUIRED_RUNTIME_SECRETS = Object.freeze(['bad name']);\n" +
				'export const AUDIT_ONLY_SECRETS = Object.freeze([]);\n',
		);
		assert.equal(status, 1);
		assert.ok((stdout + stderr).includes('invalid Worker binding name'));
	});
});
