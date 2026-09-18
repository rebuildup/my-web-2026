import type { Meta, StoryObj } from '@storybook/react';
import { Hero } from './hero';

/**
 * Hero stories. The component takes no props — these variants exist
 * so designers can confirm the proximity-first composition holds
 * across the breakpoints defined in `responsive-design` (§Macro layout):
 * single column at `base`, stacked at `md`, asymmetric `7fr / 3fr` at
 * `lg` and wider. The right rail is plain mono text with proximity
 * grouping — no border, no background fill.
 */
const meta = {
	title: 'home/Hero',
	component: Hero,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof Hero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const StackAtMd: Story = {
	parameters: {
		viewport: {
			defaultViewport: 'tablet',
		},
	},
};

export const Narrow: Story = {
	parameters: {
		viewport: {
			defaultViewport: 'mobile1',
		},
	},
};
