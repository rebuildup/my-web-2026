import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * `infisical-bootstrap-cf.mjs` unit tests.
 *
 * The script makes HTTPS calls to Infisical (`/api/v1/...`) and
 * Cloudflare Builds API. End-to-end testing requires live
 * credentials. The testable surface is the **pure helpers** +
 * **secret-handling invariants**:
 *
 *   1. `buildBuildsEnvVarsPatchBody` produces the **object map**
 *      shape Cloudflare expects (`{KEY: {value, is_secret}}`) —
 *      NOT an array of `{name, value, is_secret}` records.
 *   2. `selectProductionTrigger` filters triggers by
 *      `deployment_enabled === true` AND `branch in {main, release-*}`.
 *   3. `findWorkerTag` locates a worker by name in the workers
 *      list response.
 *   4. `parseJsonc` strips JSONC comments before parsing.
 *   5. **No source line that takes a client secret value to
 *      stdout / log / error.** The script must not echo
 *      `clientSecret` anywhere except as a request body field,
 *      which is verified by grepping the source.
 *
 * Helpers are loaded via regex extraction (same pattern as
 * `bootstrap-home-api-key.test.mjs`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'infisical-bootstrap-cf.mjs');
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
		parseJsonc: grab('parseJsonc'),
		buildBuildsEnvVarsPatchBody: grab('buildBuildsEnvVarsPatchBody'),
		selectProductionTrigger: grab('selectProductionTrigger'),
		findWorkerTag: grab('findWorkerTag'),
	};
}

