import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	LOCAL_ONLY_ACK_ENV,
	assertLocalOnlySpecMaySkip,
	isLocalBaseUrl,
	localOnlyAcknowledged,
} from './_local-only-spec.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightBin = join(repoRoot, 'node_modules', '.bin', 'playwright');

test('the local predicate keeps the condition the specs already used', () => {
	// Unset → the local default (`http://127.0.0.1:<port>`).
	assert.equal(isLocalBaseUrl(undefined), true);
	assert.equal(isLocalBaseUrl('http://127.0.0.1:3000'), true);
	// A deployed origin is not local, whatever it is.
	assert.equal(isLocalBaseUrl('https://rebuildup.dev'), false);
	assert.equal(isLocalBaseUrl('http://localhost:3000'), false);
});

test('a loopback-shaped prefix is not a local origin', () => {
	// The predicate used to be a string prefix, so both of these were
	// "local" while pointing somewhere else entirely.
	assert.equal(isLocalBaseUrl('http://127.0.0.1.example.org:3000'), false);
	assert.equal(isLocalBaseUrl('http://127.0.0.1@remote.example/'), false);
	// A URL that does not parse is not the local machine either — the
	// local branch is the one that starts servers and seeds databases.
	assert.equal(isLocalBaseUrl('not a url'), false);
	assert.equal(isLocalBaseUrl(''), false);
});

test('a loopback-shaped origin cannot skip a local-only spec without the acknowledgement', () => {
	// The guard is the point of the predicate: a lookalike origin must
	// not be able to slip past it.
	assert.throws(
		() =>
			assertLocalOnlySpecMaySkip({
				baseUrl: 'http://127.0.0.1@remote.example/',
				acknowledged: false,
			}),
		(error) => {
			assert.match(error.message, /Refusing to skip silently/);
			return true;
		},
	);
});

test('the acknowledgement is opt-in and explicit', () => {
	assert.equal(localOnlyAcknowledged({}), false);
	assert.equal(localOnlyAcknowledged({ [LOCAL_ONLY_ACK_ENV]: '0' }), false);
	assert.equal(localOnlyAcknowledged({ [LOCAL_ONLY_ACK_ENV]: 'true' }), false);
	assert.equal(localOnlyAcknowledged({ [LOCAL_ONLY_ACK_ENV]: '1' }), true);
});

test('a local run never needs the acknowledgement', () => {
	assert.doesNotThrow(() =>
		assertLocalOnlySpecMaySkip({ baseUrl: undefined, acknowledged: false }),
	);
	assert.doesNotThrow(() =>
		assertLocalOnlySpecMaySkip({ baseUrl: 'http://127.0.0.1:3000', acknowledged: false }),
	);
});

test('a non-local run without the acknowledgement fails loudly', () => {
	assert.throws(
		() => assertLocalOnlySpecMaySkip({ baseUrl: 'https://rebuildup.dev', acknowledged: false }),
		(error) => {
			assert.match(error.message, /Refusing to skip silently/);
			// The message has to name the way out, or it is only a wall.
			assert.match(error.message, new RegExp(LOCAL_ONLY_ACK_ENV));
			assert.match(error.message, /https:\/\/rebuildup\.dev/);
			return true;
		},
	);
});

test('a non-local run WITH the acknowledgement may skip', () => {
	assert.doesNotThrow(() =>
		assertLocalOnlySpecMaySkip({ baseUrl: 'https://rebuildup.dev', acknowledged: true }),
	);
});

// The end-to-end negative control: the guard is only worth something if
// the RUNNER actually fails. These two cases are the whole point of
// Issue #728 — a spec that silently contributes nothing is
// indistinguishable from a spec that verified something.
test(
	'the runner fails when a local-only spec is pointed at a deployed origin',
	{
		skip: existsSync(playwrightBin) ? false : 'playwright is not installed',
	},
	() => {
		const run = spawnSync(playwrightBin, ['test', '--list', 'e2e/seo-status.spec.ts'], {
			cwd: repoRoot,
			encoding: 'utf8',
			env: { ...process.env, PLAYWRIGHT_BASE_URL: 'https://rebuildup.dev' },
		});
		const output = `${run.stdout}${run.stderr}`;
		assert.equal(run.status, 1, output);
		assert.match(output, /Refusing to skip silently/);
		assert.match(output, new RegExp(LOCAL_ONLY_ACK_ENV));
	},
);

test(
	'the runner accepts the acknowledged run',
	{
		skip: existsSync(playwrightBin) ? false : 'playwright is not installed',
	},
	() => {
		const run = spawnSync(playwrightBin, ['test', '--list', 'e2e/seo-status.spec.ts'], {
			cwd: repoRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				PLAYWRIGHT_BASE_URL: 'https://rebuildup.dev',
				[LOCAL_ONLY_ACK_ENV]: '1',
			},
		});
		const output = `${run.stdout}${run.stderr}`;
		assert.equal(run.status, 0, output);
		assert.match(output, /Total: \d+ tests in 1 file/);
	},
);
