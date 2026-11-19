import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `infisical-names.mjs` unit tests (Issue #984).
 *
 * The script is the safe replacement for
 * `infisical secrets --env=... --path=... --plain` when only names are
 * needed. The pinned invariants:
 *
 *   1. `extractSecretNames` emits NAMES only — values never appear in
 *      the returned array, sorted and de-duplicated.
 *   2. Lines that are not `NAME=value` (continuation lines of
 *      multi-line values, CLI noise) are dropped silently.
 *   3. Names must match the secret-name grammar; a value that happens
 *      to sit before an `=` on a malformed line cannot leak because
 *      only grammar-matching tokens are collected.
 *   4. The source spawns with `shell: false` and never echoes stdout /
 *      stderr of the child on failure.
 */
import { extractSecretNames, parseArgs } from './infisical-names.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'infisical-names.mjs'), 'utf8');

describe('extractSecretNames', () => {
	it('returns sorted unique names from NAME=value lines', () => {
		const stdout = [
			'ZETA_KEY=topsecret-value',
			'ALPHA_KEY=another-secret',
			'ALPHA_KEY=duplicate-ignored',
			'BETA_KEY=v@lue=with=equals',
			'',
		].join('\n');
		assert.deepEqual(extractSecretNames(stdout), ['ALPHA_KEY', 'BETA_KEY', 'ZETA_KEY']);
	});

	it('never returns value content', () => {
		const stdout = 'MY_SECRET=s3cr3t-value-that-must-not-leak\nOTHER=plain\n';
		const names = extractSecretNames(stdout);
		assert.deepEqual(names, ['MY_SECRET', 'OTHER']);
		for (const name of names) {
			assert.ok(!name.includes('s3cr3t'), `name leaked value content: ${name}`);
		}
	});

	it('drops lines without = and malformed names', () => {
		const stdout = [
			'no-equals-here',
			'=leading-equals',
			'1BAD=value',
			'has space=value',
			'GOOD_NAME=ok',
			'line-with-dash=value', // dashes are legal in the grammar
		].join('\n');
		assert.deepEqual(extractSecretNames(stdout), ['GOOD_NAME', 'line-with-dash']);
	});

	it('drops multi-line value continuation lines', () => {
		// A PEM-style multi-line value: only the first line carries
		// `NAME=`; continuation lines have no `=` or fail the grammar.
		const stdout = [
			'CERT_KEY=-----BEGIN',
			'MIIabc continuation',
			'-----END CERT-----',
			'PLAIN_KEY=x',
		].join('\n');
		assert.deepEqual(extractSecretNames(stdout), ['CERT_KEY', 'PLAIN_KEY']);
	});

	it('handles CRLF and empty input', () => {
		assert.deepEqual(extractSecretNames('A_KEY=1\r\nB_KEY=2\r\n'), ['A_KEY', 'B_KEY']);
		assert.deepEqual(extractSecretNames(''), []);
		assert.deepEqual(extractSecretNames(null), []);
	});
});

describe('parseArgs', () => {
	it('defaults to dev env and root path', () => {
		assert.deepEqual(parseArgs([]), { env: 'dev', path: '/', json: false });
	});

	it('parses --env, --path and --json', () => {
		assert.deepEqual(parseArgs(['--env=prod', '--path=/feeds', '--json']), {
			env: 'prod',
			path: '/feeds',
			json: true,
		});
	});

	it('rejects path traversal and bad env slugs', () => {
		assert.throws(() => parseArgs(['--path=/../etc']), /invalid --path/);
		assert.throws(() => parseArgs(['--path=relative']), /invalid --path/);
		assert.throws(() => parseArgs(['--env=PROD']), /invalid --env/);
	});
});

describe('source invariants', () => {
	it('spawns with shell: false', () => {
		assert.match(SOURCE, /shell:\s*false/);
	});

	it('never echoes child stdout or stderr on failure', () => {
		// The failure path must not interpolate result.stdout /
		// result.stderr into the thrown error.
		const failureBlock = SOURCE.slice(
			SOURCE.indexOf('result.status !== 0'),
			SOURCE.indexOf('extractSecretNames(result.stdout'),
		);
		assert.ok(!failureBlock.includes('result.stdout'), 'stdout echoed on failure');
		assert.ok(!failureBlock.includes('result.stderr'), 'stderr echoed on failure');
	});

	it('caps child output', () => {
		assert.match(SOURCE, /maxBuffer:\s*SPAWN_MAX_OUTPUT_BYTES/);
	});
});
