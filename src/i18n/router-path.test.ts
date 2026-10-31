import { describe, expect, it } from 'vitest';
import { ADMIN_SURFACE_NAMESPACE, isPathInNamespace, normaliseRouterPathname } from './router-path';

/**
 * The request-path reading contract (Issue #700).
 *
 * The table below is the contract, and it is deliberately a table
 * rather than a handful of examples: the rule is a PARITY rule. Every
 * surface that classifies a request path — the Admin cache policy,
 * the anomaly monitor's surface classifier, the analytics mount gate —
 * has to classify it exactly the way TanStack Router resolves it, and
 * every row records one resolution question the router answers
 * differently from a naive string comparison.
 *
 * The router's matching inputs:
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
describe('normaliseRouterPathname', () => {
	it.each<[string, string]>([
		// The reading is decode-then-case-fold, in the router's order.
		['/admin/keys', '/admin/keys'],
		['/ADMIN/KEYS', '/admin/keys'],
		['/Admin/Login', '/admin/login'],
		['/%61dmin/keys', '/admin/keys'],
		['/%61DMIN/KEYS', '/admin/keys'],
		['/%61dmin', '/admin'],
		// `decodeURI` — not `decodeURIComponent` — leaves the reserved
		// separators encoded, which is what keeps `/admin%2Fkeys` out
		// of the Admin namespace.
		['/admin%2Fkeys', '/admin%2fkeys'],
		['/%2Fadmin', '/%2fadmin'],
		['/%5Cadmin', '/\\admin'],
		// `decodeURI` turns `%25` into a literal `%` in ONE pass, so
		// the reader sees `/%61dmin/keys` — not Admin. The assertion
		// pins that single-pass result; h3 and router-core additionally
		// preserve `%25` themselves, so no layer decodes it twice.
		['/%2561dmin/keys', '/%61dmin/keys'],
		// A malformed escape makes `decodeURI` throw. The reader must
		// not throw with it: the request is answered with a 400 by the
		// request layer, and the classifier runs on the same pathname.
		['/%61dmin/%ZZ', '/%61dmin/%zz'],
		['/%E0%A4%A/admin', '/%e0%a4%a/admin'],
		['/admin/%ZZ', '/admin/%zz'],
		// Nothing to decode, nothing to fold.
		['/', '/'],
		['/about', '/about'],
		['', ''],
	])('reads %s as %s', (pathname, expected) => {
		expect(normaliseRouterPathname(pathname)).toBe(expected);
	});
});

describe('isPathInNamespace', () => {
	it.each<[string, string, boolean]>([
		// The namespace is matched EXACTLY or as a `/`-delimited
		// descendant.
		['/admin', ADMIN_SURFACE_NAMESPACE, true],
		['/admin/', ADMIN_SURFACE_NAMESPACE, true],
		['/admin/keys', ADMIN_SURFACE_NAMESPACE, true],
		['/admin/invitations/accept', ADMIN_SURFACE_NAMESPACE, true],
		// Case-insensitive static segments (router default).
		['/ADMIN', ADMIN_SURFACE_NAMESPACE, true],
		['/Admin/', ADMIN_SURFACE_NAMESPACE, true],
		['/adMin/KEYS', ADMIN_SURFACE_NAMESPACE, true],
		['/ADMIN/INVITATIONS/ACCEPT', ADMIN_SURFACE_NAMESPACE, true],
		// Percent-decoded before matching (`/%61` is `a`).
		['/%61dmin/keys', ADMIN_SURFACE_NAMESPACE, true],
		['/%61dmin', ADMIN_SURFACE_NAMESPACE, true],
		['/%61DMIN/KEYS', ADMIN_SURFACE_NAMESPACE, true],
		// Exact-prefix-or-`/`: a bare prefix would swallow a future
		// public route.
		['/administration', ADMIN_SURFACE_NAMESPACE, false],
		['/administrator-guide', ADMIN_SURFACE_NAMESPACE, false],
		['/adminish', ADMIN_SURFACE_NAMESPACE, false],
		['/ADMINISH', ADMIN_SURFACE_NAMESPACE, false],
		// The router does not treat a doubled slash as the admin route;
		// it answers this path with a 308 to `/admin`.
		['//admin', ADMIN_SURFACE_NAMESPACE, false],
		['//admin/keys', ADMIN_SURFACE_NAMESPACE, false],
		// Reserved separators are NOT decoded by the router's matcher,
		// so these are 404s rather than the Admin surface.
		['/admin%2Fkeys', ADMIN_SURFACE_NAMESPACE, false],
		['/%2Fadmin', ADMIN_SURFACE_NAMESPACE, false],
		['/%5Cadmin', ADMIN_SURFACE_NAMESPACE, false],
		['/%2561dmin/keys', ADMIN_SURFACE_NAMESPACE, false],
		// Malformed escapes do not reach route matching: h3's
		// `decodePathname` (in the H3Event constructor) throws
		// `URIError`, which start-server-core turns into a 400. The
		// reader must not throw on the way to that answer. A path whose
		// ADMIN PREFIX is escaped cannot be an admin path under the
		// raw fallback, and one whose prefix is literal still is.
		['/%61dmin/%ZZ', ADMIN_SURFACE_NAMESPACE, false],
		['/admin/%ZZ', ADMIN_SURFACE_NAMESPACE, true],
		// Everything outside the admin namespace.
		['/', ADMIN_SURFACE_NAMESPACE, false],
		['/about', ADMIN_SURFACE_NAMESPACE, false],
		['/portfolio', ADMIN_SURFACE_NAMESPACE, false],
		['', ADMIN_SURFACE_NAMESPACE, false],
	])('classifies %s against %s as %s', (pathname, namespace, expected) => {
		expect(isPathInNamespace(pathname, namespace)).toBe(expected);
	});

	it('is not hard-wired to one namespace', () => {
		// The rule is generic on purpose: the platform's request-path
		// namespaces are values, and the reading rule is one rule. A
		// second namespace must not need a second implementation.
		expect(isPathInNamespace('/tools/multi-slicer', '/tools')).toBe(true);
		expect(isPathInNamespace('/toolshed', '/tools')).toBe(false);
		expect(isPathInNamespace('/tools', '/tools')).toBe(true);
	});
});
