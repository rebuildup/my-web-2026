import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactionsWidget } from './widget';
import type { HomeReactionsData } from './load';

/**
 * ReactionsWidget smoke tests — server-render the disabled state and
 * the populated state. Click-handler assertions need a DOM environment
 * and are out of scope for the SSR-only test set; the impl tests in
 * `load.test.ts` cover the mutation paths.
 */

describe('ReactionsWidget', () => {
	it('renders the disabled placeholder when data.enabled is false', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			enabled: false,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('reactions disabled');
		expect(html).toContain('bootstrap-home-api-key');
	});

	it('renders aggregate chips with the resolved emoji when data.enabled is true and aggregates are non-empty', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [
				{ kind: 'emoji', value: 'thumbs_up', count: 17 },
				{ kind: 'emoji', value: 'tada', count: 9 },
			],
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('👍');
		expect(html).toContain('17');
		expect(html).toContain('🎉');
		expect(html).toContain('9');
		// Slug is the opaque stored value — surfaced via title attribute
		expect(html).toContain(':thumbs_up:');
		expect(html).toContain(':tada:');
	});

	it('falls back to the raw :slug: text for unknown slug aggregates (DB-backed future)', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [{ kind: 'emoji', value: 'custom_slug', count: 3 }],
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		// Unresolvable slugs render the literal `:slug:` text so the chip
		// is still visible (and the slug is grep-able in logs).
		expect(html).toContain(':custom_slug:');
		expect(html).toContain('3');
	});

	it('renders the picker chip row with the catalog oglyphs', () => {
		const data: HomeReactionsData = { target_key: 'home-page', aggregates: [], enabled: true };
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('aria-label="Add a reaction"');
		// Every catalog slug appears in the picker (the title attr is the slug in `:slug:` form).
		expect(html).toContain('thumbs_up');
		expect(html).toContain('rocket');
		expect(html).toContain('bulb');
	});

	it('renders the empty-state copy when enabled but no aggregates', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('まだ反応はありません');
	});
});
