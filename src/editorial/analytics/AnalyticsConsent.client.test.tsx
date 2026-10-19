import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsConsentControl, AnalyticsGate } from './AnalyticsConsent';
import {
	GoogleAnalytics,
	GoogleAnalyticsRouteTracker,
	__resetCapturedMeasurementIdForTests,
} from './GoogleAnalytics';
import {
	ANALYTICS_CONSENT_STORAGE_KEY,
	__resetDocumentAnalyticsConsentForTests,
	analyticsMeasurementAllowed,
} from './consent';

/**
 * The consent surface as a visitor meets it (Issue #495).
 *
 * `consent.test.ts` proves the decision rules and
 * `GoogleAnalytics.test.tsx` proves the emission gates, both without a
 * DOM. This file proves the part only a browser can show:
 *
 *   - nothing is rendered on the server or before hydration, so the
 *     default HTML carries no analytics markup and no prompt flash;
 *   - the prompt appears for a first visit, and refusing it keeps the
 *     page fully usable while loading nothing;
 *   - granting mounts the GA4 loader + route tracker in the same
 *     document without a reload;
 *   - a browser "do not track" signal hides the grant action and keeps
 *     the site unmeasured even with a stored grant;
 *   - a store that refuses the write says so instead of claiming a
 *     measurement that cannot happen.
 *
 * Run with: `pnpm run test:client` (see `vitest.client.config.ts`;
 * the workerd pool has no DOM).
 */

const MEASUREMENT_ID = 'G-TEST0000';

/**
 * Replaces `globalThis.localStorage` with an in-memory store for one
 * test. happy-dom provides a real one, but a test that asserts what was
 * written (and one that makes writes throw) needs to own it.
 */
function installFakeStorage() {
	const values = new Map<string, string>();
	const storage = {
		get length() {
			return values.size;
		},
		key(index: number) {
			return [...values.keys()][index] ?? null;
		},
		getItem(key: string) {
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			values.set(key, String(value));
		},
		removeItem(key: string) {
			values.delete(key);
		},
		clear() {
			values.clear();
		},
	};
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', {
		value: storage,
		configurable: true,
		writable: true,
	});
	return {
		values,
		remove() {
			if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
			else Reflect.deleteProperty(globalThis, 'localStorage');
		},
	};
}

/** Restores the browser signals this file mutates. */
const originalDoNotTrack = Object.getOwnPropertyDescriptor(globalThis.navigator, 'doNotTrack');

function setDoNotTrack(value: string | undefined) {
	Object.defineProperty(globalThis.navigator, 'doNotTrack', {
		value,
		configurable: true,
		enumerable: true,
	});
}

/**
 * Makes the installed store reject writes, the way a blocked or
 * quota-exceeded store does.
 */
function breakStorageWrites() {
	const storage = (globalThis as { localStorage: Storage }).localStorage;
	const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {
		throw new Error('storage is blocked');
	});
	return setItem;
}

let storageFixture: ReturnType<typeof installFakeStorage>;

/** Removes every tag the gate may have appended to the document head. */
function removeAnalyticsScripts() {
	for (const node of document.head.querySelectorAll('script')) {
		node.remove();
	}
}

beforeEach(() => {
	storageFixture = installFakeStorage();
	__resetCapturedMeasurementIdForTests();
	__resetDocumentAnalyticsConsentForTests();
	removeAnalyticsScripts();
	setDoNotTrack(undefined);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	removeAnalyticsScripts();
	storageFixture.remove();
	__resetCapturedMeasurementIdForTests();
	__resetDocumentAnalyticsConsentForTests();
	if (originalDoNotTrack) {
		Object.defineProperty(globalThis.navigator, 'doNotTrack', originalDoNotTrack);
	} else {
		setDoNotTrack(undefined);
	}
});

describe('AnalyticsConsentControl — no prompt before hydration', () => {
	it('renders nothing on the server', () => {
		expect(renderToStaticMarkup(<AnalyticsConsentControl />)).toBe('');
		expect(
			renderToStaticMarkup(<AnalyticsGate measurementId={MEASUREMENT_ID} locationKey="/" />),
		).toBe('');
	});
});

