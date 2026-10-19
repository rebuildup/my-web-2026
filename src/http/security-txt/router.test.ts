import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SecurityTxtDocument } from './document';
import { SECURITY_TXT_PATH } from './document';
import { createSecurityTxtRouter } from './router';

/**
 * The HTTP contract of `GET /.well-known/security.txt` (Issue #468).
 *
 * Three levels, because each answers a question the other two cannot:
 *
 *   1. the DI seam (`createSecurityTxtRouter`) with an injected
 *      policy — proves status, media type, cache policy, the rendered
 *      bytes and the expiry gate;
 *   2. the router as MOUNTED (`externalBoundary`) — proves the surface
 *      is wired into the boundary at all;
 *   3. the real Worker (`SELF.fetch`) — proves `src/server.ts` routes
 *      the `/.well-known` namespace to the boundary instead of letting
 *      the SSR handler answer it with a 200 page.
 *
 * The injected policy is a FIXTURE built from RFC 2606 reserved names.
 * It is not, and must never become, a published reporting channel: the
 * repository has no operator-approved address to publish, which is why
 * level 3 asserts a `404`.
 */

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const ORIGIN = 'https://example.com';

const APPROVED: SecurityTxtDocument = {
	contacts: ['mailto:security@example.invalid'],
	expires: FUTURE,
	preferredLanguages: ['ja', 'en'],
};

const router = () => createSecurityTxtRouter(() => APPROVED);

describe('GET /.well-known/security.txt — approved policy', () => {
	it('answers 200 with the RFC 9116 §3 media type', async () => {
		const res = await router().request(SECURITY_TXT_PATH, undefined, {} as Env);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, must-revalidate');
	});

	it('serves a document a browser can read, with Contact first and Expires last', async () => {
		const res = await router().request(SECURITY_TXT_PATH, undefined, {} as Env);
		const body = await res.text();
		// No `Canonical:` line here because the injected fixture is a
		// bare `SecurityTxtDocument`. The field is DERIVED by
		// `resolvePublication` (`policy.test.ts` asserts it) rather than
		// guessed by the router, so a caller that injects a document
		// without one gets exactly the bytes it asked for.
		expect(body).toBe(
			`Contact: mailto:security@example.invalid\nPreferred-Languages: ja\nPreferred-Languages: en\nExpires: ${FUTURE}\n`,
		);
	});
});

describe('GET /.well-known/security.txt — nothing publishable', () => {
	it('answers 404 when no policy is approved', async () => {
		const res = await createSecurityTxtRouter(() => null).request(
			SECURITY_TXT_PATH,
			undefined,
			{} as Env,
		);
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, must-revalidate');
	});

	it('leaks nothing in the refusal body', async () => {
		const res = await createSecurityTxtRouter(() => null).request(
			SECURITY_TXT_PATH,
			undefined,
			{} as Env,
		);
		const body = await res.text();
		expect(body).not.toMatch(/@|Expires:|Contact:/);
	});

	it('refuses an expired document even when the injected source returns one', async () => {
		// Defence in depth: the seam is injectable, so the router does
		// not trust it to have applied the deadline (RFC 9116 §2.5.1).
		const stale = createSecurityTxtRouter(() => ({ ...APPROVED, expires: PAST }));
		const res = await stale.request(SECURITY_TXT_PATH, undefined, {} as Env);
		expect(res.status).toBe(404);
		expect(await res.text()).not.toContain('Contact:');
	});

	it('honours an injected clock instead of reading the wall clock', async () => {
		const atDeadline = createSecurityTxtRouter(
			() => APPROVED,
			() => Date.parse(FUTURE),
		);
		expect((await atDeadline.request(SECURITY_TXT_PATH, undefined, {} as Env)).status).toBe(404);
		const beforeDeadline = createSecurityTxtRouter(
			() => APPROVED,
			() => Date.parse(FUTURE) - 1,
		);
		expect((await beforeDeadline.request(SECURITY_TXT_PATH, undefined, {} as Env)).status).toBe(
			200,
		);
	});
});

describe('the surface as deployed', () => {
	it('is mounted on the external boundary', async () => {
		const { externalBoundary } = await import('../hono');
		const res = await externalBoundary.request(SECURITY_TXT_PATH, undefined, {} as Env);
		// 404, because no owner-approved reporting channel exists yet.
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
	});

	it('reaches the Worker, which routes the namespace instead of rendering a page', async () => {
		const res = await SELF.fetch(`${ORIGIN}${SECURITY_TXT_PATH}`);
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
	});

	it('answers unknown well-known paths from the boundary, not the SSR shell', async () => {
		const res = await SELF.fetch(`${ORIGIN}/.well-known/not-a-real-document`);
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).not.toContain('text/html');
	});
});
