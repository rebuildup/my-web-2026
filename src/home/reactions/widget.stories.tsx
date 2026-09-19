import type { Meta, StoryObj } from '@storybook/react';
import { ReactionsWidget } from './widget';
import type { HomeReactionsData } from './load';

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
 */

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
			enabled: false,
		} satisfies HomeReactionsData,
	},
};

export const Empty: Story = {
	args: {
		data: {
			target_key: 'home-page',
			aggregates: [],
			enabled: true,
		} satisfies HomeReactionsData,
	},
};

export const Populated: Story = {
	args: {
		data: {
			target_key: 'home-page',
			aggregates: [
				{ kind: 'emoji', value: '👍', count: 17 },
				{ kind: 'emoji', value: '🎉', count: 9 },
				{ kind: 'emoji', value: '🔥', count: 4 },
				{ kind: 'emoji', value: '👀', count: 2 },
			],
			enabled: true,
		} satisfies HomeReactionsData,
	},
};
