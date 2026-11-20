import { css } from '../../../styled-system/css';

/**
 * SkipLink — the shared "skip to main content" affordance (Issue #1109).
 *
 * Every public page renders the same visually-hidden-until-focused
 * anchor as its first focusable element. It lived as a copy-pasted
 * `skipLinkStyle` const (or an inline `css()` call) in each page
 * file, which is why the UI contract counted the same `<a>` control
 * violation once per route. The style is a platform invariant —
 * off-canvas until `:focus-visible`, then pinned top-left on the
 * canvas colour with the shared focus ring — so it is owned here
 * once, inside the exempt definition side of the contract.
 *
 * The default target is `#main`: most pages' `<main id="main">` is
 * the skip destination. Pages whose landmark carries a different id
 * (e.g. `#portfolio-detail`) pass it through `href`.
 */
export function SkipLink({ href = '#main' }: { href?: string }) {
	return (
		<a
			href={href}
			className={css({
				position: 'absolute',
				left: '0',
				top: '0',
				padding: '2',
				backgroundColor: 'bg.canvas',
				color: 'text.default',
				textDecoration: 'none',
				transform: 'translateY(-200%)',
				_focusVisible: {
					transform: 'translateY(0)',
					outline: '2px solid {colors.border.focus}',
					outlineOffset: '2px',
				},
			})}
		>
			本文へスキップ
		</a>
	);
}
