import type { Meta, StoryObj } from '@storybook/react';
import { Card } from './Card';
import { Badge } from './Badge';

const meta: Meta<typeof Card> = {
	title: 'Editorial/Card',
	component: Card,
	argTypes: {
		elevation: { control: { type: 'select' }, options: ['flat', 'raised'] },
		tone: { control: { type: 'select' }, options: ['default', 'accent'] },
	},
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Flat: Story = {
	args: {
		elevation: 'flat',
		children: (
			<div>
				<h3 style={{ margin: 0, fontSize: '1.125rem' }}>Flat card</h3>
				<p style={{ margin: '8px 0 0', color: '#7a8194' }}>Used for inline content grouping.</p>
			</div>
		),
	},
};

export const Raised: Story = {
	args: {
		elevation: 'raised',
		children: (
			<div>
				<h3 style={{ margin: 0, fontSize: '1.125rem' }}>Raised card</h3>
				<p style={{ margin: '8px 0 0', color: '#7a8194' }}>For emphasized surfaces.</p>
			</div>
		),
	},
};

export const WithBadge: Story = {
	args: {
		elevation: 'flat',
		children: (
			<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
				<div style={{ display: 'flex', gap: 8 }}>
					<Badge tone="info">info</Badge>
					<Badge tone="accent">accent</Badge>
					<Badge tone="neutral">neutral</Badge>
				</div>
				<p style={{ margin: 0 }}>Cards compose with other primitives.</p>
			</div>
		),
	},
};
