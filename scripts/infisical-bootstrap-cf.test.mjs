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
 *   5. `jwtOrganizationId` extracts the org id from a JWT
 *      payload (including multi-line `infisical user get token`
 *      output).
 *   6. **No source line that takes a client secret value to
 *      stdout / log / error.** The script must not echo
 *      `clientSecret` anywhere except as a request body field,
 *      which is verified by grepping the source.
 *   7. Self-host API contract: the script uses the **documented
 *      v0.165.x** endpoints (`POST /api/v1/auth/universal-auth/...`
 *      — NOT the older `/identities/{id}/universal-auth` 404
 *      route), accepts `INFISICAL_IDENTITY_ID` env override (the
 *      self-host's LIST endpoint is broken), and documents the
 *      missing project-membership endpoint.
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
		jwtOrganizationId: grab('jwtOrganizationId'),
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

	describe('jwtOrganizationId', () => {
		const { jwtOrganizationId } = loadPureHelpers();

		const JWT_HEADER_B64 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
		const ORG_ID = 'd808df2c-ec67-4046-b733-8c0db0bfa47d';
		function makeJwt(payload) {
			const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8')
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '');
			return `${JWT_HEADER_B64}.${payloadB64}.sigdummy`;
		}

		it('extracts organizationId from a JWT payload', () => {
			const jwt = makeJwt({ organizationId: ORG_ID });
			assert.equal(jwtOrganizationId(jwt), ORG_ID);
		});

		it('extracts organizationId from `infisical user get token` multi-line output', () => {
			const jwt = makeJwt({ organizationId: ORG_ID });
			const multiLine = `SessionID:xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx\nToken:${jwt}\nExpiresAt:Thu, 01 Jan 1970 00:00:00 GMT\nTTL:1h0m0s`;
			assert.equal(jwtOrganizationId(multiLine), ORG_ID);
		});

		it('returns null for missing organizationId claim', () => {
			const jwt = makeJwt({ authMethod: 'google' });
			assert.equal(jwtOrganizationId(jwt), null);
		});

		it('returns null for empty input', () => {
			assert.equal(jwtOrganizationId(''), null);
			assert.equal(jwtOrganizationId(null), null);
			assert.equal(jwtOrganizationId(undefined), null);
		});

		it('returns null for malformed JWT (not three base64url segments)', () => {
			assert.equal(jwtOrganizationId('not.a.jwt.at.all'), null);
			assert.equal(jwtOrganizationId('onlytwosegments.x'), null);
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
				const trimmed = line.trim();
				// Skip // line comments and JSDoc /* … */ block
				// comment lines. (The script's header docblock uses
				// `clientSecret` as a field name reference, which is
				// documentation, not a value leak.)
				if (
					line.includes('clientSecret') &&
					!trimmed.startsWith('//') &&
					!trimmed.startsWith('*') &&
					!trimmed.startsWith('/*')
				) {
					acc.push({ line: idx + 1, text: trimmed });
				}
				return acc;
			}, []);

			// Acceptable contexts: the body builder, the variable
			// assignment in main(), and the explicit null-out cleanup.
			// Anything else (log, error, write) is a leak.
			const acceptablePatterns = [
				/clientSecret must be a non-empty string/,
				/clientSecret: secret/, // function param rename to `secret`
				/const envVarsBody = buildBuildsEnvVarsPatchBody/, // body builder call
				/clientSecret = null/, // explicit cleanup
				/let clientSecret = await generateClientSecret/, // generator assignment in main()
				/response\?\.clientSecret/, // parse API response top-level
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

	describe('self-host v0.165.x API contract', () => {
		it('universal-auth attach uses /api/v1/auth/universal-auth/identities/{id}', () => {
			// The self-host does NOT expose
			// `POST /api/v1/identities/{id}/universal-auth` (404).
			// The correct endpoint is
			// `POST /api/v1/auth/universal-auth/identities/{id}`
			// which returns `{ identityUniversalAuth: { clientId,
			// ... } }`.
			assert.match(
				SOURCE,
				/httpsRequestJson\(\s*'POST',\s*`\$\{base\}\/api\/v1\/auth\/universal-auth\/identities\/\$\{identityId\}`/,
				'script must POST to /api/v1/auth/universal-auth/identities/{id}',
			);
			// Negative: must not POST to the broken endpoint.
			const brokenUsage = SOURCE.match(
				/httpsRequestJson\(\s*'POST',\s*`\$\{base\}\/api\/v1\/identities\/\$\{identityId\}\/universal-auth`/,
			);
			assert.equal(brokenUsage, null, 'script must not POST to the 404 /identities/{id}/universal-auth');
		});

		it('reads clientId from the universal-auth response (no separate GET)', () => {
			// The attach response includes `clientId` in the
			// `identityUniversalAuth` envelope, so no separate
			// `getUniversalAuthClientId` call is needed.
			assert.match(SOURCE, /universalAuth\?\.clientId/, 'must read clientId from attach response');
			assert.equal(
				SOURCE.includes('function getUniversalAuthClientId'),
				false,
				'script must not define getUniversalAuthClientId (clientId comes from attach response)',
			);
		});

		it('client-secret generation expects top-level clientSecret (no clientId)', () => {
			assert.match(SOURCE, /response\?\.clientSecret/);
			const destructuresFromResponse = SOURCE.match(
				/(?:const|let)\s*\{\s*clientId\s*,\s*clientSecret\s*\}\s*=\s*response/g,
			);
			assert.equal(destructuresFromResponse, null);
		});

		it('documents the missing project-membership endpoint as a warning', () => {
			// Self-host v0.165.x has no discoverable
			// project-membership endpoint. The script must log a
			// warning instead of failing.
			assert.match(SOURCE, /project-membership/);
			assert.match(
				SOURCE,
				/console\.warn\([^)]*project-membership/i,
				'script must log a warning that project-membership attach is unavailable',
			);
		});

		it('does not POST to /api/v1/identities/{id}/project-memberships (404 route)', () => {
			// The documented endpoint returns 404 on this self-host.
			// The script must not attempt it.
			const brokenUsage = SOURCE.match(
				/httpsRequestJson\(\s*'POST',\s*`\$\{base\}\/api\/v1\/identities\/\$\{identityId\}\/project-memberships`/,
			);
			assert.equal(
				brokenUsage,
				null,
				'script must not POST to /api/v1/identities/{id}/project-memberships (returns 404 on self-host)',
			);
		});

		it('identity creation POSTs {name, organizationId} (NOT {name} alone)', () => {
			// The self-host requires `organizationId` in the POST
			// body (422 without it).
			assert.match(SOURCE, /name,\s*organizationId\b/, 'createIdentity must include organizationId');
		});
	});

	describe('INFISICAL_IDENTITY_ID override (self-host LIST bug workaround)', () => {
		it('accepts INFISICAL_IDENTITY_ID env var', () => {
			assert.match(
				SOURCE,
				/process\.env\.INFISICAL_IDENTITY_ID/,
				'script must accept INFISICAL_IDENTITY_ID env override',
			);
		});

		it('defines getIdentityById helper for the override path', () => {
			assert.match(SOURCE, /function getIdentityById/, 'must define getIdentityById helper');
		});

		it('warns the operator when the override is not provided', () => {
			assert.match(
				SOURCE,
				/console\.warn\([^)]*INFISICAL_IDENTITY_ID not set/,
				'script must warn operator when INFISICAL_IDENTITY_ID is missing',
			);
		});

		it('does not define findIdentity (replaced by getIdentityById)', () => {
			assert.equal(
				SOURCE.includes('function findIdentity'),
				false,
				'findIdentity has been replaced by getIdentityById (LIST endpoint broken on self-host)',
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
				// `// delete` style comments are OK; we only care
				// about actual API method usage or non-comment revoke
				// references.
				const codeMatches = matches?.filter((m) => {
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
