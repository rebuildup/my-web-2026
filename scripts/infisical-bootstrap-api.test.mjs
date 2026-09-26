import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * `infisical-bootstrap-api.mjs` unit tests.
 *
 * The script makes HTTPS calls to Infisical (POST /api/v1/projects +
 * POST /api/v1/projects/{id}/environments) and writes `.infisical.json`.
 * Testing the network path requires a live Infisical self-host.
 *
 * The interesting invariants testable without credentials are:
 *
 *   1. Pure-helper shape: `buildInfisicalJsonContent` produces the
 *      exact JSON contract `.infisical.json` expects (workspaceId +
 *      optional defaultEnvironment, trailing newline, 2-space indent).
 *   2. workspaceId validation: must be UUID v4; non-v4 strings fail
 *      before any file write.
 *   3. JWT organizationId extraction: handles the multi-line output
 *      of `infisical user get token` (which contains `Token:<jwt>` +
 *      other metadata lines).
 *   4. Argument parsing: only `--help` / `-h` accepted; unknown
 *      args abort with a clear error.
 *   5. argv / log / error secret-handling: never embeds a secret
 *      value (this script handles non-secret identifiers only).
 *   6. Self-host API contract: the source calls `/api/v1/...` paths
 *      (NOT the `/api/v3/...` paths assumed by the original plan)
 *      and uses `projectName` + `organizationId` for project
 *      creation. (The self-host v0.165.x does not expose
 *      `/api/v3/projects`; see ADR-0015 §11.6.1 / Execution log
 *      2026-09-27.)
 *
 * Helpers are loaded via regex extraction (same pattern as
 * `bootstrap-home-api-key.test.mjs#loadPureHelpers`) so the tests
 * pin the script's exported function surface without depending on
 * the side-effectful main() path.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'infisical-bootstrap-api.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

function loadPureHelpers() {
	const grab = (signature) => {
		// Match `function name(...) {` at top-level (no leading whitespace
		// for top-level declarations) OR `function name(...) {` after a
		// blank line inside an indented block. The script uses top-level
		// declarations only, so this is straightforward.
		const re = new RegExp(`function ${signature}\\b[\\s\\S]*?\\n\\}`, 'm');
		const match = SOURCE.match(re);
		if (!match) throw new Error(`could not extract ${signature} from script`);
		// biome-ignore lint/security/noGlobalEval: test-only function extraction.
		return eval(`(${match[0].replace(/^function\s+/, 'function ')})`);
	};
	return {
		buildInfisicalJsonContent: grab('buildInfisicalJsonContent'),
		validateWorkspaceId: grab('validateWorkspaceId'),
		jwtOrganizationId: grab('jwtOrganizationId'),
		parseArgs: grab('parseArgs'),
	};
}

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const VALID_ORG_ID = 'd808df2c-ec67-4046-b733-8c0db0bfa47d';

