import type { Meta, StoryObj } from '@storybook/react';
import { SectionHeading } from './SectionHeading';

/**
 * SectionHeading establishes the section rhythm used across the
 * Marketing layout family. Each story exercises a different eyebrow /
 * description / children combination.
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
		description:
			'個人 Platform の機能領域。公開状態は各 capability の badge を正として、順に組み立てていく。',
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

export const WithChildren: Story = {
	args: {
		id: 'children-demo',
		eyebrow: 'With children',
		title: 'children スロット',
		description: 'Section の中身 (cards / list / table) は children 経由でここへ。',
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
