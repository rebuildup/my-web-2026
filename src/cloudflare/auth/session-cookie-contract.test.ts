import { SELF, env } from 'cloudflare:test';
import { getCookies } from 'better-auth/cookies';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRODUCTION_BETTER_AUTH_URL } from '../../../scripts/_cloudflare-contract.mjs';
import { auth } from './better-auth';
import {
	SECURE_COOKIE_PREFIX,
	type SessionCookieContractReport,
	type SessionCookieProfileId,
	type SessionCookieViolationCode,
	evaluateSessionCookies,
	maskSetCookieValue,
	readSetCookieHeaders,
	sessionCookieProfileFor,
	splitSetCookieHeader,
} from './session-cookie-contract';

/**
 * Session cookie attribute contract (Issue #438).
 *
 * Two layers, both in the local workerd pool. Nothing here talks to
 * production, and nothing reads a secret value.
 *
 * 1. POSITIVE — a real Worker response. `SELF.fetch` drives the whole
 *    external boundary (`src/server.ts` → `authRouter` →
 *    `auth.handler`) against the Miniflare D1 binding, and the
 *    `Set-Cookie` headers that come back are evaluated by
 *    `evaluateSessionCookies`. The signed-in account is a local-only
 *    fixture user created through `auth.api.createUser`; its rows are
 *    deleted afterwards. The contract is role-independent, so the
 *    fixture uses `role: 'admin'` only because that is the role the
 *    sign-in surface actually serves.
 *
 *    The deployed shape (Secure + `__Secure-`) cannot be observed from
 *    this pool: `vitest.config.ts` deliberately leaves `BETTER_AUTH_URL`
 *    unbound so the pool exercises the "no pinned origin" branch. So
 *    the production shape is produced the same way Better Auth
 *    produces it — `getCookies()` over the real instance options with
 *    `baseURL` set to the canonical pinned origin from
 *    `scripts/_cloudflare-contract.mjs` — and the resulting attributes
 *    are serialized into `Set-Cookie` strings and evaluated by the
 *    same function. That is a local fixture, not a production
 *    request, and it is the only way to pin the https shape without a
 *    real account.
 *
 * 2. NEGATIVE — forged fixtures. Each fixture is a hand-written
 *    `Set-Cookie` string with exactly one attribute weakened, and each
 *    must FAIL the same evaluator. A fixture that passed would mean the
 *    contract cannot detect the downgrade it exists to detect.
 *
 * Secret / PII invariant
 * ----------------------
 * The evaluator drops cookie values at parse time, so a report has no
 * field for one. That alone is NOT enough for the verification
 * evidence: a real sign-in response carries the live signed session
 * token and a `session_data` cookie holding the signed user record
 * (name, email, role), and `record()` used to keep those raw strings
 * for the screenshot. Every header is therefore passed through
 * `maskSetCookieValue` at the moment it enters the evidence map, so the
 * emitted payload carries attribute names, flags and values only, and
 * the two `report safety` tests assert that on the payload itself
 * rather than on the report it is derived from.
 *
 * Importing `scripts/_cloudflare-contract.mjs`
 * -------------------------------------------
 * This is the one place where `src/**` imports from `scripts/**`. It is
 * deliberate: the canonical production origin has exactly one
 * declaration, and the contract must be evaluated against THAT value
 * rather than a third restatement of it. `scripts/check-architecture.mjs`
 * models owner-to-owner edges inside `src/` only, so the edge is
 * documented here rather than registered there.
 */

/**
 * Placeholder cookie value. Obviously not a token: the contract drops
 * values at parse time, so this string is never read by any assertion
 * and exists only to make a forged header well-formed.
 */
const FIXTURE_VALUE = 'fixture-value-not-a-token';

const LOCAL_LABEL = 'local workerd pool (no pinned BETTER_AUTH_URL)';
const PRODUCTION_LABEL = 'canonical production origin (pinned BETTER_AUTH_URL)';

const localProfile = sessionCookieProfileFor(undefined, LOCAL_LABEL);
const productionProfile = sessionCookieProfileFor(PRODUCTION_BETTER_AUTH_URL, PRODUCTION_LABEL);

