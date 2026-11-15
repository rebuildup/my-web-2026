import type { Meta, StoryObj } from '@storybook/react';
import { AdToolLinkCard, AdToolNative, AdToolRect, AdToolVideo, AdTopBanner } from './placements';

/**
 * Home ad placements (Issue #925, second pass).
 *
 * Each story is one observed real-ad format reproduced on the home
 * page — leaderboard strip, in-feed link card, video spot, display
 * rectangle and native card — each promoting a real published Tool
 * with its committed screen capture. See
 * `docs/verification/home/925-ad-reproduction/README.md` for the
 * source ads, anatomy mapping and verification evidence.
 */
const meta = {
	title: 'home/Ads',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Leaderboard: Story = {
	render: () => <AdTopBanner />,
};

export const LinkCard: Story = {
	render: () => <AdToolLinkCard />,
};

export const VideoSpot: Story = {
	render: () => <AdToolVideo />,
};

export const DisplayRect: Story = {
	render: () => <AdToolRect />,
};

export const NativeCard: Story = {
	render: () => <AdToolNative />,
};
