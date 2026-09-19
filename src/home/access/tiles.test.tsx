import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
 */

describe('CounterTile', () => {
	it('renders the formatted count when enabled and non-zero', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 1234,
			first_hit: Date.now() - 86_400_000,
			last_hit: Date.now() - 30_000,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		// Intl.NumberFormat('en-US') emits "1,234" for 1234.
		expect(html).toContain('1,234');
		// KPI label and period are inside the tile.
		expect(html).toContain('page views');
		expect(html).toContain('since');
		expect(html).toContain('home-page');
		// Delta is shown as +N since launch.
		expect(html).toContain('+1,234 since launch');
		// Last hit is present.
		expect(html).toContain('last hit:');
	});

	it('renders the disabled placeholder when enabled=false', () => {
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
	});

	it('omits the period label and delta when first_hit is null', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 0,
			first_hit: null,
			last_hit: null,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		// No "since" period when first_hit is null.
		expect(html).not.toContain('since ');
		expect(html).toContain('0');
	});

	it('omits the "last hit" line when last_hit is null', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 0,
			first_hit: null,
			last_hit: null,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		expect(html).not.toContain('last hit:');
	});
});
