import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CounterTile } from './tiles';
import type { HomeCounterData } from './load';

/**
 * CounterTile — SSR smoke tests. Pure-render, no DOM. Click handlers
 * and live ticking (the `formatLastHit` relative time) are covered
 * by visual review + manual sweep.
 */

describe('CounterTile', () => {
	it('renders the formatted count when enabled and non-zero', () => {
		const data: HomeCounterData = {
			key: 'home-page',
			count: 1234,
			first_hit: Date.now() - 60_000,
			last_hit: Date.now() - 30_000,
			enabled: true,
		};
		const html = renderToStaticMarkup(<CounterTile data={data} />);
		// Intl.NumberFormat('en-US') emits "1,234" for 1234.
		expect(html).toContain('1,234');
		expect(html).toContain('hits / home-page');
		expect(html).toContain('04 — Access counter');
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
	});

	it('omits the "last hit" paragraph when last_hit is null', () => {
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
