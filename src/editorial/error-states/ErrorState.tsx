import { css, cx } from '../../../styled-system/css';
import { Container } from '../primitives/Container';
import type { ErrorStateAlternative, ErrorStateKind, ErrorStateRecoveryAction } from './contract';
import { alternativesFor, errorStateDefinition } from './contract';

/**
 * ErrorState — the shared shell every failure surface renders.
 *
 * One component, three bindings (`NotFoundState`,
 * `ServiceUnavailableState`, `DependencyFailureState`). The shell owns
 * the layout, the action vocabulary and the progressive-enhancement
 * rules; the copy and the action set come from `./contract`.
 *
 * Full-document links, not router links (Issue #501)
 * -------------------------------------------------
 * Every affordance is a plain `<a href>`, never TanStack Router's
 * `<Link>`. A failure surface exists precisely when the router's data
 * layer did not deliver, so the escape hatch must not depend on the
 * router: a client-side `<Link>` click inside a broken loader can fail
 * the same way the page did.
 *
 * NO control carries a click handler, and that is a contract rather
 * than an omission:
 *
 *   - `retry` re-requests the URL that failed (its pathname plus the
 *     router's canonical search string) as a document navigation.
 *   - `back` is an `<a href={backHref}>` — the site home by default.
 *
 * A wired retry handler was tried and removed. The only hook the
 * framework offers is `CatchBoundary#reset`, and it clears local React
 * state without touching the router: `MatchInner` then re-reads the
 * same `status: 'error'` match and re-throws it, so the click did
 * nothing at all. `router.invalidate()` would re-run the loaders, but
 * it re-runs EVERY active loader and blanks the surface into a pending
 * outlet — a worse answer to "can I get out of here" than a navigation
 * that re-runs the whole SSR pipeline and cannot itself fail the way
 * the page did.
 *
 * The consequence is one rule instead of two: every recovery control
 * behaves identically before hydration, after hydration, and with
 * scripting disabled. `error-states.test.tsx` walks the rendered
 * element tree and asserts that no recovery anchor carries `onClick`.
 *
 * No error value is accepted as a prop, so there is no code path that
 * could render a throwable's message or stack.
 */

export interface ErrorStateProps {
	kind: ErrorStateKind;
	/**
	 * href the retry anchor points at. `src/router.tsx` passes the failed
	 * URL's pathname plus the router's canonical search string, so the
	 * retry keeps the query the visitor arrived with. Defaults to the
	 * site home for a caller that has no failed URL in hand.
	 */
	retryHref?: string;
	/**
	 * href the back anchor points at — the way out of a failure
	 * surface for a visitor with no in-app history (direct entry, a
	 * crawler, a fresh tab). Defaults to the site home.
	 */
	backHref?: string;
	/**
	 * Alternative surfaces. Defaults to the contract list for the kind
	 * (the whole public roster for 404, the dependency-free subset for
	 * the failure states). Callers may narrow it; they may not widen it
	 * beyond surfaces that exist — see `./contract`.
	 */
	alternatives?: readonly ErrorStateAlternative[];
}

const TONE_STATUS_CLASS = {
	neutral: css({ color: 'text.muted' }),
	warning: css({ color: 'accent.warning' }),
	negative: css({ color: 'accent.negative' }),
} as const;

