import type { Meta, StoryObj } from '@storybook/react';
import { CurrentProjects } from './CurrentProjects';
import type { CurrentProject } from './projects';

/**
 * CurrentProjects stories (Issue #316).
 *
 * Three states, because the section has three honest shapes:
 *
 *   - `Populated`  — the ordinary case: a handful of projects, one of
 *     them with a published link. This is the state the verification
 *     capture (`scripts/capture-home-current-projects.mjs`) renders.
 *   - `Empty`      — nothing publishable. The section publishes ONE
 *     sentence, not an empty list, so a reader can tell "nothing is
 *     published" from "the page failed".
 *   - `Linkless`   — projects with NO link at all. The shipped
 *     snapshot is in this state today (the owner has not confirmed a
 *     public destination), so the section has to read well without a
 *     link in every row.
 *
 * The fixtures are literals in this file, not the committed snapshot
 * (`CURRENT_PROJECTS`): a preview is a design surface, and it must
 * not change because the owner edited the snapshot.
 */
const POPULATED: CurrentProject[] = [
	{
		id: 'my-web-2026',
		name: 'my-web-2026',
		statusJa: '個人 Web Platform の再構築。0.8.1 sprint で現在地の表示を追加中。',
		link: { label: '詳細を見る', href: '/about' },
	},
	{
		id: 'tastile',
		name: 'Tastile',
		statusJa:
			'scheduling を扱う product。Web / Android / desktop / backend を含む multi-client development。',
	},
	{
		id: 'after-effects',
		name: 'After Effects',
		statusJa: 'script / plugin / extension の継続開発。配布と運用まで含む product として扱う。',
	},
	{
		id: 'ai-coding-agent',
		name: 'AI coding agent',
		statusJa:
			'agent workflow の実運用と形式知化。project-init / design-skills として実験と文書を並行。',
	},
];

const LINKLESS: CurrentProject[] = POPULATED.map(({ id, name, statusJa }) => ({
	id,
	name,
	statusJa,
}));

const meta = {
	title: 'home/CurrentProjects',
	component: CurrentProjects,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof CurrentProjects>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
	render: () => <CurrentProjects projects={POPULATED} />,
};

export const Empty: Story = {
	render: () => <CurrentProjects projects={[]} />,
};

export const Linkless: Story = {
	render: () => <CurrentProjects projects={LINKLESS} />,
};
