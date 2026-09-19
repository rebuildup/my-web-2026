import type { Meta, StoryObj } from '@storybook/react';
import type { HomeCounterData } from './load';
import { CounterTile } from './tiles';

/**
 * CounterTile stories — used by the editorial design loop to iterate
 * on the `04 — Access counter` section without re-running SSR.
 *
 * Odometer-style 7-slot digit strip (0.3.0 stabilisation pass):
 * the count is rendered as a fixed-width sequence of digit images,
 * leading zeros to fill the slots. Variants exercise every slot
 * shape the production counter will see.
 *
 *   - `Zero`:        count 0 (just-deployed state) → "0000000".
 *   - `Small`:       count 17 → "0000017".
 *   - `Mid`:         count 12,345 → "0012345".
 *   - `Full`:        count 9,999,999 → "9999999" (every slot lit).
 *   - `Overflow`:    count 12,345,678 (8 digits) → layout grows
 *                    to fit the natural decimal expansion.
 *   - `Fresh`:       count 5, last_hit within the last minute.
 *   - `Stale`:       count 99, last_hit > 24 h ago.
 *   - `Disconnected`: disabled (no API key) — em-dash, no images.
 */
const meta = {
	title: 'home/CounterTile',
	component: CounterTile,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof CounterTile>;

export default meta;
type Story = StoryObj<typeof meta>;

const now = Date.now();
const min = 60_000;
const h = 60 * min;
const d = 24 * h;

export const Zero: Story = {
	args: {
		data: { key: 'home-page', count: 0, first_hit: null, last_hit: null, enabled: true },
	},
};

export const Small: Story = {
	args: {
		data: {
			key: 'home-page',
			count: 17,
			first_hit: now - d,
			last_hit: now - 3 * min,
			enabled: true,
		},
	},
};

export const Mid: Story = {
	args: {
		data: {
			key: 'home-page',
			count: 12_345,
			first_hit: now - 30 * d,
			last_hit: now - 5 * min,
			enabled: true,
		},
	},
};

export const Full: Story = {
	args: {
		data: {
			key: 'home-page',
			count: 9_999_999,
			first_hit: now - 365 * d,
			last_hit: now - 30_000,
			enabled: true,
		},
	},
};

export const Overflow: Story = {
	args: {
		data: {
			key: 'home-page',
			count: 12_345_678,
			first_hit: now - 365 * d,
			last_hit: now - 30_000,
			enabled: true,
		},
	},
};

export const Fresh: Story = {
	args: {
		data: {
			key: 'home-page',
			count: 5,
			first_hit: now - 2 * min,
			last_hit: now - 5_000,
			enabled: true,
		},
	},
};

export const Stale: Story = {
	args: {
		data: {
			key: 'home-page',
			count: 99,
			first_hit: now - 14 * d,
			last_hit: now - 2 * d,
			enabled: true,
		},
	},
};

export const Disconnected: Story = {
	args: {
		data: { key: 'home-page', count: 0, first_hit: null, last_hit: null, enabled: false },
	},
};
