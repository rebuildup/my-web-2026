import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from './emoji-catalog';
import type { HomeReactionsData } from './load';
import { ReactionsWidget } from './widget';

/**
 * ReactionsWidget smoke tests — server-render the disabled state, the
 * populated state, and the picker-shell shape. The actual
 * `emoji-picker-react` library is client-only (lazy-loaded + mount
 * gated), so SSR HTML for the picker slot is the skeleton placeholder.
 * Click-handler assertions need a DOM environment and live in the
 * `.test.tsx` DOM suite; the impl tests in `load.test.ts` cover the
 * mutation paths.
 *
 * Branch 43 — picker rewrite. The widget no longer rolls its own
 * flat grid; the picker UX is delegated to ealush/emoji-picker-react
 * v4 (categories + sticky headers + search). We render the picker
 * client-only and bridge the click event back to our catalog slug.
 */

const SEEDED_CATALOG: readonly CatalogEntry[] = [
	{ slug: 'thumbs_up', codepoint: '👍', enabled: true },
	{ slug: 'tada', codepoint: '🎉', enabled: true },
	{ slug: 'fire', codepoint: '🔥', enabled: true },
	{ slug: 'rocket', codepoint: '🚀', enabled: true },
	{ slug: 'bulb', codepoint: '💡', enabled: true },
];

describe('ReactionsWidget', () => {
	it('renders the disabled placeholder when data.enabled is false', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			catalog: [],
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
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('👍');
		expect(html).toContain('17');
		expect(html).toContain('🎉');
		expect(html).toContain('9');
		// Slug is the opaque stored value — surfaced via title attribute.
		expect(html).toContain(':thumbs_up:');
		expect(html).toContain(':tada:');
	});

	it('falls back to the raw :slug: text for unknown slug aggregates (DB-backed future)', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [{ kind: 'emoji', value: 'custom_slug', count: 3 }],
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		// Unresolvable slugs render the literal `:slug:` text so the chip
		// is still visible (and the slug is grep-able in logs).
		expect(html).toContain(':custom_slug:');
		expect(html).toContain('3');
	});

	it('renders the picker skeleton during SSR (picker is client-only)', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		// The emoji-picker-react library is lazy + mount-gated, so SSR
		// HTML contains the placeholder, not thousands of emoji glyphs.
		expect(html).toContain('data-testid="home-reactions-picker-skeleton"');
		expect(html).toContain('aria-label="Add a reaction"');
	});

	it('renders the empty-state copy when enabled but no aggregates', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('まだ反応はありません');
	});

	it('caps the displayed aggregate chips at MAX_RECORDED_CHIPS', () => {
		const manyAggregates = Array.from({ length: 12 }, (_, i) => ({
			kind: 'emoji' as const,
			value: `slug_${i}`,
			count: i + 1,
		}));
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: manyAggregates,
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		// Slugs 0..7 render; 8..11 are clipped.
		expect(html).toContain(':slug_0:');
		expect(html).toContain(':slug_7:');
		expect(html).not.toContain(':slug_8:');
		expect(html).not.toContain(':slug_11:');
	});
});
