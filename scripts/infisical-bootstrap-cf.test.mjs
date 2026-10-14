import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { ACCOUNT_ID } from './_cloudflare-identity.mjs';

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
 *   2. `selectProductionTrigger` filters triggers by either the OLD
 *      shape (`deployment_enabled === true` AND
 *      `branch in {main, release-*}`) OR the NEW 2026-09 Cloudflare
 *      shape (`branch_includes` array contains `main` or
 *      `release-*` — no `deployment_enabled` field, implicitly
 *      active). Tolerates both shapes from the same probe so the
 *      script doesn't depend on API version drift.
 *   3. `findWorkerTag` locates a worker by name OR by id in the
 *      workers list response (Cloudflare's `/workers/scripts`
 *      shape uses `id` as the worker name; `/builds/workers` uses
 *      `name`).
 *   3a. `discoverProductionTriggerUuid` falls back from
 *       `/builds/workers` to `/workers/scripts` when the former
 *       404s, and tolerates `trigger.trigger_uuid` (new shape) or
 *       `trigger.uuid` (old shape) for the resulting UUID.
 *   4. `parseJsonc` strips JSONC comments before parsing.
 *   5. `jwtOrganizationId` extracts the org id from a JWT
 *      payload (including multi-line `infisical user get token`
 *      output).
 *   6. `resolveCloudflareAccountId` selects the account id from
 *      `CLOUDFLARE_ACCOUNT_ID` env (preferred) or
 *      `wrangler.production.jsonc#account_id` (committed SoT).
 *   7. **No source line that takes a client secret value to
 *      stdout / log / error.** The script must not echo
 *      `clientSecret` anywhere except as a request body field,
 *      which is verified by grepping the source.
 *   8. Self-host API contract: the script uses the **documented
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
	// `resolveCloudflareAccountId` references the imported ACCOUNT_ID, so
	// it is built with that value injected rather than evaluated bare.
	// Injecting the REAL constant keeps the extracted function honest: a
	// hand-written duplicate here could drift from the source under test.
	const withAccountId = (signature, value) => {
		const re = new RegExp(`function ${signature}\\b[\\s\\S]*?\\n\\}`, 'm');
		const match = SOURCE.match(re);
		if (!match) throw new Error(`could not extract ${signature} from script`);
		const factory = new Function('ACCOUNT_ID', `${match[0]}\nreturn ${signature};`);
		return factory(value);
	};
	return {
		parseJsonc: grab('parseJsonc'),
		buildBuildsEnvVarsPatchBody: grab('buildBuildsEnvVarsPatchBody'),
		selectProductionTrigger: grab('selectProductionTrigger'),
		findWorkerTag: grab('findWorkerTag'),
		jwtOrganizationId: grab('jwtOrganizationId'),
		resolveCloudflareAccountId: withAccountId('resolveCloudflareAccountId', ACCOUNT_ID),
	};
}

/**
 * Load the Issue #86 membership helpers as ONE bundle.
 *
 * These are not independent pure functions: `classifyMembership` calls
 * `membershipRoleSlugs`, `convergeProjectMembership` calls
 * `classifyMembership` and `isAlreadyMemberConflict`, and
 * `resolveProjectRole` reads the module-level preference-order
 * constants. Evaluating any of them in isolation would either fail to
 * resolve a sibling or silently fall back to an injected copy of the
 * constants — a hand-written duplicate that can drift from the source
 * under test, which is exactly the failure this extraction pattern
 * exists to prevent.
 *
 * So the real declarations and the real constants are concatenated and
 * evaluated together, and the bundle hands back only the public names.
 * The code under test is the code in the script, verbatim.
 */
function loadMembershipHelpers() {
	/** Slice a top-level `function name(...)` / `async function name(...)`. */
	const sliceTopLevel = (signature, { isAsync = false } = {}) => {
		const needle = `${isAsync ? 'async ' : ''}function ${signature}(`;
		const start = SOURCE.indexOf(needle);
		if (start < 0) throw new Error(`could not extract ${signature} from script`);
		// Declared at top level, so the closing brace is the first `\n}`
		// at column 0 after the declaration.
		const end = SOURCE.indexOf('\n}', start);
		if (end < 0) throw new Error(`could not find the end of ${signature}`);
		return SOURCE.slice(start, end + 2);
	};

	// The real constants, so the role preference order under test is the
	// order in the script and not a copy that can drift.
	const constantSlice = (name) => {
		const start = SOURCE.indexOf(`const ${name} = `);
		if (start < 0) throw new Error(`could not extract constant ${name} from script`);
		const end = SOURCE.indexOf(';', start);
		return SOURCE.slice(start, end + 1);
	};

	const bundle = [
		constantSlice('PROJECT_ROLE_PREFERENCE_ORDER'),
		constantSlice('NO_ACCESS_ROLE'),
		sliceTopLevel('membershipRoleSlugs'),
		sliceTopLevel('resolveProjectRole'),
		sliceTopLevel('classifyMembership'),
		sliceTopLevel('isAlreadyMemberConflict'),
		sliceTopLevel('pickIdentityByName'),
		sliceTopLevel('convergeProjectMembership', { isAsync: true }),
		'return { membershipRoleSlugs, resolveProjectRole, classifyMembership, isAlreadyMemberConflict, pickIdentityByName, convergeProjectMembership };',
	].join('\n\n');
	// biome-ignore lint/security/noGlobalEval: test-only function extraction.
	return eval(`(() => { ${bundle} })()`);
}

/**
 * Fake provider for the membership boundary.
 *
 * Records every call so tests can assert the CALLS made, not only the
 * end state — a script that reached the right state by writing twice
 * would otherwise pass. `membership` is the provider's real state and
 * is mutated by create/update exactly as a server would, so a
 * convergence test is a genuine state test.
 */
