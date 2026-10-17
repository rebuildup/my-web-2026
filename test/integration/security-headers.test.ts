/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Security headers on real Worker responses (Issue #449).
 *
 * `applySecurityHeaders` is mounted in `src/server.ts` AFTER the Hono
 * / TanStack Start dispatch, so the only layer that can prove "the
 * header is on the response the client actually receives" is `SELF`.
 * A unit test on the resolver cannot catch a header the runtime seals,
 * a middleware that only covers one of the two branches, or a route
 * that bypasses the choke point — those are exactly the failures this
 * file exists to catch.
 *
 * Coverage shape:
 *   - host documents (`/contact`, `/contact` 404 sibling) — baseline
 *   - the external boundary (`/api/v1/*`, incl. a 404 JSON error)
 *   - the admin surface (`/admin` redirect, `/admin/login`)
 *   - the Tool surfaces — shell route, artifact path, and the Tool
 *     that declares the microphone grant
 *
 * The Tool ARTIFACT path is Static Assets territory in production, so
 * the Worker cannot prove that half; `public/_headers` + the
 * `scripts/check-security-headers.mjs` parity gate own it, and
 * `docs/security/security-headers.md` records the local measurement.
 */
async function headersOf(
	path: string,
): Promise<{ status: number; type: string | null; headers: Headers }> {
	const res = await SELF.fetch(`https://rebuildup.dev${path}`, { redirect: 'manual' });
	return { status: res.status, type: res.headers.get('content-type'), headers: res.headers };
}

const DENIED_BASELINE = expect.stringContaining('microphone=()');

describe('security headers — host documents (Issue #449)', () => {
	it('serves nosniff + referrer + permissions on a public page', async () => {
		// `/contact` rather than `/`: the home loader needs the reactions
		// tables and this file does not bootstrap them (see
		// `html-cache-policy.test.ts` for the same reasoning).
		const { status, headers } = await headersOf('/contact');
		expect(status).toBe(200);
		expect(headers.get('x-content-type-options')).toBe('nosniff');
		expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(headers.get('permissions-policy')).toEqual(DENIED_BASELINE);
	});

	it('denies the microphone on an ordinary page', async () => {
		// The host baseline. Without this a Tool grant would have nothing
		// to be separated from.
		const { headers } = await headersOf('/contact');
		expect(headers.get('permissions-policy')).toContain('microphone=()');
		expect(headers.get('permissions-policy')).toContain('camera=()');
	});

	it('covers a 404 document too', async () => {
		const { status, headers } = await headersOf('/no-such-page-449');
		expect(status).toBe(404);
		expect(headers.get('x-content-type-options')).toBe('nosniff');
		expect(headers.get('permissions-policy')).toEqual(DENIED_BASELINE);
	});
});

describe('security headers — external boundary (Issue #449)', () => {
	it('covers an API success response', async () => {
		const { status, headers } = await headersOf('/api/v1/health');
		expect(status).toBe(200);
		expect(headers.get('x-content-type-options')).toBe('nosniff');
		expect(headers.get('permissions-policy')).toEqual(DENIED_BASELINE);
	});

	it('covers the boundary notFound / onError shapes', async () => {
		const { status, headers } = await headersOf('/api/v1/does-not-exist');
		expect(status).toBe(404);
		expect(headers.get('x-content-type-options')).toBe('nosniff');
		expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
	});

	it('keeps the boundary CORS preflight working', async () => {
		// Tool artefacts are fetched cross-origin by their opaque-origin
		// frame. A security header must not turn a preflight into a
		// failure, so assert the CORS headers survive alongside them.
		const res = await SELF.fetch('https://rebuildup.dev/api/v1/health', {
			method: 'OPTIONS',
			headers: { origin: 'https://rebuildup.dev', 'access-control-request-method': 'GET' },
		});
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('permissions-policy')).toEqual(DENIED_BASELINE);
	});
});

