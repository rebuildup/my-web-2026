import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsConsentControl, AnalyticsGate } from './AnalyticsConsent';
import { __resetCapturedMeasurementIdForTests } from './GoogleAnalytics';
import {
	ANALYTICS_CONSENT_STORAGE_KEY,
	__resetDocumentAnalyticsConsentForTests,
	analyticsMeasurementAllowed,
	getDocumentAnalyticsConsent,
	isAnalyticsMountPath,
} from './consent';

/**
 * The analytics mount site, in a browser (Issue #700).
 *
 * `test/integration/analytics-admin-path-parity.test.ts` proves that
 * the mount DECISION agrees with the router, and
 * `src/editorial/analytics/GoogleAnalytics.test.tsx` proves that the
 * route tracker stays silent for the Admin surface. This file proves
 * the half only a DOM can show: with a recorded grant in the browser,
 * the GA4 loader is INITIALISED on a public path and is NOT initialised
 * on a path the router resolves to the Admin surface — including the
 * percent-encoded and case variants the router folds into the same
 * screen.
 *
 * It also proves the other half of the privacy contract: the path
 * decision does not touch the CONSENT decision. A visitor who granted
 * consent keeps the recorded answer when the Admin surface opens, so
 * returning to a public page measures again — the gate stops the
 * measurement, it does not forget the answer.
 *
 * Run with: `pnpm run test:client` (see `vitest.client.config.ts`;
 * the workerd pool has no DOM).
 */

/**
 * Distinct IDs per scenario.
 *
 * React hoists `<script async src>` as a document resource and does not
 * re-insert a resource the document already rendered, while this file
 * removes the nodes between tests (`removeAnalyticsScripts`). A unique
 * `src` per scenario keeps both properties: the "no googletagmanager"
 * assertions still start from an empty head, and a scenario that must
 * observe the loader really observes its own insertion. The same
 * reason is stated in `AnalyticsConsent.client.test.tsx`.
 */
const MEASUREMENT_ID = 'G-MOUNT001';
const RETURNING_MEASUREMENT_ID = 'G-MOUNT002';

/**
 * The mount site, as `src/routes/__root.tsx` composes it: the gate is
 * mounted only where `isAnalyticsMountPath(pathname)` allows it, and
 * the consent control travels with it.
 *
 * The root route itself needs a router context, so this file renders the
 * same one-line decision with the real gate. The function under test is
 * the one the root calls.
 */
function MountSite({ pathname, measurementId }: { pathname: string; measurementId: string }) {
	if (!isAnalyticsMountPath(pathname)) return null;
	return (
		<>
			<AnalyticsGate measurementId={measurementId} locationKey={pathname} />
			<AnalyticsConsentControl />
		</>
	);
}

/** The GA4 loader the gate mounts into the document head. */
function loaderScript(): HTMLScriptElement | null {
	return document.head.querySelector('script[src*="googletagmanager.com/gtag/js"]');
}

/** Removes every tag a mounted gate may have appended to the head. */
function removeAnalyticsScripts() {
	for (const node of document.head.querySelectorAll('script')) {
		node.remove();
	}
}

/**
 * Replaces `globalThis.localStorage` with an in-memory store.
 *
 * The same fixture `AnalyticsConsent.client.test.tsx` uses: the test
 * asserts what the visitor's browser holds, so it owns the store
 * instead of trusting the environment's.
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

let storageFixture: ReturnType<typeof installFakeStorage>;

beforeEach(() => {
	storageFixture = installFakeStorage();
	__resetCapturedMeasurementIdForTests();
	__resetDocumentAnalyticsConsentForTests();
	removeAnalyticsScripts();
});

afterEach(() => {
	cleanup();
	removeAnalyticsScripts();
	storageFixture.remove();
	__resetCapturedMeasurementIdForTests();
	__resetDocumentAnalyticsConsentForTests();
});

describe('the mount site on a public path', () => {
	it('initialises GA4 for a recorded grant', async () => {
		storageFixture.values.set(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');

		render(<MountSite pathname="/about" measurementId={MEASUREMENT_ID} />);

		await waitFor(() => {
			expect(loaderScript()).not.toBeNull();
		});
		expect(loaderScript()?.getAttribute('src')).toContain(encodeURIComponent(MEASUREMENT_ID));
		expect(analyticsMeasurementAllowed()).toBe(true);
	});
});

describe('the mount site on the Admin surface', () => {
	it.each([
		// The paths the router resolves to the Admin surface.
		'/admin',
		'/admin/keys',
		// Case-insensitive static segments.
		'/ADMIN/KEYS',
		// Percent-decoded before matching: `%61` is `a`.
		'/%61dmin/keys',
		'/%61DMIN/KEYS',
	])('initialises nothing on %s', async (pathname) => {
		storageFixture.values.set(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');

		render(<MountSite pathname={pathname} measurementId={MEASUREMENT_ID} />);

		// The gate is not mounted, so nothing can initialise: no loader,
		// no inline `config`, no consent prompt.
		await waitFor(() => {
			expect(loaderScript()).toBeNull();
		});
		expect(document.head.innerHTML).not.toContain('googletagmanager');
		expect(document.body.innerHTML).not.toContain('data-testid="analytics-consent');
	});
});

describe('the consent decision survives the path decision', () => {
	it('keeps a recorded grant while the Admin surface is open', async () => {
		storageFixture.values.set(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');

		render(<MountSite pathname="/%61dmin/keys" measurementId={MEASUREMENT_ID} />);

		// The path decision stops the measurement; it does not rewrite
		// the visitor's answer — the recorded decision is still there.
		expect(storageFixture.values.get(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('granted');
		expect(loaderScript()).toBeNull();
		expect(document.body.innerHTML).not.toContain('data-testid="analytics-consent');
	});

	it('measures again on the next public page', async () => {
		storageFixture.values.set(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');

		const { unmount } = render(
			<MountSite pathname="/%61dmin/keys" measurementId={MEASUREMENT_ID} />,
		);
		unmount();
		render(<MountSite pathname="/about" measurementId={RETURNING_MEASUREMENT_ID} />);

		await waitFor(() => {
			expect(loaderScript()).not.toBeNull();
		});
		expect(loaderScript()?.getAttribute('src')).toContain(
			encodeURIComponent(RETURNING_MEASUREMENT_ID),
		);
	});

	it('leaves an undecided visitor undecided', async () => {
		render(<MountSite pathname="/%61dmin/keys" measurementId={MEASUREMENT_ID} />);

		expect(storageFixture.values.get(ANALYTICS_CONSENT_STORAGE_KEY)).toBeUndefined();
		expect(getDocumentAnalyticsConsent()).toBe('unset');
		expect(analyticsMeasurementAllowed()).toBe(false);
		expect(loaderScript()).toBeNull();
	});
});
