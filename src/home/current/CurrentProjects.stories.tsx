import type { Meta, StoryObj } from '@storybook/react';
import { CurrentProjects } from './CurrentProjects';
import { CURRENT_PROJECTS } from './projects';
import type { CurrentProject } from './projects';

/**
 * CurrentProjects stories (Issue #316).
 *
 * Four states, because the section has four honest shapes:
 *
 *   - `Shipped`    — the snapshot the route actually hands the page
 *     (`CURRENT_PROJECTS`). This is the state the verification capture
 *     (`scripts/capture-home-current-projects.mjs`) renders, so the
 *     committed screenshots show what a reader receives today rather
 *     than a design fixture.
 *   - `Populated`  — the ordinary case: a handful of projects, one of
 *     them with a published link. A design surface for the linked
 *     shape the shipped snapshot does not exercise yet.
 *   - `Empty`      — nothing publishable. The section publishes ONE
 *     sentence, not an empty list, so a reader can tell "nothing is
 *     published" from "the page failed".
 *   - `Linkless`   — projects with NO link at all. The shipped
 *     snapshot is in this state today (the owner has not confirmed a
 *     public destination), so the section has to read well without a
 *     link in every row.
 *
 * The `Populated` / `Empty` / `Linkless` fixtures are literals in this
 * file: a design surface must not change because the owner edited the
 * snapshot. `Shipped` is the deliberate exception — it is the only
 * story whose content is the snapshot itself.
 */
const POPULATED: CurrentProject[] = [
	{
		id: 'my-web-2026',
		name: 'my-web-2026',
		statusJa: '個人 Web Platform の再構築。',
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

export const Shipped: Story = {
	render: () => <CurrentProjects projects={CURRENT_PROJECTS} />,
};

export const Populated: Story = {
	render: () => <CurrentProjects projects={POPULATED} />,
};

export const Empty: Story = {
	render: () => <CurrentProjects projects={[]} />,
};

export const Linkless: Story = {
	render: () => <CurrentProjects projects={LINKLESS} />,
};
