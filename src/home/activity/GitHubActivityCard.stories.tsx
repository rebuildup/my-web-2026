import type { Meta, StoryObj } from '@storybook/react';
import { GitHubActivityCard } from './GitHubActivityCard';
import committedJson from './github-activity.json';
import { publicGitHubActivity, readGitHubActivitySnapshot } from './snapshot';

/**
 * GitHubActivityCard stories (Issue #334 verification).
 *
 * Both stories read the COMMITTED `github-activity.json` through the
 * same fail-closed reader and public projection the Home route uses —
 * no fixture data is invented:
 *
 *   - `Populated` — the snapshot as committed, so the card shows the
 *     real Issue/PR event labels, dates and repository links.
 *   - `Empty` — the same document with `repos` and `feed` emptied
 *     before the reader runs, which is the snapshot's honest "nothing
 *     observed" shape: the card keeps its header and prints
 *     「直近の公開イベントはありません。」 instead of a fabricated
 *     event. This is the state `docs/verification/activity/
 *     github-empty.png` captures.
 */
const meta = {
	title: 'home/GitHubActivityCard',
	component: GitHubActivityCard,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
} satisfies Meta<typeof GitHubActivityCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const committed = readGitHubActivitySnapshot(committedJson);
if (!committed) {
	throw new Error('src/home/activity/github-activity.json failed the snapshot reader');
}
const populated = publicGitHubActivity(committed);

const emptySnapshot = readGitHubActivitySnapshot({
	...committedJson,
	repos: [],
	feed: [],
});
if (!emptySnapshot) {
	throw new Error('the emptied github-activity.json variant failed the snapshot reader');
}
const empty = publicGitHubActivity(emptySnapshot);

export const Populated: Story = {
	args: { activity: populated },
	render: ({ activity }) => <GitHubActivityCard activity={activity} />,
};

export const Empty: Story = {
	args: { activity: empty },
	render: ({ activity }) => <GitHubActivityCard activity={activity} />,
};
