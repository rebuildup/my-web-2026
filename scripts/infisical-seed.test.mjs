import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * `infisical-seed.mjs` unit tests.
 *
 * The script reads `.infisical.json#workspaceId`, calls the Infisical
 * V3 list / insert endpoints for the dev environment, and seeds the
 * 3-name contract. End-to-end testing requires live credentials.
 *
 * The testable surface is the **pure helpers** + **invariant guard**:
 *
 *   1. `buildDevSecretValues` returns the 3-name contract with the
 *      expected shape (random 32-byte hex for each, plus
 *      `BETTER_AUTH_SECRETS` in `1:<hex>` versioned form).
 *   2. `extractExistingKeys` parses the V3 list response into a
 *      `Set<string>` of secret keys.
 *   3. `--env=prod` is **rejected** (operator post-#67 work only).
 *   4. The script does NOT call PATCH / update endpoints (idempotent
 *      insert-only contract).
 *   5. argv / log / error message invariant: no secret value reaches
 *      stdout (verified by source grep).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'infisical-seed.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

function loadPureHelpers() {
	const grab = (signature) => {
		const re = new RegExp(`function ${signature}\\b[\\s\\S]*?\\n\\}`, 'm');
		const match = SOURCE.match(re);
		if (!match) throw new Error(`could not extract ${signature} from script`);
		// biome-ignore lint/security/noGlobalEval: test-only function extraction.
		return eval(`(${match[0].replace(/^function\s+/, 'function ')})`);
	};
	return {
		buildDevSecretValues: grab('buildDevSecretValues'),
		extractExistingKeys: grab('extractExistingKeys'),
		parseArgs: grab('parseArgs'),
	};
}

describe('infisical-seed.mjs', () => {
	describe('buildDevSecretValues', () => {
		const { buildDevSecretValues } = loadPureHelpers();

		it('returns all 3 contract keys', () => {
			const out = buildDevSecretValues();
			assert.deepEqual(Object.keys(out).sort(), [
				'BETTER_AUTH_SECRET',
				'BETTER_AUTH_SECRETS',
				'MY_WEB_2026_CONSUMER_API_KEY',
			]);
		});

		it('each value is a 64-character hex string (32 random bytes)', () => {
			const out = buildDevSecretValues();
			assert.equal(out.BETTER_AUTH_SECRET.length, 64);
			assert.match(out.BETTER_AUTH_SECRET, /^[0-9a-f]{64}$/);
			assert.equal(out.MY_WEB_2026_CONSUMER_API_KEY.length, 64);
			assert.match(out.MY_WEB_2026_CONSUMER_API_KEY, /^[0-9a-f]{64}$/);
		});

		it('BETTER_AUTH_SECRETS is in versioned form "1:<hex>"', () => {
			const out = buildDevSecretValues();
			assert.match(out.BETTER_AUTH_SECRETS, /^1:[0-9a-f]{64}$/);
		});

		it('generates a fresh value on each call (no caching)', () => {
			const a = buildDevSecretValues();
			const b = buildDevSecretValues();
			assert.notEqual(a.BETTER_AUTH_SECRET, b.BETTER_AUTH_SECRET);
			assert.notEqual(a.MY_WEB_2026_CONSUMER_API_KEY, b.MY_WEB_2026_CONSUMER_API_KEY);
		});

		it('BETTER_AUTH_SECRET and MY_WEB_2026_CONSUMER_API_KEY use SEPARATE random sources (security invariant)', () => {
			// Defensive: sharing one hex would make the consumer API
			// key trivially predictable from the auth signing key.
			// The versioned BETTER_AUTH_SECRETS prefix `1:` is
			// expected to share its key with BETTER_AUTH_SECRET
			// (Better Auth 1.5+ contract); but the consumer API key
			// has no such relationship.
			const out = buildDevSecretValues();
			assert.notEqual(
				out.BETTER_AUTH_SECRET,
				out.MY_WEB_2026_CONSUMER_API_KEY,
				'BETTER_AUTH_SECRET and MY_WEB_2026_CONSUMER_API_KEY must use separate random sources',
			);
		});

		it('BETTER_AUTH_SECRETS versioned key equals BETTER_AUTH_SECRET (Better Auth 1.5+ contract)', () => {
			// The versioned form `1:<hex>` denotes "first version,
			// current key". The signing key inside the versioned
			// string MUST equal BETTER_AUTH_SECRET.
			const out = buildDevSecretValues();
			const versionedKey = out.BETTER_AUTH_SECRETS.slice('1:'.length);
			assert.equal(versionedKey, out.BETTER_AUTH_SECRET);
		});
	});

	describe('extractExistingKeys', () => {
		const { extractExistingKeys } = loadPureHelpers();

		it('extracts secretKey fields from a list response', () => {
			const list = [
				{ secretKey: 'BETTER_AUTH_SECRET', secretValue: 'redacted' },
				{ secretKey: 'BETTER_AUTH_SECRETS', secretValue: 'redacted' },
				{ secretKey: 'MY_WEB_2026_CONSUMER_API_KEY', secretValue: 'redacted' },
			];
			const out = extractExistingKeys(list);
			assert.deepEqual(
				[...out].sort(),
				['BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY'].sort(),
			);
		});

		it('returns an empty Set for non-array input', () => {
			assert.equal(extractExistingKeys(null).size, 0);
			assert.equal(extractExistingKeys(undefined).size, 0);
			assert.equal(extractExistingKeys({}).size, 0);
			assert.equal(extractExistingKeys('not an array').size, 0);
		});

		it('skips entries without a string secretKey', () => {
			const list = [{ secretKey: 'PRESENT' }, { secretKey: 123 }, { secretKey: null }, {}, null];
			const out = extractExistingKeys(list);
			assert.deepEqual([...out], ['PRESENT']);
		});
	});

	describe('parseArgs', () => {
		const { parseArgs } = loadPureHelpers();

		it('defaults to dev environment when --env is omitted', () => {
			const out = parseArgs([]);
			assert.equal(out.environment, 'dev');
		});

		it('accepts --env=dev explicitly', () => {
			const out = parseArgs(['--env=dev']);
			assert.equal(out.environment, 'dev');
		});

		it('rejects --env=prod (operator-only post-#67 work)', () => {
			assert.throws(() => parseArgs(['--env=prod']), /out of scope for the agent/);
		});

		it('rejects --env with other values', () => {
			assert.throws(() => parseArgs(['--env=staging']), /must be one of dev, prod/);
		});

		it('rejects unknown arguments', () => {
			assert.throws(() => parseArgs(['--bogus']), /unknown argument: --bogus/);
		});

		it('--help prints usage and exits 0', () => {
			const origExit = process.exit;
			const origLog = console.log;
			let exitCode = null;
			let logOutput = '';
			process.exit = (code) => {
				exitCode = code;
				throw new Error('__exit__');
			};
			console.log = (msg) => {
				logOutput += `${msg}\n`;
			};
			try {
				try {
					parseArgs(['--help']);
				} catch (e) {
					if (e.message !== '__exit__') throw e;
				}
				assert.equal(exitCode, 0);
				assert.match(logOutput, /Usage: infisical-seed\.mjs/);
			} finally {
				process.exit = origExit;
				console.log = origLog;
			}
		});
	});

	describe('idempotency invariant (insert-only, no update)', () => {
		it('the script source does not call PATCH on the secrets endpoint', () => {
			// Defensive: the script should only POST new secrets,
			// never PATCH / PUT / UPDATE existing ones. Operator
			// tuning is preserved by skipping existing keys.
			const patches = SOURCE.match(/method:\s*['"]PATCH['"]/g);
			const puts = SOURCE.match(/method:\s*['"]PUT['"]/g);
			assert.equal(patches, null);
			assert.equal(puts, null);
		});
	});

	describe('argv / log / error secret-handling invariant', () => {
		it('the script source never logs a secret value', () => {
			// No console.log of the random hex values, no error message
			// echoing them, no writeFileSync persisting them.
			const logLeaks = SOURCE.match(/console\.(log|error|warn)[^)]*secretValue/g);
			const writeLeaks = SOURCE.match(/writeFileSync[^)]*secretValue/g);
			const templateLeaks = SOURCE.match(/`[^`]*\$\{[^}]*secretValue[^}]*\}[^`]*`/g);
			assert.equal(logLeaks, null);
			assert.equal(writeLeaks, null);
			assert.equal(templateLeaks, null);
		});

		it('the script does not echo random values in error messages', () => {
			// Defensive: error messages must not include the random
			// hex (it could be a credential).
			const errorLeaks = SOURCE.match(/throw new Error\([^)]*randomBytes[^)]*\)/g);
			// We use `globalThis.crypto.getRandomValues` (Web Crypto
			// API), not `randomBytes` — but the pattern is checked
			// defensively. If a future refactor re-introduces
			// `randomBytes`, this test still guards against leaking
			// it into error messages.
			assert.equal(errorLeaks, null);
		});
	});
});
