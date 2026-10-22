import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	GoogleAnalytics,
	GoogleAnalyticsRouteTracker,
	__resetCapturedMeasurementIdForTests,
	captureMeasurementId,
	createPageViewRouteState,
	stripAnalyticsQuery,
	trackRoutePageView,
} from './GoogleAnalytics';
import { __resetDocumentAnalyticsConsentForTests, setDocumentAnalyticsConsent } from './consent';

/**
 * GoogleAnalytics component contract (Issue #171, Issue #286).
 *
 *   - When `measurementId` is the empty string or `undefined`,
 *     the component renders nothing (`null`).
 *   - When `measurementId` is a non-empty `G-XXXXXXX` string,
 *     the component renders the GA4 `<script async src=...>` tag
 *     and the inline `gtag('config', ...)` init script — exactly
 *     once (one `config` per document; the initial page_view).
 *   - The captured SSR measurement ID is write-once: a falsy
 *     client-side stub never overwrites the captured SSR value.
 *   - SPA route changes fire exactly one
 *     `gtag('event', 'page_view', ...)` each (Issue #286): the
 *     initial location is deduped against the `config` page_view,
 *     `/admin/*` is never tracked, no captured ID means no
 *     tracking, and a document that never executed the init
 *     snippet bootstraps the official queue + `config` instead of
 *     pushing a targetless event.
 *
 * The component has zero router / DOM dependencies, so this test
 * runs in the workerd pool with no shims. The same component is
 * also exercised in `pnpm run test:client` (see
 * `vitest.client.config.ts`) for the happy-dom render path when
 * real `<script>` tag execution is required — including the
 * effect-wiring integration test in `GoogleAnalytics.client.test.tsx`.
 */

interface AnalyticsGlobals {
	gtag?: unknown;
	dataLayer?: unknown;
}

function analyticsGlobals(): AnalyticsGlobals {
	return globalThis as unknown as AnalyticsGlobals;
}

/** Removes any gtag / dataLayer state a test leaked onto `globalThis`. */
function resetAnalyticsGlobals(): void {
	analyticsGlobals().gtag = undefined;
	analyticsGlobals().dataLayer = undefined;
}

describe('GoogleAnalytics — captureMeasurementId', () => {
	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
		// Issue #495: every measurement assertion below runs in a
		// document that has recorded an affirmative decision. The
		// consent gate itself is asserted in its own describe block.
		setDocumentAnalyticsConsent('granted');
	});

	it('captures the first non-empty value', () => {
		expect(captureMeasurementId(undefined)).toBeUndefined();
		expect(captureMeasurementId('G-ABCDEFG')).toBe('G-ABCDEFG');
	});

	it('returns the captured value on subsequent calls', () => {
		captureMeasurementId('G-ABCDEFG');
		expect(captureMeasurementId('G-ZZZZZZZ')).toBe('G-ABCDEFG');
	});

	it('does not capture the empty string', () => {
		expect(captureMeasurementId('')).toBeUndefined();
		expect(captureMeasurementId('G-LATER')).toBe('G-LATER');
	});

	it('does not overwrite an existing capture with undefined', () => {
		captureMeasurementId('G-ABCDEFG');
		expect(captureMeasurementId(undefined)).toBe('G-ABCDEFG');
	});

	it('treats whitespace-only strings as falsy', () => {
		// Whitespace-only is not a valid GA ID; do not capture.
		expect(captureMeasurementId('   ')).toBeUndefined();
		expect(captureMeasurementId('G-VALID')).toBe('G-VALID');
	});
});

