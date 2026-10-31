import { describe, expect, it } from 'vitest';
import {
	ANALYTICS_CONSENT_STORAGE_KEY,
	__resetDocumentAnalyticsConsentForTests,
	analyticsConsentStorage,
	analyticsMeasurementAllowed,
	effectiveAnalyticsConsentState,
	getDocumentAnalyticsConsent,
	isAnalyticsMountPath,
	parseAnalyticsConsent,
	readAnalyticsConsent,
	resolveAnalyticsConsent,
	setDocumentAnalyticsConsent,
	writeAnalyticsConsent,
} from './consent';

/**
 * Analytics consent decision contract (Issue #495).
 *
 * The rules this suite exists to pin:
 *
 *   1. `unset` is NOT a grant. No decision recorded means no
 *      measurement — that is the state of every first visit and every
 *      SSR render.
 *   2. Only the two exact literals are decisions. Anything else a
 *      browser, a hand edit, or a future version of this module can
 *      leave in the store degrades to `unset`, never to `granted`.
 *   3. A store that cannot be read or written is `unset`, and a
 *      refused write is reported as such rather than silently
 *      rendering a state the browser does not hold.
 *   4. A browser off-switch (Do Not Track / Global Privacy Control)
 *      overrides a stored `granted`.
 *
 * Storage is injected, so the suite proves the contract without a DOM
 * and without touching a real browser store.
 */

/** In-memory `Storage` subset that can be told to fail on demand. */
function fakeStorage(initial?: string) {
	let value = initial ?? null;
	const storage = {
		getItem: (key: string) => (key === ANALYTICS_CONSENT_STORAGE_KEY ? value : null),
		setItem: (key: string, next: string) => {
			if (key !== ANALYTICS_CONSENT_STORAGE_KEY) return;
			value = next;
		},
	};
	return storage;
}

/** A store that throws the way a blocked / quota-exceeded store does. */
function throwingStorage() {
	return {
		getItem: () => {
			throw new Error('storage is blocked');
		},
		setItem: () => {
			throw new Error('quota exceeded');
		},
	};
}

describe('parseAnalyticsConsent', () => {
	it('accepts exactly the two decision literals', () => {
		expect(parseAnalyticsConsent('granted')).toBe('granted');
		expect(parseAnalyticsConsent('denied')).toBe('denied');
	});

	it('tolerates surrounding whitespace from a hand-edited value', () => {
		expect(parseAnalyticsConsent(' granted\n')).toBe('granted');
		expect(parseAnalyticsConsent('\tdenied ')).toBe('denied');
	});

	it('degrades every other value to unset, never to granted', () => {
		for (const raw of [
			null,
			undefined,
			'',
			'   ',
			'true',
			'1',
			'GRANTED',
			'yes',
			'{"decision":"granted"}',
			'granted;denied',
		]) {
			expect(parseAnalyticsConsent(raw)).toBe('unset');
		}
	});
});

describe('readAnalyticsConsent', () => {
	it('reads a recorded decision from the declared key', () => {
		expect(readAnalyticsConsent(fakeStorage('granted'))).toBe('granted');
		expect(readAnalyticsConsent(fakeStorage('denied'))).toBe('denied');
	});

	it('reports unset when there is no store', () => {
		expect(readAnalyticsConsent(null)).toBe('unset');
	});

	it('reports unset when the store throws on read', () => {
		expect(readAnalyticsConsent(throwingStorage())).toBe('unset');
	});
});

describe('writeAnalyticsConsent', () => {
	it('stores the decision and reads it back', () => {
		const storage = fakeStorage();
		expect(writeAnalyticsConsent('denied', storage)).toBe(true);
		expect(readAnalyticsConsent(storage)).toBe('denied');
		expect(writeAnalyticsConsent('granted', storage)).toBe(true);
		expect(readAnalyticsConsent(storage)).toBe('granted');
	});

	it('reports a refused write instead of pretending it happened', () => {
		// The UI depends on this: a "granted" label over a value the
		// browser never stored would claim a measurement that cannot
		// happen.
		expect(writeAnalyticsConsent('granted', throwingStorage())).toBe(false);
		expect(writeAnalyticsConsent('granted', null)).toBe(false);
	});
});

describe('resolveAnalyticsConsent', () => {
	it('does not grant on an empty store', () => {
		const resolved = resolveAnalyticsConsent({ storage: fakeStorage(), offSwitch: null });
		expect(resolved).toMatchObject({ state: 'unset', granted: false, offSwitch: null });
	});

	it('grants only on an affirmative decision', () => {
		const resolved = resolveAnalyticsConsent({ storage: fakeStorage('granted'), offSwitch: null });
		expect(resolved).toMatchObject({ state: 'granted', granted: true });
	});

	it('keeps an explicit refusal refused', () => {
		const resolved = resolveAnalyticsConsent({ storage: fakeStorage('denied'), offSwitch: null });
		expect(resolved).toMatchObject({ state: 'denied', granted: false });
	});

	it('lets the browser off-switch override a stored grant', () => {
		const withDnt = resolveAnalyticsConsent({
			storage: fakeStorage('granted'),
			offSwitch: 'do-not-track',
		});
		expect(withDnt).toMatchObject({ state: 'granted', granted: false, offSwitch: 'do-not-track' });

		const withGpc = resolveAnalyticsConsent({
			storage: fakeStorage('granted'),
			offSwitch: 'global-privacy-control',
		});
		expect(withGpc.granted).toBe(false);
	});

	it('reports an unavailable store without failing', () => {
		const resolved = resolveAnalyticsConsent({ storage: null, offSwitch: null });
		expect(resolved.storageUnavailable).toBe(true);
		expect(resolved.granted).toBe(false);
	});
});

