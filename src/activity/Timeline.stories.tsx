import type { Meta, StoryObj } from '@storybook/react';
import { ActivityTimelineView } from './Timeline';
import {
	activityTimelineFixture,
	emptyActivityTimelineFixture,
	failedActivityTimelineFixture,
} from './fixtures';

/**
 * ActivityTimelineView stories (Issue #352 verification).
 *
 * All three stories render the committed `fixtures.ts` — synthetic
 * review data that exercises every kind (`release` / `article` /
 * `work`), the authored `dateLabel` path and each honest state:
 *
 *   - `Populated` — all three sources `ok`, six items sorted date
 *     desc: two GitHub releases, one article, three portfolio works
 *     with authored period labels.
 *   - `Empty` — sources healthy, zero items: the honest
 *     「掲載できる活動はまだありません。」 state.
 *   - `SourcesFailed` — github + portfolio `failed`, articles
 *     `unconfigured`: the header keeps per-source health and the body
 *     says 「活動ソースを取得できませんでした。」 — never an
 *     "empty = no activity" lie.
 *   - `Unavailable` — `timeline: null`, the assembly-failure state.
 */
const meta = {
	title: 'activity/ActivityTimelineView',
	component: ActivityTimelineView,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
} satisfies Meta<typeof ActivityTimelineView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
	args: { timeline: activityTimelineFixture },
	render: ({ timeline }) => <ActivityTimelineView timeline={timeline} />,
};

export const Empty: Story = {
	args: { timeline: emptyActivityTimelineFixture },
	render: ({ timeline }) => <ActivityTimelineView timeline={timeline} />,
};

export const SourcesFailed: Story = {
	args: { timeline: failedActivityTimelineFixture },
	render: ({ timeline }) => <ActivityTimelineView timeline={timeline} />,
};

export const Unavailable: Story = {
	args: { timeline: null },
	render: ({ timeline }) => <ActivityTimelineView timeline={timeline} />,
};
