/**
 * Google Analytics 4 wire-up (Issue #171, Issue #286).
 *
 * Renders the GA4 `<script async>` bootstrap and the inline init
 * script that pushes the `gtag('config', …)` call. Mounted inside
 * the document `<head>` by `AnalyticsGate` (`./AnalyticsConsent.tsx`),
 * which `src/routes/__root.tsx` mounts on public routes, so the tag
 * loads once a consent decision allows it and the pageview is
 * recorded before the visitor can navigate away.
 *
 * SPA route changes (Issue #286). The inline `gtag('config', …)`
 * records exactly one page_view: the initial document load. TanStack
 * Router navigations replace the URL without loading a new document,
 * so nothing after the first paint would be measured without the
 * companion `GoogleAnalyticsRouteTracker` below — a render-null
 * component that mounts with the script and pushes
 * `gtag('event', 'page_view', …)` on each location change. The
 * tracker dedupes against its initial location key, so the initial
 * load is counted once (by `config`) and never again (by the
 * tracker).
 *
 * No GA ID → no markup, no tracking. The root route loader reads
 * `GOOGLE_ANALYTICS_MEASUREMENT_ID` (a runtime secret — Issue #187)
 * during SSR and passes the value as the `measurementId` prop. When
 * the value is the empty string or `undefined`, the component
 * renders `null`. Operators therefore do not need to remove a
 * script tag — leaving the secret unset is the off switch.
 *
 * Consent gate (Issue #495). A measurement ID is necessary but not
 * sufficient: nothing here renders, and no event is emitted, unless
 * `./consent` has resolved an affirmative decision for this document.
 * The check lives at the two emission points rather than only in the
 * caller, so a mount site added later (or an SSR render) cannot skip
 * it by forgetting a prop. `AnalyticsGate` in `./AnalyticsConsent.tsx`
 * is the caller that resolves the decision; this module only enforces
 * it.
 *
 * Consent Mode (Issue #495). The inline init script now opens with a
 * `gtag('consent', 'default', …)` call that grants analytics storage
 * — the thing the visitor just agreed to — and keeps ad storage, ad
 * user data, ad personalization, personalization and functionality
 * storage denied, which is what GA4 would otherwise default to. The
 * declaration is therefore in the same document as the grant, rather
 * than in a comment: the payload Google may store is written down in
 * the only file that loads the tag.
 *
 * Admin gating. `/admin/*` is the operator's own UI; GA tracking
 * would record every admin action into the same GA property as the
 * public traffic and pollute the funnel. Pathname gating lives in
 * `__root.tsx` (where the router context is available) — see the
 * `useLocation` selector there — not inside this component, so
 * this module has zero router dependencies and can be rendered in
 * any React environment (workerd pool, happy-dom, Storybook).
 *
 * Query-string gating (Issue #467). Pathname gating is not enough
 * on its own: the route-change tracker forwards the router location
 * key to GA4, and that key ends with the search string.
 * `/admin/invitations/accept?token=…` happens to be admin-gated, but
 * the gate is a prefix match on the pathname, so a public route
 * carrying a token, an email, or free text in its query would forward
 * it to a third-party property by default. `stripAnalyticsQuery`
 * reduces every payload this module emits to the pathname alone. The
 * initial page_view that `gtag('config', …)` records is the one
 * remaining path where GA reads the document URL itself — see
 * `docs/security/log-redaction.md` ("Known limits").
 *
 * Why a module-level captured value. The root route loader runs on
 * the server during SSR (where `cloudflare:workers` resolves to the
 * real workerd env) and on the client during subsequent
 * navigations (where the same import resolves to the frozen empty
 * stub documented in `src/cloudflare/workers-stub.ts`). The capture
 * is write-once: a falsy client-side value never overwrites the
 * captured value. Because the client bootstrap (`src/client.tsx`)
 * re-runs loaders instead of hydrating dehydrated loader state, the
 * loader prop is `undefined` on every client render (the Issue #286
 * diagnosis), so the capture is additionally seeded from the
 * SSR-rendered bootstrap script in the current document — see
 * `readMeasurementIdFromDocument`. Together the two sources
 * preserve the ID across the client-side lifecycle so the script
 * tag and the tracker survive a navigation out of `/admin/*`.
 */

