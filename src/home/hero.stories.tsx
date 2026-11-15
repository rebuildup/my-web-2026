import type { Meta, StoryObj } from '@storybook/react';
import { Hero } from './hero';

/**
 * Hero stories (Issue #925 second pass).
 *
 * The hero is the page's editorial entry — the 現在地 statement in
 * normal flow content. The advertising surfaces are a separate axis
 * and live in `src/home/ads/` (see `home/Ads` stories), placed around
 * the content sections by the composer. See
 * `docs/verification/home/925-ad-reproduction/README.md` for the
 * observed source ads and verification evidence.
 *
 * Accessibility contract kept from Issue #287: exactly one `h1`
 * whose accessible name is `my-web-2026`, inside
 * `section[aria-labelledby="hero-title"]`.
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
