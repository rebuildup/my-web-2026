import type { Meta, StoryObj } from '@storybook/react';
import { activityHighlightsFixture, emptyActivityHighlightsFixture } from '../../activity/fixtures';
import { ActivityHighlightsView } from './Highlights';

/**
 * ActivityHighlightsView stories (Issue #1319 verification).
 *
 * Both stories render the committed `fixtures.ts` — synthetic
 * review data that exercises every block of the edited layer:
 *
 *   - `Populated` — summary panel + measured contributions +
 *     selected works + releases with a related-work join.
 *   - `Empty` — every source unreadable: the honest
 *     「ハイライトを構成できる活動がまだありません。」 state.
 */
const meta = {
	title: 'activity/ActivityHighlightsView',
	component: ActivityHighlightsView,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
} satisfies Meta<typeof ActivityHighlightsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
	args: { highlights: activityHighlightsFixture },
};

export const Empty: Story = {
	args: { highlights: emptyActivityHighlightsFixture },
};
