import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	GoogleAnalytics,
	GoogleAnalyticsRouteTracker,
	__resetCapturedMeasurementIdForTests,
	captureMeasurementId,
} from './GoogleAnalytics';

/**
 * Effect-wiring integration test for the SPA route-change tracker
 * (Issue #286).
 *
 * `GoogleAnalytics.test.tsx` (workerd pool) covers the pure
 * `trackRoutePageView` logic — dedupe, admin exclusion, the missing-ID
 * off switch, and the init-snippet fallback. This file proves the
 * React half of the contract in a DOM environment (happy-dom): the
 * component's location effect fires exactly once per `locationKey`
 * change, never on mount, and never for `/admin/*`.
 *
 * Run with: `pnpm run test:client` (see `vitest.client.config.ts`;
 * the default workerd pool has no DOM and cannot mount components).
 */

interface AnalyticsGlobals {
	gtag?: unknown;
	dataLayer?: unknown;
}

function analyticsGlobals(): AnalyticsGlobals {
	return globalThis as unknown as AnalyticsGlobals;
}

function resetAnalyticsGlobals(): void {
	analyticsGlobals().gtag = undefined;
	analyticsGlobals().dataLayer = undefined;
}

describe('GoogleAnalyticsRouteTracker — effect wiring (Issue #286)', () => {
	beforeEach(() => {
		// The measurement-ID capture is module-level write-once state —
		// it must be cleared or the previous test's ID leaks into the
		// "no ID captured" case.
		__resetCapturedMeasurementIdForTests();
		resetAnalyticsGlobals();
	});

	afterEach(() => {
		cleanup();
		__resetCapturedMeasurementIdForTests();
		resetAnalyticsGlobals();
	});

	it('renders no DOM output', () => {
		const { container } = render(
			<GoogleAnalyticsRouteTracker measurementId="G-TEST000" locationKey="/" />,
		);
		expect(container.innerHTML).toBe('');
	});

	it('fires page_view once per route change, deduped, silent on /admin/*', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;

		const { rerender } = render(
			<GoogleAnalyticsRouteTracker measurementId="G-TEST000" locationKey="/" />,
		);

		// Mount = the document's initial location: `gtag('config', …)`
		// already recorded it, so the effect must stay silent.
		expect(gtag).not.toHaveBeenCalled();

		rerender(<GoogleAnalyticsRouteTracker measurementId="G-TEST000" locationKey="/about" />);
		expect(gtag).toHaveBeenCalledTimes(1);
		expect(gtag).toHaveBeenCalledWith(
			'event',
			'page_view',
			expect.objectContaining({ page_path: '/about' }),
		);

		// Same key again (any re-render) → no double count.
		rerender(<GoogleAnalyticsRouteTracker measurementId="G-TEST000" locationKey="/about" />);
		expect(gtag).toHaveBeenCalledTimes(1);

		// /admin/* never tracked.
		rerender(<GoogleAnalyticsRouteTracker measurementId="G-TEST000" locationKey="/admin/keys" />);
		expect(gtag).toHaveBeenCalledTimes(1);

		// Back to a public page → tracked again, with an absolute
		// page_location built from the DOM location.
		rerender(<GoogleAnalyticsRouteTracker measurementId="G-TEST000" locationKey="/contact" />);
		expect(gtag).toHaveBeenCalledTimes(2);
		expect(gtag).toHaveBeenLastCalledWith(
			'event',
			'page_view',
			expect.objectContaining({
				page_path: '/contact',
				page_location: expect.stringContaining('/contact'),
			}),
		);
	});

	it('stays inert when no measurement ID is ever captured', () => {
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;

		const { rerender } = render(<GoogleAnalyticsRouteTracker locationKey="/" />);
		rerender(<GoogleAnalyticsRouteTracker locationKey="/about" />);

		expect(gtag).not.toHaveBeenCalled();
	});
});

describe('GoogleAnalytics — SSR-script ID seeding (Issue #286)', () => {
	let bootstrapScript: HTMLScriptElement | undefined;

	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
		resetAnalyticsGlobals();
		bootstrapScript = undefined;
	});

	afterEach(() => {
		cleanup();
		bootstrapScript?.remove();
		__resetCapturedMeasurementIdForTests();
		resetAnalyticsGlobals();
	});

	/** Simulates the SSR-rendered bootstrap script in the document. */
	function appendSsrBootstrap(id: string): HTMLScriptElement {
		const el = document.createElement('script');
		el.setAttribute('src', `https://www.googletagmanager.com/gtag/js?id=${id}`);
		document.head.appendChild(el);
		bootstrapScript = el;
		return el;
	}

	it('seeds the write-once capture from the SSR-rendered script when the loader prop is undefined', () => {
		// The real client condition (Issue #286 diagnosis): the loader
		// prop is always `undefined` client-side — only the SSR script
		// in the document carries the ID.
		appendSsrBootstrap('G-DOCTEST');

		expect(captureMeasurementId(undefined)).toBe('G-DOCTEST');
		// Write-once: subsequent falsy values never clear it.
		expect(captureMeasurementId(undefined)).toBe('G-DOCTEST');
		expect(captureMeasurementId('')).toBe('G-DOCTEST');
	});

	it('renders the bootstrap markup again from the DOM-seeded capture (loader prop undefined)', () => {
		appendSsrBootstrap('G-DOCTEST');
		// A re-render with no loader value must still emit the scripts —
		// this is what lets the tags survive navigation. Rendered via
		// renderToStaticMarkup because React intentionally skips
		// <script src> insertion during client rendering.
		const html = renderToStaticMarkup(<GoogleAnalytics />);
		expect(html).toContain('gtag/js?id=G-DOCTEST');
		expect(html).toContain("gtag('config', 'G-DOCTEST');");
	});

	it('fires page_view on route change when the ID comes only from the SSR script', () => {
		appendSsrBootstrap('G-DOCTEST');
		const gtag = vi.fn();
		analyticsGlobals().gtag = gtag;

		// No measurementId prop at all — mirrors `__root.tsx` after the
		// client loader re-runs against the empty workers stub.
		const { rerender } = render(<GoogleAnalyticsRouteTracker locationKey="/" />);
		expect(gtag).not.toHaveBeenCalled();

		rerender(<GoogleAnalyticsRouteTracker locationKey="/about" />);
		expect(gtag).toHaveBeenCalledTimes(1);
		expect(gtag).toHaveBeenCalledWith(
			'event',
			'page_view',
			expect.objectContaining({ page_path: '/about' }),
		);
	});
});
