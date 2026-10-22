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
 * Why CSS shapes and not an inline `<svg>`
 * ------------------------------------
 * An `<svg>` is the obvious way to draw these and it was the first
 * implementation. It does not survive this repository's own XSS
 * boundary test: `test/fixtures/markdown-xss-fixtures.ts` treats ANY
 * `<svg` inside the rendered article region as executable markup
 * (Issue #451, `<svg onload>`), and the portfolio list renders one
 * card per `<article>` — so a decorative inline svg fails
 * `test/integration/markdown-xss-ssr.test.ts`. Weakening that oracle
 * to admit first-party svg would trade a security invariant for a
 * decorative convenience, so the shapes are drawn with CSS
 * `clip-path` / `border-radius` instead. Each kind is ONE element
 * with no children, which also keeps the per-card DOM cost at one
 * node (`list-scale.test.tsx`).
 *
 * Two families, and they are not mixed on one surface: the four
 * status kinds are compact solid silhouettes (disc / triangle /
 * cross / broken ring) and the four category kinds are geometric
 * (diamond / square / stacked bars / chevron). A status row shows
 * status; a portfolio card shows category.
 *
 * The fourth status kind, `unobserved`, is Issue #502's: the
 * difference between "the read failed" and "there was no read" is
 * exactly the kind of difference a status vocabulary has to be able
 * to draw, because a visitor who cannot tell them apart will read a
 * missing measurement as a fault. It is a ring with a gap — an
 * unfinished observation — and it is never mixed with the category
 * family, so it cannot collide with the portfolio kinds.
 *
 * What is pinned where
 * --------------------
 * `StateMark.test.tsx` compares the RESOLVED silhouette of all seven
 * kinds (inline `clip-path` plus the utility classes), so collapsing
 * two kinds onto one polygon fails there — a `data-state-mark`
 * consumer test cannot see that. Whether two DIFFERENT silhouettes
 * are far enough apart at the shipped 8px to read apart is a
 * rendering question and is answered by the rasterised evidence in
 * `docs/verification/a11y/status-monochrome.md`.
 */
export type StateMarkKind =
	| 'ok'
	| 'degraded'
	| 'unreachable'
	| 'unobserved'
	| 'design'
	| 'code'
	| 'writing'
	| 'tool';

export interface StateMarkProps {
	kind: StateMarkKind;
	/**
	 * `sm` (space token 2 = 8px) is the size both shipped surfaces
	 * render: the status badge and the portfolio card's category row
	 * pass it, because the label beside the mark is `fontSize.xs` and
	 * a larger mark would out-weigh the word that carries the actual
	 * state. `md` (12px) is the default, used where the mark is shown
	 * on its own (the Storybook vocabulary sheet), not on a card.
	 */
	size?: 'sm' | 'md';
	className?: string;
}

/**
 * The silhouette vocabulary.
 *
 * `ok` is a rounded square (`borderRadius: 'full'` — a Panda token);
 * every other kind is a solid `currentColor` block cut into shape by
 * a `clip-path` polygon, whose percentages serve both sizes.
 *
 * Why the polygons are an INLINE style: Panda's `clip-path` utility
 * does not emit an arbitrary polygon value unless the token layer
 * declares a `clipPath` scale, and declaring one would put decorative
 * silhouette geometry into the design-token contract — the tokens own
 * the palette and the spacing ladder, not the shape of a badge glyph.
 * An inline `clipPath` keeps the decision local to the primitive that
 * owns it. (The same reasoning is why `MonochromeProof` sets its
 * `filter` inline rather than as a utility.)
 */
const SHAPE_CLIP: Readonly<Record<StateMarkKind, string | null>> = {
	// Disc — "reachable".
	ok: null,
	// Upward triangle — "degraded".
	degraded: 'polygon(50% 0%, 100% 100%, 0% 100%)',
	// Cross — "unreachable": two diagonal bands in one polygon.
	unreachable: 'polygon(30% 0%, 70% 0%, 50% 25%, 100% 50%, 70% 100%, 30% 100%, 50% 75%, 0% 50%)',
	// Broken ring — "not observed": a disc with a 90° wedge cut out
	// of its right side. The wedge is what separates it from the
	// solid `ok` disc: an unfinished circle reads as "the reading
	// never arrived", which is the fact the status vocabulary has to
	// be able to state (Issue #502). The cut opens toward the badge
	// edge, so the mark still reads as a circle at 8px.
	unobserved:
		'polygon(50% 50%, 85.4% 14.6%, 50% 0%, 14.6% 14.6%, 0% 50%, 14.6% 85.4%, 50% 100%, 85.4% 85.4%)',
	// Diamond — "design".
	design: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
	// Axis-aligned square — "code". No clip needed.
	code: null,
	// Three stacked bars, the third short — "writing" (long-form).
	writing:
		'polygon(0% 0%, 100% 0%, 100% 30%, 0% 30%, 0% 38%, 100% 38%, 100% 68%, 0% 68%, 0% 76%, 60% 76%, 60% 100%, 0% 100%)',
	// Chevron — "tool".
	tool: 'polygon(30% 12%, 55% 12%, 85% 50%, 55% 88%, 30% 88%, 60% 50%)',
};

export function StateMark({ kind, size = 'md', className }: StateMarkProps) {
	const clip = SHAPE_CLIP[kind];
	return (
		<span
			/*
			 * Decorative: the label beside the mark is the accessible
			 * name (1.4.1 is satisfied by shape + text, never by a
			 * shape alone).
			 */
			aria-hidden="true"
			data-state-mark={kind}
			className={cx(
				css({
					display: 'inline-block',
					flexShrink: '0',
					backgroundColor: 'currentColor',
					width: size === 'sm' ? '2' : '3',
					height: size === 'sm' ? '2' : '3',
					...(kind === 'ok' ? { borderRadius: 'full' } : {}),
				}),
				className,
			)}
			style={clip ? { clipPath: clip } : undefined}
		/>
	);
}
