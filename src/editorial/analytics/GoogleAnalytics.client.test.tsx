import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	GoogleAnalyticsRouteTracker,
	__resetCapturedMeasurementIdForTests,
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