const FIXTURE_USER = {
	email: 'session-contract-admin@test.local',
	password: 'local-fixture-password-not-a-secret',
	name: 'Session Contract Fixture',
	role: 'admin' as const,
};

/**
 * Verification evidence for the required screenshot. Assembled from
 * the reports the assertions below already computed, then emitted as
 * ONE JSON line so a local run can be rendered without re-deriving
 * anything by hand.
 */
interface CaseEvidence {
	id: string;
	kind: 'real-response' | 'fixture';
	expectation: 'pass' | 'fail';
	profile: SessionCookieProfileId;
	/**
	 * The `Set-Cookie` strings the evaluator saw, with every value
	 * replaced by `<masked>` on the way in. Attribute names, flags and
	 * attribute values survive, because they are what the contract is
	 * about; the cookie *value* does not, because for a real response
	 * it is a signed session token / signed user record.
	 */
	headers: string[];
	cookies: {
		name: string;
		secure: boolean;
		httpOnly: boolean;
		sameSite: string | null;
		path: string | null;
		domain: string | null;
		maxAge: number | null;
	}[];
	violations: { code: SessionCookieViolationCode; message: string }[];
}

const evidence = new Map<string, CaseEvidence>();

/**
 * Store one case for the verification evidence.
 *
 * Masking happens HERE, at the boundary where a raw header enters the
 * evidence map, rather than in whatever later renders it: a renderer
 * that forgets to redact turns a log line into a credential, and there
 * is no second line of defence between this call and `console.info`.
 */
function record(
	id: string,
	kind: CaseEvidence['kind'],
	expectation: 'pass' | 'fail',
	report: SessionCookieContractReport,
	headers: readonly string[] = [],
) {
	evidence.set(id, {
		id,
		kind,
		expectation,
		profile: report.profile.id,
		headers: headers.map((header) => maskSetCookieValue(header)),
		cookies: report.cookies.map((cookie) => ({ name: cookie.name, ...cookie.attributes })),
		violations: report.violations.map((violation) => ({
			code: violation.code,
			message: violation.message,
		})),
	});
}

/**
 * The exact value `afterAll` prints. A function rather than an inline
 * object literal so the safety tests can assert on the same bytes the
 * report line carries, instead of on a re-derivation of it.
 */
function buildEvidencePayload() {
	return {
		marker: 'session-cookie-contract',
		origin: 'local workerd pool (@cloudflare/vitest-plugin, Miniflare D1)',
		profiles: {
			local: {
				id: localProfile.id,
				secure: localProfile.secure,
				namePrefix: localProfile.namePrefix,
			},
			production: {
				id: productionProfile.id,
				secure: productionProfile.secure,
				namePrefix: productionProfile.namePrefix,
			},
		},
		cases: [...evidence.values()],
	};
}

function codes(report: SessionCookieContractReport): SessionCookieViolationCode[] {
	return report.violations.map((violation) => violation.code);
}

async function clearRows(): Promise<void> {
	for (const table of ['session', 'account', 'verification', 'apikey', 'user']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

async function signIn(email: string, password: string): Promise<Response> {
	return SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
		body: JSON.stringify({ email, password }),
	});
}

/**
 * Serialize a Better Auth cookie descriptor into a `Set-Cookie`
 * string, with the placeholder value. Mirrors Better Auth's own
 * attribute spelling so the fixture is indistinguishable from a real
 * response at the parser. `expires` / `partitioned` / `prefix` are
 * carried by the descriptor type but are never set by this
 * configuration, and the contract does not evaluate them.
 */
type BetterAuthCookieAttributes = ReturnType<typeof getCookies>['sessionToken']['attributes'];

function serializeCookie(name: string, attributes: BetterAuthCookieAttributes): string {
	const parts = [`${name}=${FIXTURE_VALUE}`];
	if (attributes.secure === true) parts.push('Secure');
	if (attributes.httpOnly === true) parts.push('HttpOnly');
	if (typeof attributes.sameSite === 'string') parts.push(`SameSite=${attributes.sameSite}`);
	if (typeof attributes.path === 'string') parts.push(`Path=${attributes.path}`);
	if (typeof attributes.domain === 'string') parts.push(`Domain=${attributes.domain}`);
	if (typeof attributes.maxAge === 'number') parts.push(`Max-Age=${attributes.maxAge}`);
	return parts.join('; ');
}