describe('infisical-bootstrap-api.mjs', () => {
	describe('buildInfisicalJsonContent', () => {
		const { buildInfisicalJsonContent } = loadPureHelpers();

		it('emits workspaceId + defaultEnvironment when provided', () => {
			const out = buildInfisicalJsonContent({
				workspaceId: VALID_UUID,
				defaultEnvironment: 'dev',
			});
			assert.equal(
				out,
				`${JSON.stringify({ workspaceId: VALID_UUID, defaultEnvironment: 'dev' }, null, 2)}\n`,
			);
		});

		it('omits defaultEnvironment when null', () => {
			const out = buildInfisicalJsonContent({
				workspaceId: VALID_UUID,
				defaultEnvironment: null,
			});
			assert.equal(out, `${JSON.stringify({ workspaceId: VALID_UUID }, null, 2)}\n`);
		});

		it('uses 2-space indentation (matches existing infisical-bootstrap.mjs output)', () => {
			const out = buildInfisicalJsonContent({
				workspaceId: VALID_UUID,
				defaultEnvironment: 'prod',
			});
			assert.match(out, /^\{\n {2}"workspaceId":/);
		});

		it('ends with exactly one trailing newline', () => {
			const out = buildInfisicalJsonContent({
				workspaceId: VALID_UUID,
				defaultEnvironment: 'dev',
			});
			assert.equal(out.endsWith('\n'), true);
			assert.equal(out.endsWith('\n\n'), false);
		});
	});

	describe('validateWorkspaceId', () => {
		const { validateWorkspaceId } = loadPureHelpers();

		it('accepts a UUID v4 and lowercases it', () => {
			assert.equal(validateWorkspaceId(VALID_UUID.toUpperCase()), VALID_UUID);
		});

		it('rejects non-string input', () => {
			assert.throws(() => validateWorkspaceId(123), /not UUID v4/);
			assert.throws(() => validateWorkspaceId(null), /not UUID v4/);
			assert.throws(() => validateWorkspaceId(undefined), /not UUID v4/);
		});

		it('rejects malformed UUID', () => {
			assert.throws(() => validateWorkspaceId('not-a-uuid'), /not UUID v4/);
		});

		it('rejects UUID v1 (only v4 accepted — matches existing infisical-bootstrap.mjs contract)', () => {
			const v1 = 'a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d';
			assert.throws(() => validateWorkspaceId(v1), /not UUID v4/);
		});
	});

	describe('jwtOrganizationId', () => {
		const { jwtOrganizationId } = loadPureHelpers();

		// Sample JWT with payload `{organizationId: "<ORG>", ...}`.
		// Constructed for tests: header = `{"alg":"HS256","typ":"JWT"}`
		// → base64url `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`. Payload is
		// the variable part. The third segment can be any base64url.
		const JWT_HEADER_B64 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
		function makeJwt(payload) {
			const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8')
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '');
			return `${JWT_HEADER_B64}.${payloadB64}.sigdummy`;
		}

		it('extracts organizationId from a JWT payload', () => {
			const jwt = makeJwt({
				authMethod: 'google',
				authTokenType: 'accessToken',
				userId: 'x',
				tokenVersionId: 'y',
				accessVersion: 1,
				organizationId: VALID_ORG_ID,
				iat: 1,
				exp: 2,
			});
			assert.equal(jwtOrganizationId(jwt), VALID_ORG_ID);
		});

		it('extracts organizationId from a JWT embedded in `infisical user get token` multi-line output', () => {
			// The CLI emits this shape; the function must locate the JWT
			// segment and extract the org id without depending on line
			// position.
			const jwt = makeJwt({ organizationId: VALID_ORG_ID });
			const multiLine = `SessionID:xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx\nToken:${jwt}\nExpiresAt:Thu, 01 Jan 1970 00:00:00 GMT\nTTL:1h0m0s`;
			assert.equal(jwtOrganizationId(multiLine), VALID_ORG_ID);
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

	describe('parseArgs', () => {
		const { parseArgs } = loadPureHelpers();

		it('accepts no args', () => {
			const out = parseArgs([]);
			assert.deepEqual(out, {});
		});

		it('accepts --help', () => {
			// Stub process.exit to capture the call without actually exiting.
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
				assert.match(logOutput, /Usage: infisical-bootstrap-api\.mjs/);
			} finally {
				process.exit = origExit;
				console.log = origLog;
			}
		});

		it('accepts -h', () => {
			const origExit = process.exit;
			process.exit = () => {
				throw new Error('__exit__');
			};
			try {
				try {
					parseArgs(['-h']);
				} catch (e) {
					if (e.message !== '__exit__') throw e;
				}
			} finally {
				process.exit = origExit;
			}
		});

		it('rejects unknown argument', () => {
			assert.throws(() => parseArgs(['--bogus']), /unknown argument: --bogus/);
		});
	});

	describe('argv / log / error-message secret-handling invariant', () => {
		it('the script source never reads secret env vars', () => {
			// The script must not read process.env.BETTER_AUTH_SECRET,
			// process.env.MY_WEB_2026_CONSUMER_API_KEY, or any other
			// runtime secret variable. It only reads INFISICAL_TOKEN +
			// INFISICAL_ORG_ID + INFISICAL_API_URL.
			const secretReads = SOURCE.match(/process\.env\.(BETTER_AUTH_[A-Z_]+|MY_WEB_2026_[A-Z_]+)/g);
			assert.equal(
				secretReads,
				null,
				`script reads runtime secret env vars: ${secretReads?.join(', ')}`,
			);
		});

		it('the script source never logs a secret value (no console.log of an env var reference)', () => {
			// Defensive: assert no `console.log(...process.env...)` style
			// leak. Runtime secrets should never reach stdout / log.
			const leaks = SOURCE.match(/console\.(log|error|warn)\([^)]*process\.env\.(BETTER|MY_WEB)/g);
			assert.equal(
				leaks,
				null,
				`script may leak secret values to stdout/log: ${leaks?.join(', ')}`,
			);
		});
	});

	describe('self-host API contract', () => {
		it('uses /api/v1/... paths (NOT /api/v3/...)', () => {
			// Self-host v0.165.x does not expose /api/v3/projects. The
			// /api/v3/... paths assumed by the original plan are 404.
			// Regression: the script must keep using /api/v1/...
			const v1Calls = SOURCE.match(/\/api\/v1\//g) ?? [];
			const v3Calls = SOURCE.match(/\/api\/v3\//g) ?? [];
			assert.ok(v1Calls.length > 0, 'script must use /api/v1/... paths');
			assert.equal(v3Calls.length, 0, 'script must not use /api/v3/... paths');
		});

		it('uses projectName + organizationId (NOT name + slug) for project creation', () => {
			// v0.165.x POST /api/v1/projects body shape is
			// `{projectName, organizationId}`, not `{name, slug}`.
			// The old shape returns 422 from this self-host.
			assert.match(SOURCE, /projectName:\s*PROJECT_NAME/);
			assert.match(SOURCE, /organizationId/);
			// The literal `slug: PROJECT_SLUG` shape would 422; we
			// pin the absence here.
			assert.equal(
				SOURCE.includes('slug: PROJECT_SLUG'),
				false,
				'script must not POST project with `{name, slug}` shape (422 on this self-host)',
			);
		});
	});

	describe('.infisical.json schema (regression for operator `infisical init` interop)', () => {
		it('ALLOWED_INFISICAL_JSON_KEYS includes gitBranchToEnvironmentMapping', () => {
			// Regression: `infisical init` writes
			// `gitBranchToEnvironmentMapping` into `.infisical.json`.
			// Without this allowance, a re-init between agent runs would
			// cause bootstrap-api to throw on existing files.
			assert.match(SOURCE, /'gitBranchToEnvironmentMapping'/);
		});
	});
});
