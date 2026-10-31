/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { routeIdsFromRouteTree } from '../../scripts/seo-head-contract.mjs';
import { isAnalyticsMountPath } from '../../src/editorial/analytics/consent';
import { isAdminPath } from '../../src/http/admin-path';
import { ADMIN_SURFACE_NAMESPACE } from '../../src/i18n/router-path';
import { routeTree } from '../../src/routeTree.gen';
import { applyPortfolioSchema } from './fixtures/portfolio-d1';
import { applyReactionsSchema } from './fixtures/reactions-d1';

/**
 * The Admin path classification, against the router that decides it
 * (Issue #700).
 *
 * Why this suite drives the Worker
 * --------------------------------
 * The question is not "what does the classifier say" — the unit tables
 * in `src/i18n/router-path.test.ts` and
 * `src/editorial/analytics/consent.test.ts` answer that. The question
 * is "does the classifier say the same thing the ROUTER does", and the
 * only place the router's own answer exists is the request it serves.
 * `SELF.fetch` runs the real TanStack Start pipeline, so every row
 * below is compared with the resolution the visitor actually gets.
 *
 * The privacy half
 * ----------------
 * `isAnalyticsMountPath` decides whether the GA4 tag may mount on a
 * document. The Admin surface is the operator's own UI, and the
 * initial `gtag('config', …)` hit reads the document URL itself — so
 * an admin URL carrying an invitation token would be sent even though
 * every later event is query-stripped. A path the router resolves to
 * the Admin surface must therefore never be a path the tag mounts on.
 *
 * The boundary half
 * -----------------
 * The same path also decides the Admin HTML cache policy
 * (`src/server.ts`) and the anomaly monitor's watched surface
 * (`src/http/middleware/anomaly-monitor.ts`). The last test in this
 * file pins that the two classifiers cannot drift apart again.
 */
interface RouterAnswer {
	/** The status the router answered with. */
	status: number;
	/** The path the answer redirects to, if it redirects. */
	target: string | null;
	/** Does the document carry the Admin sign-in form? */
	adminDocument: boolean;
	/** Does the document carry any analytics markup? */
	analyticsMarkup: boolean;
	/** Does the document carry the consent control? */
	consentControl: boolean;
}

/**
 * Asks the router what a request path resolves to.
 *
 * `redirect: 'manual'` keeps the redirect visible: an admin path
 * answers 307 to the sign-in form, and the classification has to be
 * about the path the visitor REQUESTED, not about the path the
 * redirect lands on.
 */
async function askTheRouter(path: string): Promise<RouterAnswer> {
	const res = await SELF.fetch(`https://example.com${path}`, { redirect: 'manual' });
	const location = res.headers.get('location');
	const html = res.status === 200 ? await res.text() : '';
	return {
		status: res.status,
		target: location ? new URL(location, 'https://example.com').pathname : null,
		adminDocument: html.includes('action="/api/v1/auth/sign-in/email"'),
		analyticsMarkup: html.includes('googletagmanager') || html.includes('gtag('),
		consentControl: html.includes('data-testid="analytics-consent'),
	};
}

/**
 * Every path this suite classifies, with the router's own answer for
 * it. The three groups are the three kinds of answer the router gives:
 *
 *   - the Admin gate (307 → the sign-in form) and the sign-in form
 *     itself: the Admin surface;
 *   - a public document (200) or the router's 404 surface: not the
 *     Admin surface;
 *   - a canonicalisation or a request-layer error: no document is
 *     rendered at that URL at all.
 */
const ADMIN_SURFACE_PATHS: [string, number, string | null][] = [
	// The paths the router answers with the Admin gate: an anonymous
	// request is sent to the sign-in form.
	['/admin', 307, '/admin/login'],
	['/admin/keys', 307, '/admin/login'],
	// Case-insensitive static segments.
	['/ADMIN/KEYS', 307, '/admin/login'],
	// Percent-decoded before matching: `%61` is `a`.
	['/%61dmin/keys', 307, '/admin/login'],
	['/%61dmin', 307, '/admin/login'],
	['/%61DMIN/KEYS', 307, '/admin/login'],
	// The trailing-slash variant canonicalises into the namespace.
	['/admin/', 307, '/admin'],
	// The sign-in form IS the Admin surface.
	['/admin/login', 200, null],
];

