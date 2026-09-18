import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Container } from './Container';

/**
 * Container is the canonical page-width wrapper used by the
 * Marketing layout family. The `<Storybook render>` slot lets
 * designers inspect the responsive page-margin behavior at every
 * breakpoint by resizing the preview frame.
 */
const meta = {
	title: 'design-system/Container',
	component: Container,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof Container>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: () => (
		<Container>
			<div
				className={css({
					paddingBlock: '8',
					borderRadius: 'md',
					backgroundColor: 'bg.subtle',
					textAlign: 'center',
					fontFamily: 'sans',
					color: 'text.muted',
				})}
			>
				Container — content is bounded to 1024px with responsive page margin.
			</div>
		</Container>
	),
};

export const AsSection: Story = {
	render: () => (
		<Container as="section">
			<h2
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'lg',
					fontWeight: '700',
				})}
			>
				Container with `as="section"` for landmark wrappers
			</h2>
		</Container>
	),
};
