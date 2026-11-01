import { useSyncExternalStore } from 'react';

/**
 * reduced-motion — the shipped policy for honouring an OS-level
 * "reduce motion" preference (Issue #403).
 *
 * Why this lives in `editorial`
 * ----------------------------
 * The decision "what moves, and what the page shows instead when the
 * visitor asked for less motion" is a visual-language decision, so it
 * belongs with the obligation that owns the visual language
 * (`src/editorial/`: tokens, semantic tokens, primitives). Every
 * consumer — `home`, `portfolio`, `routes` — reads this contract from
 * here, so none of them has to know about any other surface's motion.
 *
 * The obligation, in one sentence: **a value or an operation state is
 * carried by the resting document, never by the animation that
 * decorates it.** Turning motion off must therefore change how the
 * page *moves*, never what it *says*.
 *
 * Two layers, both required
 * -------------------------
 *   1. The stylesheet floor (`src/styles.css`): inside
 *      `@media (prefers-reduced-motion: reduce)` every animated /
 *      transitioned box is reduced to an effectively instantaneous
 *      state change and `scroll-behavior` is forced back to `auto`.
 *      This is the backstop for motion the platform has not
 *      classified yet.
 *   2. The component opt-out (this module + `data-motion`): a
 *      component that creates motion decides *at render time* not to
 *      create it, so no `animation-name` is emitted at all, and the
 *      same component's resting markup is what both modes render.
 *
 * The backstop alone is not enough (it cannot be asserted from a unit
 * test, and a JS-driven animation would keep running), and the
 * component opt-out alone is not enough (a future `animationName` on a
 * surface nobody reviewed would ship unguarded). `scripts/check-reduced-motion.mjs`
 * enforces both, and is part of `validate:fast`.
 *
 * Accessibility mapping (WCAG 2.2)
 * --------------------------------
 *   - 2.2.2 Pause, Stop, Hide (A): moving content that starts
 *     automatically and runs longer than five seconds must be
 *     pausable. The platform ships no such content; the gate refuses
 *     an autoplaying `<video>` / `<audio>` so the question cannot be
 *     answered "no" by accident later.
 *   - 2.3.3 Animation from Interactions (AAA): noted because it is the
 *     success criterion most often cited for this work, and it is
 *     **not** A/AA — the A/AA obligations this change carries are
 *     1.4.13 / 4.1.2 (state is readable, not merely animatable) and
 *     the 2.2.2 floor above.
 */

/**
 * The media query the platform treats as "the visitor asked for less
 * motion". Exported so a capture script, a test, or a stylesheet
 * comment names the same string the browser is asked about.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Attribute a motion-bearing element carries so the stylesheet can
 * opt that element out without naming a `data-testid` (presentation
 * must not depend on a test hook) and without a generated utility
 * class (which would move every time the Panda recipe is refactored).
 *
 * `data-motion="<name>"` is paired with a selector inside the
 * reduced-motion block of `src/styles.css`; the pairing is verified by
 * `scripts/check-reduced-motion.mjs`.
 */
export const MOTION_HOOK_ATTRIBUTE = 'data-motion';

/**
 * The name a component uses when the preference decision is passed
 * DOWN to it rather than read again.
 *
 * `CounterTile` reads the hook itself; the digit strip it renders is
 * handed the answer as `reducedMotion` and therefore never asks the
 * media query twice. A component may only spell that parameter this
 * way: `scripts/check-reduced-motion.mjs` verifies a motion surface
 * against `usePrefersReducedMotion()` **or** against this name, so a
 * prop called `quiet` (or no prop at all) is reported as a surface
 * that animates regardless of the visitor's preference.
 */
export const REDUCED_MOTION_PROP = 'reducedMotion';

/** The `data-motion` value the access counter's digit roll-up uses. */
export const COUNTER_ROLL_MOTION = 'counter-roll';

/**
 * The `data-motion` value the companion character's greeting uses
 * (Issue #274).
 *
 * Unlike `COUNTER_ROLL_MOTION`, this one is never automatic: the frame
 * strip is still until a visitor presses the trigger, plays once, and
 * returns to the still frame. Under reduced motion the component emits
 * neither the strip nor the trigger, so this hook has no element to
 * name — the stylesheet selector is the backstop for markup produced
 * without a client preference read (an SSR document replayed from
 * cache, a Storybook build that pinned nothing).
 */
export const PET_REACTION_MOTION = 'pet-reaction';

/**
 * Read the preference once, outside React.
 *
 * Returns `false` wherever the query cannot be asked — the Worker
 * runtime, `renderToStaticMarkup`, a Node test. The server snapshot is
 * "motion allowed" rather than "motion reduced" on purpose: the SSR
 * document is one static artefact, and the client re-reads the real
 * preference during hydration, so the reduced-motion visitor gets the
 * reduced markup and everybody else gets the animated markup without
 * a hydration mismatch (`useSyncExternalStore` handles the difference
 * as the ordinary store update it is).
 */
export function prefersReducedMotion(): boolean {
	if (typeof globalThis.matchMedia !== 'function') return false;
	try {
		return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
	} catch {
		// A `matchMedia` implementation that throws is a broken
		// environment, not a reason to blank the page: fall back to
		// "motion allowed" exactly like the non-browser path.
		return false;
	}
}

/**
 * Subscribe to preference changes (the visitor flipped the OS setting
 * while the page was open). Returns an unsubscribe function; the
 * module-level identity keeps `useSyncExternalStore` from
 * re-subscribing on every render.
 */
export function subscribeToReducedMotion(onStoreChange: () => void): () => void {
	if (typeof globalThis.matchMedia !== 'function') return () => {};
	const query = globalThis.matchMedia(REDUCED_MOTION_QUERY);
	query.addEventListener('change', onStoreChange);
	return () => query.removeEventListener('change', onStoreChange);
}

/** SSR snapshot — see `prefersReducedMotion` for why it is `false`. */
function getServerReducedMotion(): boolean {
	return false;
}

/**
 * `true` when the visitor asked for reduced motion.
 *
 * Used by a component that creates motion: the component then renders
 * its resting markup and emits no `animation-name` at all, so the
 * reduced-motion document is byte-comparable with the final frame of
 * the animated one.
 */
export function usePrefersReducedMotion(): boolean {
	return useSyncExternalStore(
		subscribeToReducedMotion,
		prefersReducedMotion,
		getServerReducedMotion,
	);
}

/**
 * Resolve an explicit override against the live preference.
 *
 * A Storybook fixture and a unit test need a deterministic answer that
 * does not depend on the machine rendering them; production callers
 * pass nothing and get the live query.
 */
export function resolveReducedMotion(override?: boolean): boolean {
	return override ?? prefersReducedMotion();
}
