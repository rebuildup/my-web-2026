import { describe, expect, it } from 'vitest';
import {
	MAX_REDIRECT_TARGET_LENGTH,
	classifyRedirectTarget,
	collectRedirectCandidatesFromBody,
	collectRedirectCandidatesFromUrl,
	firstRejectedRedirect,
	resolveInternalRedirect,
} from './redirect';

/**
 * Unit tests for the open-redirect classifier (Issue #454).
 *
 * Pure string classification — no Worker, no Hono, no bindings — so
 * the whole matrix runs in milliseconds and every hostile shape has
 * exactly one owning test. The mounted behaviour (the same rules over
 * a real `/api/v1/auth/*` request) lives in `redirect-guard.test.ts`;
 * this file owns the classification itself.
 *
 * The hostile rows are taken from the shapes that actually show up in
 * open-redirect reports: scheme-relative authorities, backslash
 * authority (`\` is a `/` in every browser URL parser), userinfo
 * tricks (`https://rebuildup.dev@evil.example`), and one or two
 * layers of percent-encoding, which is what defeats a validator that
 * inspects the raw string and a consumer that decodes it later.
 */

const TRUSTED = { trustedOrigins: ['https://rebuildup.dev'] } as const;

function accepted(candidate: unknown, policy = {} as Parameters<typeof classifyRedirectTarget>[1]) {
	const decision = classifyRedirectTarget(candidate, policy);
	if (!decision.ok)
		throw new Error(`expected accept, got ${decision.reason}: ${String(candidate)}`);
	return decision.redirect;
}

function refused(candidate: unknown, policy = {} as Parameters<typeof classifyRedirectTarget>[1]) {
	const decision = classifyRedirectTarget(candidate, policy);
	if (decision.ok) throw new Error(`expected refusal, got redirect: ${decision.redirect}`);
	return decision.reason;
}

describe('classifyRedirectTarget — internal paths are accepted', () => {
	it.each([
		['/admin', '/admin'],
		['/admin/keys', '/admin/keys'],
		['/', '/'],
		['/admin?tab=keys#list', '/admin?tab=keys#list'],
		// Percent-encoded separators that decode to a still-internal path.
		['%2Fadmin%2Fkeys', '/admin/keys'],
		// The accepted target is the fully-decoded form, so a second
		// decode by any downstream consumer is a no-op. Escapes inside
		// a query value are canonicalised with it (`%2F` -> `/`).
		['/admin?next=%2Fkeys', '/admin?next=/keys'],
		// Leading / trailing whitespace from a hand-edited link.
		['   /admin   ', '/admin'],
	])('accepts %j as %j', (candidate, expected) => {
		expect(accepted(candidate)).toBe(expected);
	});

	it('downgrades a same-origin absolute URL to its path', () => {
		// The canonical production origin (ADR-0014). The caller never
		// sees a host, only the internal path.
		expect(accepted('https://rebuildup.dev/admin/keys?a=1#b', TRUSTED)).toBe('/admin/keys?a=1#b');
		expect(accepted('https://rebuildup.dev', TRUSTED)).toBe('/');
		// Case-insensitive origin match (URL origins are lower-cased).
		expect(accepted('https://Rebuildup.DEV/admin', TRUSTED)).toBe('/admin');
	});

	it('does not treat a trusted origin prefix as a trusted origin', () => {
		// `rebuildup.dev.evil.example` and `https://rebuildup.dev@evil.example`
		// both end up somewhere else entirely.
		expect(refused('https://rebuildup.dev.evil.example/admin', TRUSTED)).toBe('external_origin');
		expect(refused('https://rebuildup.dev@evil.example/admin', TRUSTED)).toBe('external_origin');
	});
});

