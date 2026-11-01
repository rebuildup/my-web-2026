/**
 * The visitor-facing analytics consent surface (Issue #495).
 *
 * Two components, one decision
 * -----------------------------
 * `AnalyticsGate` lives in the document `<head>` and is the ONLY path
 * to GA4 markup: it renders the loader script and the route-change
 * tracker together, and only when `./consent` has resolved an
 * affirmative decision. `AnalyticsConsentControl` lives in the
 * `<body>` and is the only place a decision is recorded.
 *
 * They stay in sync through one `localStorage` key and one window
 * event (`ANALYTICS_CONSENT_CHANGE_EVENT`). A context provider was
 * rejected deliberately: the two consumers render in different parts
 * of the document, and a provider that has to wrap both `<head>` and
 * `<body>` would own the document shell — a page-composition decision
 * this Issue does not make.
 *
 * SSR renders neither
 * -------------------
 * `useEffect` does not run on the server, so the first server render
 * and the first client render both produce nothing: there is no
 * hydration mismatch, and a crawler or a visitor whose JavaScript
 * never runs is never measured and never prompted. Measurement
 * therefore starts strictly after hydration and strictly after a
 * stored `granted` — there is no code path where GA4 loads before the
 * visitor is asked.
 *
 * Refusing is a first-class state, not an error
 * ---------------------------------------------
 * `AnalyticsConsentPanel` renders a confirmation of the recorded
 * state and a way back into the choice. Nothing about the page changes
 * with the decision: this component never disables navigation, never
 * blocks input, and never re-renders a route. The integration suite
 * (`test/integration/analytics-consent.test.ts`) proves the no-script
 * half at the request level.
 *
 * A refusal is also enforced against a tag that is already running.
 * The decision path calls `revokeAnalyticsMeasurement()` before it
 * announces the change, so the copy can say the measurement stops
 * instead of only that nothing new is loaded. A store that refuses
 * the write is treated the same way: nothing was recorded, so
 * nothing is measured, and the panel reports the failure rather than
 * the state it could not persist.
 *
 * The browser signal is reported, not hidden
 * -------------------------------------------
 * When Do Not Track / Global Privacy Control is on, the panel says the
 * measurement is off because of the browser setting and offers no
 * override. The signal is a browser fact, not a legal conclusion, and
 * the copy deliberately stops there (see `docs/verification/privacy/
 * analytics-disabled.md`).
 *
 * Two senders, named as two (Issue #662)
 * ---------------------------------------
 * The copy says what reaches GA4 (path, referrer, browser / device
 * information) and names the two routes it travels: the values this
 * site’s own code sends explicitly (the measurement id and the path),
 * and GA4’s own automatic collection. The published data lifecycle
 * registry (`src/privacy/data-lifecycle.ts`) splits the same transfer
 * the same way, so the two public surfaces cannot contradict each
 * other: the banner names what arrives, the registry names who sends
 * what. The banner’s factual claim about GA4’s automatic collection is
 * not weakened by that split.
 */

import { useCallback, useEffect, useState } from 'react';
import { css } from '../../../styled-system/css';
import {
	GoogleAnalytics,
	GoogleAnalyticsRouteTracker,
	allowAnalyticsMeasurement,
	revokeAnalyticsMeasurement,
} from './GoogleAnalytics';
import {
	ANALYTICS_CONSENT_CHANGE_EVENT,
	type ANALYTICS_CONSENT_OFFSET_PROPERTY,
	type AnalyticsConsentDecision,
	type AnalyticsConsentOffSwitch,
	type AnalyticsConsentState,
	type ResolvedAnalyticsConsent,
	effectiveAnalyticsConsentState,
	resolveAnalyticsConsent,
	setDocumentAnalyticsConsent,
	writeAnalyticsConsent,
} from './consent';

