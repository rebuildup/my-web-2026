import type { Meta, StoryObj } from '@storybook/react';
import { Hero } from './hero';

/**
 * Hero stories. The component takes no props — these variants exist
 * so designers can confirm the editorial spread composition holds
 * across the breakpoints defined in `responsive-design` (§Macro layout):
 * single column at `base`, stacked at `md`, asymmetric `4fr / 8fr` at
 * `lg` and wider.
 *
 * Issue #287 — the Hero uses the same 12-column grid rule the body
 * sections use in their spread `SectionHeading`: the left 4/12
 * **title span** carries the eyebrow line (mono caption at base,
 * metadata rail at `lg` — one breakpoint shows one of them) above
 * the `SiteMark` h1, on the same x-axis as the section titles; the
 * right 8/12 span starts with the lead description. Below `lg` the
 * columns stack into the original single flow.
 *
 * Type and spacing jump at golden ratio:
 * - The h1 renders the `SiteMark` identity mark (Issue #287) at
 *   64px (`16`) base / 96px (`24`) at `lg` — the display tier the
 *   previous `4xl` name occupied, a 4× jump over body `md` (16px).
 *   That contrast is the editorial voice.
 * - caption ↔ h1 (8px), h1 ↔ lead body (40px), lead ↔ secondary
 *   (0, continuous prose), secondary ↔ CTAs (16px).
 * - Hero padding is `16/32` (64/128px) — the page-entry beat.
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
