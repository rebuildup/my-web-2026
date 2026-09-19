import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
	title: 'Editorial/Badge',
	component: Badge,
	argTypes: {
		tone: { control: { type: 'select' }, options: ['neutral', 'accent'] },
	},
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const Neutral: Story = { args: { tone: 'neutral', children: 'neutral' } };
export const Accent: Story = { args: { tone: 'accent', children: 'accent' } };

export const AllTones: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: 12 }}>
			<Badge tone="neutral">neutral</Badge>
			<Badge tone="accent">accent</Badge>
		</div>
	),
};
