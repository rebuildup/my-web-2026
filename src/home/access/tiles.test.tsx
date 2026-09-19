import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import digit0Url from '../digits/0.webp?url';
import digit1Url from '../digits/1.webp?url';
import digit2Url from '../digits/2.webp?url';
import digit3Url from '../digits/3.webp?url';
import digit4Url from '../digits/4.webp?url';
import digit5Url from '../digits/5.webp?url';
import digit6Url from '../digits/6.webp?url';
import digit7Url from '../digits/7.webp?url';
import digit8Url from '../digits/8.webp?url';
import type { HomeCounterData } from './load';
import { CounterTile } from './tiles';

/**
 * CounterTile — SSR smoke tests. Pure-render, no DOM.
 *
 * Branch 43 — Dashboard KPI shape. The "04 — Access counter" eyebrow
 * and the section description now live on the SectionHeading spread
 * in `composer.tsx`; the tile itself only renders the KPI value
 * (count), delta, period, and last-hit timestamp. Tests assert the
 * new shape — no more "04 — Access counter" or "hits / home-page"
 * inside the tile.
 *
 * 0.3.0 stabilisation pass — odometer-style digit strip. The count
 * is rendered as a *fixed-width* sequence of digit images (7 slots,
 * leading zeros), not as text. The image-swap mechanic + the fixed
 * width is what gives the tile its mechanical-counter feel — see
 * `scripts/generate-counter-digits.mjs` for the rasteriser. Tests
 * assert the slot count and per-slot digit, plus the screen-reader
 * `aria-label` carries the un-padded number with locale formatting.
 *
 * The digit URL imports resolve to the same hashed path Vite emits
 * into the SSR / client bundles; the assertion compares against the
 * import value so the test stays correct as Vite re-hashes assets.
 */

const SLOT_COUNT = 7;

describe('CounterTile', () => {
	it('renders 7 digit slots with leading zeros when count < 10^7', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 1234,
			first_hit: Date.now() - 86_400_000,
			last_hit: Date.now() - 30_000,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		// "0001234" — three zeros followed by 1, 2, 3, 4.
		expect(html).toContain(`src="${digit0Url}"`);
		expect(html).toContain(`src="${digit1Url}"`);
		expect(html).toContain(`src="${digit2Url}"`);
		expect(html).toContain(`src="${digit3Url}"`);
		expect(html).toContain(`src="${digit4Url}"`);
		// Six other digits must NOT appear (slot count is fixed at 7).
		expect(html).not.toContain(`src="${digit5Url}"`);
		// Screen-reader label uses the *un-padded* number with locale
		// formatting so the user hears "1,234 page views", not
		// "zero zero zero one two three four".
		expect(html).toContain('aria-label="1,234 page views"');
		// Secondary metadata is unaffected.
		expect(html).toContain('page views');
		expect(html).toContain('since');
		expect(html).toContain('home-page');
		expect(html).toContain('+1,234 since launch');
		expect(html).toContain('last hit:');
	});

	it('renders the natural decimal expansion (no padding) when count ≥ 10^7', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 12_345_678,
			first_hit: Date.now() - 86_400_000,
			last_hit: Date.now() - 30_000,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		// Eight digit slots visible (no leading zeros, layout grows).
		for (const url of [
			digit1Url,
			digit2Url,
			digit3Url,
			digit4Url,
			digit5Url,
			digit6Url,
			digit7Url,
			digit8Url,
		]) {
			expect(html).toContain(`src="${url}"`);
		}
		expect(html).not.toContain(`src="${digit0Url}"`);
		expect(html).toContain('aria-label="12,345,678 page views"');
	});

	it('renders 7 zero slots when count is 0', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 0,
			first_hit: null,
			last_hit: null,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		// Every slot is "0" — 7 references to the same WebP.
		const matches = html.match(new RegExp(`src="${digit0Url}"`, 'g'));
		expect(matches?.length).toBe(SLOT_COUNT);
		// No "since" period when first_hit is null.
		expect(html).not.toContain('since ');
		expect(html).toContain('aria-label="0 page views"');
	});

	it('renders the disabled placeholder (em-dash, no digit images) when enabled=false', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 0,
			first_hit: null,
			last_hit: null,
			enabled: false,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		expect(html).toContain('counter disabled');
		expect(html).toContain('bootstrap-home-api-key');
		expect(html).toContain('—');
		// No digit images in the disabled path.
		expect(html).not.toContain(`src="${digit0Url}"`);
		expect(html).not.toContain(`src="${digit1Url}"`);
	});

	it('omits the "last hit" line when last_hit is null', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 5,
			first_hit: null,
			last_hit: null,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		expect(html).not.toContain('last hit:');
	});
});