import { useEffect, useRef } from 'react';
import { analyticsMeasurementAllowed } from './consent';

let capturedMeasurementId: string | undefined;

/**
 * Test seam. Resets the captured SSR measurement ID between tests;
 * production code never calls this.
 */
export function __resetCapturedMeasurementIdForTests(): void {
	capturedMeasurementId = undefined;
}

/**
 * Reads the measurement ID from the SSR-rendered bootstrap script.
 *
 * Why this exists (Issue #286 diagnosis). The root loader value only
 * reaches components during SSR: on the client the `cloudflare:workers`
 * stub returns `undefined`, and the client bootstrap in
 * `src/client.tsx` re-runs loaders (the app does not hydrate
 * dehydrated loader state), so the `measurementId` prop is `undefined`
 * on every client-side render — the module-level write-once capture
 * never received a value, and the tracker was inert. The SSR HTML
 * itself does carry the ID (the `<script async src="…gtag/js?id=G-…">`
 * tag rendered above), so the capture is seeded from that DOM node:
 * it is SSR output, it only exists where GA is allowed to mount
 * (never on `/admin/*` full loads), and reading it preserves the
 * write-once contract — the ID that SSR rendered is exactly the ID
 * that survives the client-side lifecycle.
 */
function readMeasurementIdFromDocument(): string | undefined {
	if (typeof document === 'undefined') return undefined;
	try {
		const script = document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
		if (!script) return undefined;
		const src = script.getAttribute('src') ?? '';
		const id = new URL(src, document.baseURI).searchParams.get('id');
		return id && id.trim().length > 0 ? id.trim() : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Returns the first non-empty measurement ID ever captured, or
 * `undefined` when no ID has been captured yet. Subsequent calls
 * never overwrite a previously captured value, so a falsy
 * client-side stub never wipes the SSR value.
 *
 * Two sources feed the write-once capture, first non-empty wins:
 * the `value` argument (the SSR loader prop during SSR) and the
 * SSR-rendered bootstrap script in the current document (the
 * client-side path — see `readMeasurementIdFromDocument`).
 */
export function captureMeasurementId(value: string | undefined): string | undefined {
	if (!capturedMeasurementId) {
		const fromDocument = readMeasurementIdFromDocument();
		if (fromDocument) {
			capturedMeasurementId = fromDocument;
		}
	}
	if (value && value.trim().length > 0 && !capturedMeasurementId) {
		capturedMeasurementId = value;
	}
	return capturedMeasurementId;
}

export interface GoogleAnalyticsProps {
	/**
	 * GA4 measurement ID (the `G-XXXXXXX` string). When the empty
	 * string or `undefined` is passed, the component renders nothing.
	 *
	 * A measurement ID alone is not enough to render: the document must
	 * also carry a granted consent decision (Issue #495). See
	 * `./consent` and `AnalyticsGate`.
	 */
	measurementId?: string | undefined;
}

/**
 * The Consent Mode default this site runs with (Issue #495).
 *
 * `analytics_storage: 'granted'` is the one thing the visitor agreed
 * to; every advertising and personalization store stays `denied`, so
 * GA4 cannot widen the grant this site asked for. `wait_for_update`
 * is not set: there is no later consent update in this document, and a
 * wait would only delay the tag.
 */
export const ANALYTICS_CONSENT_DEFAULT_SNIPPET =
	"gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'denied'});";

export function GoogleAnalytics({ measurementId }: GoogleAnalyticsProps) {
	const captured = captureMeasurementId(measurementId);
	if (!captured) return null;
	if (!analyticsMeasurementAllowed()) return null;

	const id = captured;
	const encodedSrc = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
	const escapedId = id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
	const initScript = `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}${ANALYTICS_CONSENT_DEFAULT_SNIPPET}gtag('js', new Date());gtag('config', '${escapedId}');`;

	return (
		<>
			<script async src={encodedSrc} />
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: GA4 init script. The only user-controlled surface is the measurement ID, which is the `G-XXXXXXX` string we escape via `escapedId` above; no visitor data flows through this attribute. */}
			<script dangerouslySetInnerHTML={{ __html: initScript }} />
		</>
	);
}

/* ------------------------------------------------------------------------- *
 * SPA route-change page_view tracking (Issue #286)
 * ------------------------------------------------------------------------- */

/**
 * Dedupe state for route-change page_views. Seeded with the location
 * key of the document's initial load — `gtag('config', …)` already
 * recorded that page_view, so the tracker must stay silent until the
 * location actually changes.
 */
export interface PageViewRouteState {
	lastLocationKey: string;
}

/**
 * Creates the tracker state for a freshly loaded document.
 *
 * @param initialLocationKey - `pathname + searchStr` of the location
 * the document was loaded with.
 */
export function createPageViewRouteState(initialLocationKey: string): PageViewRouteState {
	return { lastLocationKey: initialLocationKey };
}

type GtagFn = (command: string, ...params: unknown[]) => void;

interface AnalyticsGlobals {
	gtag?: unknown;
	dataLayer?: unknown;
}

/**
 * Drop the query string and hash from a router location key
 * (Issue #467).
 *
 * The tracker used to forward the location key verbatim, so a
 * query string reached GA4 as `page_path` / `page_location`. Query
 * strings are where the project puts things that must not leave the
 * browser: `/admin/invitations/accept?token=…` carries a single-use
 * invitation token, and any future public route with `?email=`,
 * `?q=`, or `?token=` would forward personal data or a credential to
 * a third-party analytics property by default. The pathname is what
 * the funnel is measured on; the search string is not.
 *
 * Exported for the audit test in `GoogleAnalytics.test.tsx` and
 * reusable by any future analytics surface.
 */
export function stripAnalyticsQuery(locationKey: string): string {
	const cut = locationKey.search(/[?#]/);
	return cut === -1 ? locationKey : locationKey.slice(0, cut);
}

function analyticsGlobals(): AnalyticsGlobals {
	return globalThis as unknown as AnalyticsGlobals;
}

/** The `/admin/*` prefix must stay in sync with the script-mount gate in `src/routes/__root.tsx`. */
const ADMIN_PATH_PREFIX = '/admin';

/**
 * Returns the page_view params for a route change.
 *
 * `page_path` is the location key with the query string and hash
 * removed (see `stripAnalyticsQuery`). `page_location` and
 * `page_title` are added only when the host exposes `location` /
 * `document` (they always exist in a browser; they do not exist in
 * the workerd test pool).
 */
function buildPageViewParams(locationKey: string): Record<string, string> {
	const publicPath = stripAnalyticsQuery(locationKey);
	const params: Record<string, string> = { page_path: publicPath };
	if (typeof globalThis.location !== 'undefined') {
		params.page_location = new URL(publicPath, globalThis.location.href).href;
	}
	if (typeof globalThis.document !== 'undefined') {
		params.page_title = globalThis.document.title;
	}
	return params;
}

/**
 * Pushes a `page_view` for a client-side route change.
 *
 * Called by `GoogleAnalyticsRouteTracker` from its location effect.
 * Contract:
 *
 * - The first key (the document's initial location) is swallowed —
 *   the inline `gtag('config', …)` already recorded it, and counting
 *   it again would double the initial page_view.
 * - Every subsequent distinct key fires exactly one
 *   `gtag('event', 'page_view', …)`.
 * - `/admin/*` keys are never tracked (same rule as the script-mount
 *   gate in `__root.tsx`), but they still advance the dedupe state so
 *   the first public page after leaving `/admin/*` is tracked.
 * - No captured measurement ID → never tracks (the render-gate
 *   contract: unset secret = off switch).
 * - No granted consent decision → never tracks (Issue #495). The
 *   render gate and the emission gate are checked independently, so a
 *   document whose consent was withdrawn mid-session stops emitting
 *   events as well as stopping the tag.
 *
 * Fallback when `window.gtag` does not exist yet: the official init
 * snippet never executed in this document — the visit landed on
 * `/admin/*`, where the GA scripts are excluded, and this is the
 * first public route change. In that case the official snippet queue
 * (`dataLayer` + `gtag`) is recreated and `js` + `config` are queued;
 * `config` records this page's page_view, so no separate event is
 * pushed for it. `gtag.js` (whose `<script async>` tag
 * `GoogleAnalytics` renders on this very navigation) processes the
 * queue when it loads.
 */
export function trackRoutePageView(state: PageViewRouteState, locationKey: string): void {
	// Dedupe: initial location (already counted by `config`) and
	// repeated renders of the same location must not fire again.
	if (locationKey === state.lastLocationKey) return;
	state.lastLocationKey = locationKey;

	// Off switch: no SSR-captured ID means the whole tracker is inert.
	if (!capturedMeasurementId) return;

	// Consent gate (Issue #495): an unmeasured document never emits,
	// even if the script tag is somehow present.
	if (!analyticsMeasurementAllowed()) return;

	// Admin is never tracked; the key above is still recorded.
	if (locationKey.startsWith(ADMIN_PATH_PREFIX)) return;

	const globals = analyticsGlobals();
	if (typeof globals.gtag !== 'function') {
		// Recreate the official snippet's queue, byte-compatible with
		// the inline init script (gtag.js consumes `arguments`
		// objects pushed onto dataLayer).
		if (!Array.isArray(globals.dataLayer)) {
			globals.dataLayer = [];
		}
		const dataLayer = globals.dataLayer as unknown[];
		const stub: GtagFn = function gtag(): void {
			// The official GA4 snippet queues `arguments` objects (not
			// arrays) onto dataLayer — gtag.js consumes them in that shape.
			// biome-ignore lint/style/noArguments: matches the official snippet byte-for-byte.
			dataLayer.push(arguments);
		};
		globals.gtag = stub;
		stub('consent', 'default', {
			analytics_storage: 'granted',
			ad_storage: 'denied',
			ad_user_data: 'denied',
			ad_personalization: 'denied',
			functionality_storage: 'denied',
			personalization_storage: 'denied',
			security_storage: 'denied',
		});
		stub('js', new Date());
		stub('config', capturedMeasurementId);
		return;
	}

	(globals.gtag as GtagFn)('event', 'page_view', buildPageViewParams(locationKey));
}

export interface GoogleAnalyticsRouteTrackerProps {
	/**
	 * GA4 measurement ID — same value / same write-once capture
	 * semantics as `GoogleAnalytics`. Pass the root loader value;
	 * when nothing was ever captured the tracker never fires.
	 */
	measurementId?: string | undefined;
	/**
	 * Current location key: `pathname + searchStr` from
	 * `useLocation()` in `__root.tsx`. The hash is intentionally
	 * excluded — hash-only jumps are in-page anchors, not route
	 * changes.
	 */
	locationKey: string;
}

/**
 * Route-change page_view emitter (Issue #286).
 *
 * Renders `null` — it emits no markup. Since Issue #495 it is mounted
 * only alongside the GA4 script, inside `AnalyticsGate`, so an
 * unmeasured document has no tracker at all. It stays silent on
 * `/admin/*` per the contract above.
 *
 * Mounting it fresh with the current location (rather than keeping one
 * instance alive across an admin round trip) is what makes the
 * one-page_view invariant hold when consent arrives mid-session: the
 * inline `config` in the freshly mounted `GoogleAnalytics` records the
 * page, and this instance seeds its dedupe state with the same key.
 *
 * Module dependencies: none beyond React. The router dependency
 * lives in `__root.tsx`, which passes the location key as a prop, so
 * this module keeps its zero-router-dependency property.
 */
export function GoogleAnalyticsRouteTracker({
	measurementId,
	locationKey,
}: GoogleAnalyticsRouteTrackerProps) {
	// Keep the write-once SSR capture warm: the root loader returns
	// `undefined` on client-side navigations (the `cloudflare:workers`
	// stub), and the tracker must still know the ID afterwards.
	captureMeasurementId(measurementId);

	const stateRef = useRef<PageViewRouteState | null>(null);
	if (stateRef.current === null) {
		stateRef.current = createPageViewRouteState(locationKey);
	}

	useEffect(() => {
		const state = stateRef.current;
		if (!state) return;
		trackRoutePageView(state, locationKey);
	}, [locationKey]);

	return null;
}