describe('effectiveAnalyticsConsentState', () => {
	it('publishes granted only when the answer is granted', () => {
		expect(
			effectiveAnalyticsConsentState({
				state: 'granted',
				granted: true,
				offSwitch: null,
				storageUnavailable: false,
			}),
		).toBe('granted');
	});

	it('publishes denied for a grant the browser off-switch vetoed', () => {
		expect(
			effectiveAnalyticsConsentState({
				state: 'granted',
				granted: false,
				offSwitch: 'do-not-track',
				storageUnavailable: false,
			}),
		).toBe('denied');
	});

	it('passes unset and denied through', () => {
		const base = { offSwitch: null, storageUnavailable: false } as const;
		expect(effectiveAnalyticsConsentState({ state: 'unset', granted: false, ...base })).toBe(
			'unset',
		);
		expect(effectiveAnalyticsConsentState({ state: 'denied', granted: false, ...base })).toBe(
			'denied',
		);
	});
});

describe('document-scoped decision', () => {
	it('defaults to unset, which is not allowed to measure', () => {
		__resetDocumentAnalyticsConsentForTests();
		expect(getDocumentAnalyticsConsent()).toBe('unset');
		expect(analyticsMeasurementAllowed()).toBe(false);
	});

	it('follows a later decision in the same document', () => {
		// Unlike the measurement-ID capture this is not write-once: a
		// visitor may record a decision at any moment.
		__resetDocumentAnalyticsConsentForTests();
		setDocumentAnalyticsConsent('granted');
		expect(analyticsMeasurementAllowed()).toBe(true);
		setDocumentAnalyticsConsent('denied');
		expect(analyticsMeasurementAllowed()).toBe(false);
		__resetDocumentAnalyticsConsentForTests();
	});
});

describe('isAnalyticsMountPath', () => {
	// The mount gate `src/routes/__root.tsx` applies to both
	// `AnalyticsGate` and `AnalyticsConsentControl`. The suite exists
	// because an SSR render never contains the tag on any route, so an
	// assertion against rendered HTML cannot tell a working gate from a
	// missing one — this table can.
	//
	// The table is a ROUTER-PARITY table (Issue #700): every row is a
	// path TanStack Router resolves one way, and the gate has to
	// resolve it the same way. `test/integration/analytics-admin-path-
	// parity.test.ts` runs the same paths through the real Worker, so
	// the rows here and the router's own answers cannot drift apart.
	it.each([
		['/', true],
		['/portfolio', true],
		['/portfolio/aulymo', true],
		['/about', true],
		['/status', true],
		['/design-system', true],
		['/admin', false],
		['/admin/', false],
		['/admin/login', false],
		['/admin/keys', false],
		['/admin/invitations/accept', false],
		// TanStack Router matches static segments case-insensitively,
		// so these render the admin surface and must be excluded too —
		// a case-sensitive check would send an invitation token.
		['/ADMIN', false],
		['/Admin/Login', false],
		['/ADMIN/INVITATIONS/ACCEPT', false],
		// The router percent-decodes the pathname before matching, so
		// these reach the admin screen too (`%61` is `a`). A gate that
		// compared the raw string would let their document URL reach
		// GA4 through the initial `gtag('config', …)` hit.
		['/%61dmin', false],
		['/%61dmin/keys', false],
		['/%61DMIN/KEYS', false],
		// A bare prefix match would swallow this future route; the
		// rule is `/admin` or `/admin/…` exactly.
		['/administration', true],
		['/administrator-guide', true],
		['/adminish', true],
		['/ADMINISH', true],
		// The router answers a doubled slash with a canonicalisation,
		// not with the admin screen, so this path is not the admin
		// surface and must not be excluded from measurement.
		['//admin', true],
		['//admin/keys', true],
		// Reserved separators stay encoded, so the router answers
		// these with its 404 surface rather than the admin screen.
		['/admin%2Fkeys', true],
		['/%2Fadmin', true],
		// `decodeURI` turns `%25` into a literal `%` in ONE pass, so the
		// path still carries the escaped `a` — not the admin surface.
		['/%2561dmin/keys', true],
		// A malformed escape makes the decode throw. The request is
		// answered with a 400 before route matching, and the gate must
		// not throw on the way to that answer: it falls back to the raw
		// pathname, so an ESCAPED admin prefix is not the admin
		// surface, while a literal one still is.
		['/%61dmin/%ZZ', true],
		['/%E0%A4%A/admin', true],
		['/admin/%ZZ', false],
	])('answers %s -> %s', (pathname, expected) => {
		expect(isAnalyticsMountPath(pathname)).toBe(expected);
	});

	it('never rewrites the document consent state', () => {
		// The path decision and the consent decision are two different
		// questions. A visitor who granted consent on a public page and
		// then opened the admin surface keeps the recorded decision —
		// the gate stops the measurement, it does not forget the
		// answer, so returning to a public page measures again.
		__resetDocumentAnalyticsConsentForTests();
		setDocumentAnalyticsConsent('granted');
		expect(isAnalyticsMountPath('/%61dmin/keys')).toBe(false);
		expect(getDocumentAnalyticsConsent()).toBe('granted');
		__resetDocumentAnalyticsConsentForTests();
	});
});

describe('analyticsConsentStorage', () => {
	it('is unavailable outside a browser document', () => {
		// The workerd pool has no `localStorage`; the module must not
		// assume one, and must not throw while probing.
		expect(analyticsConsentStorage()).toBeNull();
	});
});
