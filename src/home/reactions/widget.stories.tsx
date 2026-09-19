import type { Meta, StoryObj } from '@storybook/react';
import type { CatalogEntry } from '../../http/reactions/emoji-catalog';
import type { HomeReactionsData } from './load';
import { ReactionsWidget } from './widget';

/**
 * Visitor-facing reactions widget — Storybook stories.
 *
 * Covers the three observable states:
 *
 *   - `Disabled` — `data.enabled === false`. The widget renders the
 *     "consumer API key not configured" placeholder so the visitor
 *     sees why reactions are inert (and the operator sees the
 *     pointer to the bootstrap script).
 *   - `Empty` — `data.enabled === true` but no reactions recorded
 *     yet. The "first reaction" copy invites the visitor to engage.
 *   - `Populated` — a realistic aggregate set; chips render emoji
 *     + count and the input invites a new reaction.
 *
 * Click / submit handlers fire the actual `createServerFn` mutations
 * in production. Storybook cannot run those (no `cloudflare:workers`
 * env, no D1 binding) — the on-screen mutations are inert in this
 * preview and the optimistic update does not propagate.
 *
 * Ticket G (branch 39): the catalog is now DB-backed; stories
 * snapshot the seeded catalog so the picker row renders the same
 * 16-slug vocabulary a fresh deploy produces.
 */

const SEEDED_CATALOG: readonly CatalogEntry[] = [
	{ slug: 'thumbs_up', codepoint: '👍', enabled: true },
	{ slug: 'tada', codepoint: '🎉', enabled: true },
	{ slug: 'fire', codepoint: '🔥', enabled: true },
	{ slug: 'eyes', codepoint: '👀', enabled: true },
	{ slug: 'sparkles', codepoint: '✨', enabled: true },
	{ slug: 'rocket', codepoint: '🚀', enabled: true },
	{ slug: 'heart', codepoint: '❤', enabled: true },
	{ slug: 'laughing', codepoint: '😄', enabled: true },
	{ slug: 'thinking', codepoint: '🤔', enabled: true },
	{ slug: 'clap', codepoint: '👏', enabled: true },
	{ slug: 'wave', codepoint: '👋', enabled: true },
	{ slug: 'check', codepoint: '✅', enabled: true },
	{ slug: 'cross', codepoint: '❌', enabled: true },
	{ slug: 'warning', codepoint: '⚠️', enabled: true },
	{ slug: 'star', codepoint: '⭐', enabled: true },
	{ slug: 'bulb', codepoint: '💡', enabled: true },
];

const meta: Meta<typeof ReactionsWidget> = {
	title: 'home/ReactionsWidget',
	component: ReactionsWidget,
};

export default meta;

type Story = StoryObj<typeof ReactionsWidget>;

export const Disabled: Story = {
	args: {
		data: {
			target_key: 'home-page',
			aggregates: [],
			catalog: [],
			enabled: false,
		} satisfies HomeReactionsData,
	},
};

export const Empty: Story = {
	args: {
		data: {
			target_key: 'home-page',
			aggregates: [],
			catalog: SEEDED_CATALOG,
			enabled: true,
		} satisfies HomeReactionsData,
	},
};

export const Populated: Story = {
	args: {
		data: {
			target_key: 'home-page',
			aggregates: [
				{ kind: 'emoji', value: 'thumbs_up', count: 17 },
				{ kind: 'emoji', value: 'tada', count: 9 },
				{ kind: 'emoji', value: 'fire', count: 4 },
				{ kind: 'emoji', value: 'eyes', count: 2 },
			],
			catalog: SEEDED_CATALOG,
			enabled: true,
		} satisfies HomeReactionsData,
	},
};
