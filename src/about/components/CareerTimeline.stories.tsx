import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { CAREER_TIMELINE, selectPublishableCareerEntries } from '../career';
import { CareerTimeline } from './CareerTimeline';

/**
 * CareerTimeline — the standalone preview of the Issue #389 history
 * surface.
 *
 * What this preview is
 * --------------------
 * The component drawn on its own, with the SAME committed data the
 * route adapter will use: `CAREER_TIMELINE` filtered through
 * `selectPublishableCareerEntries`, the fail-closed gate that only
 * lets `verified` entries through. The `PendingReview` story shows
 * the entries the gate is currently HOLDING (legacy-only /
 * unverified) so the owner can see exactly which legacy claims are
 * awaiting confirmation — it renders them through the same
 * component, which marks their status honestly instead of hiding it.
 *
 * `Empty` demonstrates the acceptance criterion 「データが1件も公開
 * 承認されない場合の代替表示」: with no publishable entry the
 * component renders an honest empty message, never a fabricated row.
 *
 * No route, no binding, no peer obligation — `Container` and
 * `SectionHeading` are the shipped editorial primitives, so
 * `scripts/check-storybook-ownership.mjs` treats this story as a
 * standalone surface.
 */

const meta = {
	title: 'about/Career timeline',
	component: CareerTimeline,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof CareerTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

const pageStyle = css({
	paddingBlock: { base: '10', lg: '16' },
	backgroundColor: 'bg.canvas',
	minHeight: '100%',
});

function Frame({ children }: { children: React.ReactNode }) {
	return (
		<div className={pageStyle}>
			<Container>
				<SectionHeading
					eyebrow="History"
					title="経歴 / Career timeline"
					description="旧サイトの年表を、確認状態つきの事実データとして移行したもの。"
					variant="spread"
				>
					{children}
				</SectionHeading>
			</Container>
		</div>
	);
}

/** The publishable surface: only `verified` entries. */
export const Publishable: Story = {
	args: { entries: selectPublishableCareerEntries(CAREER_TIMELINE) },
	render: (args) => (
		<Frame>
			<CareerTimeline {...args} />
		</Frame>
	),
};

/**
 * The entries the gate is holding — shown WITH their verification
 * badges so nothing reads as confirmed that is not. This is a review
 * surface for the owner, not the public rendering.
 */
export const PendingReview: Story = {
	args: {
		entries: CAREER_TIMELINE.filter((entry) => entry.verification.status !== 'verified'),
	},
	render: (args) => (
		<Frame>
			<CareerTimeline {...args} />
		</Frame>
	),
};

/** The honest empty state (acceptance: 公開承認0件時の代替表示). */
export const Empty: Story = {
	args: { entries: [] },
	render: (args) => (
		<Frame>
			<CareerTimeline {...args} />
		</Frame>
	),
};