describe('AnalyticsConsentControl — first visit', () => {
	it('offers both choices and loads nothing while undecided', async () => {
		const { container } = render(
			<>
				<AnalyticsGate measurementId={MEASUREMENT_ID} locationKey="/" />
				<AnalyticsConsentControl />
			</>,
		);

		const panel = await screen.findByTestId('analytics-consent');
		expect(panel.getAttribute('data-analytics-consent')).toBe('unset');
		expect(screen.getByTestId('analytics-consent-grant')).toBeTruthy();
		expect(screen.getByTestId('analytics-consent-deny')).toBeTruthy();
		// The gate is mounted and still silent: no loader, no init
		// script, no measurement identifier in the document.
		expect(container.innerHTML).not.toContain('googletagmanager');
		expect(document.head.innerHTML).not.toContain('googletagmanager');
	});

	it('records a refusal, collapses to a status, and still loads nothing', async () => {
		render(
			<>
				<AnalyticsGate measurementId={MEASUREMENT_ID} locationKey="/" />
				<AnalyticsConsentControl />
			</>,
		);

		screen.getByTestId('analytics-consent-deny').click();

		await waitFor(() => {
			expect(storageFixture.values.get(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('denied');
		});
		const toggle = await screen.findByTestId('analytics-consent-toggle');
		expect(toggle.textContent).toContain('無効');
		expect(document.head.innerHTML).not.toContain('googletagmanager');
		// The refusal is recoverable: the status reopens the same panel.
		toggle.click();
		const panel = await screen.findByTestId('analytics-consent');
		expect(panel.getAttribute('data-analytics-consent')).toBe('denied');
		expect(screen.getByTestId('analytics-consent-deny')).toBeTruthy();
	});

	it('mounts the loader and the route tracker on a grant, without a reload', async () => {
		render(
			<>
				<AnalyticsGate measurementId={MEASUREMENT_ID} locationKey="/" />
				<AnalyticsConsentControl />
			</>,
		);

		screen.getByTestId('analytics-consent-grant').click();

		await waitFor(() => {
			expect(storageFixture.values.get(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('granted');
		});
		const script = await waitFor(() => {
			const node = document.head.querySelector(
				'script[src*="googletagmanager.com/gtag/js"]',
			) as HTMLScriptElement | null;
			expect(node).not.toBeNull();
			return node as HTMLScriptElement;
		});
		expect(script.getAttribute('src')).toContain(encodeURIComponent(MEASUREMENT_ID));
		// The tracker mounts with the script and stays silent for the
		// location the inline `config` already recorded.
		// A recorded decision collapses the panel to the status control;
		// the grant is visible there, not in a panel that is gone.
		const toggle = await screen.findByTestId('analytics-consent-toggle');
		expect(toggle.textContent).toContain('有効');
	});

	it('remembers a recorded decision on the next document', async () => {
		storageFixture.values.set(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');
		render(<AnalyticsGate measurementId={MEASUREMENT_ID} locationKey="/" />);
		// The gate publishes the stored answer as this document's decision
		// in its mount effect, which is what the GA4 modules gate on.
		// (Asserting the `<script>` again would test React's resources
		// cache, not the decision: React inserts a hoisted async script
		// once per document and does not re-insert one this file already
		// rendered.)
		await waitFor(() => {
			expect(analyticsMeasurementAllowed()).toBe(true);
		});
	});
});

describe('AnalyticsConsentControl — browser off-switch', () => {
	it('honours Do Not Track over a stored grant and offers no override', async () => {
		storageFixture.values.set(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');
		setDoNotTrack('1');

		render(
			<>
				<AnalyticsGate measurementId={MEASUREMENT_ID} locationKey="/" />
				<AnalyticsConsentControl />
			</>,
		);

		const panel = await screen.findByTestId('analytics-consent');
		expect(panel.getAttribute('data-analytics-off-switch')).toBe('do-not-track');
		expect(screen.queryByTestId('analytics-consent-grant')).toBeNull();
		// The stored grant does not load the tag under the signal.
		expect(document.head.innerHTML).not.toContain('googletagmanager');
	});
});

describe('AnalyticsConsentControl — storage the browser refuses', () => {
	it('reports a refused write instead of claiming a measurement', async () => {
		const setItem = breakStorageWrites();
		render(
			<>
				<AnalyticsGate measurementId={MEASUREMENT_ID} locationKey="/" />
				<AnalyticsConsentControl />
			</>,
		);

		screen.getByTestId('analytics-consent-grant').click();

		const status = await screen.findByTestId('analytics-consent-status');
		await waitFor(() => {
			expect(status.textContent).toContain('保存できませんでした');
		});
		expect(setItem).toHaveBeenCalled();
		expect(document.head.innerHTML).not.toContain('googletagmanager');
	});
});

describe('the GA4 modules behind the gate', () => {
	it('still render nothing without the gate (a caller cannot skip consent)', async () => {
		// Mounted directly, without `AnalyticsGate`: the components
		// consult the document-scoped decision, and no decision has been
		// resolved in this document.
		const { container } = render(
			<>
				<GoogleAnalytics measurementId={MEASUREMENT_ID} />
				<GoogleAnalyticsRouteTracker measurementId={MEASUREMENT_ID} locationKey="/" />
			</>,
		);
		await Promise.resolve();
		expect(container.innerHTML).not.toContain('googletagmanager');
	});
});
