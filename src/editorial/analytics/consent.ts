/**
 * Analytics consent decision contract (Issue #495).
 *
 * What this module decides, and what it deliberately does not
 * ---------------------------------------------------------
 * It decides ONE question: *may this document send measurement
 * events to the GA4 property?* The answer is `granted` only when a
 * visitor has recorded an affirmative decision AND the browser is not
 * asking not to be tracked. Everything else is `denied` or `unset`,
 * and both of those mean **no measurement**.
 *
 * It does NOT decide which law applies to a visitor. This repository
 * is one origin with one visitor mix, and the applicable regime is an
 * owner decision that cannot be derived from code (see
 * `docs/verification/privacy/analytics-disabled.md` §「適用法の判断」).
 * The module therefore implements the two states that are defensible
 * without that decision — a real affirmative grant and a real
 * non-tracking state — and no per-region branching. A visitor in a
 * regime that requires consent before any storage gets exactly that:
 * nothing is sent until they choose.
 *
 * The default is non-tracking
 * ---------------------------
 * `unset` (no stored decision) is NOT a grant. It renders no GA4
 * script, queues no event, and reads no analytics identifier, because
 * the browser's storage is unreadable during SSR and a server that
 * guessed `granted` would be measuring exactly the visitors who never
 * asked for it. Turning measurement on therefore requires a stored
 * `granted` written by a click.
 *
 * What is stored, and where
 * -------------------------
 * One key, `localStorage`, holding the literal string `granted` or
 * `denied`. No identifier, no timestamp, no visitor data, no
 * fingerprint — a reviewer can read the whole stored state from the
 * key alone. `sessionStorage` and cookies are deliberately unused: a
 * cookie would be a new tracked surface, and a session-scoped record
 * would re-prompt every visitor on every tab.
 *
 * Storage is treated as untrusted input. A browser with storage
 * disabled, a Safari private window, or a visitor who edited the value
 * by hand all produce a value this module does not recognise, and an
 * unrecognised value degrades to `unset` (no measurement), never to
 * `granted`. The same applies to a `setItem` that throws.
 *
 * Do Not Track / Global Privacy Control
 * -------------------------------------
 * `navigator.doNotTrack === '1'` and `navigator.globalPrivacyControl
 * === true` are browser signals, not legal conclusions. They are
 * honoured as hard off-switches: a stored `granted` does not override
 * either of them, because a browser that says "do not track me" has
 * already answered the question this module asks. Nothing here claims
 * what any jurisdiction requires of the site operator.
 */

/** `localStorage` key holding the recorded decision. */
export const ANALYTICS_CONSENT_STORAGE_KEY = 'my-web-2026:analytics-consent';

/**
 * Window event fired after a decision is recorded, so a component that
 * mounted the GA4 script decision separately (the head gate) can react
 * without a reload. Same-realm only — a cross-document signal would
 * be an unrequested cross-tab channel.
 */
export const ANALYTICS_CONSENT_CHANGE_EVENT = 'my-web-2026:analytics-consent-change';

/** A decision a visitor can record. */
export type AnalyticsConsentDecision = 'granted' | 'denied';

/**
 * The state of the consent answer in this document.
 *
 * `unset` is a first-class state, not an error case: it is what a
 * first-time visitor has, and it means "no measurement".
 */
export type AnalyticsConsentState = AnalyticsConsentDecision | 'unset';

/** The browser signals that force the non-tracking state. */
export type AnalyticsConsentOffSwitch = 'do-not-track' | 'global-privacy-control';

/** The subset of the `Storage` interface this module uses. */
export interface AnalyticsConsentStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** The resolved answer plus the reason it is the answer. */
export interface ResolvedAnalyticsConsent {
	/** The recorded decision, or `unset`. */
	state: AnalyticsConsentState;
	/** `true` only for an affirmative decision with no off-switch. */
	granted: boolean;
	/** The browser signal that overrode a stored `granted`, if any. */
	offSwitch: AnalyticsConsentOffSwitch | null;
	/** `true` when the value could not be read from storage. */
	storageUnavailable: boolean;
}

/**
 * Parses a stored value into a state.
 *
 * Anything that is not exactly `granted` or `denied` — including
 * `null`, an empty string, whitespace, a hand-edited JSON blob, or a
 * value written by a future version of this module — is `unset`.
 * Trimming is deliberate: a value pasted with a trailing newline is a
 * user typo, not a grant.
 */
export function parseAnalyticsConsent(raw: string | null | undefined): AnalyticsConsentState {
	if (typeof raw !== 'string') return 'unset';
	const value = raw.trim();
	if (value === 'granted' || value === 'denied') return value;
	return 'unset';
}

