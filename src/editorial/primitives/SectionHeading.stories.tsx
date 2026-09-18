import type { Meta, StoryObj } from '@storybook/react';
import { SectionHeading } from './SectionHeading';

/**
 * SectionHeading establishes the section rhythm used across the
 * Marketing layout family. The `default` variant exercises different
 * eyebrow / description combinations; the `spread` variant exercises
 * the editorial 2-column layout that the body sections below the
 * hero use, with a `children` slot for the section's own content.
 */
const meta = {
	title: 'editorial/SectionHeading',
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

export const Spread: Story = {
	args: {
		id: 'spread-demo',
		eyebrow: 'Spread variant',
		title: 'Editorial spread / 大見出しパターン',
		description:
			'左 sticky に 4xl の大見出しを置き、右カラムに eyebrow / description / children を流すパターン。',
		variant: 'spread',
		children: (
			<div
				style={{
					padding: '24px',
					border: '1px dashed #cbd5e1',
					borderRadius: '8px',
					color: '#475569',
				}}
			>
				Section の中身 (cards / list / table) は children 経由でここへ。
			</div>
		),
	},
};