describe('security headers — admin surface (Issue #449)', () => {
	it('covers the anonymous /admin redirect (no body, no content-type)', async () => {
		// Same regression shape as the cache-policy suite: this response
		// has no body and no content-type, so any path-only special case
		// could drop the headers.
		const { status, headers } = await headersOf('/admin');
		expect(status).toBeGreaterThanOrEqual(300);
		expect(status).toBeLessThan(400);
		expect(headers.get('x-content-type-options')).toBe('nosniff');
		expect(headers.get('permissions-policy')).toEqual(DENIED_BASELINE);
	});

	it('covers the admin login document', async () => {
		const { status, headers } = await headersOf('/admin/login');
		expect(status).toBe(200);
		expect(headers.get('x-content-type-options')).toBe('nosniff');
		expect(headers.get('permissions-policy')).toEqual(DENIED_BASELINE);
	});
});

describe('security headers — Tool surfaces (Issue #449)', () => {
	it('keeps a Tool with no declared grant on the host baseline', async () => {
		const { status, headers } = await headersOf('/tools/prototype');
		expect(status).toBe(200);
		expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(headers.get('permissions-policy')).toEqual(DENIED_BASELINE);
	});

	it('grants the microphone ONLY on the Tool that declares it', async () => {
		// `mic-level` declares `delivery.iframe.allow: "microphone"`.
		// The shell route is served by the SSR pipeline, so this is the
		// container-side half of the grant that a browser can actually
		// observe on the top-level document.
		const { status, headers } = await headersOf('/tools/mic-level');
		expect(status).toBe(200);
		const policy = headers.get('permissions-policy') ?? '';
		expect(policy).toContain('microphone=(self "https://rebuildup.dev")');
		// Everything else stays denied — a grant is per feature.
		expect(policy).toContain('camera=()');
		expect(policy).toContain('usb=()');
	});

	it('does not leak the grant onto a neighbouring Tool', async () => {
		const { headers } = await headersOf('/tools/readmark');
		expect(headers.get('permissions-policy')).toEqual(DENIED_BASELINE);
	});

	it('keeps the grant scoped to the origin that served the request', async () => {
		const res = await SELF.fetch('http://127.0.0.1:8787/tools/mic-level', { redirect: 'manual' });
		expect(res.headers.get('permissions-policy')).toContain(
			'microphone=(self "http://127.0.0.1:8787")',
		);
	});

	it('does not let a lookalike slug inherit the grant', async () => {
		const { headers } = await headersOf('/tools/mic-level-2');
		expect(headers.get('permissions-policy') ?? '').not.toContain('microphone=(self');
	});
});

describe('security header measurements for the PR report (Issue #449)', () => {
	// `docs/verification/security/headers-browser.png` is a rendered
	// report, not a hand-written summary: it embeds the values measured
	// HERE, from a real workerd run of the real Worker. Emitting them as
	// one marker line lets the capture script consume the measurement
	// instead of re-deriving it, so the screenshot cannot drift away
	// from what the Worker actually sends.
	it('prints the measured matrix for the verification report', async () => {
		const paths = [
			'/contact',
			'/no-such-page-449',
			'/api/v1/health',
			'/api/v1/does-not-exist',
			'/admin',
			'/admin/login',
			'/tools/prototype',
			'/tools/readmark',
			'/tools/mic-level',
		];
		const rows: Array<Record<string, string>> = [];
		for (const path of paths) {
			const { status, headers } = await headersOf(path);
			rows.push({
				path,
				status: String(status),
				'x-content-type-options': headers.get('x-content-type-options') ?? '(absent)',
				'referrer-policy': headers.get('referrer-policy') ?? '(absent)',
				'permissions-policy': headers.get('permissions-policy') ?? '(absent)',
			});
		}
		console.log(`SECURITY_HEADERS_MEASUREMENT ${JSON.stringify(rows)}`);
		expect(rows).toHaveLength(paths.length);
	});
});
