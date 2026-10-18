import { css, cx } from '../../../styled-system/css';

/**
 * StateMark — the non-colour half of every status / category cue
 * (Issue #411).
 *
 * WCAG 2.2 SC 1.4.1 Use of Color (Level A) forbids conveying
 * information by colour alone. Before this primitive the shipped
 * surfaces carried status / category on the semantic accent layer
 * and nothing else: `home/status` painted `ok` as a filled badge and
 * both failure states as the same neutral pill, and `portfolio`
 * painted its 4px card rule with `accent.category.<facet>` — four
 * hues, one identical bar shape. A visitor with a colour vision
 * deficiency, a monochrome display, or Windows High Contrast forced
 * colours therefore saw the same rectangle for every state.
 *
 * The contract this file owns is the SHAPE vocabulary:
 *
 *   - every kind has a distinct silhouette, so the states stay
 *     separable when hue is removed entirely;
 *   - the mark is decorative (`aria-hidden`). It never carries the
 *     accessible name: the obligation that composes it owns the
 *     wording, and shape + text is what satisfies 1.4.1;
 *   - the mark paints in `currentColor`, i.e. it inherits the colour
 *     of the label it sits next to. It therefore adds no contrast
 *     obligation of its own (1.4.11 stays whatever the surrounding
 *     label already clears) and it can never become the only channel
 *     — a consumer cannot "colour the state back in" through this
 *     prop because there is no tone prop to reach for.
 *
 * Two families, and they are not mixed on one surface: the three
 * status kinds are solid silhouettes (disc / triangle / cross) and
 * the four category kinds are geometric (diamond / square / stacked
 * bars / chevron). A status row shows status; a portfolio card shows
 * category.
 */
export type StateMarkKind =
	| 'ok'
	| 'degraded'
	| 'unreachable'
	| 'design'
	| 'code'
	| 'writing'
	| 'tool';

export interface StateMarkProps {
	kind: StateMarkKind;
	/**
	 * `sm` (8px) is the size a status badge uses — the label beside
	 * it is `fontSize.xs`, so a larger mark would out-weigh the word
	 * that carries the actual state. `md` (12px) is the default and
	 * is what a category rule on a portfolio card uses.
	 */
	size?: 'sm' | 'md';
	className?: string;
}

/** Silhouettes, in a 12×12 frame. `cross` / `chevron` / `bars` are stroked; the rest are filled. */
function shape(kind: StateMarkKind) {
	switch (kind) {
		case 'ok':
			return <circle cx="6" cy="6" r="5" />;
		case 'degraded':
			return (
				<path d="M6 0.9 L11.6 10.7 a0.5 0.5 0 0 1 -0.43 0.75 L0.83 11.45 a0.5 0.5 0 0 1 -0.43 -0.75 Z" />
			);
		case 'unreachable':
			return (
				<path
					d="M2.6 2.6 L9.4 9.4 M9.4 2.6 L2.6 9.4"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.1"
					strokeLinecap="round"
				/>
			);
		case 'design':
			return <path d="M6 0.7 L11.3 6 L6 11.3 L0.7 6 Z" />;
		case 'code':
			return <rect x="0.9" y="0.9" width="10.2" height="10.2" />;
		case 'writing':
			return (
				<>
					<rect x="0.9" y="1.4" width="10.2" height="1.9" rx="0.95" />
					<rect x="0.9" y="5.05" width="10.2" height="1.9" rx="0.95" />
					<rect x="0.9" y="8.7" width="6.4" height="1.9" rx="0.95" />
				</>
			);
		case 'tool':
			return (
				<path
					d="M4.3 2.1 L8.9 6 L4.3 9.9"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.1"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			);
	}
}

export function StateMark({ kind, size = 'md', className }: StateMarkProps) {
	return (
		<svg
			/*
			 * Decorative: the label beside the mark is the accessible
			 * name (1.4.1 is satisfied by shape + text, never by a
			 * shape alone). `focusable="false"` keeps IE / legacy
			 * Edge from putting the svg in the tab order.
			 */
			aria-hidden="true"
			data-state-mark={kind}
			fill="currentColor"
			focusable="false"
			viewBox="0 0 12 12"
			xmlns="http://www.w3.org/2000/svg"
			className={cx(
				css({
					display: 'block',
					flexShrink: '0',
					width: size === 'sm' ? '2' : '3',
					height: size === 'sm' ? '2' : '3',
				}),
				className,
			)}
		>
			{shape(kind)}
		</svg>
	);
}
