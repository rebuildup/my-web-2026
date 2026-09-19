import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EmojiClickData } from 'emoji-picker-react';
import type { CatalogEntry } from './emoji-catalog';
import type { HomeReactionsData } from './load';
import { ReactionsWidget, deriveSlugFromPicker } from './widget';

/**
 * ReactionsWidget smoke tests — server-render the disabled state, the
 * populated state, and the modal-picker shape. The actual
 * `emoji-picker-react` library is client-only (lazy-loaded + mount
 * gated inside a `<dialog>`), so SSR HTML for the picker slot is the
 * skeleton placeholder inside a closed dialog.
 *
 * Click-handler assertions need a DOM environment and live in the
 * `.test.tsx` DOM suite; the impl tests in `load.test.ts` cover the
 * mutation paths (auto-register, dedupe, etc.). The
 * `deriveSlugFromPicker` helper is exported and tested here as a pure
 * function.
 *
 * Branch 43 picker rewrite — picker is a modal opened by a trigger
 * button (not inline). Tests assert the new shape: trigger button
 * presence, dialog/skeleton rendering, MAX_RECORDED_CHIPS cap, and
 * the disabled-state placeholder.
 */

const SEEDED_CATALOG: readonly CatalogEntry[] = [
	{ slug: 'thumbs_up', codepoint: '👍', enabled: true },
	{ slug: 'tada', codepoint: '🎉', enabled: true },
	{ slug: 'fire', codepoint: '🔥', enabled: true },
	{ slug: 'rocket', codepoint: '🚀', enabled: true },
	{ slug: 'bulb', codepoint: '💡', enabled: true },
];

const clickEvent = (overrides: Partial<EmojiClickData> = {}): EmojiClickData => ({
	unified: '1f44d',
	unifiedWithoutSkinTone: '1f44d',
	emoji: '👍',
	names: ['thumbs_up', 'thumbs-up', 'thumbs up'],
	imageUrl: '',
	getImageUrl: () => '',
	activeSkinTone: 'neutral' as EmojiClickData['activeSkinTone'],
	isCustom: false,
	...overrides,
});

describe('ReactionsWidget', () => {
	it('renders the disabled placeholder when data.enabled is false', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			viewer_reactions: [],
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
			// Visitor has reacted with both — chip click would map to
			// DELETE (P1 review finding: widget toggle uses this set,
			// not the aggregate count).
			viewer_reactions: [
				{ kind: 'emoji', value: 'thumbs_up' },
				{ kind: 'emoji', value: 'tada' },
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
			// Visitor has NOT reacted with this slug — chip click would
			// map to PUT, not DELETE.
			viewer_reactions: [],
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		// Unresolvable slugs render the literal `:slug:` text so the chip
		// is still visible (and the slug is grep-able in logs).
		expect(html).toContain(':custom_slug:');
		expect(html).toContain('3');
	});

	it('renders the picker modal skeleton during SSR (picker is client-only inside a <dialog>)', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			viewer_reactions: [],
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		// Closed <dialog> with skeleton fallback — picker library is
		// lazy-loaded; the catalog metadata is read by the picker on
		// the client, not serialized into SSR HTML.
		expect(html).toContain('<dialog');
		expect(html).toContain('aria-label="Add a reaction"');
		expect(html).toContain('data-testid="home-reactions-picker-skeleton"');
		// The picker MUST NOT be embedded inline in the page.
		expect(html).not.toContain('aria-label="Emoji picker"');
	});

	it('renders a trigger button that opens the picker modal', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			viewer_reactions: [],
			catalog: SEEDED_CATALOG,
			enabled: true,
		};
		const html = renderToStaticMarkup(<ReactionsWidget data={data} />);
		expect(html).toContain('data-testid="home-reactions-open-picker"');
		expect(html).toContain('リアクションを追加');
	});

	it('renders the empty-state copy when enabled but no aggregates', () => {
		const data: HomeReactionsData = {
			target_key: 'home-page',
			aggregates: [],
			viewer_reactions: [],
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
			viewer_reactions: [],
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

describe('deriveSlugFromPicker', () => {
	it('picks the first valid slug-form name from the picker event', () => {
		expect(deriveSlugFromPicker(clickEvent())).toBe('thumbs_up');
	});

	it('skips names that contain invalid slug characters (hyphens, spaces)', () => {
		const result = deriveSlugFromPicker(
			clickEvent({
				names: ['thumbs-up', 'thumbs up', 'thumbs_up'],
			}),
		);
		expect(result).toBe('thumbs_up');
	});

	it('falls back to u_<unified> when no name fits the slug grammar', () => {
		const result = deriveSlugFromPicker(
			clickEvent({
				unified: '1FAF6',
				names: ['heart-hands', 'heart hands'],
			}),
		);
		expect(result).toBe('u_1faf6');
	});

	it('returns null when neither path yields a valid slug', () => {
		// Synthetic: unified is too long to be a safe fallback.
		const tooLongUnified = '1'.repeat(20);
		const result = deriveSlugFromPicker(
			clickEvent({
				unified: tooLongUnified,
				names: ['has space', 'has-hyphen'],
			}),
		);
		expect(result).toBeNull();
	});
});