describe('GoogleAnalytics — render output', () => {
	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
		// Issue #495: every measurement assertion below runs in a
		// document that has recorded an affirmative decision. The
		// consent gate itself is asserted in its own describe block.
		setDocumentAnalyticsConsent('granted');
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
	});

	it('renders nothing when measurementId is undefined', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics />);
		expect(html).toBe('');
	});

	it('renders nothing when measurementId is the empty string', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="" />);
		expect(html).toBe('');
	});

	it('renders the bootstrap script and the init script when measurementId is set', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="G-ABCDEFG" />);
		expect(html).toContain('async=""');
		expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEFG"');
		expect(html).toContain('window.dataLayer = window.dataLayer || [];');
		expect(html).toContain('function gtag(){dataLayer.push(arguments);}');
		expect(html).toContain("gtag('js', new Date());");
		expect(html).toContain("gtag('config', 'G-ABCDEFG');");
	});

	it('declares the Consent Mode default the grant is limited to (Issue #495)', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="G-ABCDEFG" />);
		// The grant the visitor gave is analytics storage. Everything
		// advertising / personalization related stays denied, and the
		// declaration is in the document rather than in a comment.
		expect(html).toContain("gtag('consent','default',{analytics_storage:'granted'");
		expect(html).toContain("ad_storage:'denied'");
		expect(html).toContain("ad_user_data:'denied'");
		expect(html).toContain("ad_personalization:'denied'");
		expect(html).toContain("personalization_storage:'denied'");
		expect(html).toContain("functionality_storage:'denied'");
		// Consent Mode must be declared before `config`, or the first
		// page_view is recorded against the default state.
		expect(html.indexOf("gtag('consent'")).toBeLessThan(html.indexOf("gtag('config'"));
	});

	it('preserves the SSR-captured value across re-renders with no measurementId', () => {
		// Simulates SSR capture, then a subsequent client-side
		// navigation where the loader returns undefined (the
		// `cloudflare:workers` stub).
		renderToStaticMarkup(<GoogleAnalytics measurementId="G-FIRST" />);
		const html = renderToStaticMarkup(<GoogleAnalytics />);
		expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-FIRST"');
		expect(html).toContain("gtag('config', 'G-FIRST');");
	});

	it('encodes the measurement ID into the bootstrap URL', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="G-A B/C" />);
		// Spaces and slashes must be percent-encoded in the URL.
		expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-A%20B%2FC"');
	});

	it('escapes a single-quote character in the inline config call', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="G-ABC'DEF" />);
		// The single quote must be escaped to avoid breaking the
		// `gtag('config', '...')` literal in the init script.
		expect(html).not.toContain("gtag('config', 'G-ABC'DEF');");
		expect(html).toContain("gtag('config', 'G-ABC\\'DEF');");
	});
});

describe('GoogleAnalytics — initial-load config (Issue #286)', () => {
	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
		// Issue #495: every measurement assertion below runs in a
		// document that has recorded an affirmative decision. The
		// consent gate itself is asserted in its own describe block.
		setDocumentAnalyticsConsent('granted');
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
	});

	it('emits exactly one gtag("config") call in the rendered markup', () => {
		// The inline init script is what records the initial
		// page_view. It must appear once and only once — a second
		// `config` in the same document would double the initial
		// page_view.
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="G-ABCDEFG" />);
		expect(html.match(/gtag\('config'/g)).toHaveLength(1);
	});
});

