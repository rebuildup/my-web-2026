import { css } from '../../../styled-system/css';
import { Container } from '../primitives/Container';

/**
 * The published copy of the waiting surface (Issue #489).
 *
 * Kept as a constant, next to the component, for the same reason
 * `src/editorial/error-states/contract.ts` keeps its copy in a constant:
 * the wording is an editorial decision that changes when the
 * published-information policy changes, not when the palette changes.
 *
 * Copy rules applied here, identical to the failure surfaces':
 *   - Japanese first, ` / `, English.
 *   - No apology theatre, no ETA the platform cannot know, no blame,
 *     and no fabricated personal data.
 *   - It states the CONDITION ("the page has not answered yet"), which
 *     is what a visitor can observe, and never names a binding, a
 *     request id or an upstream service.
 */
export const WAITING_STATE_COPY = Object.freeze({
	eyebrow: '読み込み中 / Loading',
	headline: 'ページを読み込んでいます / Loading this page',
	description:
		'通信がゆっくり、または応答がまだ返っていません。準備ができたページがここに表示されます。そのまま待てない場合は、同じページを開き直せます。 / The connection is slow, or this page has not answered yet. It appears here as soon as it is ready. If you would rather not wait, you can request it again.',
	retry: '再試行する / Try again',
});

export interface WaitingSurfaceProps {
	/**
	 * href of the retry control — the URL the visitor is waiting for.
	 *
	 * Always a plain `<a href>`, never a click handler: the waiting
	 * surface exists precisely because the router's data layer has not
	 * answered, so the way out must not depend on the router. This is the
	 * same rule `src/editorial/error-states/ErrorState.tsx` states for
	 * its recovery controls, and for the same reason — a hydrated retry
	 * that re-uses a stalled data layer would reproduce the stall.
	 */
	retryHref: string;
}

/**
 * WaitingSurface — what the outlet shows while a page is still being
 * fetched (Issue #489).
 *
 * Why it exists
 * -------------
 * TanStack Router renders `route.options.pendingComponent ?? router.options
 * .defaultPendingComponent` for a match whose status is `pending`, and
 * renders NOTHING when neither is set. Before this component existed the
 * platform set neither, so a client-side navigation under a slow link
 * left the visitor looking at the PREVIOUS page under a URL that had
 * already changed, for as long as the new route took to arrive. Measured
 * on `release-0-7-0`: 4.1s of that state on a 4s cold route download and
 * 12.1s on a stall — see `docs/verification/perf/slow-network-state.md`.
 *
 * What it publishes
 * -----------------
 * The condition, and a way out. Nothing else: no elapsed time, no
 * progress percentage, no retry counter. A spinner that does not spin,
 * or a "0%" that never moves, is worse than a sentence, and a visitor
 * who cannot tell a slow page from a broken one cannot decide whether to
 * stay.
 *
 * Why it is a STATUS region
 * -------------------------
 * `<output>` carries the implicit polite-live-region role (`status`) in
 * the HTML-AAM mapping, and it is what this platform already ships for
 * a polite status message (`src/admin/images/images.tsx`,
 * `src/external-api/ExternalReadCard.tsx`), so the announcement behaves
 * identically wherever a visitor meets one. The region also carries
 * `aria-busy="true"`, which is the honest state — its content is about to
 * be replaced by the page itself.
 *
 * No heading element, on purpose. The waiting surface is NOT the page;
 * it is a message about a page that has not rendered yet. Emitting an
 * `<h1>` would put a document outline in place for a second and then
 * take it away, and the destination brings its own headings when it
 * settles.
 *
 * No motion. A pulsing bar or a rotating glyph would be a motion surface
 * that `scripts/check-reduced-motion.mjs` (`validate:fast`) governs, for
 * a state that has to be legible on the slowest possible link: a
 * decoration that needs a 60fps budget is decoration a stalled page
 * cannot afford.
 */
export function WaitingSurface({ retryHref }: WaitingSurfaceProps) {
	return (
		<Container>
			<section
				aria-busy="true"
				data-testid="waiting-state"
				data-waiting-surface="router-pending"
				className={css({
					paddingBlock: { base: '16', lg: '32' },
					maxWidth: '720px',
				})}
			>
				<output
					data-waiting-eyebrow
					className={css({
						margin: '0',
						display: 'block',
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					{WAITING_STATE_COPY.eyebrow}
				</output>
				<p
					data-waiting-headline
					className={css({
						margin: '0',
						marginBlockStart: '2',
						fontFamily: 'heading',
						fontSize: { base: 'xl', lg: '2xl' },
						fontWeight: '700',
						lineHeight: '1.2',
						letterSpacing: '-0.02em',
						color: 'text.default',
						textWrap: 'balance',
					})}
				>
					{WAITING_STATE_COPY.headline}
				</p>
				<p
					data-waiting-description
					className={css({
						margin: '0',
						marginBlockStart: '4',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.6',
						color: 'text.muted',
						textWrap: 'pretty',
					})}
				>
					{WAITING_STATE_COPY.description}
				</p>
				<p
					className={css({
						margin: '0',
						marginBlockStart: '6',
						display: 'flex',
						flexWrap: 'wrap',
						gap: '2',
					})}
				>
					<a
						href={retryHref}
						data-waiting-action="retry"
						className={css({
							display: 'inline-flex',
							alignItems: 'center',
							minHeight: '10',
							paddingInline: '4',
							borderRadius: 'md',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: 'border.subtle',
							fontFamily: 'sans',
							fontSize: 'sm',
							fontWeight: '600',
							color: 'text.default',
							textDecoration: 'none',
							_hover: { borderColor: 'border.strong', textDecoration: 'underline' },
							_focusVisible: {
								outline: '2px solid {colors.border.focus}',
								outlineOffset: '2px',
							},
						})}
					>
						{WAITING_STATE_COPY.retry}
					</a>
				</p>
			</section>
		</Container>
	);
}