const actionClassName = css({
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
	backgroundColor: 'bg.canvas',
	_hover: { borderColor: 'border.strong', textDecoration: 'underline' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

export function ErrorState({
	kind,
	retryHref = '/',
	backHref = '/',
	alternatives,
}: ErrorStateProps) {
	const definition = errorStateDefinition(kind);
	const alternativeLinks = alternatives ?? alternativesFor(kind);
	const headingId = `error-state-${kind}-heading`;
	const descriptionId = `error-state-${kind}-description`;

	return (
		<Container>
			{/* The region names itself with the headline the visitor reads,
			    and points at the explanation as its description, so the whole
			    message is one navigable/announced unit (the ids are what make
			    the two attributes mean anything). */}
			<section
				aria-labelledby={headingId}
				aria-describedby={descriptionId}
				data-testid={`error-state-${kind}`}
				data-error-state={kind}
				className={css({
					paddingBlock: { base: '16', lg: '32' },
					maxWidth: '720px',
				})}
			>
				<p
					className={css({
						margin: '0',
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					{definition.eyebrow} / {definition.statusLabel}
				</p>
				<h1
					id={headingId}
					className={css({
						margin: '0',
						marginBlockStart: '2',
						fontFamily: 'heading',
						fontSize: { base: '2xl', lg: '3xl' },
						fontWeight: '700',
						lineHeight: '1.15',
						letterSpacing: '-0.025em',
						textWrap: 'balance',
						color: 'text.default',
					})}
				>
					{definition.headline}
				</h1>
				<p
					id={descriptionId}
					data-error-state-description
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
					{definition.description}
				</p>
				<div
					className={css({
						marginBlockStart: '6',
						paddingBlockStart: '4',
						borderTop: '1px solid {colors.border.subtle}',
					})}
				>
					<p
						data-error-state-status
						className={css({
							margin: '0',
							display: 'flex',
							alignItems: 'baseline',
							gap: '2',
							flexWrap: 'wrap',
							fontFamily: 'sans',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						<span
							className={cx(
								css({ fontFamily: 'mono', fontWeight: '600' }),
								TONE_STATUS_CLASS[definition.tone],
							)}
						>
							{definition.statusLabel}
						</span>
						<span>{definition.condition}</span>
					</p>
					<RecoveryActions
						actions={definition.recovery}
						retryHref={retryHref}
						backHref={backHref}
					/>
					{definition.alternativesNote ? (
						<p
							data-error-state-alternatives-note
							className={css({
								margin: '0',
								marginBlockStart: '6',
								fontFamily: 'sans',
								fontSize: 'sm',
								lineHeight: '1.6',
								color: 'text.muted',
							})}
						>
							{definition.alternativesNote}
						</p>
					) : null}
					<AlternativeList alternatives={alternativeLinks} />
				</div>
			</section>
		</Container>
	);
}

interface RecoveryActionProps {
	actions: readonly ErrorStateRecoveryAction[];
	retryHref: string;
	backHref: string;
}

function RecoveryActions({ actions, retryHref, backHref }: RecoveryActionProps) {
	const rendered = actions.filter((action) => action !== 'alternative');
	if (rendered.length === 0) return null;
	return (
		<nav aria-label="復旧 / Recovery" data-error-state-recovery>
			<ul
				className={css({
					margin: '0',
					marginBlockStart: '2',
					padding: '0',
					listStyle: 'none',
					display: 'flex',
					flexWrap: 'wrap',
					gap: '2',
				})}
			>
				{rendered.map((action) =>
					action === 'retry' ? (
						<li key={action}>
							{/* No onClick: the click must stay a real navigation,
							    so the retry works the same before hydration,
							    after hydration and with scripting off. See the
							    module comment for what was tried and dropped. */}
							<a href={retryHref} data-error-action="retry" className={actionClassName}>
								再試行する / Try again
							</a>
						</li>
					) : (
						<li key={action}>
							<a href={backHref} data-error-action="back" className={actionClassName}>
								ホームへ戻る / Back to home
							</a>
						</li>
					),
				)}
			</ul>
		</nav>
	);
}

function AlternativeList({ alternatives }: { alternatives: readonly ErrorStateAlternative[] }) {
	if (alternatives.length === 0) return null;
	return (
		<>
			<h2
				className={css({
					margin: '0',
					marginBlockStart: '6',
					fontFamily: 'sans',
					fontSize: 'sm',
					fontWeight: '600',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				開けるページ / Surfaces you can open
			</h2>
			<ul
				data-error-state-alternatives
				className={css({
					margin: '0',
					marginBlockStart: '2',
					padding: '0',
					listStyle: 'none',
					display: 'flex',
					flexWrap: 'wrap',
					gap: '2',
				})}
			>
				{alternatives.map((alternative) => (
					<li key={alternative.href}>
						<a
							href={alternative.href}
							data-error-action="alternative"
							className={css({
								display: 'inline-flex',
								alignItems: 'center',
								minHeight: '8',
								paddingInline: '3',
								borderRadius: 'md',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: 'border.subtle',
								fontFamily: 'sans',
								fontSize: 'sm',
								color: 'text.accent',
								textDecoration: 'underline',
								_hover: { borderColor: 'border.strong', color: 'text.default' },
								_focusVisible: {
									outline: '2px solid {colors.border.focus}',
									outlineOffset: '2px',
								},
							})}
						>
							{alternative.label}
						</a>
					</li>
				))}
			</ul>
		</>
	);
}