describe('GoogleAnalytics — SPA route-change page_view (Issue #286)', () => {
	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
		setDocumentAnalyticsConsent('granted');
		resetAnalyticsGlobals();
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
		resetAnalyticsGlobals();
	});

	it('renders no markup for the route tracker', () => {
		const html = renderToStaticMarkup(
			<GoogleAnalyticsRouteTracker measurementId="G-TEST000" locationKey="/" />,
		);
		expect(html).toBe('');
	});

	it('stays silent for the initial location and repeated renders of it', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;
		captureMeasurementId('G-TEST000');

		const state = createPageViewRouteState('/');
		trackRoutePageView(state, '/');
		trackRoutePageView(state, '/');

		// The initial page_view was already recorded by
		// `gtag('config', …)` — counting it again would double it.
		expect(gtag).not.toHaveBeenCalled();
	});

	it('fires exactly one page_view per route change', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;
		captureMeasurementId('G-TEST000');

		const state = createPageViewRouteState('/');
		trackRoutePageView(state, '/about');
		expect(gtag).toHaveBeenCalledTimes(1);
		expect(gtag).toHaveBeenCalledWith(
			'event',
			'page_view',
			expect.objectContaining({ page_path: '/about' }),
		);

		// A repeat render of the same location must not double count.
		trackRoutePageView(state, '/about');
		expect(gtag).toHaveBeenCalledTimes(1);

		// The next distinct location fires the next page_view. The
		// search string is part of the DEDUPE key but is stripped from
		// the payload (Issue #467) — see the analytics redaction
		// describe block at the end of this file.
		trackRoutePageView(state, '/portfolio?tab=work');
		expect(gtag).toHaveBeenCalledTimes(2);
		expect(gtag).toHaveBeenLastCalledWith(
			'event',
			'page_view',
			expect.objectContaining({ page_path: '/portfolio' }),
		);
	});

	it('never fires for /admin/* and resumes on the next public page', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;
		captureMeasurementId('G-TEST000');

		const state = createPageViewRouteState('/');
		trackRoutePageView(state, '/about');
		expect(gtag).toHaveBeenCalledTimes(1);

		trackRoutePageView(state, '/admin/keys');
		trackRoutePageView(state, '/admin/login?next=/');
		// The router resolves static segments case-insensitively, so a
		// case variant renders the admin screen; the tracker must stay
		// inert for it too (Issue #495 review S1).
		trackRoutePageView(state, '/ADMIN/KEYS');
		expect(gtag).toHaveBeenCalledTimes(1);
		for (const call of gtag.mock.calls) {
			const params = call[2] as { page_path: string };
			expect(params.page_path.startsWith('/admin')).toBe(false);
		}

		// Leaving /admin/* for a public page IS tracked (the tracker
		// instance survives the admin navigations).
		trackRoutePageView(state, '/contact');
		expect(gtag).toHaveBeenCalledTimes(2);
		expect(gtag).toHaveBeenLastCalledWith(
			'event',
			'page_view',
			expect.objectContaining({ page_path: '/contact' }),
		);
	});

	it('never tracks when no measurement ID was ever captured', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;
		// Deliberately no captureMeasurementId(...) call — simulates
		// the unset-secret off switch.

		const state = createPageViewRouteState('/');
		trackRoutePageView(state, '/about');
		trackRoutePageView(state, '/admin/keys');

		expect(gtag).not.toHaveBeenCalled();
	});

	it('bootstraps the official queue and config when the init snippet never ran', () => {
		captureMeasurementId('G-TEST000');
		// No `gtag`, no `dataLayer`: the document was loaded on
		// /admin/* (GA scripts excluded) and this is the first
		// public route change of the session.
		const state = createPageViewRouteState('/admin/login');
		trackRoutePageView(state, '/');

		const globals = analyticsGlobals();
		expect(typeof globals.gtag).toBe('function');
		const queue = globals.dataLayer as unknown[];
		// Same queue shape the inline init script produces: the Consent
		// Mode default (Issue #495), then `js`, then `config`.
		expect(queue).toHaveLength(3);
		expect((queue[0] as unknown[])[0]).toBe('consent');
		expect((queue[0] as unknown[])[2]).toEqual(
			expect.objectContaining({ analytics_storage: 'granted', ad_storage: 'denied' }),
		);
		expect((queue[1] as unknown[])[0]).toBe('js');
		expect((queue[2] as unknown[])[0]).toBe('config');
		expect((queue[2] as unknown[])[1]).toBe('G-TEST000');
		// `config` records this page's page_view — no separate event
		// on top of it.
		expect(queue.some((entry) => (entry as unknown[])[0] === 'event')).toBe(false);

		// Subsequent route changes use the now-available `gtag` and
		// push a normal page_view event.
		trackRoutePageView(state, '/about');
		expect(queue).toHaveLength(4);
		expect((queue[3] as unknown[])[0]).toBe('event');
		expect((queue[3] as unknown[])[1]).toBe('page_view');
		expect((queue[3] as unknown[])[2]).toEqual(expect.objectContaining({ page_path: '/about' }));
	});
});

/**
 * The consent gate (Issue #495).
 *
 * The contract under audit is the default: a measurement ID alone
 * measures NOTHING. `unset` (no decision recorded — every first visit,
 * and every SSR render) and `denied` both suppress the script tag and
 * every event, so the GA4 code path is unreachable until a visitor
 * records a grant.
 */
