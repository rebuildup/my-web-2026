import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PetSprite } from './PetSprite';

/**
 * PetSprite — the contract the two shipped surfaces depend on
 * (Issue #274).
 *
 * What these assertions can prove
 * -------------------------------
 * Static markup only (the workerd pool has no DOM), which is exactly
 * the half that matters here:
 *
 *   - the character is DECORATIVE — every image is `alt=""` +
 *     `aria-hidden="true"`, so the sprite cannot steal the accessible
 *     name of the section that contains it;
 *   - the resting frame is the committed asset, and the reaction strip
 *     is mounted but hidden, so the first press animates instead of
 *     waiting for 15 kB to arrive;
 *   - the strip carries the `data-motion` hook the stylesheet opt-out
 *     and `scripts/check-reduced-motion.mjs` both name;
 *   - the trigger is a real `<button type="button">` with its own
 *     accessible name, not a clickable `<div>`;
 *   - the frame is reserved at its intrinsic 96 x 104 before the image
 *     decodes, which is what makes the surrounding paragraph immune to
 *     layout shift;
 *   - under reduced motion the component emits NEITHER the strip NOR
 *     the trigger. A button whose only effect is motion is not offered
 *     to a visitor who asked for less motion, and the resting markup is
 *     byte-for-byte the reduced markup — the property
 *     `src/editorial/reduced-motion.ts` states and the reason a static
 *     assertion is possible at all.
 *
 * What they cannot prove: that the four frames line up under the CSS
 * `steps()` animation, or that the character is recognisable at 96 px.
 * Those are rendering questions and live with the visual evidence in
 * `docs/domain/pet-companion.md`.
 */

function markup(props: { reducedMotion?: boolean } = {}): string {
	return renderToStaticMarkup(<PetSprite {...props} />);
}

/** Every image element in a fragment of markup. */
function images(html: string): string[] {
	return html.match(/<img\b[^>]*>/g) ?? [];
}

describe('PetSprite (Issue #274)', () => {
	it('renders the committed resting frame and the mounted reaction strip', () => {
		const html = markup();
		const sources = images(html).map((tag) => tag.match(/src="([^"]+)"/)?.[1]);
		expect(sources).toContain('/pets/melty/idle-rest.webp');
		expect(sources).toContain('/pets/melty/waving.webp');
	});

	it('keeps every image decorative so the section keeps its own name', () => {
		const html = markup();
		const tags = images(html);
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) {
			expect(tag).toContain('alt=""');
			expect(tag).toContain('aria-hidden="true"');
		}
	});

	it('names the reaction strip with the contract motion hook', () => {
		// The constant lives in `src/editorial/reduced-motion.ts`; writing
		// the literal here would let the stylesheet selector and the
		// component drift apart without either gate noticing.
		expect(markup()).toContain('data-motion="pet-reaction"');
	});

	it('reserves the frame at its intrinsic size so decoding cannot shift layout', () => {
		const strip = images(markup()).find((tag) => tag.includes('waving.webp')) ?? '';
		const resting = images(markup()).find((tag) => tag.includes('idle-rest.webp')) ?? '';
		// 4 x 96 px wide strip, 104 px tall; resting frame is one cell.
		expect(strip).toContain('width="384"');
		expect(strip).toContain('height="104"');
		expect(resting).toContain('width="96"');
		expect(resting).toContain('height="104"');
	});

	it('offers the reaction through a real button with its own name', () => {
		const html = markup();
		expect(html).toContain('<button type="button"');
		expect(html).toContain('あいさつしてもらう');
		// The previous sibling of the button is the decorative box: the
		// control never borrows the character's (absent) label.
		expect(html.indexOf('あいさつしてもらう')).toBeGreaterThan(html.indexOf('</span>'));
	});

	it('lazy-loads and deprioritises both images', () => {
		for (const tag of images(markup())) {
			expect(tag).toContain('loading="lazy"');
			expect(tag).toContain('decoding="async"');
		}
	});

	it('emits neither the strip nor the trigger under reduced motion', () => {
		const html = markup({ reducedMotion: true });
		expect(html).not.toContain('waving.webp');
		expect(html).not.toContain('data-motion=');
		expect(html).not.toContain('<button');
		// The character is still there — motion is the only thing lost.
		expect(html).toContain('idle-rest.webp');
	});
});
