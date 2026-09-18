import type { Meta, StoryObj } from '@storybook/react';
import { Hero } from './hero';

/**
 * Hero stories. The component takes no props — these variants exist
 * so designers can confirm the editorial spread composition holds
 * across the breakpoints defined in `responsive-design` (§Macro layout):
 * single column at `base`, stacked at `md`, asymmetric `4fr / 8fr` at
 * `lg` and wider.
 *
 * The Hero adopts the same 12-column grid that the body sections use
 * in their spread `SectionHeading`: a narrow metadata rail (4/12) on
 * the left and the lead column (8/12) on the right. Below `lg` the
 * rail is hidden because the lead column already carries the version
 * line in its caption.
 *
 * Type and spacing jump at golden ratio:
 * - h1 climbs to `4xl` (64px) at `lg` and wider, a 4× jump over
 *   body `md` (16px). That contrast is the editorial voice.
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
