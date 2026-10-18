import { describe, expect, it } from 'vitest';
import {
	DENIED_PERMISSIONS,
	HOST_REFERRER_POLICY,
	TOOL_APP_REFERRER_POLICY,
	applySecurityHeaders,
	grantedAllowlist,
	permissionsPolicyValue,
	resolveSecurityHeaders,
} from './security-headers';

/**
 * Security header policy unit contract (Issue #449).
 *
 * The integration suite in `test/integration/security-headers.test.ts`
 * proves the headers actually reach real responses through workerd.
 * These tests pin the decision logic itself, because that logic is
 * where a "blanket deny that breaks the Tools" regression would hide:
 * a granted feature that silently stops being granted fails here
 * first, with a readable diff, instead of surfacing as a denied
 * microphone in a browser.
 */
describe('permissionsPolicyValue', () => {
	it('denies every listed feature by default', () => {
		const value = permissionsPolicyValue('https://rebuildup.dev');
		for (const feature of DENIED_PERMISSIONS) {
			expect(value).toContain(`${feature}=()`);
		}
	});

	it('keeps microphone denied unless the caller grants it', () => {
		expect(permissionsPolicyValue('https://rebuildup.dev')).toContain('microphone=()');
		expect(permissionsPolicyValue('https://rebuildup.dev', ['camera'])).toContain('microphone=()');
	});

	it('grants a declared feature to self and the serving origin', () => {
		const value = permissionsPolicyValue('http://127.0.0.1:8787', ['microphone']);
		expect(value).toContain('microphone=(self "http://127.0.0.1:8787")');
		// The rest of the baseline is untouched — a grant is per feature,
		// not a wholesale relaxation.
		expect(value).toContain('camera=()');
		expect(value).toContain('usb=()');
	});

	it('is case-insensitive about the granted feature name', () => {
		expect(permissionsPolicyValue('https://rebuildup.dev', ['Microphone'])).toContain(
			'microphone=(self "https://rebuildup.dev")',
		);
	});

	it('ignores a grant for a feature that is not denied anyway', () => {
		// `clipboard-write` is not in the deny list: it keeps the browser
		// default allowlist, which is what `/admin` uses today. A grant
		// for it must not invent a new Permissions-Policy entry.
		const value = permissionsPolicyValue('https://rebuildup.dev', ['clipboard-write']);
		expect(value).not.toContain('clipboard-write');
	});

	it('emits a stable, comma-separated value in deny-list order', () => {
		expect(permissionsPolicyValue('https://rebuildup.dev')).toBe(
			'bluetooth=(), camera=(), display-capture=(), geolocation=(), hid=(), microphone=(), payment=(), serial=(), usb=(), xr-spatial-tracking=()',
		);
	});
});

describe('grantedAllowlist', () => {
	it('scopes the grant to the origin that served the response', () => {
		expect(grantedAllowlist('https://rebuildup.dev')).toBe('(self "https://rebuildup.dev")');
		// Local workerd / preview must not inherit the production origin.
		expect(grantedAllowlist('http://127.0.0.1:8787')).toBe('(self "http://127.0.0.1:8787")');
	});
});

describe('resolveSecurityHeaders', () => {
	it('returns the three headers for a plain host response', () => {
		expect(resolveSecurityHeaders('https://rebuildup.dev')).toEqual({
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': HOST_REFERRER_POLICY,
			'Permissions-Policy': expect.stringContaining('microphone=()'),
		});
	});

	it('honours a Tool artifact referrer policy and its grant together', () => {
		const headers = resolveSecurityHeaders('https://rebuildup.dev', {
			referrerPolicy: TOOL_APP_REFERRER_POLICY,
			grantedPermissions: ['microphone'],
		});
		expect(headers['Referrer-Policy']).toBe('no-referrer');
		expect(headers['Permissions-Policy']).toContain('microphone=(self "https://rebuildup.dev")');
	});
});

describe('applySecurityHeaders', () => {
	it('sets all three headers on a fresh response', () => {
		const response = applySecurityHeaders(
			new Request('https://rebuildup.dev/contact'),
			new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
		);
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Referrer-Policy')).toBe(HOST_REFERRER_POLICY);
		expect(response.headers.get('Permissions-Policy')).toContain('microphone=()');
	});

	it('applies to error and redirect responses too', () => {
		// The dispatch choke point is in `src/server.ts`, so a 404 JSON
		// from the boundary and an admin auth redirect are covered by the
		// same code path as a 200 document.
		const redirect = applySecurityHeaders(
			new Request('https://rebuildup.dev/admin'),
			Response.redirect('https://rebuildup.dev/admin/login', 307),
		);
		expect(redirect.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(redirect.headers.get('Permissions-Policy')).toContain('microphone=()');
	});

	it('does not overwrite a value a handler already set deliberately', () => {
		const response = applySecurityHeaders(
			new Request('https://rebuildup.dev/api/v1/health'),
			new Response('{}', {
				headers: { 'Referrer-Policy': 'no-referrer', 'content-type': 'application/json' },
			}),
		);
		expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
		// The headers the handler did not set still land.
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it('survives a sealed header list without throwing', () => {
		const sealed = Response.redirect('https://rebuildup.dev/admin/login', 307);
		expect(() =>
			applySecurityHeaders(new Request('https://rebuildup.dev/admin'), sealed),
		).not.toThrow();
	});

	it('survives a header value the runtime refuses and keeps the values already set', () => {
		// `set()` throws for a malformed value as well as for a sealed
		// list, and the retry on a rebuilt response can throw again.
		// Either way the request must survive: an uncaught throw here
		// would turn every response whose policy value is unusable into
		// a 500.
		let response: Response | undefined;
		expect(() => {
			response = applySecurityHeaders(new Request('https://rebuildup.dev/'), new Response('ok'), {
				referrerPolicy: 'strict-origin\nwhen-cross-origin',
			});
		}).not.toThrow();
		expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response?.headers.get('Referrer-Policy')).toBeNull();
	});
});