/**
 * Returns `localStorage` when it is usable, `null` otherwise.
 *
 * Accessing `localStorage` throws in some privacy configurations, so
 * the read itself is inside the try. A caller that passes `null`
 * treats the document as having no stored decision.
 */
export function analyticsConsentStorage(): AnalyticsConsentStorage | null {
	try {
		if (typeof localStorage === 'undefined') return null;
		// Touching the object is what throws when storage is blocked.
		localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
		return localStorage;
	} catch {
		return null;
	}
}

/**
 * Reads the recorded decision. A throwing or absent store is `unset`
 * (no measurement), never a grant.
 */
export function readAnalyticsConsent(
	storage: AnalyticsConsentStorage | null = analyticsConsentStorage(),
): AnalyticsConsentState {
	if (!storage) return 'unset';
	try {
		return parseAnalyticsConsent(storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY));
	} catch {
		return 'unset';
	}
}

/**
 * Records a decision.
 *
 * Returns `false` when the store rejected the write (quota, private
 * mode, blocked storage). The caller must keep the UI consistent with
 * what is actually stored — a "granted" label over an unwritten value
 * would claim measurement that never happens.
 */
export function writeAnalyticsConsent(
	decision: AnalyticsConsentDecision,
	storage: AnalyticsConsentStorage | null = analyticsConsentStorage(),
): boolean {
	if (!storage) return false;
	try {
		storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, decision);
		return true;
	} catch {
		return false;
	}
}

/**
 * The state that must be published for a resolved answer.
 *
 * A stored `granted` under a browser off-switch resolves to
 * `denied` here on purpose: the document-level value answers "may this
 * document measure?", and under Do Not Track the honest answer is no,
 * whatever the stored preference says.
 */
export function effectiveAnalyticsConsentState(
	resolved: ResolvedAnalyticsConsent,
): AnalyticsConsentState {
	if (resolved.granted) return 'granted';
	return resolved.state === 'granted' ? 'denied' : resolved.state;
}

/** The browser signal to honour, or `null` when neither is set. */
export function analyticsOffSwitch(): AnalyticsConsentOffSwitch | null {
	if (typeof navigator === 'undefined') return null;
	if (navigator.globalPrivacyControl === true) return 'global-privacy-control';
	if (navigator.doNotTrack === '1') return 'do-not-track';
	return null;
}

/**
 * Resolves the final answer for this document.
 *
 * The browser signal wins over a stored `granted`. Everything else
 * follows the stored value, and `unset` stays unmeasured.
 */
export function resolveAnalyticsConsent(
	options: {
		storage?: AnalyticsConsentStorage | null;
		offSwitch?: AnalyticsConsentOffSwitch | null;
	} = {},
): ResolvedAnalyticsConsent {
	const storage = options.storage === undefined ? analyticsConsentStorage() : options.storage;
	const offSwitch = options.offSwitch === undefined ? analyticsOffSwitch() : options.offSwitch;
	const state = readAnalyticsConsent(storage);
	return {
		state,
		granted: state === 'granted' && offSwitch === null,
		offSwitch: offSwitch === null ? null : offSwitch,
		storageUnavailable: storage === null,
	};
}

/* ------------------------------------------------------------------------- *
 * Document-scoped consent state
 *
 * `GoogleAnalytics` (the markup) and `trackRoutePageView` (the
 * event emitter) are both called from render and from effects, and
 * neither owns the decision UI. They read the resolved state from one
 * module-level value, exactly as `GoogleAnalytics.tsx` keeps one
 * write-once measurement ID, so a mount site cannot skip the gate by
 * forgetting a prop.
 * ------------------------------------------------------------------------- */

let documentConsent: AnalyticsConsentState = 'unset';

/**
 * Publishes the resolved state for this document.
 *
 * Unlike the measurement-ID capture this is NOT write-once: a visitor
 * may record a decision at any moment, and the value has to follow.
 * It is still only ever set from a resolved decision (the gate's
 * effect), never from a prop that SSR could have guessed.
 */
export function setDocumentAnalyticsConsent(state: AnalyticsConsentState): AnalyticsConsentState {
	documentConsent = state;
	return documentConsent;
}

/** The decision currently in force for this document. */
export function getDocumentAnalyticsConsent(): AnalyticsConsentState {
	return documentConsent;
}

/**
 * The single gate every measurement path consults.
 *
 * `granted` is the only value that measures. A caller that never sets
 * the document state (SSR, a test, a mount site added later) measures
 * nothing, which is the direction a privacy gate has to fail.
 */
export function analyticsMeasurementAllowed(
	state: AnalyticsConsentState = documentConsent,
): boolean {
	return state === 'granted';
}

/**
 * Test seam. Resets the document-scoped decision; production code
 * never calls this.
 */
export function __resetDocumentAnalyticsConsentForTests(): void {
	documentConsent = 'unset';
}
