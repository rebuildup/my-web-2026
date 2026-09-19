import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import digit0Url from './digits/0.webp?url';
import digit1Url from './digits/1.webp?url';
import digit2Url from './digits/2.webp?url';
import digit3Url from './digits/3.webp?url';
import digit4Url from './digits/4.webp?url';
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
 * Image-swap rendering (0.3.0 stabilisation pass): the count is
 * rendered as one `<img>` per digit rather than as text. The digit
 * URLs come from `import`s of the pre-rasterised 7-segment WebPs
 * (see `scripts/generate-counter-digits.mjs`); the test asserts
 * the correct image is referenced for each digit position and that
 * the formatted value is still conveyed via `aria-label` on the
 * `<div role="img">` wrapper.
 */

describe('CounterTile', () => {
	it('renders one digit image per digit when enabled and non-zero', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 1234,
			first_hit: Date.now() - 86_400_000,
			last_hit: Date.now() - 30_000,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		// Four digit images, in order 1, 2, 3, 4 (Intl.NumberFormat
		// en-US emits "1,234").
		expect(html).toContain(`src="${digit1Url}"`);
		expect(html).toContain(`src="${digit2Url}"`);
		expect(html).toContain(`src="${digit3Url}"`);
		expect(html).toContain(`src="${digit4Url}"`);
		// Formatted count stays in aria-label so screen readers
		// announce the number, not "image image image image".
		expect(html).toContain('aria-label="1,234 page views"');
		// KPI label and period are inside the tile.
		expect(html).toContain('page views');
		expect(html).toContain('since');
		expect(html).toContain('home-page');
		// Delta is shown as +N since launch.
		expect(html).toContain('+1,234 since launch');
		// Last hit is present.
		expect(html).toContain('last hit:');
	});

	it('renders a single zero digit when enabled and count is 0', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 0,
			first_hit: null,
			last_hit: null,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		// Only the "0" digit image is rendered.
		expect(html).toContain(`src="${digit0Url}"`);
		expect(html).not.toContain(`src="${digit1Url}"`);
		expect(html).toContain('aria-label="0 page views"');
		// No period label when first_hit is null.
		expect(html).not.toContain('since ');
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