describe('classifyRedirectTarget — hostile shapes are refused', () => {
	it.each([
		['https://evil.example/', 'external_origin'],
		['http://evil.example/admin', 'external_origin'],
		['//evil.example/admin', 'protocol_relative'],
		['//evil.example', 'protocol_relative'],
		['/\\evil.example', 'backslash'],
		['\\\\evil.example', 'backslash'],
		['javascript:alert(1)', 'scheme_not_allowed'],
		['JaVaScRiPt:alert(document.cookie)', 'scheme_not_allowed'],
		['data:text/html,<script>alert(1)</script>', 'scheme_not_allowed'],
		['vbscript:msgbox(1)', 'scheme_not_allowed'],
		['admin/keys', 'missing_leading_slash'],
		['../admin', 'missing_leading_slash'],
		['evil.example', 'missing_leading_slash'],
		['?returnTo=/admin', 'missing_leading_slash'],
	])('refuses %j as %s', (candidate, reason) => {
		expect(refused(candidate, TRUSTED)).toBe(reason);
	});

	it('refuses an encoded authority at any decoding depth', () => {
		// One layer — the classic `%2F%2Fevil.example` bypass of a
		// validator that only checks `value.startsWith('/')`.
		expect(refused('%2F%2Fevil.example', TRUSTED)).toBe('protocol_relative');
		expect(refused('%2f%2fevil.example', TRUSTED)).toBe('protocol_relative');
		// Two layers — bypasses a validator that decodes once.
		expect(refused('%252F%252Fevil.example', TRUSTED)).toBe('protocol_relative');
		// Three layers.
		expect(refused('%25252F%25252Fevil.example', TRUSTED)).toBe('protocol_relative');
		// Four layers is past the decode budget: a value engineered to
		// be read differently by each consumer in the chain.
		expect(refused('%2525252F%2525252Fevil.example', TRUSTED)).toBe('decode_failed');
	});

	it('refuses an encoded scheme', () => {
		expect(refused('javascript%3Aalert(1)', TRUSTED)).toBe('scheme_not_allowed');
		expect(refused('%6a%61%76%61%73%63%72%69%70%74%3Aalert(1)', TRUSTED)).toBe(
			'scheme_not_allowed',
		);
	});

	it('refuses characters a browser drops before resolving the URL', () => {
		// Header-splitting / parser-differential shapes.
		expect(refused('/admin\r\nSet-Cookie: a=b', TRUSTED)).toBe('control_characters');
		expect(refused('/admin\n/evil.example', TRUSTED)).toBe('control_characters');
		expect(refused('/admin\t/evil.example', TRUSTED)).toBe('control_characters');
		// Zero-width space: invisible in every UI, load-bearing in a
		// URL parser.
		expect(refused('/admin\u200B/evil.example', TRUSTED)).toBe('control_characters');
		// A *trailing* BOM is whitespace, so `trim()` removes it and the
		// target is accepted; an interior one is refused. Only the
		// positions that cannot be mistaken for formatting are trimmed.
		expect(accepted('/admin\uFEFF')).toBe('/admin');
		expect(refused('/admin\uFEFF/keys', TRUSTED)).toBe('control_characters');
		expect(refused('/admin\u00AD', TRUSTED)).toBe('control_characters');
		// The same characters, percent-encoded, are caught by the
		// decoded layer rather than the raw one.
		expect(refused('/admin%0d%0aX-Injected:%201', TRUSTED)).toBe('control_characters');
		// Internal whitespace survives a `Location` header verbatim.
		expect(refused('/admin keys', TRUSTED)).toBe('whitespace');
	});

	it('refuses malformed percent-encoding', () => {
		expect(refused('/admin?x=%zz', TRUSTED)).toBe('decode_failed');
		expect(refused('/admin?x=%', TRUSTED)).toBe('decode_failed');
	});

	it('refuses an absent or non-string target', () => {
		expect(refused(undefined, TRUSTED)).toBe('missing');
		expect(refused(null, TRUSTED)).toBe('missing');
		expect(refused('', TRUSTED)).toBe('missing');
		expect(refused('   ', TRUSTED)).toBe('empty_after_trim');
		expect(refused(42, TRUSTED)).toBe('not_a_string');
		expect(refused(['/admin'], TRUSTED)).toBe('not_a_string');
		expect(refused({ path: '/admin' }, TRUSTED)).toBe('not_a_string');
	});

	it('refuses an over-long target, including after decoding', () => {
		expect(refused(`/${'a'.repeat(MAX_REDIRECT_TARGET_LENGTH)}`, TRUSTED)).toBe('too_long');
		// `%25` decodes to `%`, so the decoded value is longer than the raw one.
		expect(refused(`/${'%25'.repeat(MAX_REDIRECT_TARGET_LENGTH)}`, TRUSTED)).toBe('too_long');
	});
});