/**
 * The custom property that carries this surface's height to the
 * document's focus compensation.
 *
 * Issue #395 (WCAG 2.2 SC 2.4.11 Focus Not Obscured — Minimum, AA): both
 * shapes of this surface are `position: fixed` at the bottom of the
 * viewport, so they are author-created content that can cover a focused
 * element. The browser scrolls a focused element to the edge of the
 * viewport, and the bottom edge is where this surface is.
 *
 * The compensation is a chain, and this file is one end of it: the
 * surface publishes the height it occupies, and `src/styles.css` consumes
 * it as the document's `scroll-padding` and as the room at the end of
 * the document (`body { padding-bottom }`). The browser then keeps a
 * focused element clear of the reserved space when it scrolls it into
 * view. The reserved height follows the rendered surface instead of a
 * guessed number, and with the surface off the page the property is
 * absent and the fallback reserves nothing.
 *
 * The literal is declared HERE, not imported, because
 * `scripts/check-a11y-focus-visible.mjs` closes the chain only when the
 * overlay's OWN file publishes the offset it occupies. The type
 * annotation pins the string to `./consent.ts`, which
 * `src/editorial/pet/PetSprite.tsx` also reads (Issue #274), so a rename
 * on either side is a `typecheck` error rather than silent drift.
 */
const FOCUS_OFFSET_PROPERTY =
	'--analytics-consent-offset' satisfies typeof ANALYTICS_CONSENT_OFFSET_PROPERTY;

/**
 * Publish how much of the viewport this surface occupies.
 *
 * The measurement is re-published when the surface is resized, so a
 * surface whose content changes height (a longer answer, a wrapped
 * label) keeps the compensation honest.
 */
function useFocusOffset(element: HTMLElement | null) {
	useEffect(() => {
		if (!element) return;
		const root = document.documentElement;
		const publish = () => {
			const { height } = element.getBoundingClientRect();
			// `bottom: 3` is a 0.75rem gap above the viewport edge, so the
			// space the surface occupies is that gap plus its own height.
			root.style.setProperty(FOCUS_OFFSET_PROPERTY, `${Math.ceil(height + 12)}px`);
		};
		publish();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(publish);
		observer.observe(element);
		return () => {
			observer.disconnect();
			root.style.removeProperty(FOCUS_OFFSET_PROPERTY);
		};
	}, [element]);
}

/** Copy for the panel. Kept next to the markup so a wording change is one edit. */
export const ANALYTICS_CONSENT_COPY = {
	eyebrow: 'アクセス解析',
	regionLabel: '解析の設定',
	unsetHeadline: 'アクセス解析を有効にしますか',
	unsetDescription:
		'許可すると、Google の解析サービス（GA4）へ、閲覧したページのパス・参照元・ブラウザや端末の情報が送信されます。送信元は 2 つで、このプラットフォームのコードが明示的に送る測定 ID とパス情報、そして GA4 自身が参照元やブラウザや端末の情報を読み取って送る自動収集です。許可していないあいだは何も送信されません。拒否しても、このサイトの表示と操作は変わりません。',
	grantedHeadline: 'アクセス解析が許可されています',
	grantedDescription:
		'許可したあいだは、閲覧したページのパス・参照元・ブラウザや端末の情報が Google の解析サービス（GA4）へ送信されます。送信元は 2 つで、このプラットフォームのコードが明示的に送る測定 ID とパス情報、そして GA4 自身が参照元やブラウザや端末の情報を読み取って送る自動収集です。広告用途の保存は有効にしていません。',
	deniedHeadline: 'アクセス解析は拒否されています',
	deniedDescription:
		'このブラウザでは、以降の計測を停止します。このサイトの表示と操作はこれまでどおりです。',
	offSwitchHeadline: 'ブラウザの設定により解析は停止しています',
	offSwitchDescription:
		'このブラウザは「追跡しない」を指定しています。サイト側の設定より優先して、解析用のスクリプトを読み込みません。',
	storageBlockedHeadline: '設定を保存できませんでした',
	storageBlockedDescription: 'ブラウザが保存領域を無効にしているため、設定を保存できませんでした。',
	storageBlockedStatus: 'このセッションでは計測しません。',
	storageUnavailableDescription:
		'ブラウザの保存領域を利用できないため、設定を読み取れませんでした。設定を選ぶまで計測しません。',
	grantLabel: '許可する',
	denyLabel: '拒否する',
	toggleLabel: '解析の設定',
	grantedStatus: '有効',
	deniedStatus: '無効',
	unsetStatus: '未選択',
} as const;