describe('infisical-bootstrap-cf.mjs', () => {
	describe('parseJsonc', () => {
		const { parseJsonc } = loadPureHelpers();

		it('parses plain JSON', () => {
			const out = parseJsonc('{"name":"my-web-2026","account_id":"abc"}');
			assert.deepEqual(out, { name: 'my-web-2026', account_id: 'abc' });
		});

		it('strips line comments', () => {
			const out = parseJsonc('{\n  // comment\n  "name": "x"\n}');
			assert.deepEqual(out, { name: 'x' });
		});

		it('strips block comments', () => {
			const out = parseJsonc('{ /* comment */ "name": "x" }');
			assert.deepEqual(out, { name: 'x' });
		});

		it('strips multi-line block comments', () => {
			const out = parseJsonc('{\n  /* line 1\n     line 2 */\n  "name": "x"\n}');
			assert.deepEqual(out, { name: 'x' });
		});

		it('handles typical wrangler JSONC shape', () => {
			const wranglerJsonc = `{
  // canonical production companion config (ADR-0015 §11)
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-web-2026",
  "account_id": "abc123",
  "vars": {
    "BETTER_AUTH_URL": "https://rebuildup.dev" // production canonical origin (ADR-0014)
  }
}`;
			const out = parseJsonc(wranglerJsonc);
			assert.equal(out.name, 'my-web-2026');
			assert.equal(out.account_id, 'abc123');
			assert.equal(out.vars.BETTER_AUTH_URL, 'https://rebuildup.dev');
		});
	});

	describe('buildBuildsEnvVarsPatchBody', () => {
		const { buildBuildsEnvVarsPatchBody } = loadPureHelpers();

		it('produces an object map keyed by variable name (Cloudflare API contract)', () => {
			const out = buildBuildsEnvVarsPatchBody({
				clientId: 'cid-abc',
				clientSecret: 'csec-xyz',
			});
			// CRITICAL: shape must be a flat object map, NOT an array
			// of {name, value, is_secret} records.
			assert.equal(Array.isArray(out), false);
			assert.deepEqual(Object.keys(out).sort(), ['INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET']);
			assert.deepEqual(out, {
				INFISICAL_CLIENT_ID: { value: 'cid-abc', is_secret: true },
				INFISICAL_CLIENT_SECRET: { value: 'csec-xyz', is_secret: true },
			});
		});

		it('marks both keys as secrets (is_secret=true)', () => {
			const out = buildBuildsEnvVarsPatchBody({
				clientId: 'cid',
				clientSecret: 'csec',
			});
			assert.equal(out.INFISICAL_CLIENT_ID.is_secret, true);
			assert.equal(out.INFISICAL_CLIENT_SECRET.is_secret, true);
		});

		it('rejects empty clientId', () => {
			assert.throws(
				() => buildBuildsEnvVarsPatchBody({ clientId: '', clientSecret: 'csec' }),
				/clientId must be a non-empty string/,
			);
		});

		it('rejects empty clientSecret', () => {
			assert.throws(
				() => buildBuildsEnvVarsPatchBody({ clientId: 'cid', clientSecret: '' }),
				/credential field must be a non-empty string/,
			);
		});

		it('rejects non-string inputs', () => {
			assert.throws(
				() => buildBuildsEnvVarsPatchBody({ clientId: 123, clientSecret: 'csec' }),
				/clientId must be a non-empty string/,
			);
			assert.throws(
				() => buildBuildsEnvVarsPatchBody({ clientId: 'cid', clientSecret: null }),
				/credential field must be a non-empty string/,
			);
		});
	});

	describe('selectProductionTrigger', () => {
		const { selectProductionTrigger } = loadPureHelpers();

		it('returns the trigger matching deployment_enabled=true + branch=main', () => {
			const triggers = [
				{ uuid: 'a', deployment_enabled: false, branch: 'main' },
				{ uuid: 'b', deployment_enabled: true, branch: 'main' },
				{ uuid: 'c', deployment_enabled: true, branch: 'feature/x' },
			];
			assert.equal(selectProductionTrigger(triggers)?.uuid, 'b');
		});

		it('also matches release-* branch (per release branch convention)', () => {
			const triggers = [{ uuid: 'a', deployment_enabled: true, branch: 'release-0-4-0' }];
			assert.equal(selectProductionTrigger(triggers)?.uuid, 'a');
		});

		it('returns null when no production-shaped trigger is present', () => {
			const triggers = [
				{ uuid: 'a', deployment_enabled: false, branch: 'main' },
				{ uuid: 'c', deployment_enabled: true, branch: 'feature/x' },
			];
			assert.equal(selectProductionTrigger(triggers), null);
		});

		it('returns null for non-array input', () => {
			assert.equal(selectProductionTrigger(null), null);
			assert.equal(selectProductionTrigger({}), null);
			assert.equal(selectProductionTrigger('triggers'), null);
		});

		it('throws when multiple production-shaped triggers exist (operator must set CF_TRIGGER_UUID)', () => {
			const triggers = [
				{ uuid: 'r', deployment_enabled: true, branch: 'release-0-4-0' },
				{ uuid: 'm', deployment_enabled: true, branch: 'main' },
			];
			assert.throws(
				() => selectProductionTrigger(triggers),
				/multiple production-shaped triggers found \(count=2\)/,
			);
		});

		it('throws when 3+ production-shaped triggers exist (count is in message)', () => {
			const triggers = [
				{ uuid: 'r1', deployment_enabled: true, branch: 'release-0-4-0' },
				{ uuid: 'r2', deployment_enabled: true, branch: 'release-0-5-0' },
				{ uuid: 'm', deployment_enabled: true, branch: 'main' },
			];
			assert.throws(
				() => selectProductionTrigger(triggers),
				/multiple production-shaped triggers found \(count=3\)/,
			);
		});
	});

	describe('findWorkerTag', () => {
		const { findWorkerTag } = loadPureHelpers();

		it('returns the tag for the named worker', () => {
			const list = [
				{ name: 'other-worker', tag: 'tag-other' },
				{ name: 'my-web-2026', tag: 'tag-mw26' },
			];
			assert.equal(findWorkerTag(list, 'my-web-2026'), 'tag-mw26');
		});

		it('returns null when the worker is absent', () => {
			assert.equal(findWorkerTag([], 'my-web-2026'), null);
			assert.equal(findWorkerTag(null, 'my-web-2026'), null);
			assert.equal(findWorkerTag([{ name: 'other', tag: 't' }], 'my-web-2026'), null);
		});

		it('returns null when the worker entry has no tag field', () => {
			const list = [{ name: 'my-web-2026' }];
			assert.equal(findWorkerTag(list, 'my-web-2026'), null);
		});
	});

	describe('secret-handling invariant (no client secret leak)', () => {
		it('the script source never logs clientSecret via console.log', () => {
			// Defensive: assert no `console.log(...clientSecret...)` style
			// leak. The secret must only flow into the PATCH request body
			// (buildBuildsEnvVarsPatchBody), nowhere else.
			const leaks = SOURCE.match(/console\.(log|error|warn)[^)]*clientSecret/g);
			assert.equal(leaks, null, `script may leak clientSecret to stdout/log: ${leaks?.join(', ')}`);
		});

		it('the script source never interpolates clientSecret into a string template', () => {
			// Defensive: assert no template-literal interpolation that
			// includes the variable name. Some patterns to catch:
			//   `something ${clientSecret} something`
			//   "something " + clientSecret + " something"
			const templates = SOURCE.match(/`[^`]*\$\{[^}]*clientSecret[^}]*\}[^`]*`/g);
			const concats = SOURCE.match(/["']\s*\+\s*clientSecret\s*\+/g);
			assert.equal(templates, null);
			assert.equal(concats, null);
		});

		it('the script source does not persist clientSecret via writeFileSync', () => {
			const writes = SOURCE.match(/writeFileSync[^)]*clientSecret/g);
			assert.equal(writes, null);
		});

		it('the script source does not include clientSecret in error throws', () => {
			const throws = SOURCE.match(/throw new Error\([^)]*clientSecret/g);
			assert.equal(throws, null);
		});

		it('the script source does not include clientSecret VALUE in error throws', () => {
			// Defensive: assert no error message ever interpolates the
			// variable value (which would leak the secret into logs).
			// Property-name mentions (e.g. 'clientSecret must be a
			// non-empty string') are acceptable.
			const valueLeaks = SOURCE.match(/throw new Error\([^)]*\$\{[^}]*clientSecret[^}]*\}[^)]*\)/g);
			assert.equal(valueLeaks, null);
		});

		it('clientSecret only flows into the PATCH request body', () => {
			// Verify the only place clientSecret appears is inside
			// buildBuildsEnvVarsPatchBody (the body builder). Grep all
			// occurrences outside that function and assert they're
			// either in the generator or in the explicit null-out
			// cleanup at end of main().
			const allOccurrences = SOURCE.split('\n').reduce((acc, line, idx) => {
				if (line.includes('clientSecret') && !line.trim().startsWith('//')) {
					acc.push({ line: idx + 1, text: line.trim() });
				}
				return acc;
			}, []);

			// Acceptable contexts: the body builder, the response
			// parsing (top-level `clientSecret` field), the variable
			// assignment in main(), and the explicit null-out cleanup.
			// Anything else (log, error, write) is a leak.
			const acceptablePatterns = [
				/response\?\.clientSecret/, // parse response (top-level)
				/clientSecret must be a non-empty string/, // legacy error message
				/return \{ clientId, clientSecret \};/, // generator return (legacy form, may be absent)
				/clientSecret: secret/, // function param rename to `secret`
				/const envVarsBody = buildBuildsEnvVarsPatchBody/, // body builder call
				/clientSecret = null/, // explicit cleanup
				/let clientSecret = await generateClientSecret/, // generator assignment in main()
			];

			for (const { line, text } of allOccurrences) {
				const isAcceptable = acceptablePatterns.some((p) => p.test(text));
				assert.ok(
					isAcceptable,
					`line ${line} references clientSecret in non-allow-listed context: ${text}`,
				);
			}
		});
	});

	describe('Cloudflare v4 envelope unwrap (result wrapper)', () => {
		it('the script unwraps .result for the workers list', () => {
			// The workers list response is `{ success, errors,
			// messages, result: [...] }`. Without unwrapping,
			// findWorkerTag would receive the envelope object and
			// always return null.
			assert.match(
				SOURCE,
				/findWorkerTag\(workersResponse\?\.result,/,
				'script must unwrap .result from workers list response',
			);
		});

		it('the script unwraps .result for the triggers list', () => {
			assert.match(
				SOURCE,
				/selectProductionTrigger\(triggersResponse\?\.result\)/,
				'script must unwrap .result from triggers list response',
			);
		});

		it('the script unwraps .result for the existing env vars', () => {
			// existingEnvResponse?.result must be the env-var object
			// map (keyed by variable name), not the v4 envelope.
			assert.match(
				SOURCE,
				/existingEnvResult\s*=\s*existingEnvResponse\?\.result/,
				'script must unwrap .result from existing env vars response',
			);
		});

		it('the script unwraps .result for the post-PATCH verify', () => {
			assert.match(
				SOURCE,
				/verifiedResult\s*=\s*verifiedResponse\?\.result/,
				'script must unwrap .result from verified env vars response',
			);
		});
	});

	describe('Infisical API response shape', () => {
		it('findIdentity reads from .identities (not the top-level array)', () => {
			// `GET /api/v1/identities` returns
			// `{ identities: [...], totalCount }`. Reading the array
			// directly would yield undefined.
			assert.match(
				SOURCE,
				/Array\.isArray\(response\?\.identities\)/,
				'script must read list from .identities key (Infisical v1 API contract)',
			);
		});

		it('generateClientSecret expects top-level clientSecret (no clientId)', () => {
			// The client-secrets POST returns
			// `{ clientSecret, clientSecretData }` only — no
			// `clientId`. clientId is fetched separately from the
			// Universal Auth endpoint.
			assert.match(
				SOURCE,
				/response\?\.clientSecret/,
				'generateClientSecret must read top-level clientSecret field',
			);
			// And explicitly should not destructure `{ clientId, clientSecret }`
			// from the response.
			const destructuresFromResponse = SOURCE.match(
				/(?:const|let)\s*\{\s*clientId\s*,\s*clientSecret\s*\}\s*=\s*response/g,
			);
			assert.equal(destructuresFromResponse, null);
		});

		it('the script fetches clientId from the Universal Auth endpoint', () => {
			// `clientId` lives at
			// `GET /api/v1/auth/universal-auth/identities/{identityId}`
			assert.match(
				SOURCE,
				/\/api\/v1\/auth\/universal-auth\/identities\/\$\{identityId\}/,
				'script must read clientId from the Universal Auth endpoint',
			);
			assert.match(
				SOURCE,
				/function getUniversalAuthClientId/,
				'script must define getUniversalAuthClientId helper',
			);
		});
	});

	describe('no pre-emptive revoke (decision-tree idempotency)', () => {
		it('the script source never calls a revoke / delete-secret endpoint', () => {
			// Defensive: assert no call to a hypothetical DELETE
			// endpoint or a `revoke` parameter. This is what guards
			// the operator-mandated decision-tree idempotency.
			const revokePatterns = [/method:\s*['"]DELETE['"]/, /revoke/i, /delete.*secret/i];
			for (const pattern of revokePatterns) {
				const matches = SOURCE.match(new RegExp(pattern.source, 'gi'));
				// `// delete or `// delete-secret` style comments are OK;
				// we only care about actual API method usage or
				// non-comment revoke references.
				const codeMatches = matches?.filter((m) => {
					// Find the line containing the match and check
					// it's not a comment.
					const lines = SOURCE.split('\n');
					for (const line of lines) {
						if (line.includes(m)) {
							return !line.trim().startsWith('//') && !line.trim().startsWith('*');
						}
					}
					return true;
				});
				assert.equal(
					codeMatches?.length ?? 0,
					0,
					`script contains pre-emptive revoke pattern ${pattern}: ${codeMatches?.join(', ')}`,
				);
			}
		});
	});
});