describe('classifyRedirectTarget — policy', () => {
	it('enforces allowedPrefixes', () => {
		const policy = { ...TRUSTED, allowedPrefixes: ['/admin'] };
		expect(accepted('/admin/keys', policy)).toBe('/admin/keys');
		expect(refused('/', policy)).toBe('path_not_allowed');
		expect(refused('/about', policy)).toBe('path_not_allowed');
		// The prefix is compared on the decoded value, so encoding does
		// not buy a way out of the allow-list.
		expect(refused('%2Fabout', policy)).toBe('path_not_allowed');
	});

	it('rejects every absolute URL when no origin is trusted', () => {
		// The fail-closed default: an unset `BETTER_AUTH_URL` must not
		// widen the allow-list, it must narrow it.
		expect(refused('https://rebuildup.dev/admin', {})).toBe('external_origin');
		expect(refused('https://rebuildup.dev/admin', { trustedOrigins: [] })).toBe('external_origin');
	});
});

describe('resolveInternalRedirect', () => {
	it('returns the internal path for a safe target', () => {
		expect(resolveInternalRedirect('/admin/keys', { ...TRUSTED, fallback: '/admin' })).toBe(
			'/admin/keys',
		);
	});

	it('falls back — never rewrites — for every refused target', () => {
		for (const hostile of [
			undefined,
			'',
			'//evil.example',
			'https://evil.example',
			'javascript:alert(1)',
			'/%2F%2Fevil.example',
			'/\\evil.example',
		]) {
			expect(resolveInternalRedirect(hostile, { ...TRUSTED, fallback: '/admin' })).toBe('/admin');
		}
	});
});

describe('candidate collection', () => {
	const params = ['callbackURL', 'returnTo'] as const;

	it('collects every occurrence in the query string', () => {
		const url = new URL(
			'https://rebuildup.dev/api/v1/auth/x?callbackURL=/a&callbackURL=//evil&other=1',
		);
		expect(collectRedirectCandidatesFromUrl(url, params)).toEqual([
			{ param: 'callbackURL', value: '/a', source: 'query' },
			{ param: 'callbackURL', value: '//evil', source: 'query' },
		]);
	});

	it('collects urlencoded bodies', () => {
		const candidates = collectRedirectCandidatesFromBody(
			'email=a%40b.test&callbackURL=%2Fadmin&password=x',
			'application/x-www-form-urlencoded',
			params,
		);
		expect(candidates).toEqual([{ param: 'callbackURL', value: '/admin', source: 'body' }]);
	});

	it('collects JSON bodies, top-level fields only', () => {
		const candidates = collectRedirectCandidatesFromBody(
			JSON.stringify({ email: 'a@b.test', callbackURL: '//evil', nested: { callbackURL: '/ok' } }),
			'application/json',
			params,
		);
		expect(candidates).toEqual([{ param: 'callbackURL', value: '//evil', source: 'body' }]);
	});

	it('ignores bodies it cannot read rather than guessing', () => {
		expect(collectRedirectCandidatesFromBody('not json', 'application/json', params)).toEqual([]);
		expect(collectRedirectCandidatesFromBody('[1,2]', 'application/json', params)).toEqual([]);
		expect(collectRedirectCandidatesFromBody('<x/>', 'application/xml', params)).toEqual([]);
		expect(collectRedirectCandidatesFromBody('', 'application/json', params)).toEqual([]);
	});

	it('reports the first refused candidate', () => {
		const candidates = [
			...collectRedirectCandidatesFromUrl(new URL('https://rebuildup.dev/?returnTo=/ok'), params),
			{ param: 'callbackURL', value: 'https://evil.example', source: 'body' as const },
		];
		expect(firstRejectedRedirect(candidates, TRUSTED)).toEqual({
			param: 'callbackURL',
			value: 'https://evil.example',
			source: 'body',
			reason: 'external_origin',
		});
		expect(firstRejectedRedirect([], TRUSTED)).toBeNull();
	});
});