export interface AnalyticsConsentPanelProps {
	/** The decision in force, already resolved against any browser signal. */
	state: AnalyticsConsentState;
	/** The browser signal that overrode a stored grant, if any. */
	offSwitch: AnalyticsConsentOffSwitch | null;
	/** `true` when the store could not be read or written. */
	storageUnavailable: boolean;
	/** `true` after a write the store rejected. */
	writeFailed: boolean;
	onDecide: (decision: AnalyticsConsentDecision) => void;
}

/**
 * The presentational panel (Issue #495).
 *
 * Exported so the Storybook story and the DOM test can render a state
 * without a `localStorage`, and so every visual state of the decision
 * is reviewable without touching the real site.
 *
 * Accessibility: the panel is a named `<section>`; the status line is
 * an `aria-live="polite"` region so a decision is announced without
 * moving focus; both actions are real `<button>` elements, so keyboard
 * and screen-reader activation are native. When the browser off-switch
 * is on the grant button is replaced by an explanation — the copy
 * never offers an action the code would refuse to perform.
 */
export function AnalyticsConsentPanel({
	state,
	offSwitch,
	storageUnavailable,
	writeFailed,
	onDecide,
}: AnalyticsConsentPanelProps) {
	const headingId = 'analytics-consent-heading';
	const descriptionId = 'analytics-consent-description';
	// The surface is measured so the document can reserve the space it
	// occupies (Issue #395, SC 2.4.11).
	const [surface, setSurface] = useState<HTMLElement | null>(null);
	useFocusOffset(surface);
	// A refused write outranks the recorded state: the browser does not
	// hold the decision, so reporting "許可されています" here would be a
	// claim about a state the visitor no longer has.
	const description = writeFailed
		? ANALYTICS_CONSENT_COPY.storageBlockedDescription
		: offSwitch !== null
			? ANALYTICS_CONSENT_COPY.offSwitchDescription
			: state === 'granted'
				? ANALYTICS_CONSENT_COPY.grantedDescription
				: state === 'denied'
					? ANALYTICS_CONSENT_COPY.deniedDescription
					: ANALYTICS_CONSENT_COPY.unsetDescription;
	const headline = writeFailed
		? ANALYTICS_CONSENT_COPY.storageBlockedHeadline
		: offSwitch !== null
			? ANALYTICS_CONSENT_COPY.offSwitchHeadline
			: state === 'granted'
				? ANALYTICS_CONSENT_COPY.grantedHeadline
				: state === 'denied'
					? ANALYTICS_CONSENT_COPY.deniedHeadline
					: ANALYTICS_CONSENT_COPY.unsetHeadline;
	const statusMessage = writeFailed
		? ANALYTICS_CONSENT_COPY.storageBlockedStatus
		: storageUnavailable && state === 'unset'
			? ANALYTICS_CONSENT_COPY.storageUnavailableDescription
			: '';
	const statusLabel =
		offSwitch !== null || state === 'denied'
			? ANALYTICS_CONSENT_COPY.deniedStatus
			: state === 'granted'
				? ANALYTICS_CONSENT_COPY.grantedStatus
				: ANALYTICS_CONSENT_COPY.unsetStatus;

	return (
		<section
			ref={setSurface}
			aria-labelledby={headingId}
			aria-describedby={descriptionId}
			data-testid="analytics-consent"
			data-analytics-consent={state}
			data-analytics-off-switch={offSwitch ?? 'none'}
			className={css({
				position: 'fixed',
				insetInline: { base: '3', lg: '6' },
				bottom: '3',
				zIndex: '20',
				maxWidth: '560px',
				marginInline: 'auto',
				padding: '4',
				borderRadius: 'lg',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				backgroundColor: 'bg.surface',
				color: 'text.default',
				boxShadow: 'sm',
			})}
		>
			<p
				className={css({
					margin: '0',
					fontFamily: 'mono',
					fontSize: 'xs',
					letterSpacing: '0.06em',
					color: 'text.muted',
				})}
			>
				{ANALYTICS_CONSENT_COPY.eyebrow} / {statusLabel}
			</p>
			<h2
				id={headingId}
				className={css({
					margin: '0',
					marginBlockStart: '2',
					fontFamily: 'heading',
					fontSize: 'md',
					fontWeight: '700',
					lineHeight: '1.3',
					color: 'text.default',
				})}
			>
				{headline}
			</h2>
			<p
				id={descriptionId}
				className={css({
					margin: '0',
					marginBlockStart: '2',
					fontFamily: 'sans',
					fontSize: 'sm',
					lineHeight: '1.7',
					color: 'text.muted',
				})}
			>
				{description}
			</p>
			{/* Status region: the decision and any storage failure are
			    announced politely, and neither moves focus — a visitor who
			    activated a button should keep their place in the page. */}
			<p
				aria-live="polite"
				data-testid="analytics-consent-status"
				className={css({
					margin: '0',
					marginBlockStart: '2',
					fontFamily: 'sans',
					fontSize: 'xs',
					lineHeight: '1.6',
					color: writeFailed ? 'accent.negative' : 'text.muted',
				})}
			>
				{statusMessage}
			</p>
			<div
				className={css({
					marginBlockStart: '4',
					display: 'flex',
					flexWrap: 'wrap',
					gap: '2',
				})}
			>
				{offSwitch === null ? (
					<button
						type="button"
						onClick={() => onDecide('granted')}
						data-testid="analytics-consent-grant"
						className={css({
							minHeight: '10',
							paddingInline: '4',
							borderRadius: 'md',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: 'border.subtle',
							backgroundColor: 'bg.accent',
							color: 'text.inverse',
							fontFamily: 'sans',
							fontSize: 'sm',
							fontWeight: '600',
							cursor: 'pointer',
							_focusVisible: {
								outline: '2px solid {colors.border.focus}',
								outlineOffset: '2px',
							},
						})}
					>
						{ANALYTICS_CONSENT_COPY.grantLabel}
					</button>
				) : null}
				<button
					type="button"
					onClick={() => onDecide('denied')}
					data-testid="analytics-consent-deny"
					className={css({
						minHeight: '10',
						paddingInline: '4',
						borderRadius: 'md',
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: 'border.subtle',
						backgroundColor: 'bg.canvas',
						color: 'text.default',
						fontFamily: 'sans',
						fontSize: 'sm',
						fontWeight: '600',
						cursor: 'pointer',
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '2px',
						},
					})}
				>
					{ANALYTICS_CONSENT_COPY.denyLabel}
				</button>
			</div>
		</section>
	);
}