/**
 * The deployed cookie set, computed by Better Auth itself from the
 * live instance options with the pinned production origin. Only the
 * base URL differs from what the module under test was built with.
 */
function productionShapedCookies(): string[] {
	type CookieOptions = Parameters<typeof getCookies>[0];
	const options = (auth as unknown as { options: CookieOptions }).options;
	const cookies = getCookies({ ...options, baseURL: PRODUCTION_BETTER_AUTH_URL });
	return [
		serializeCookie(cookies.sessionToken.name, cookies.sessionToken.attributes),
		serializeCookie(cookies.sessionData.name, cookies.sessionData.attributes),
	];
}

interface NegativeFixture {
	id: string;
	description: string;
	profile: SessionCookieProfileId;
	/** One attribute weakened relative to the contract. */
	cookies: string[];
	expectedCodes: SessionCookieViolationCode[];
}

const NEGATIVE_FIXTURES: readonly NegativeFixture[] = [
	{
		id: 'http-only-missing',
		description: 'session token without HttpOnly — readable from JavaScript',
		profile: 'https',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; SameSite=Lax; Secure`,
		],
		expectedCodes: ['http-only-missing'],
	},
	{
		id: 'secure-dropped',
		description: '__Secure- name prefix kept while the Secure attribute is dropped',
		profile: 'https',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`,
		],
		expectedCodes: ['secure-missing'],
	},
	{
		id: 'secure-without-prefix',
		description: 'Secure attribute without the RFC 6265bis __Secure- prefix',
		profile: 'https',
		cookies: [
			`better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`,
		],
		expectedCodes: ['prefix-missing'],
	},
	{
		id: 'domain-widened',
		description: 'Domain attribute widens the cookie to sibling subdomains (cookie tossing)',
		profile: 'https',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure; Domain=rebuildup.dev`,
		],
		expectedCodes: ['domain-unexpected'],
	},
	{
		id: 'same-site-none',
		description: 'SameSite=None drops the cross-site request mitigation',
		profile: 'https',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=None; Secure`,
		],
		expectedCodes: ['same-site-unexpected'],
	},
	{
		id: 'same-site-absent',
		description: 'no SameSite attribute at all',
		profile: 'https',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; HttpOnly; Secure`,
		],
		expectedCodes: ['same-site-missing'],
	},
	{
		id: 'path-narrowed',
		description: 'Path scoped to the auth router drops the session on /admin and /api/v1',
		profile: 'https',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Secure`,
		],
		expectedCodes: ['path-unexpected'],
	},
	{
		id: 'max-age-extended',
		description: 'Max-Age silently raised from the configured 30-day lifetime to a year',
		profile: 'https',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax; Secure`,
		],
		expectedCodes: ['max-age-unexpected'],
	},
	{
		id: 'session-cookie-absent',
		description: 'a response that sets no session cookie at all',
		profile: 'https',
		cookies: [`unrelated=${FIXTURE_VALUE}; Path=/; HttpOnly; SameSite=Lax`],
		expectedCodes: ['session-cookie-missing'],
	},
	{
		id: 'cookie-cache-readable',
		description:
			'cookie-cache cookie without HttpOnly exposes the signed user record (id, role, email)',
		profile: 'https',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`,
			`${SECURE_COOKIE_PREFIX}better-auth.session_data=${FIXTURE_VALUE}; Max-Age=300; Path=/; SameSite=Lax; Secure`,
		],
		expectedCodes: ['http-only-missing'],
	},
	{
		id: 'secure-marked-on-plain-http',
		description: 'Secure cookie under the local http profile — dropped by a non-localhost browser',
		profile: 'http',
		cookies: [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`,
		],
		expectedCodes: ['secure-unexpected', 'prefix-unexpected'],
	},
];

describe('session cookie contract — positive (real workerd response)', () => {
	beforeEach(clearRows);
	afterEach(clearRows);

	it('sign-in Set-Cookie satisfies the http profile used by the local pool', async () => {
		await auth.api.createUser({ body: FIXTURE_USER });

		const res = await signIn(FIXTURE_USER.email, FIXTURE_USER.password);
		expect(res.status).toBe(200);

		const report = evaluateSessionCookies(readSetCookieHeaders(res.headers), localProfile);
		record(
			'local-workerd-sign-in',
			'real-response',
			'pass',
			report,
			readSetCookieHeaders(res.headers),
		);

		expect(report.violations).toEqual([]);
		expect(report.ok).toBe(true);

		const token = report.cookies.find((cookie) => cookie.rule === 'session_token');
		expect(token).toMatchObject({
			name: 'better-auth.session_token',
			attributes: {
				secure: false,
				httpOnly: true,
				sameSite: 'lax',
				path: '/',
				domain: null,
				maxAge: 2_592_000,
			},
		});

		// The cookie cache is enabled in the auth config (ADR-0009); its
		// cookie carries a signed copy of the user record, so the same
		// attribute policy applies to it.
		const cookieCache = report.cookies.find((cookie) => cookie.rule === 'session_data');
		expect(cookieCache).toMatchObject({
			name: 'better-auth.session_data',
			attributes: { httpOnly: true, sameSite: 'lax', path: '/', domain: null, maxAge: 300 },
		});
	});

	it('deployed shape: the pinned https origin emits Secure + the __Secure- prefix', () => {
		// The canonical origin is https, so the https profile applies.
		// `scripts/check-cloudflare-contract.mjs` separately proves the
		// built Worker carries this value.
		expect(productionProfile.id).toBe('https');

		const headers = productionShapedCookies();
		const report = evaluateSessionCookies(headers, productionProfile);
		record('production-shape-fixture', 'fixture', 'pass', report, headers);

		expect(report.violations).toEqual([]);
		expect(report.ok).toBe(true);

		const token = report.cookies.find((cookie) => cookie.rule === 'session_token');
		expect(token?.name).toBe(`${SECURE_COOKIE_PREFIX}better-auth.session_token`);
		expect(token?.attributes).toMatchObject({
			secure: true,
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			domain: null,
			maxAge: 2_592_000,
		});
	});
});

describe('session cookie contract — negative (real response and forged fixtures)', () => {
	beforeEach(clearRows);
	afterEach(clearRows);

	it('a rejected sign-in sets no session cookie', async () => {
		const res = await signIn(FIXTURE_USER.email, 'wrong-password');
		expect(res.status).toBe(401);

		const headers = readSetCookieHeaders(res.headers);
		const report = evaluateSessionCookies(headers, localProfile);
		record('rejected-sign-in', 'real-response', 'fail', report, headers);

		expect(report.ok).toBe(false);
		expect(codes(report)).toEqual(['session-cookie-missing']);
	});

	for (const fixture of NEGATIVE_FIXTURES) {
		it(`rejects the forged fixture: ${fixture.id}`, () => {
			const profile = fixture.profile === 'https' ? productionProfile : localProfile;
			const report = evaluateSessionCookies(fixture.cookies, profile);
			record(fixture.id, 'fixture', 'fail', report, fixture.cookies);

			expect(report.ok).toBe(false);
			// Exact, not `arrayContaining`: the fixture weakens ONE
			// attribute, so an additional violation means the fixture is
			// weaker than its description and would stop proving that the
			// contract detects exactly one downgrade.
			expect(codes(report)).toEqual(fixture.expectedCodes);
		});
	}
});

describe('session cookie contract — report safety', () => {
	it('never carries a cookie value into the report', () => {
		const report = evaluateSessionCookies(
			[
				`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Path=/; SameSite=Lax; Secure`,
			],
			productionProfile,
		);

		expect(report.ok).toBe(false);
		expect(JSON.stringify(report)).not.toContain(FIXTURE_VALUE);
		expect(report.violations[0]?.message).not.toContain(FIXTURE_VALUE);
	});

	it('splits a joined Set-Cookie header without cutting an Expires date', () => {
		// The workerd pool keeps multiple Set-Cookie headers separate,
		// so the joined form a runtime without `getSetCookie()` returns
		// is constructed by hand here.
		const joined = [
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=${FIXTURE_VALUE}; Max-Age=2592000; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/; HttpOnly; SameSite=Lax; Secure`,
			`${SECURE_COOKIE_PREFIX}better-auth.session_data=${FIXTURE_VALUE}; Max-Age=300; Path=/; HttpOnly; SameSite=Lax; Secure`,
		].join(', ');

		const report = evaluateSessionCookies(splitSetCookieHeader(joined), productionProfile);

		expect(report.ok).toBe(true);
		expect(report.cookies).toHaveLength(2);
	});

	it('masks the value and keeps every attribute, including a base64 padding "="', () => {
		expect(
			maskSetCookieValue(
				`${SECURE_COOKIE_PREFIX}better-auth.session_token=abc123==; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`,
			),
		).toBe(
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=<masked>; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`,
		);
		// A value-less fragment is returned untouched rather than
		// rewritten into something that looks like a cookie.
		expect(maskSetCookieValue('garbage-without-a-pair')).toBe('garbage-without-a-pair');
	});
});

describe('session cookie contract — verification evidence safety', () => {
	it('masks a raw header at the moment it enters the evidence payload', () => {
		// Stand-in for the real workerd sign-in header: a value that is
		// unmistakably a credential and that must never survive into the
		// emitted line. Recorded here so this assertion holds even if the
		// suite order changes.
		const raw = `${SECURE_COOKIE_PREFIX}better-auth.session_token=live-signed-token-must-not-be-printed; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`;
		const report = evaluateSessionCookies([raw], productionProfile);
		record('evidence-masking-self-check', 'real-response', 'pass', report, [raw]);

		const payload = buildEvidencePayload();
		const selfCheck = payload.cases.find((entry) => entry.id === 'evidence-masking-self-check');

		expect(selfCheck?.headers).toEqual([
			`${SECURE_COOKIE_PREFIX}better-auth.session_token=<masked>; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`,
		]);
		expect(JSON.stringify(payload)).not.toContain('live-signed-token-must-not-be-printed');
	});

	it('emits no cookie value in the payload, including the real sign-in case', () => {
		const payload = buildEvidencePayload();
		const serialized = JSON.stringify(payload);

		// Not vacuous: the self-check case above, plus the real workerd
		// response and the forged fixtures recorded by the suites before
		// this one, are all in here.
		expect(payload.cases.length).toBeGreaterThan(1);

		// Structural: every stored header must have `<masked>` exactly
		// where the value would be.
		for (const entry of payload.cases) {
			for (const header of entry.headers) {
				const value = header.slice(header.indexOf('=') + 1).split(';')[0];
				expect(value).toBe('<masked>');
			}
		}

		expect(serialized).not.toContain(FIXTURE_VALUE);
		expect(serialized).not.toContain(FIXTURE_USER.email);
		expect(serialized).not.toContain(FIXTURE_USER.name);
		// A session cookie may appear, never with a value behind it.
		expect(serialized).not.toMatch(/session_(?:token|data)=(?![^;"]*<masked>)/);
	});
});

/**
 * Emit one JSON line so the verification screenshot can be produced
 * from a real run (see
 * `docs/verification/security/cookie-header-test.webp`). It is not
 * gated on an env var on purpose: the workerd test pool exposes
 * neither `process.env` nor Vite env vars, so a flag could not reach
 * it. Vitest's default reporter only surfaces console output from
 * failing tests, so the normal `pnpm run test` stays quiet; the
 * documented reproduction command passes `--reporter=verbose` to see
 * it.
 *
 * The payload cannot carry a session token or a user record: values
 * were dropped at parse time inside the evaluator, and the raw
 * headers `record()` keeps for the evidence were masked on the way in.
 * `describe('… verification evidence safety')` asserts both on this
 * exact payload, and `scripts/render-session-cookie-report.mjs`
 * refuses to render a payload whose headers are not masked.
 */
afterAll(() => {
	console.info(`SESSION_COOKIE_CONTRACT_REPORT ${JSON.stringify(buildEvidencePayload())}`);
});
