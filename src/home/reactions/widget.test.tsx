import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from './emoji-catalog';
import type { HomeReactionsData } from './load';
import { ReactionsWidget } from './widget';

/**
 * ReactionsWidget smoke tests — server-render the disabled state, the
 * populated state, and the picker shape. Click-handler assertions need
 * a DOM environment and are out of scope for the SSR-only test set;
 * the impl tests in `load.test.ts` cover the mutation paths.
 *
 * Branch 43 — picker rewrite. The picker is now a search input + a
 * grid of catalog cells. Tests assert the new ARIA shape and the
 * catalog rendering, not the pre-branch-43 free-text form.
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

	it('renders the picker grid with every catalog entry surfaced', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('aria-label="Add a reaction"');
		// Every catalog entry is rendered as a button with an aria-label
		// of the form "Add :<slug>: reaction".
		expect(html).toContain('aria-label="Add :thumbs_up: reaction"');
		expect(html).toContain('aria-label="Add :rocket: reaction"');
		expect(html).toContain('aria-label="Add :bulb: reaction"');
		// Disabled catalog rows do not render in the picker.
		const catalogWithDisabled: readonly CatalogEntry[] = [
			{ slug: 'thumbs_up', codepoint: '👍', enabled: true },
			{ slug: 'hidden', codepoint: '🙈', enabled: false },
		];
		const html2 = renderToStaticMarkup(
			<ReactionsWidget
				data={{
					target_key: 'home-page',
					aggregates: [],
					catalog: catalogWithDisabled,
					enabled: true,
				}}
			/>,
		);
		expect(html2).not.toContain('aria-label="Add :hidden: reaction"');
	});

	it('renders a search input that filters the picker', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('id="home-reactions-picker-search"');
		expect(html).toContain('type="search"');
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
});