/**
 * Resolves the document-scoped decision on the client and keeps it in
 * sync with the control's writes.
 *
 * The effect (not the render) publishes the decision, so the value
 * `GoogleAnalytics` reads during render is always one this document
 * resolved from a stored answer.
 */
function useAnalyticsConsentDecision(): ResolvedAnalyticsConsent {
	const [resolved, setResolved] = useState<ResolvedAnalyticsConsent>({
		state: 'unset',
		granted: false,
		offSwitch: null,
		storageUnavailable: false,
	});

	useEffect(() => {
		const apply = () => {
			const next = resolveAnalyticsConsent();
			setDocumentAnalyticsConsent(effectiveAnalyticsConsentState(next));
			setResolved(next);
		};
		apply();
		window.addEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, apply);
		return () => window.removeEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, apply);
	}, []);

	return resolved;
}

export interface AnalyticsGateProps {
	/** GA4 measurement ID from the root loader (Issue #171). */
	measurementId?: string | undefined;
	/** `pathname + searchStr` from `useLocation()`. */
	locationKey: string;
}

/**
 * The measurement gate (Issue #495) — the only path to GA4.
 *
 * The loader script and the route tracker mount together and only
 * after an affirmative decision. Mounting them together is what keeps
 * the one-page_view-per-location invariant true when consent arrives
 * mid-session: the freshly mounted inline `gtag('config', …)` records
 * the current page and the freshly mounted tracker seeds its dedupe
 * state with the same location, so it stays silent for it.
 */
