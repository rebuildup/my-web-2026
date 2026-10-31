import { describe, expect, it } from 'vitest';
import { isAdminPath } from './admin-path';

/**
 * Admin path classification (Issue #654, Issue #700).
 *
 * The table below is the contract. It is deliberately a table rather
 * than a handful of examples because the rule is a *parity* rule: the
 * cache policy and the anomaly monitor must classify a path exactly the
 * way TanStack Router resolves it, and every row records one resolution
 * question the router answers differently from a naive prefix match.
 *
 * The rule itself — how a request path is READ — is owned by
 * `src/i18n/router-path.ts` (Issue #700) and is shared with the
 * analytics mount gate, so the two surfaces cannot classify one request
 * as two things. This file pins the boundary's own use of it.
 *
 * The router's matching inputs, verified at the Worker entry in
 * `test/integration/html-cache-policy.test.ts`:
 *
 *   - static segments are compared case-insensitively
 *     (`caseSensitive: false` is the default and `src/router.tsx` does
 *     not override it), so `/ADMIN/KEYS` renders the admin screen;
 *   - the pathname is percent-decoded before matching, so
 *     `/%61dmin/keys` also reaches `/admin/keys`;
 *   - reserved separators stay encoded, so `/admin%2Fkeys` and
 *     `/%2Fadmin` are 404s, not the Admin surface.
 *
 * The rows marked `false` are not merely theoretical: the router
 * answers `/administration` with its 404 surface, and `//admin` with a
 * 308 canonicalisation to `/admin` — neither request is an Admin
 * document at that URL.
 */
describe('isAdminPath', () => {
	it.each<[string, boolean]>([
		// The routes the Admin surface actually owns.
		['/admin', true],
		['/admin/', true],
		['/admin/login', true],
		['/admin/keys', true],
		['/admin/invitations/accept', true],
		// Case-insensitive static segments (router default).
		['/ADMIN', true],
		['/Admin/', true],
		['/adMin/KEYS', true],
		['/ADMIN/KEYS', true],
		['/ADMIN/INVITATIONS/ACCEPT', true],
		// Percent-decoded before matching (`/%61` is `a`).
		['/%61dmin/keys', true],
		['/%61dmin', true],
		['/%61DMIN/KEYS', true],
		// Exact-prefix-or-`/`: a bare prefix would swallow a future
		// public route.
		['/administration', false],
		['/administrator-guide', false],
		['/adminish', false],
		['/ADMINISH', false],
		// The router does not treat a doubled slash as the admin route;
		// it answers this path with a 308 to `/admin`.
		['//admin', false],
		['//admin/keys', false],
		// Reserved separators are NOT decoded by the router's matcher,
		// so these are 404s rather than the Admin surface.
		['/admin%2Fkeys', false],
		['/%2Fadmin', false],
		['/%5Cadmin', false],
		// `decodeURI` turns `%25` into a literal `%` in ONE pass, so the
		// classifier sees `/%61dmin/keys` — not Admin. The assertion pins
		// that single-pass result; h3 and router-core additionally
		// preserve `%25` themselves, so no layer decodes it twice.
		['/%2561dmin/keys', false],
		// Malformed escapes do not reach route matching: h3's
		// `decodePathname` (in the H3Event constructor) throws
		// `URIError`, which start-server-core turns into a 400. The
		// classifier must not throw on the way to that answer.
		['/%61dmin/%ZZ', false],
		['/%E0%A4%A/admin', false],
		// The raw fallback keeps a LITERAL admin prefix: only the
		// escaped one is lost, so this path is still the admin surface
		// (the request itself is answered with a 400).
		['/admin/%ZZ', true],
		// Everything outside the admin namespace.
		['/', false],
		['/about', false],
		['/portfolio', false],
		['', false],
	])('classifies %s as admin: %s', (pathname, expected) => {
		expect(isAdminPath(pathname)).toBe(expected);
	});
});
