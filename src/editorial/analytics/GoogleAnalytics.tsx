/**
 * Google Analytics 4 wire-up (Issue #171).
 *
 * Renders the GA4 `<script async>` bootstrap and the inline init
 * script that pushes the `gtag('config', …)` call. Mounted inside
 * the document `<head>` by `src/routes/__root.tsx` so the tag
 * loads on first paint and the pageview is recorded before the
 * visitor can navigate away.
 *
 * No GA ID → no markup. The root route loader reads
 * `GOOGLE_ANALYTICS_MEASUREMENT_ID` from `wrangler.jsonc#vars` (and
 * the production mirror) during SSR and passes the value as the
 * `measurementId` prop. When the value is the empty string or
 * `undefined`, the component renders `null`. Operators therefore
 * do not need to remove a script tag — leaving the var unset is the
 * off switch.
 *
 * Admin gating. `/admin/*` is the operator's own UI; GA tracking
 * would record every admin action into the same GA property as the
 * public traffic and pollute the funnel. Pathname gating lives in
 * `__root.tsx` (where the router context is available) — see the
 * `useLocation` selector there — not inside this component, so
 * this module has zero router dependencies and can be rendered in
 * any React environment (workerd pool, happy-dom, Storybook).
 *
 * Why a module-level captured value. The root route loader runs on
 * the server during SSR (where `cloudflare:workers` resolves to the
 * real workerd env) and on the client during subsequent
 * navigations (where the same import resolves to the frozen empty
 * stub documented in `src/cloudflare/workers-stub.ts`). Capturing
 * the SSR value into a module-level `let` preserves the ID across
 * the client-side lifecycle so the script tag survives a navigation
 * out of `/admin/*`. The capture is write-once: a falsy client-side
 * value never overwrites the captured SSR value.
 */

let capturedMeasurementId: string | undefined;

/**
 * Test seam. Resets the captured SSR measurement ID between tests;
 * production code never calls this.
 */
export function __resetCapturedMeasurementIdForTests(): void {
	capturedMeasurementId = undefined;
}

/**
 * Returns the first non-empty measurement ID ever captured, or
 * `undefined` when no ID has been captured yet. Subsequent calls
 * never overwrite a previously captured value, so a falsy
 * client-side stub never wipes the SSR value.
 */
export function captureMeasurementId(value: string | undefined): string | undefined {
	if (value && value.trim().length > 0 && !capturedMeasurementId) {
		capturedMeasurementId = value;
	}
	return capturedMeasurementId;
}

export interface GoogleAnalyticsProps {
	/**
	 * GA4 measurement ID (the `G-XXXXXXX` string). When the empty
	 * string or `undefined` is passed, the component renders nothing.
	 */
	measurementId?: string | undefined;
}

export function GoogleAnalytics({ measurementId }: GoogleAnalyticsProps) {
	const captured = captureMeasurementId(measurementId);
	if (!captured) return null;

	const id = captured;
	const encodedSrc = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
	const escapedId = id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
	const initScript = `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${escapedId}');`;

	return (
		<>
			<script async src={encodedSrc} />
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: GA4 init script. The only user-controlled surface is the measurement ID, which is the `G-XXXXXXX` string we escape via `escapedId` above; no visitor data flows through this attribute. */}
			<script dangerouslySetInnerHTML={{ __html: initScript }} />
		</>
	);
}
