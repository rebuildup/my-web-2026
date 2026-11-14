import type { Meta, StoryObj } from '@storybook/react';
import { Hero } from './hero';

/**
 * Hero stories (Issue #925 redesign).
 *
 * The hero is a faithful reproduction of a real Facebook feed link-ad
 * card — advertiser row (avatar + page name + 「スポンサー広告」 +
 * overflow), primary copy, link-preview card (image / domain /
 * headline / description) and a single CTA. The composition is
 * scoped to `src/home/hero.tsx`; the palette deliberately mirrors
 * the observed ad (`#1877f2` CTA, `#f0f2f5` surface, `#65676b`
 * secondary text) instead of the global editorial tokens. See
 * `docs/verification/home/925-ad-reproduction/README.md` for the
 * source ad, anatomy mapping and verification evidence.
 *
 * `stats` is optional: when the caller has measured git activity it
 * adds one factual bullet (`直近 N 日で M 件のコミット`); without it
 * the ad renders no unmeasured number.
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

export const WithMeasuredStats: Story = {
	args: {
		stats: { commitsInWindow: 2433, windowDays: 30, commitsTotal: 9102 },
	},
};

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