describe('GoogleAnalytics — consent gate (Issue #495)', () => {
	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
		resetAnalyticsGlobals();
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
		resetAnalyticsGlobals();
	});

	it('renders no markup with a captured ID while the decision is unset', () => {
		captureMeasurementId('G-TEST000');
		expect(renderToStaticMarkup(<GoogleAnalytics measurementId="G-TEST000" />)).toBe('');
	});

	it('renders no markup with a captured ID after an explicit denial', () => {
		captureMeasurementId('G-TEST000');
		setDocumentAnalyticsConsent('denied');
		expect(renderToStaticMarkup(<GoogleAnalytics measurementId="G-TEST000" />)).toBe('');
	});

	it('emits no event while the decision is unset or denied', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;
		captureMeasurementId('G-TEST000');

		// `unset`: no decision recorded yet.
		const unsetState = createPageViewRouteState('/');
		trackRoutePageView(unsetState, '/about');
		expect(gtag).not.toHaveBeenCalled();

		// `denied`: a decision recorded, and it is a refusal.
		setDocumentAnalyticsConsent('denied');
		const deniedState = createPageViewRouteState('/');
		trackRoutePageView(deniedState, '/contact');
		expect(gtag).not.toHaveBeenCalled();
	});

	it('stops emitting as soon as the decision is withdrawn mid-document', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;
		captureMeasurementId('G-TEST000');
		setDocumentAnalyticsConsent('granted');

		const state = createPageViewRouteState('/');
		trackRoutePageView(state, '/about');
		expect(gtag).toHaveBeenCalledTimes(1);

		// The visitor revokes. The tag may still be in the document
		// (it was loaded under the earlier grant), so the emission
		// gate has to hold on its own.
		setDocumentAnalyticsConsent('denied');
		trackRoutePageView(state, '/contact');
		expect(gtag).toHaveBeenCalledTimes(1);
	});
});

/**
 * Analytics log surface (Issue #467).
 *
 * GA4 is a THIRD-PARTY sink: anything pushed through `gtag` leaves
 * the browser. The route tracker used to forward the router location
 * key verbatim, so the search string — the part of a URL this project
 * puts tokens and personal data in — was sent as `page_path` and
 * `page_location`.
 *
 * The audit asserts the negative: a fabricated invitation token in
 * the query must not reach `gtag`, while the pathname (what the
 * funnel is actually measured on) must.
 */
describe('GoogleAnalytics — analytics log redaction', () => {
	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
		setDocumentAnalyticsConsent('granted');
		resetAnalyticsGlobals();
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
		__resetDocumentAnalyticsConsentForTests();
	});

	it('strips the query string and hash from a location key', () => {
		expect(stripAnalyticsQuery('/portfolio')).toBe('/portfolio');
		expect(stripAnalyticsQuery('/portfolio?facets=web,design')).toBe('/portfolio');
		expect(stripAnalyticsQuery('/admin/invitations/accept?token=canary-token-abcdef123456')).toBe(
			'/admin/invitations/accept',
		);
		expect(stripAnalyticsQuery('/about#section')).toBe('/about');
	});

	it('never pushes a query-string token into gtag', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;
		captureMeasurementId('G-TEST000');

		const state = createPageViewRouteState('/');
		trackRoutePageView(
			state,
			'/portfolio?token=canary-token-abcdef123456&email=canary.person@example.invalid',
		);

		expect(gtag).toHaveBeenCalledTimes(1);
		const [command, event, params] = gtag.mock.calls[0] as [string, string, Record<string, string>];
		expect(command).toBe('event');
		expect(event).toBe('page_view');
		expect(params.page_path).toBe('/portfolio');
		expect(JSON.stringify(params)).not.toContain('canary-token-abcdef123456');
		expect(JSON.stringify(params)).not.toContain('canary.person@example.invalid');
	});

	it('still distinguishes two route changes that differ only in query', () => {
		// Dedupe is keyed on the FULL location key, so `/portfolio?a=1`
		// and `/portfolio?a=2` remain distinct events; only the payload
		// is stripped.
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;
		captureMeasurementId('G-TEST000');

		const state = createPageViewRouteState('/');
		trackRoutePageView(state, '/portfolio?a=1');
		trackRoutePageView(state, '/portfolio?a=2');
		trackRoutePageView(state, '/portfolio?a=2');

		expect(gtag).toHaveBeenCalledTimes(2);
	});
});