function createFakeProvider({
	membership = null,
	roleSlugs = ['admin', 'developer', 'viewer'],
	roleSlugsAvailable = true,
} = {}) {
	const calls = [];
	const state = { membership };
	const grantRole = (identityId, role) => ({
		id: 'mem-1',
		roles: [{ id: 'r1', role, isTemporary: false }],
		identity: { id: identityId, name: 'my-web-2026-cf-worker' },
	});

	return {
		calls,
		state,
		async listProjectRoleSlugs(args) {
			calls.push({ op: 'listProjectRoleSlugs', ...args });
			return roleSlugsAvailable ? roleSlugs : null;
		},
		async getMembership(args) {
			calls.push({ op: 'getMembership', ...args });
			return state.membership;
		},
		async createMembership(args) {
			calls.push({ op: 'createMembership', ...args });
			if (state.membership !== null) {
				// The real uniqueness constraint: a second create is a 400.
				return { status: 400, data: { message: 'Identity is already a member' } };
			}
			state.membership = grantRole(args.identityId, args.role);
			return { status: 200, data: { identityMembership: state.membership } };
		},
		async updateMembership(args) {
			calls.push({ op: 'updateMembership', ...args });
			state.membership = grantRole(args.identityId, args.role);
		},
	};
}

/**
 * The real provider, wired to a scripted transport.
 *
 * `createInfisicalMembershipProvider` accepts `exchange` / `requestJson`
 * as injectable seams defaulting to the module's HTTP helpers, so the
 * status→meaning decisions can be asserted directly. This builds it
 * against a queue of canned responses and records every URL it calls.
 *
 * This exists because the equivalent assertions written as source
 * greps were satisfiable by wrapping the code under test in
 * `if (false)` — a test that reports success having observed nothing.
 */
function createProviderWithTransport({
	membershipResponses = [],
	roleResponses = [],
	createResponses = [],
	record = null,
} = {}) {
	const membershipQueue = [...membershipResponses];
	const roleQueue = [...roleResponses];
	const createQueue = [...createResponses];
	const providerSource = SOURCE.slice(
		SOURCE.indexOf('function createInfisicalMembershipProvider({'),
		SOURCE.indexOf(
			'\n}',
			SOURCE.indexOf(
				'return { listProjectRoleSlugs, getMembership, createMembership, updateMembership };',
			),
		) + 2,
	);
	// biome-ignore lint/security/noGlobalEval: test-only function extraction.
	const factory = eval(`(HTTPS_DEFAULTS => {
		const httpsExchange = HTTPS_DEFAULTS.exchange;
		const httpsRequestJson = HTTPS_DEFAULTS.requestJson;
		${providerSource}
		return createInfisicalMembershipProvider;
	})`);
	const build = factory({
		// Defaults only need to satisfy the default-parameter binding;
		// every call in these tests is overridden.
		exchange: async () => ({ status: 500, data: null, parseFailed: false }),
		requestJson: async () => {
			throw new Error('requestJson should not be called in this test');
		},
	});
	const next = (queue, label) => {
		if (queue.length === 0) {
			throw new Error(
				`no scripted ${label} response left; the provider made an unexpected extra call`,
			);
		}
		return queue.shift();
	};
	return build({
		apiUrl: 'https://infisical.test',
		token: 'test-token',
		async exchange(method, url) {
			record?.(method, url);
			if (method === 'GET' && url.endsWith('/roles')) return next(roleQueue, 'role list');
			if (method === 'GET') return next(membershipQueue, 'membership read');
			if (method === 'POST') return next(createQueue, 'membership create');
			throw new Error(`unexpected transport call: ${method} ${url}`);
		},
		async requestJson(method, url) {
			record?.(method, url);
			return { success: true };
		},
	});
}

