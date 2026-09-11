import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
	title: 'Design System/Button',
	component: Button,
	argTypes: {
		variant: { control: { type: 'select' }, options: ['primary', 'secondary', 'ghost'] },
		size: { control: { type: 'select' }, options: ['md', 'sm'] },
		disabled: { control: 'boolean' },
	},
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
	args: { variant: 'primary', children: 'Primary action' },
};

export const Secondary: Story = {
	args: { variant: 'secondary', children: 'Secondary action' },
};

export const Ghost: Story = {
	args: { variant: 'ghost', children: 'Ghost action' },
};

export const Small: Story = {
	args: { variant: 'primary', size: 'sm', children: 'Small primary' },
};

export const Disabled: Story = {
	args: { variant: 'primary', disabled: true, children: 'Disabled' },
};

export const AllVariants: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
			<Button variant="primary">Primary</Button>
			<Button variant="secondary">Secondary</Button>
			<Button variant="ghost">Ghost</Button>
			<Button variant="primary" size="sm">
				Small primary
			</Button>
			<Button variant="primary" disabled>
				Disabled
			</Button>
		</div>
	),
};
