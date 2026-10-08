import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	GoogleAnalytics,
	GoogleAnalyticsRouteTracker,
	__resetCapturedMeasurementIdForTests,
	captureMeasurementId,
	createPageViewRouteState,
	trackRoutePageView,
} from './GoogleAnalytics';

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
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
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
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
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
		resetAnalyticsGlobals();
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
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

		// The next distinct location fires the next page_view; the
		// search string is part of the location key.
		trackRoutePageView(state, '/portfolio?tab=work');
		expect(gtag).toHaveBeenCalledTimes(2);
		expect(gtag).toHaveBeenLastCalledWith(
			'event',
			'page_view',
			expect.objectContaining({ page_path: '/portfolio?tab=work' }),
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
		expect(queue).toHaveLength(2);
		expect((queue[0] as unknown[])[0]).toBe('js');
		expect((queue[1] as unknown[])[0]).toBe('config');
		expect((queue[1] as unknown[])[1]).toBe('G-TEST000');
		// `config` records this page's page_view — no separate event
		// on top of it.
		expect(queue.some((entry) => (entry as unknown[])[0] === 'event')).toBe(false);

		// Subsequent route changes use the now-available `gtag` and
		// push a normal page_view event.
		trackRoutePageView(state, '/about');
		expect(queue).toHaveLength(3);
		expect((queue[2] as unknown[])[0]).toBe('event');
		expect((queue[2] as unknown[])[1]).toBe('page_view');
		expect((queue[2] as unknown[])[2]).toEqual(expect.objectContaining({ page_path: '/about' }));
	});
});
