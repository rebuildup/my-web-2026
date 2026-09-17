import type { Meta, StoryObj } from '@storybook/react';
import { SectionHeading } from './SectionHeading';

/**
 * SectionHeading establishes the section rhythm used across the
 * Marketing layout family. Each variant exercises a different
 * eyebrow / description combination to confirm the spacing rule
 * survives copy changes.
 */
const meta = {
	title: 'design-system/SectionHeading',
	component: SectionHeading,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
} satisfies Meta<typeof SectionHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		eyebrow: 'Capabilities',
		title: 'できごと / What’s here',
		description: '個人 Platform の機能領域。0.2.0 時点ではまだどれも未公開で、順に組み立てていく。',
	},
};

export const TitleOnly: Story = {
	args: {
		title: 'タイトルだけのパターン',
	},
};

export const WithIdForAria: Story = {
	args: {
		id: 'demo-section',
		eyebrow: 'aria-labelledby',
		title: 'id 付きは aria-labelledby で参照できる',
		description: 'Section が aria-labelledby でこの heading を指せる。',
	},
};
