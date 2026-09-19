import type { Meta, StoryObj } from '@storybook/react';
import { CounterTile } from './tiles';
import type { HomeCounterData } from './load';

/**
 * CounterTile stories — used by the editorial design loop to iterate
 * on the `04 — Access counter` section without re-running SSR.
 *
 * Variants:
 *   - `Zero`: enabled, count 0 (just-deployed state).
 *   - `Small`: enabled, count 17.
 *   - `Large`: enabled, count 12_345.
 *   - `Fresh`: enabled, last_hit within the last minute.
 *   - `Stale`: enabled, last_hit > 24 h ago.
 *   - `Disconnected`: disabled (no API key).
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

export const Large: Story = {
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