const PUBLIC_PATHS: [string, number][] = [
	// A lookalike prefix is a 404, not the Admin surface.
	['/administration', 404],
	['/adminish', 404],
	// Public documents.
	['/', 200],
	['/about', 200],
	['/contact', 200],
	// A doubled slash is canonicalised by the request layer, so no
	// document is rendered at that URL.
	['//admin', 308],
];

const NO_DOCUMENT_PATHS: [string, number, boolean][] = [
	// A malformed escape never reaches route matching: the request
	// layer answers 400. The gate must not throw on the way to that
	// answer, and it falls back to the raw pathname — so an ESCAPED
	// admin prefix is not the Admin surface, while a literal one
	// still is.
	['/%61dmin/%ZZ', 400, true],
	['/%E0%A4%A/admin', 400, true],
	['/admin/%ZZ', 400, false],
	// Reserved separators stay encoded, so the router answers with its
	// 404 surface: these are not the Admin surface.
	['/admin%2Fkeys', 404, true],
	['/%2561dmin/keys', 404, true],
];

beforeAll(async () => {
	// The Home and About documents read D1. workerd cannot see
	// `migrations/*.sql`, so the schema is applied here — the same
	// shape `test/integration/analytics-consent.test.ts` uses.
	await applyReactionsSchema(env.DB);
	await applyPortfolioSchema(env.DB);
});

describe('the router and the analytics mount gate agree on the Admin surface (Issue #700)', () => {
	it.each(ADMIN_SURFACE_PATHS)(
		'the router resolves %s to the Admin surface, so measurement must not mount there',
		async (path, status, target) => {
			const answer = await askTheRouter(path);
			expect(answer.status).toBe(status);
			expect(answer.target).toBe(target);

			// The gate says no, and the HTTP boundary's classifier says
			// yes: one rule, read the same way by both.
			expect(isAnalyticsMountPath(path)).toBe(false);
			expect(isAdminPath(path)).toBe(true);

			// Nothing GA4-shaped is in the Admin document either.
			expect(answer.analyticsMarkup).toBe(false);
			expect(answer.consentControl).toBe(false);
		},
		30_000,
	);

	it.each(PUBLIC_PATHS)(
		'the router does not resolve %s to the Admin surface, so measurement must not be excluded there',
		async (path, status) => {
			const answer = await askTheRouter(path);
			expect(answer.status).toBe(status);

			expect(isAnalyticsMountPath(path)).toBe(true);
			expect(isAdminPath(path)).toBe(false);
		},
		30_000,
	);

	it.each(NO_DOCUMENT_PATHS)(
		'the router answers %s with %i and the gate answers %s',
		async (path, status, mountAllowed) => {
			const answer = await askTheRouter(path);
			expect(answer.status).toBe(status);
			expect(isAnalyticsMountPath(path)).toBe(mountAllowed);
		},
		30_000,
	);

	it('publishes the namespace the router serves', () => {
		// The route tree owns the ROUTES; the published namespace is
		// the space they live in. If the Admin surface moves, this
		// fails instead of silently changing what the cache policy, the
		// anomaly monitor and the analytics gate exclude.
		const routePaths = routeIdsFromRouteTree(routeTree as unknown as { children?: unknown[] });
		expect(routePaths).toContain(ADMIN_SURFACE_NAMESPACE);
	});

	it('the analytics gate and the HTTP boundary cannot drift apart', () => {
		// Both read the same owner today, so this is trivially true —
		// which is exactly the point: the moment one of them grows a
		// private copy of the rule, this fails.
		const paths = [
			...ADMIN_SURFACE_PATHS.map(([path]) => path),
			...PUBLIC_PATHS.map(([path]) => path),
			...NO_DOCUMENT_PATHS.map(([path]) => path),
		];
		for (const path of paths) {
			expect(isAnalyticsMountPath(path)).toBe(!isAdminPath(path));
		}
	});
});
