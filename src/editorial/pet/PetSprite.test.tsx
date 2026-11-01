import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PetSprite } from './PetSprite';

/**
 * PetSprite — the contract the two shipped surfaces depend on
 * (Issue #274).
 *
 * What these assertions can prove
 * -------------------------------
 * Static markup only (the workerd pool has no DOM), which is the half
 * that matters for the overlay's *resting* form:
 *
 *   - the character is DECORATIVE — the root is `aria-hidden="true"`
 *     with no `role` / `tabindex`, every image is `alt=""`, and there is
 *     no focusable descendant. The owner asked for no button, and a
 *     focusable element inside `aria-hidden` would be an invalid tree;
 *   - the resting render is the committed idle cell at its intrinsic
 *     96 x 104, so nothing shifts when a reaction swaps the image;
 *   - the only image in the server document is the idle cell: the
 *     greeting / gaze / travel strips are fetched when a pose first
 *     needs them, not on page load;
 *   - the box carries the `data-motion` hook the stylesheet opt-out and
 *     `scripts/check-reduced-motion.mjs` both name;
 *   - under reduced motion the markup is the same resting frame — the
 *     automatic reactions are never started (their decisions live in
 *     `./reactions.ts`, and `reactions.test.ts` pins that the same
 *     `reducedMotion` argument turns each one off).
 *
 * What they cannot prove: that the strip frames line up under the CSS
 * `steps()` animation, that the drag tracks a pointer, or that the
 * character is recognisable at 96 px. Those are browser questions and
 * live with the visual evidence in `docs/domain/pet-companion.md`.
 *
 * The behaviours that need a live browser are pinned as DECISIONS in
 * `./reactions.test.ts` (drag threshold and direction, scroll gaze,
 * pointer gaze, reduced-motion silence) and as arithmetic in
 * `./position.test.ts` (clamping, persistence, unusable storage).
 */

function markup(props: { reducedMotion?: boolean } = {}): string {
	return renderToStaticMarkup(<PetSprite {...props} />);
}

/** Every image element in a fragment of markup. */
function images(html: string): string[] {
	return html.match(/<img\b[^>]*>/g) ?? [];
}

describe('PetSprite (Issue #274)', () => {
	it('renders a floating overlay, not a section of the page', () => {
		const html = markup();
		// `position: fixed` is what makes it follow the scroll instead of
		// belonging to the flow. The class name is generated, so the
		// assertion is on the rendered transform/inset style the server
		// emits before any drag.
		expect(html).toContain('inset-inline-end:24px');
		// The resting bottom inset is lifted above the analytics-consent
		// toggle (a 36 px button 12 px off the bottom edge): at the plain
		// 24 px corner the decorative overlay covered part of that real
		// control. This is a browser measurement — the numbers live in
		// `REST_INSET_BLOCK_END` and in
		// `docs/verification/visual/pet-companion/`.
		expect(html).toContain('inset-block-end:72px');
	});

	it('hides the whole overlay from assistive technology and offers no control', () => {
		const html = markup();
		expect(html).toContain('aria-hidden="true"');
		expect(html).not.toContain('<button');
		expect(html).not.toContain('tabindex');
		expect(html).not.toContain('tabIndex');
		expect(html).not.toContain('role="');
	});

	it('keeps every image decorative', () => {
		const tags = images(markup());
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) {
			expect(tag).toContain('alt=""');
			expect(tag).toContain('aria-hidden="true"');
		}
	});

	it('names the frame with the contract motion hook', () => {
		// The constant lives in `src/editorial/reduced-motion.ts`; writing
		// the literal here would let the stylesheet selector and the
		// component drift apart without either gate noticing.
		expect(markup()).toContain('data-motion="pet-reaction"');
	});

	it('reserves the frame at its intrinsic size so decoding cannot shift layout', () => {
		const [resting] = images(markup());
		expect(resting).toContain('width="96"');
		expect(resting).toContain('height="104"');
		expect(resting).toContain('/pets/melty/idle-rest.webp');
	});

	it('loads only the resting frame on the server document', () => {
		// The strips are fetched by the pose that needs them: a reader who
		// never drags never downloads 25 kB of travel frames.
		const html = markup();
		for (const asset of [
			'waving.webp',
			'running-right.webp',
			'running-left.webp',
			'look-up.webp',
			'look-right.webp',
			'look-down.webp',
			'look-left.webp',
		]) {
			expect(html).not.toContain(asset);
		}
	});

	it('lazy-loads and deprioritises the image', () => {
		for (const tag of images(markup())) {
			expect(tag).toContain('loading="lazy"');
			expect(tag).toContain('decoding="async"');
			expect(tag).toMatch(/fetchpriority="low"/i);
		}
	});

	it('renders the same resting frame under reduced motion', () => {
		const html = markup({ reducedMotion: true });
		expect(html).toContain('/pets/melty/idle-rest.webp');
		expect(html).not.toContain('waving.webp');
		expect(html).not.toContain('running-right.webp');
		expect(html).not.toContain('<button');
	});
});
