import type { MouseEvent } from 'react';
import { css } from '../../../styled-system/css';
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
 * the same way the page did. Plain anchors also make the two
 * progressive-enhancement rules work without JavaScript:
 *
 *   - `retry` is an `<a href={retryHref}>` that the browser follows as a
 *     normal navigation when no `onRetry` handler is wired (pre-hydration),
 *     and that calls `onRetry` instead once it is.
 *   - `back` is an `<a href={backHref}>` — the site home by default —
 *     and calls `onBack` when one is wired.
 *
 * No error value is accepted as a prop, so there is no code path that
 * could render a throwable's message or stack.
 */

export interface ErrorStateProps {
	kind: ErrorStateKind;
	/**
	 * Re-run the failed request. Wired by the router error boundary
	 * (`reset`). Without it the retry anchor is a plain page reload,
	 * which is also the correct pre-hydration behaviour.
	 */
	onRetry?: () => void;
	/**
	 * href the retry anchor points at. Defaults to the site home; the
	 * root route passes the current pathname so a pre-hydration click
	 * re-requests the page that actually failed.
	 */
	retryHref?: string;
	/**
	 * Return to the previous document. Wired by the router error boundary
	 * so a visitor who navigated within the SPA keeps their place.
	 */
	onBack?: () => void;
	/**
	 * href the back anchor points at when no `onBack` is wired, and the
	 * fallback target of an `onBack` click that cannot run (SSR markup).
	 * Defaults to the site home.
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
	onRetry,
	retryHref = '/',
	onBack,
	backHref = '/',
	alternatives,
}: ErrorStateProps) {
	const definition = errorStateDefinition(kind);
	const alternativeLinks = alternatives ?? alternativesFor(kind);
	const headingId = `error-state-${kind}-heading`;

	return (
		<Container as="section">
			<div
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
							className={css({
								fontFamily: 'mono',
								fontWeight: '600',
								...TONE_STATUS_CLASS[definition.tone],
							})}
						>
							{definition.statusLabel}
						</span>
						<span>{definition.condition}</span>
					</p>
					<RecoveryActions
						actions={definition.recovery}
						retryHref={retryHref}
						backHref={backHref}
						onRetry={onRetry}
						onBack={onBack}
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
			</div>
		</Container>
	);
}

interface RecoveryActionProps {
	actions: readonly ErrorStateRecoveryAction[];
	retryHref: string;
	backHref: string;
	onRetry?: () => void;
	onBack?: () => void;
}

function RecoveryActions({ actions, retryHref, backHref, onRetry, onBack }: RecoveryActionProps) {
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
							<a
								href={retryHref}
								data-error-action="retry"
								className={actionClassName}
								onClick={(event: MouseEvent<HTMLAnchorElement>) => {
									if (!onRetry) return;
									// Progressive enhancement: once a handler is
									// wired, let the router re-run the request
									// instead of navigating the document.
									event.preventDefault();
									onRetry();
								}}
							>
								再試行する / Try again
							</a>
						</li>
					) : (
						<li key={action}>
							<a
								href={backHref}
								data-error-action="back"
								className={actionClassName}
								onClick={(event: MouseEvent<HTMLAnchorElement>) => {
									if (!onBack) return;
									event.preventDefault();
									onBack();
								}}
							>
								{onBack ? '前のページへ戻る / Go back' : 'ホームへ戻る / Back to home'}
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