export function AnalyticsGate({ measurementId, locationKey }: AnalyticsGateProps) {
	const { granted } = useAnalyticsConsentDecision();
	if (!granted) return null;
	return (
		<>
			<GoogleAnalytics measurementId={measurementId} />
			<GoogleAnalyticsRouteTracker measurementId={measurementId} locationKey={locationKey} />
		</>
	);
}

/**
 * The consent control (Issue #495) — the only place a decision is
 * recorded.
 *
 * Rendered at the end of `<body>` and on public routes only: `/admin/*`
 * is the operator's own surface and is already excluded from
 * measurement by the mount gate in `src/routes/__root.tsx`, so a
 * consent prompt there would ask a question whose answer is fixed.
 *
 * Before a decision is recorded the panel is expanded; afterwards it
 * collapses to a status line with a control that reopens it, so the
 * visitor can change their mind without a reload and without the
 * panel covering the page.
 */
export function AnalyticsConsentControl() {
	const { state, offSwitch, storageUnavailable } = useAnalyticsConsentDecision();
	const [expanded, setExpanded] = useState(true);
	const [writeFailed, setWriteFailed] = useState(false);
	// A returning visitor who already answered sees the status control,
	// not the full panel. The effect decides rather than the initial
	// state, because the stored answer is unreadable until the mount
	// effect resolves it — starting collapsed would be a guess.
	const decided = state !== 'unset';
	useEffect(() => {
		if (decided) setExpanded(false);
	}, [decided]);
	// Nothing is rendered before hydration: the stored decision is only
	// readable in the browser, so a server render could only show the
	// `unset` panel and would flash it at a visitor who already answered.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	// The collapsed status control is a fixed overlay too, so it publishes
	// its own height for the same compensation (Issue #395, SC 2.4.11).
	const [surface, setSurface] = useState<HTMLElement | null>(null);
	useFocusOffset(surface);

	const decide = useCallback((decision: AnalyticsConsentDecision) => {
		const written = writeAnalyticsConsent(decision);
		setWriteFailed(!written);
		if (!written) {
			// The store refused the value, so nothing was recorded — and
			// that is a non-measuring document. A previous grant may have
			// loaded the tag already, so stop it here rather than waiting
			// for a decision that will never be stored. The panel then
			// says the write failed instead of reporting the old state.
			setDocumentAnalyticsConsent('unset');
			revokeAnalyticsMeasurement();
			return;
		}
		if (decision === 'denied') {
			// The visitor withdrew after the tag may have loaded. Unmounting
			// the React tree does not unload gtag.js, so stop it in place
			// (see `revokeAnalyticsMeasurement`).
			revokeAnalyticsMeasurement();
		} else {
			// A re-grant after a withdrawal has to clear the opt-out flag
			// before the freshly mounted inline `config` runs.
			allowAnalyticsMeasurement();
		}
		setExpanded(false);
		window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_CHANGE_EVENT));
	}, []);

	const statusLabel =
		offSwitch !== null || state === 'denied'
			? ANALYTICS_CONSENT_COPY.deniedStatus
			: state === 'granted'
				? ANALYTICS_CONSENT_COPY.grantedStatus
				: ANALYTICS_CONSENT_COPY.unsetStatus;

	if (!mounted) return null;

	if (expanded) {
		return (
			<AnalyticsConsentPanel
				state={state}
				offSwitch={offSwitch}
				storageUnavailable={storageUnavailable}
				writeFailed={writeFailed}
				onDecide={decide}
			/>
		);
	}

	return (
		<button
			type="button"
			ref={setSurface}
			onClick={() => setExpanded(true)}
			data-testid="analytics-consent-toggle"
			aria-expanded={false}
			className={css({
				position: 'fixed',
				bottom: '3',
				insetInlineEnd: '3',
				minHeight: '9',
				paddingInline: '3',
				borderRadius: 'full',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				backgroundColor: 'bg.surface',
				color: 'text.default',
				fontFamily: 'sans',
				fontSize: 'xs',
				fontWeight: '600',
				cursor: 'pointer',
				_focusVisible: {
					outline: '2px solid {colors.border.focus}',
					outlineOffset: '2px',
				},
			})}
		>
			{ANALYTICS_CONSENT_COPY.toggleLabel}: {statusLabel}
		</button>
	);
}