const membershipHelpers = loadMembershipHelpers();

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

	describe('resolveCloudflareAccountId (Issue #247)', () => {
		const { resolveCloudflareAccountId } = loadPureHelpers();

		/*
		 * The canonical account is now IMPORTED from
		 * `_cloudflare-identity.mjs`, not scraped out of a Wrangler config
		 * that this slice deletes. These tests pin the override rule that
		 * replaced the file fallback: an env override is accepted ONLY
		 * when it repeats the canonical id, because the old resolver
		 * returned whatever the env var held and could therefore point
		 * the Machine Identity bootstrap at a different account.
		 */

		it('returns the canonical id when no override is set', () => {
			for (const envValue of [undefined, null, '']) {
				const out = resolveCloudflareAccountId({ envValue });
				assert.equal(out.accountId, ACCOUNT_ID);
				assert.equal(out.source, '_cloudflare-identity.mjs#ACCOUNT_ID');
			}
		});

		it('accepts an override that merely repeats the canonical id', () => {
			const out = resolveCloudflareAccountId({ envValue: ACCOUNT_ID });
			assert.equal(out.accountId, ACCOUNT_ID);
			assert.equal(out.source, 'env (matches canonical)');
		});

		it('REJECTS an override that names a different account', () => {
			assert.throws(
				() => resolveCloudflareAccountId({ envValue: '0'.repeat(32) }),
				/does not match the canonical account/,
			);
		});

		it('ignores a second source: there is no config file to fall back to', () => {
			// Passing the old `wranglerProduction` argument must not be
			// able to influence the result, or a caller could still
			// smuggle an identity in through a dead parameter.
			const out = resolveCloudflareAccountId({
				envValue: undefined,
				wranglerProduction: { account_id: 'file-account-id' },
			});
			assert.equal(out.accountId, ACCOUNT_ID);
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

		it('returns the trigger matching deployment_enabled=true + branch=main (OLD shape)', () => {
			const triggers = [
				{ uuid: 'a', deployment_enabled: false, branch: 'main' },
				{ uuid: 'b', deployment_enabled: true, branch: 'main' },
				{ uuid: 'c', deployment_enabled: true, branch: 'feature/x' },
			];
			assert.equal(selectProductionTrigger(triggers)?.uuid, 'b');
		});

		it('also matches release-* branch (per release branch convention, OLD shape)', () => {
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

		// New 2026-09 Cloudflare API shape: `branch_includes` is an
		// array. No `deployment_enabled` field — the trigger is
		// implicitly active when listed.
		it('returns the trigger matching branch_includes=["main"] (NEW shape)', () => {
			const triggers = [
				{ trigger_uuid: 'a', branch_includes: ['feature/x'] },
				{ trigger_uuid: 'b', branch_includes: ['main'] },
				{ trigger_uuid: 'c', branch_includes: [] },
			];
			assert.equal(selectProductionTrigger(triggers)?.trigger_uuid, 'b');
		});

		it('matches release-* branches in branch_includes array (NEW shape)', () => {
			const triggers = [
				{ trigger_uuid: 'r', branch_includes: ['release-0-4-0'] },
				{ trigger_uuid: 'm', branch_includes: ['main'] },
			];
			// Two matches => helper throws so the operator must
			// disambiguate via CF_TRIGGER_UUID.
			assert.throws(() => selectProductionTrigger(triggers), /count=2/);
		});

		it('matches a single release-* branch in branch_includes (NEW shape, single match)', () => {
			const triggers = [{ trigger_uuid: 'r', branch_includes: ['release-0-4-0'] }];
			assert.equal(selectProductionTrigger(triggers)?.trigger_uuid, 'r');
		});

		it('does not match a non-production branch_includes entry (NEW shape)', () => {
			const triggers = [{ trigger_uuid: 'f', branch_includes: ['feature/x'] }];
			assert.equal(selectProductionTrigger(triggers), null);
		});

		it('treats a branch_includes entry of non-string type as no match (NEW shape)', () => {
			const triggers = [{ trigger_uuid: 'a', branch_includes: [null, 42, {}, 'main'] }];
			assert.equal(selectProductionTrigger(triggers)?.trigger_uuid, 'a');
		});

		it('does not match OLD-shape triggers with no deployment_enabled (NEW-shape helper accepts both)', () => {
			// If a /builds/workers/{tag}/triggers response still
			// returns the OLD shape but `deployment_enabled` is
			// absent (some intermediate API version), the helper
			// must NOT silently skip — it must throw or match.
			const triggers = [{ uuid: 'x', branch: 'main' }];
			// branch_includes absent AND deployment_enabled absent
			// => no match in either branch => null.
			assert.equal(selectProductionTrigger(triggers), null);
		});
	});

	describe('findWorkerTag', () => {
		const { findWorkerTag } = loadPureHelpers();

		it('returns the tag for the named worker (OLD shape: `name` field)', () => {
			const list = [
				{ name: 'other-worker', tag: 'tag-other' },
				{ name: 'my-web-2026', tag: 'tag-mw26' },
			];
			assert.equal(findWorkerTag(list, 'my-web-2026'), 'tag-mw26');
		});

		it('returns the tag for the named worker via `id` field (NEW shape: /workers/scripts)', () => {
			// The /workers/scripts endpoint returns `{ id, tag, ... }`
			// where `id` is the worker name (not `name`). The helper
			// must accept both shapes for the fallback path.
			const list = [
				{ id: 'other-worker', tag: 'tag-other' },
				{ id: 'my-web-2026', tag: 'tag-mw26' },
			];
			assert.equal(findWorkerTag(list, 'my-web-2026'), 'tag-mw26');
		});

		it('prefers `name` over `id` when both are present (defensive)', () => {
			const list = [{ name: 'my-web-2026', id: 'something-else', tag: 'tag-name' }];
			assert.equal(findWorkerTag(list, 'my-web-2026'), 'tag-name');
		});

		it('returns null when the worker is absent', () => {
			assert.equal(findWorkerTag([], 'my-web-2026'), null);
			assert.equal(findWorkerTag(null, 'my-web-2026'), null);
			assert.equal(findWorkerTag([{ name: 'other', tag: 't' }], 'my-web-2026'), null);
			assert.equal(findWorkerTag([{ id: 'other', tag: 't' }], 'my-web-2026'), null);
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

		it('clientSecret only flows into an outbound request body', () => {
			// Verify every place clientSecret appears is either the
			// generator, the explicit null-out cleanup, or a REQUEST
			// BODY builder. Anything else (log, error, write, template
			// interpolation) is a leak.
			//
			// Issue #86 added a second legitimate sink: the Universal
			// Auth login body, which must carry the secret to prove the
			// granted project role actually grants read access. That is
			// a request body, not a sink — the four negative leak
			// assertions above still apply to it unchanged.
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

			// Acceptable contexts: the body builders, the variable
			// assignment in main(), and the explicit null-out cleanup.
			// Anything else (log, error, write) is a leak.
			const acceptablePatterns = [
				/clientSecret must be a non-empty string/,
				/clientSecret: secret/, // function param rename to `secret`
				/const envVarsBody = buildBuildsEnvVarsPatchBody/, // Cloudflare body builder call
				/body: \{ clientId, clientSecret \}/, // Universal Auth login body (Issue #86)
				/clientSecret,$/, // pass-through: destructure param + call-site argument
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
		it('the script unwraps .result for the builds/workers list', () => {
			assert.match(
				SOURCE,
				/findWorkerTag\(buildsWorkersResponse\?\.result,/,
				'script must unwrap .result from /builds/workers list response',
			);
		});

		it('the script unwraps .result for the /workers/scripts fallback', () => {
			assert.match(
				SOURCE,
				/findWorkerTag\(scriptsResponse\?\.result,/,
				'script must unwrap .result from /workers/scripts fallback response',
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

	describe('trigger UUID field tolerance (snake_case trigger_uuid vs uuid)', () => {
		it('the script reads trigger_uuid ?? uuid', () => {
			// The new 2026-09 Cloudflare API returns
			// `trigger_uuid` (snake_case). The old API returned
			// `uuid`. The script must tolerate both via fallback
			// access (the source uses plain `trigger.trigger_uuid`
			// since the helper already guards on
			// selectProductionTrigger's matched object).
			assert.match(
				SOURCE,
				/trigger\.trigger_uuid\s*\?\?\s*trigger\.uuid/,
				'script must fall back from trigger.trigger_uuid to trigger.uuid',
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
			//
			// Issue #86 split the transport: the attach call now goes
			// through `httpsExchange` so the RESPONSE BODY of a 400 is
			// available, which is what distinguishes "already
			// configured" from a malformed request. Both probes are
			// accepted here; the path is the contract.
			assert.match(
				SOURCE,
				/https(?:RequestJson|Exchange)\(\s*'POST',\s*`\$\{base\}\/api\/v1\/auth\/universal-auth\/identities\/\$\{identityId\}`/,
				'script must POST to /api/v1/auth/universal-auth/identities/{id}',
			);
			// Negative: must not POST to the broken endpoint.
			const brokenUsage = SOURCE.match(
				/https(?:RequestJson|Exchange)\(\s*'POST',\s*`\$\{base\}\/api\/v1\/identities\/\$\{identityId\}\/universal-auth`/,
			);
			assert.equal(
				brokenUsage,
				null,
				'script must not POST to the 404 /identities/{id}/universal-auth',
			);
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

		/*
		 * Issue #86 inverts the two assertions that used to live here.
		 *
		 * They pinned the premise that the self-host has no
		 * project-membership endpoint, so the script should warn and
		 * continue. That premise was wrong: it came from probing guessed
		 * paths only. The real surface is project-scoped
		 * (`/api/v1/projects/{projectId}/memberships/identities/{identityId}`),
		 * and a script that warns and exits 0 while granting no access
		 * is precisely the silent-bootstrap failure this repository
		 * keeps rediscovering. The assertions below now pin the
		 * canonical endpoints AND the removal of the guessed route.
		 */
		it('uses the canonical project-scoped membership endpoints', () => {
			// The path is built by one helper so the read, create and
			// converge calls cannot drift onto different routes — the
			// failure mode that produced the original wrong "no endpoint"
			// conclusion in the first place. The exact URL the read
			// actually issues is asserted BEHAVIOURALLY further down;
			// this pins the helper itself.
			assert.match(
				SOURCE,
				/`\$\{projectPath\(projectId\)\}\/memberships\/identities\/\$\{encodeURIComponent\(identityId\)\}`/,
				'script must address the canonical memberships/identities/{identityId} path',
			);
			// POST to create and PATCH to converge must both go through
			// that helper. Read-only convergence could not detect a
			// wrong role, and write-only could not be idempotent.
			assert.match(
				SOURCE,
				/exchange\('POST', membershipPath\(projectId, identityId\),/,
				'must POST to the shared membership path',
			);
			assert.match(
				SOURCE,
				/requestJson\('PATCH', membershipPath\(projectId, identityId\),/,
				'must PATCH the shared membership path',
			);
		});

		it('PATCH sends the roles array, never the deprecated flat {role} body', () => {
			// The self-host's PATCH schema is `roles` (min 1); a flat
			// `{ role }` body is rejected, so a copy-paste of the create
			// payload would fail the converge path.
			assert.match(
				SOURCE,
				/requestJson\('PATCH', membershipPath\(projectId, identityId\),\s*\{[\s\S]*?body:\s*\{\s*roles:\s*\[\s*\{\s*role,\s*isTemporary:\s*false\s*\}\s*\]\s*,?\s*\}/,
			);
			// Negative: no call site may send the flat body at all.
			const flatRoleBody = SOURCE.match(/body:\s*\{\s*role\s*,?\s*\}/g);
			assert.equal(
				flatRoleBody,
				null,
				'no membership call may send the deprecated flat { role } body',
			);
		});

		it('no longer skips project-membership attach', () => {
			// The old behaviour: a console.warn claiming no endpoint
			// exists, then continue. It must be gone.
			assert.equal(
				SOURCE.includes('Project-membership attach: SKIPPED'),
				false,
				'the "SKIPPED" premise must be removed (Issue #86)',
			);
			const warnAboutMembership = SOURCE.match(/console\.warn\(\s*['`][^'`]*membership/i);
			assert.equal(
				warnAboutMembership,
				null,
				'membership must no longer be a warning path; failure must be loud',
			);
		});

		it('does not POST to the guessed /api/v1/identities/{id}/project-memberships route', () => {
			// The 404 route stays 404; the fix was finding the real
			// endpoint, not reviving the guessed one.
			const brokenUsage = SOURCE.match(
				/https(?:RequestJson|Exchange)\(\s*'POST',\s*`\$\{base\}\/api\/v1\/identities\/\$\{identityId\}\/project-memberships`/,
			);
			assert.equal(brokenUsage, null, 'the guessed 404 route must stay unused');
		});

		it('identity creation POSTs {name, organizationId} (NOT {name} alone)', () => {
			// The self-host requires `organizationId` in the POST
			// body (422 without it).
			assert.match(
				SOURCE,
				/name,\s*organizationId\b/,
				'createIdentity must include organizationId',
			);
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

		it('refuses to create a duplicate identity when existence is unobservable', () => {
			// The old behaviour warned and created anyway, which is how a
			// re-run accumulated duplicate identities on a self-host
			// that does not enforce name uniqueness. The unobservable
			// case (count > 0, empty list) must now be a hard failure
			// that names the remedy.
			assert.match(
				SOURCE,
				/cannot determine whether identity[\s\S]{0,400}?observed nothing/,
				'must fail loudly when the existence check observed nothing',
			);
			assert.match(
				SOURCE,
				/throw new Error\(\s*`cannot determine whether identity/,
				'unobservable identity state must throw, not warn',
			);
			assert.match(
				SOURCE,
				/INFISICAL_IDENTITY_ID=<uuid> to reuse the existing identity/,
				'the error must name the operator remedy',
			);
		});

		it('asks the provider by name before creating an identity', () => {
			assert.match(SOURCE, /function listIdentitiesByName/);
			assert.match(SOURCE, /function pickIdentityByName/);
			assert.match(
				SOURCE,
				/const listed = await listIdentitiesByName\(/,
				'must query provider state before creating',
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

	describe('membershipRoleSlugs', () => {
		const { membershipRoleSlugs } = loadMembershipHelpers();

		it('returns null for "no membership" (distinct from "no roles")', () => {
			// The distinction drives create-vs-converge, so it must not
			// collapse: an empty roles[] is a membership that exists and
			// grants nothing.
			assert.equal(membershipRoleSlugs(null), null);
			assert.equal(membershipRoleSlugs(undefined), null);
			assert.deepEqual(membershipRoleSlugs({ roles: [] }), []);
		});

		it('unwraps the { identityMembership } envelope and the bare shape', () => {
			const roles = [{ id: 'r1', role: 'viewer', isTemporary: false }];
			assert.deepEqual(membershipRoleSlugs({ identityMembership: { roles } }), ['viewer']);
			assert.deepEqual(membershipRoleSlugs({ roles }), ['viewer']);
		});

		it('prefers customRoleSlug when a custom role is assigned', () => {
			assert.deepEqual(
				membershipRoleSlugs({
					roles: [{ id: 'r1', role: 'custom', customRoleSlug: 'read-only-deployer' }],
				}),
				['read-only-deployer'],
			);
		});

		it('returns every role slug for a multi-role membership', () => {
			assert.deepEqual(
				membershipRoleSlugs({ roles: [{ role: 'developer' }, { role: 'viewer' }] }),
				['developer', 'viewer'],
			);
		});

		it('returns null when the payload has no roles array', () => {
			assert.equal(membershipRoleSlugs({ id: 'x' }), null);
			assert.equal(membershipRoleSlugs('nope'), null);
		});
	});

	describe('classifyMembership', () => {
		const { classifyMembership } = loadMembershipHelpers();

		it('satisfied only when the expected role is actually granted', () => {
			assert.equal(
				classifyMembership({ roles: [{ role: 'viewer' }] }, 'viewer').state,
				'satisfied',
			);
			assert.equal(
				classifyMembership({ roles: [{ role: 'admin' }] }, 'viewer').state,
				'mismatched',
			);
		});

		it('treats a no-access membership as a converge target, never satisfied', () => {
			// `no-access` is a real membership that grants nothing. If it
			// counted as satisfied, a run would report success on an
			// identity that still cannot read a single secret.
			const out = classifyMembership({ roles: [{ role: 'no-access' }] }, 'viewer');
			assert.equal(out.state, 'mismatched');
			assert.deepEqual(out.observed, ['no-access']);
		});

		it('reports absent for a null membership', () => {
			assert.equal(classifyMembership(null, 'viewer').state, 'absent');
		});
	});

	describe('resolveProjectRole (least privilege, not a hard-coded constant)', () => {
		const { resolveProjectRole } = loadMembershipHelpers();

		it('picks viewer when the project offers it', () => {
			const out = resolveProjectRole({
				availableSlugs: ['admin', 'developer', 'viewer', 'no-access'],
				requested: undefined,
			});
			assert.equal(out.role, 'viewer');
			assert.equal(out.roleVerifiedAgainstProvider, true);
		});

		it('does not invent viewer when the project does not offer it', () => {
			// The self-host's role set is deployment-specific. Granting
			// `viewer` when it is not on offer would be a guess.
			const out = resolveProjectRole({
				availableSlugs: ['developer', 'no-access'],
				requested: undefined,
			});
			assert.equal(out.role, 'developer');
			assert.equal(out.roleVerifiedAgainstProvider, true);
		});

		it('THROWS when the only offered role grants no access', () => {
			// Regression found in self-review. The lowest-sort fallback
			// would have picked `no-access` here, and converging onto it
			// produces a membership that exists, satisfies every check
			// in this file, and grants the identity nothing — a silent
			// "success" into no access.
			assert.throws(
				() => resolveProjectRole({ availableSlugs: ['no-access'], requested: undefined }),
				/only roles that grant no access/,
			);
		});

		it('excludes no-access from the fallback even when other roles exist', () => {
			const out = resolveProjectRole({
				availableSlugs: ['no-access', 'custom-read'],
				requested: undefined,
			});
			assert.equal(out.role, 'custom-read');
		});

		it('an explicit no-access override is honoured (the operator asked for it)', () => {
			// Overriding to no-access is a deliberate operator choice, not
			// the silent least-privilege fallback, so it is not blocked.
			const out = resolveProjectRole({
				availableSlugs: ['viewer', 'no-access'],
				requested: 'no-access',
			});
			assert.equal(out.role, 'no-access');
		});

		it('REJECTS an override naming a role the project does not offer', () => {
			assert.throws(
				() =>
					resolveProjectRole({
						availableSlugs: ['viewer'],
						requested: 'owner-of-everything',
					}),
				/not offered by this project/,
			);
		});

		it('accepts an override the project does offer', () => {
			const out = resolveProjectRole({
				availableSlugs: ['viewer', 'developer'],
				requested: 'developer',
			});
			assert.equal(out.role, 'developer');
			assert.equal(out.source, 'env override');
		});

		it('reports the role as UNVERIFIED when the role list cannot be read', () => {
			// `null` means "could not ask" — not "no roles". The caller
			// must be able to tell the operator the role was assumed.
			const out = resolveProjectRole({ availableSlugs: null, requested: undefined });
			assert.equal(out.role, 'viewer');
			assert.equal(out.roleVerifiedAgainstProvider, false);
			assert.match(out.source, /NOT readable/);
		});

		it('still validates an override when the role list is unreadable', () => {
			const out = resolveProjectRole({ availableSlugs: null, requested: 'viewer' });
			assert.equal(out.role, 'viewer');
			assert.equal(out.roleVerifiedAgainstProvider, false);
		});
	});

	describe('isAlreadyMemberConflict', () => {
		const { isAlreadyMemberConflict } = loadMembershipHelpers();

		it('recognises ONLY the specific already-a-member 400', () => {
			assert.equal(
				isAlreadyMemberConflict({ status: 400, data: { message: 'Identity is already a member' } }),
				true,
			);
		});

		it('does NOT treat a generic 400 as a lost race', () => {
			// A malformed 400 is a real error. Assuming "already there"
			// is how a bootstrap reports success having observed nothing.
			assert.equal(
				isAlreadyMemberConflict({ status: 400, data: { message: 'Validation failed' } }),
				false,
			);
			assert.equal(isAlreadyMemberConflict({ status: 400, data: null }), false);
			assert.equal(isAlreadyMemberConflict({ status: 400, data: {} }), false);
		});

		it('does not treat another status carrying the same message as a conflict', () => {
			assert.equal(
				isAlreadyMemberConflict({ status: 409, data: { message: 'Identity is already a member' } }),
				false,
			);
		});
	});

	describe('pickIdentityByName (duplicate prevention)', () => {
		const { pickIdentityByName } = loadMembershipHelpers();

		it('reports unobservable when the server claims identities but lists none', () => {
			// The v0.165.x self-host bug. Absence must NOT be inferred
			// from an empty list that contradicts totalCount.
			const out = pickIdentityByName({ identities: [], totalCount: 2, name: 'x' });
			assert.equal(out.state, 'unobservable');
			assert.equal(out.totalCount, 2);
		});

		it('reports absent only when the server confirms there are none', () => {
			assert.equal(
				pickIdentityByName({ identities: [], totalCount: 0, name: 'x' }).state,
				'absent',
			);
			assert.equal(
				pickIdentityByName({
					identities: [{ identity: { id: 'a', name: 'other' } }],
					totalCount: 1,
					name: 'x',
				}).state,
				'absent',
			);
		});

		it('finds an existing identity so a re-run reuses it', () => {
			const out = pickIdentityByName({
				identities: [
					{ identity: { id: 'a', name: 'other' } },
					{ identity: { id: 'b', name: 'my-web-2026-cf-worker' } },
				],
				totalCount: 2,
				name: 'my-web-2026-cf-worker',
			});
			assert.equal(out.state, 'found');
			assert.equal(out.identity.id, 'b');
		});

		it('surfaces pre-existing duplicates instead of silently picking one', () => {
			const out = pickIdentityByName({
				identities: [
					{ identity: { id: 'a', name: 'dup' } },
					{ identity: { id: 'b', name: 'dup' } },
				],
				totalCount: 2,
				name: 'dup',
			});
			assert.equal(out.state, 'ambiguous');
			assert.deepEqual(out.ids, ['a', 'b']);
		});
	});

	describe('convergeProjectMembership (Issue #86 idempotence)', () => {
		const { convergeProjectMembership } = loadMembershipHelpers();
		const ARGS = { projectId: 'proj-1', identityId: 'id-1', expectedRole: 'viewer' };
		const ops = (calls) => calls.map((c) => c.op);

		it('first run: reads state, creates once, then VERIFIES by re-reading', async () => {
			const provider = createFakeProvider({ membership: null });
			const result = await convergeProjectMembership({ provider, ...ARGS });
			assert.equal(result.outcome, 'created');
			assert.equal(result.writes, 1);
			// The exact call sequence, not just the end state.
			assert.deepEqual(ops(provider.calls), ['getMembership', 'createMembership', 'getMembership']);
			const create = provider.calls.find((c) => c.op === 'createMembership');
			assert.equal(create.role, 'viewer');
			assert.equal(create.projectId, 'proj-1');
			assert.equal(create.identityId, 'id-1');
		});

		it('second run: clean no-op that performs ZERO writes', async () => {
			const provider = createFakeProvider({
				membership: { roles: [{ role: 'viewer' }] },
			});
			const result = await convergeProjectMembership({ provider, ...ARGS });
			assert.equal(result.outcome, 'already-correct');
			assert.equal(result.writes, 0);
			// No create. No update. One read, and nothing else. A test
			// that only checked the end state would pass on a script
			// that re-POSTed and let the server dedupe.
			assert.deepEqual(ops(provider.calls), ['getMembership']);
		});

		it('running it N times is stable: exactly one write across all runs', async () => {
			const provider = createFakeProvider({ membership: null });
			const results = [];
			for (let i = 0; i < 5; i += 1) {
				results.push(await convergeProjectMembership({ provider, ...ARGS }));
			}
			assert.deepEqual(
				results.map((r) => r.outcome),
				['created', 'already-correct', 'already-correct', 'already-correct', 'already-correct'],
			);
			assert.equal(ops(provider.calls).filter((o) => o !== 'getMembership').length, 1);
		});

		it('a wrong role converges via update, not create', async () => {
			const provider = createFakeProvider({ membership: { roles: [{ role: 'no-access' }] } });
			const result = await convergeProjectMembership({ provider, ...ARGS });
			assert.equal(result.outcome, 'converged');
			assert.deepEqual(ops(provider.calls), ['getMembership', 'updateMembership', 'getMembership']);
			// Never a create: creating again would duplicate, not fix.
			assert.equal(ops(provider.calls).includes('createMembership'), false);
		});

		it('an admin membership is DOWNGRADED to the read role, not left alone', async () => {
			const provider = createFakeProvider({ membership: { roles: [{ role: 'admin' }] } });
			await convergeProjectMembership({ provider, ...ARGS });
			assert.deepEqual(ops(provider.calls), ['getMembership', 'updateMembership', 'getMembership']);
			assert.equal(provider.state.membership.roles[0].role, 'viewer');
		});

		it('resumes an interrupted run: a membership that DID land is detected, not duplicated', async () => {
			// Simulates a crash after the create but before the verify.
			// The next run must observe the membership and do nothing.
			const provider = createFakeProvider({ membership: { roles: [{ role: 'viewer' }] } });
			const result = await convergeProjectMembership({ provider, ...ARGS });
			assert.equal(result.outcome, 'already-correct');
			assert.equal(ops(provider.calls).includes('createMembership'), false);
		});

		it('resumes a half-applied run: wrong role is finished, not restarted', async () => {
			// Simulates a crash after an update to the wrong role.
			const provider = createFakeProvider({ membership: { roles: [{ role: 'developer' }] } });
			const result = await convergeProjectMembership({ provider, ...ARGS });
			assert.equal(result.outcome, 'converged');
			assert.equal(provider.state.membership.roles[0].role, 'viewer');
		});

		it('a lost create race is resolved by RE-READING, never by assuming success', async () => {
			// A concurrent run created the membership between our read
			// and our write. The 400 is a signal to re-observe.
			let reads = 0;
			const provider = createFakeProvider({ membership: null });
			provider.createMembership = async (args) => {
				provider.calls.push({ op: 'createMembership', ...args });
				// The other run won: the membership now exists.
				provider.state.membership = { roles: [{ role: args.role }] };
				return { status: 400, data: { message: 'Identity is already a member' } };
			};
			provider.getMembership = async (args) => {
				reads += 1;
				provider.calls.push({ op: 'getMembership', ...args });
				return provider.state.membership;
			};
			const result = await convergeProjectMembership({ provider, ...ARGS });
			assert.equal(result.outcome, 'converged-after-race');
			assert.equal(reads, 2, 'must re-read provider state after the conflict');
			assert.deepEqual(ops(provider.calls), ['getMembership', 'createMembership', 'getMembership']);
		});

		it('a create 400 that is NOT the uniqueness conflict fails loudly', async () => {
			const provider = createFakeProvider({ membership: null });
			provider.createMembership = async (args) => {
				provider.calls.push({ op: 'createMembership', ...args });
				return { status: 400, data: { message: 'Validation failed' } };
			};
			await assert.rejects(
				() => convergeProjectMembership({ provider, ...ARGS }),
				/create failed with HTTP 400.*NO project access/s,
			);
		});

		it('a 403 from create fails loudly rather than reporting membership', async () => {
			const provider = createFakeProvider({ membership: null });
			provider.createMembership = async (args) => {
				provider.calls.push({ op: 'createMembership', ...args });
				return { status: 403, data: { message: 'Forbidden' } };
			};
			await assert.rejects(() => convergeProjectMembership({ provider, ...ARGS }), /HTTP 403/);
		});

		it('THROWS when the write did not actually land (a 200 is not proof)', async () => {
			// A write that returns 200 but leaves the wrong role must not
			// be reported as a success — the half-applied state.
			const provider = createFakeProvider({ membership: null });
			provider.createMembership = async (args) => {
				provider.calls.push({ op: 'createMembership', ...args });
				provider.state.membership = { roles: [{ role: 'no-access' }] };
				return { status: 200, data: {} };
			};
			await assert.rejects(
				() => convergeProjectMembership({ provider, ...ARGS }),
				/did not converge to 'viewer' after created \(observed: no-access\)/,
			);
		});

		it('THROWS when the update silently did not take effect', async () => {
			const provider = createFakeProvider({ membership: { roles: [{ role: 'admin' }] } });
			provider.updateMembership = async (args) => {
				provider.calls.push({ op: 'updateMembership', ...args });
				// Server accepted, state unchanged.
			};
			await assert.rejects(
				() => convergeProjectMembership({ provider, ...ARGS }),
				/did not converge to 'viewer' after converged \(observed: admin\)/,
			);
		});

		it('THROWS when the membership vanished entirely after the write', async () => {
			const provider = createFakeProvider({ membership: null });
			provider.createMembership = async (args) => {
				provider.calls.push({ op: 'createMembership', ...args });
				return { status: 200, data: {} }; // state stays null
			};
			await assert.rejects(
				() => convergeProjectMembership({ provider, ...ARGS }),
				/\(observed: no membership\)/,
			);
		});
	});

	describe('project access verification (Issue #86)', () => {
		it('uses the value-free secret list, never the raw value endpoint', () => {
			// The whole point of `viewSecretValue=false` is that no secret
			// value can reach this process. A `true` anywhere would leak.
			assert.match(SOURCE, /viewSecretValue: 'false'/);
			assert.equal(/viewSecretValue:\s*'true'/.test(SOURCE), false);
			assert.match(SOURCE, /\/api\/v3\/secrets\/raw\?\$\{params\.toString\(\)\}/);
		});

		it('logs the secret COUNT only, and never a name or a value', () => {
			assert.match(SOURCE, /\$\{access\.secretCount\} keys, values not read/);
			assert.equal(
				/console\.(log|error|warn)\([^)]*accessToken/.test(SOURCE),
				false,
				'the identity access token must never be logged',
			);
		});

		it('every verification failure throws, so a half-configured identity exits non-zero', () => {
			for (const fragment of [
				/Universal Auth login for the build identity failed with HTTP \$\{login\.status\}/,
				/Universal Auth login returned no accessToken/,
				/production secret list with the identity token failed with HTTP \$\{secrets\.status\}/,
				/production secret list did not return a secrets array/,
			]) {
				assert.match(SOURCE, fragment);
			}
		});

		it('the idempotent no-op branch does not mint a credential to re-verify', () => {
			// Minting a secret purely to check would leave a new live
			// credential on the server on every re-run.
			const noopBranch = SOURCE.slice(
				SOURCE.indexOf('if (allKeysPresent) {'),
				SOURCE.indexOf('let clientSecret = await generateClientSecret'),
			);
			assert.equal(
				noopBranch.includes('generateClientSecret'),
				false,
				'the no-op branch must not generate a client secret',
			);
			assert.match(noopBranch, /project access was not re-verified/);
		});
	});

	describe('process-level failure visibility (exit code)', () => {
		/*
		 * The unit tests above prove `convergeProjectMembership` throws.
		 * They cannot prove the OPERATOR sees it: a bootstrap that logs
		 * a failure and still exits 0 is the exact failure this ticket
		 * exists to remove. So the real binary is spawned.
		 *
		 * No network is needed. An unknown argument is rejected by
		 * `parseArgs` before any side effect, which drives the real
		 * `main().catch(...)` handler — so this exercises the genuine
		 * process-level exit path, and `--help` proves the success path
		 * still exits 0.
		 */
		const spawnScript = (args, env) =>
			spawnSync(process.execPath, [SCRIPT, ...args], {
				encoding: 'utf8',
				// Strip every provider credential so a regression that
				// starts talking to a real endpoint cannot silently do so
				// from a unit test.
				env: { PATH: process.env.PATH, ...env },
				timeout: 20_000,
			});

		it('exits NON-ZERO and says so on stderr when the run fails', () => {
			const result = spawnScript(['--not-a-real-flag'], {
				INFISICAL_TOKEN: 'not-a-real-token',
				INFISICAL_ORG_ID: '00000000-0000-0000-0000-000000000000',
			});
			assert.equal(result.status, 1, 'a failed bootstrap must exit 1, never 0');
			assert.match(
				result.stderr,
				/infisical-bootstrap-cf failed: unknown argument: --not-a-real-flag/,
				'the failure must be visible on stderr, not swallowed',
			);
		});

		it('exits NON-ZERO when a required credential is absent', () => {
			const result = spawnScript([], {});
			assert.equal(result.status, 1);
			assert.match(result.stderr, /INFISICAL_TOKEN env var is required/);
		});

		it('exits 0 for --help', () => {
			const result = spawnScript(['--help'], {});
			assert.equal(result.status, 0);
			assert.match(result.stdout, /INFISICAL_PROJECT_ROLE/);
		});

		it('the help text no longer claims project membership is skipped', () => {
			const result = spawnScript(['--help'], {});
			assert.equal(
				/no discoverable endpoint|SKIPPED/i.test(result.stdout),
				false,
				'the "no endpoint / SKIPPED" premise must be gone from operator-facing help',
			);
		});

		it('the top-level handler reports the message and exits 1', () => {
			// Pins the handler itself: a future refactor that logs and
			// falls through (exit 0) would turn every failure above into
			// a silent success.
			assert.match(
				SOURCE,
				/main\(\)\.catch\(\(error\) => \{[\s\S]*?console\.error\(`infisical-bootstrap-cf failed: \$\{error\?\.message \?\? error\}`\);[\s\S]*?process\.exit\(1\);/,
			);
		});
	});

	describe('unreadable response bodies are NOT absence', () => {
		/*
		 * `httpsRequestJson` / the membership provider read `null` as
		 * "the object I asked for does not exist". On the identity path
		 * that means CREATE A DUPLICATE; on the membership path it means
		 * CREATE A SECOND MEMBERSHIP. So an unreadable 2xx body must be
		 * an error, never a null.
		 *
		 * This is the transport-level instance of the same defect class
		 * the rest of Issue #86 removes: a code path that concludes
		 * "absent" from a response it did not actually understand.
		 */
		it('httpsExchange distinguishes "empty" from "unparseable"', () => {
			assert.match(
				SOURCE,
				/resolvePromise\(\{ status: res\.statusCode, data: null, parseFailed: false \}\)/,
				'an empty body must be flagged as NOT a parse failure',
			);
			assert.match(SOURCE, /parseFailed = true;/);
			assert.match(SOURCE, /resolvePromise\(\{ status: res\.statusCode, data, parseFailed \}\)/);
		});

		it('httpsRequestJson throws on a 2xx non-JSON body instead of returning null', () => {
			assert.match(
				SOURCE,
				/if \(parseFailed\) \{\s*throw new Error\(`\$\{method\} \$\{url\.pathname\} returned a non-JSON body on HTTP \$\{status\}`\);/,
			);
		});

		/*
		 * The three tests above are SOURCE greps: they pin the shape of
		 * the fix, not its behaviour. A mutation that wrapped the throw
		 * in `if (false)` still satisfies all of them — which means they
		 * would have reported "ok" having observed nothing, the exact
		 * defect class this ticket exists to remove.
		 *
		 * So the decisions are asserted BEHAVIOURALLY below, against the
		 * real provider with an injected transport. The source greps are
		 * kept as a secondary pin, not relied on alone.
		 */
		it('BEHAVIOUR: an unreadable membership body is "unknown", never "absent"', async () => {
			const provider = createProviderWithTransport({
				membershipResponses: [{ status: 200, data: null, parseFailed: true }],
			});
			await assert.rejects(
				() => provider.getMembership({ projectId: 'p1', identityId: 'i1' }),
				/unreadable body on HTTP 200; treating the state as unknown rather than absent/,
			);
		});

		it('BEHAVIOUR: only a 404 yields "no membership"', async () => {
			const provider = createProviderWithTransport({
				membershipResponses: [{ status: 404, data: { message: 'nope' }, parseFailed: false }],
			});
			assert.equal(await provider.getMembership({ projectId: 'p1', identityId: 'i1' }), null);
		});

		it('BEHAVIOUR: an unreadable body does not trigger a duplicate create', async () => {
			// The end-to-end consequence: an unreadable read must abort
			// the convergence, not fall through to the create branch.
			const provider = createProviderWithTransport({
				membershipResponses: [{ status: 200, data: null, parseFailed: true }],
			});
			let created = 0;
			await assert.rejects(async () => {
				const before = await provider.getMembership({ projectId: 'p1', identityId: 'i1' });
				if (before === null) {
					created += 1;
					await provider.createMembership({ projectId: 'p1', identityId: 'i1', role: 'viewer' });
				}
			});
			assert.equal(created, 0, 'an unreadable read must not be treated as absence');
		});

		it('BEHAVIOUR: any other error status on the read is a hard failure', async () => {
			for (const status of [401, 403, 500, 503]) {
				const provider = createProviderWithTransport({
					membershipResponses: [{ status, data: { message: 'x' }, parseFailed: false }],
				});
				await assert.rejects(
					() => provider.getMembership({ projectId: 'p1', identityId: 'i1' }),
					new RegExp(`failed with HTTP ${status}.*refusing to guess`),
					`HTTP ${status} must not be read as "no membership"`,
				);
			}
		});

		it('BEHAVIOUR: a present membership is returned unwrapped and readable', async () => {
			const provider = createProviderWithTransport({
				membershipResponses: [
					{
						status: 200,
						data: { identityMembership: { roles: [{ role: 'viewer' }] } },
						parseFailed: false,
					},
				],
			});
			const out = await provider.getMembership({ projectId: 'p1', identityId: 'i1' });
			assert.equal(membershipHelpers.membershipRoleSlugs(out)[0], 'viewer');
		});

		it('BEHAVIOUR: an unreadable ROLE list is "unknown", not "no roles"', async () => {
			const provider = createProviderWithTransport({
				roleResponses: [{ status: 200, data: null, parseFailed: true }],
			});
			// `null` means "could not ask" — the caller then reports the
			// role as unverified. An empty array would be a different and
			// much stronger claim.
			assert.equal(await provider.listProjectRoleSlugs({ projectId: 'p1' }), null);
		});

		it('BEHAVIOUR: the read is issued against the canonical project-scoped path', async () => {
			const seen = [];
			const provider = createProviderWithTransport({
				membershipResponses: [{ status: 404, data: null, parseFailed: false }],
				record: (method, url) => seen.push(`${method} ${url}`),
			});
			await provider.getMembership({ projectId: 'proj/1', identityId: 'id 1' });
			assert.deepEqual(seen, [
				'GET https://infisical.test/api/v1/projects/proj%2F1/memberships/identities/id%201',
			]);
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
