import type { Meta, StoryObj } from '@storybook/react';
import {
	AdToolCarousel,
	AdToolInstall,
	AdToolLinkCard,
	AdToolNative,
	AdToolPlayable,
	AdToolProduct,
	AdToolRect,
	AdToolVideo,
	AdTopBanner,
} from './placements';

/**
 * Home ad placements (Issue #925, second pass).
 *
 * Each story is one observed real-ad format reproduced on the home
 * page — banner, feed link card, carousel, video spot, playable,
 * display rectangle, app-install, product listing and native card —
 * each promoting a real published Tool. See
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

export const Carousel: Story = {
	render: () => <AdToolCarousel />,
};

export const VideoSpot: Story = {
	render: () => <AdToolVideo />,
};

export const Playable: Story = {
	render: () => <AdToolPlayable />,
};

export const DisplayRect: Story = {
	render: () => <AdToolRect />,
};

export const AppInstall: Story = {
	render: () => <AdToolInstall />,
};

export const ProductListing: Story = {
	render: () => <AdToolProduct />,
};

export const NativeCard: Story = {
	render: () => <AdToolNative />,
};
