import type { Meta, StoryObj } from '@storybook/react';
import { CurrentProjects } from './CurrentProjects';
import { currentProjectsFor } from './loader';
import type {
	CurrentProjectRecord,
	ProjectFact,
	ProjectFactSource,
	ProjectWeightLevel,
} from './types';

/**
 * CurrentProjects stories (Issue #316).
 *
 * The section has three honest shapes, and the fixtures below pin each one:
 *
 *   - `Shipped` — what the route hands the page today: the owner's roster
 *     composed with this repository's git snapshot. Captured by
 *     `scripts/capture-home-current-projects.mjs`, so the committed
 *     screenshots show the real document rather than a design fixture.
 *   - `Grouped` — every project has a weight level, so the list becomes
 *     group headings (`主軸 · 1 件`). The shape the owner asked for once the
 *     levels are written.
 *   - `Flat` — only some projects have a level, so grouping would imply the
 *     ungrouped rows have none; the list is flat and each row that has a
 *     level carries a tag. This is the state the shipped snapshot is in
 *     while the owner's values are unwritten.
 *
 * `Stopped` shows the section when nothing was updated inside the counting
 * window: the summary sentence says so, and no row moves.
 *
 * `Today` is fixed per render run rather than per story, so every fixture
 * in one capture session describes the same base date.
 */
const TODAY = new Date().toISOString().slice(0, 10);

function fact<T>(
	value: T,
	source: ProjectFactSource,
	observedOn: string,
	evidence?: string,
): ProjectFact<T> {
	return evidence ? { value, source, observedOn, evidence } : { value, source, observedOn };
}

const GROUPED: readonly CurrentProjectRecord[] = [
	{
		id: 'my-web-2026',
		name: 'my-web-2026',
		statusJa: '個人 Web Platform の再構築。',
		startedOn: fact('2026-09-11', 'git', '2026-11-01', '9363f814'),
		updatedOn: fact('2026-11-01', 'git', '2026-11-01', '7885f19d'),
		weight: {
			level: fact<ProjectWeightLevel>('primary', 'handwritten', '2026-11-01'),
			activity: fact(
				{ commits: 2433, windowDays: 30, commitsTotal: 2915 },
				'git',
				'2026-11-01',
				'scripts/sync-home-git-facts.mjs',
			),
		},
	},
	{
		id: 'tastile',
		name: 'Tastile',
		statusJa:
			'scheduling を扱う product。Web / Android / desktop / backend を含む multi-client development。',
		startedOn: fact('2025-04-01', 'handwritten', '2026-11-01'),
		updatedOn: fact('2026-10-28', 'handwritten', '2026-11-01'),
		weight: { level: fact<ProjectWeightLevel>('active', 'handwritten', '2026-11-01') },
	},
	{
		id: 'after-effects',
		name: 'After Effects',
		statusJa: 'script / plugin / extension の継続開発。配布と運用まで含む product として扱う。',
		startedOn: fact('2024-08-01', 'handwritten', '2026-11-01'),
		updatedOn: fact('2026-10-30', 'handwritten', '2026-11-01'),
		weight: { level: fact<ProjectWeightLevel>('active', 'handwritten', '2026-11-01') },
	},
	{
		id: 'ai-coding-agent',
		name: 'AI coding agent',
		statusJa:
			'agent workflow の実運用と形式知化。project-init / design-skills として実験と文書を並行。',
		startedOn: fact('2025-11-20', 'handwritten', '2026-11-01'),
		updatedOn: fact('2026-07-14', 'handwritten', '2026-11-01'),
		weight: { level: fact<ProjectWeightLevel>('paused', 'handwritten', '2026-11-01') },
	},
];

const FLAT: readonly CurrentProjectRecord[] = [
	GROUPED[0],
	{
		id: 'tastile',
		name: 'Tastile',
		statusJa:
			'scheduling を扱う product。Web / Android / desktop / backend を含む multi-client development。',
		weight: { level: fact<ProjectWeightLevel>('active', 'handwritten', '2026-11-01') },
	},
	{
		id: 'after-effects',
		name: 'After Effects',
		statusJa: 'script / plugin / extension の継続開発。配布と運用まで含む product として扱う。',
	},
];

const STOPPED: readonly CurrentProjectRecord[] = [
	{
		id: 'after-effects',
		name: 'After Effects',
		statusJa: 'script / plugin / extension の継続開発。配布と運用まで含む product として扱う。',
		startedOn: fact('2024-08-01', 'handwritten', '2026-11-01'),
		updatedOn: fact('2026-08-02', 'handwritten', '2026-11-01'),
	},
];

const meta = {
	title: 'home/CurrentProjects',
	component: CurrentProjects,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
	// `today` is required by the component and is fixed per render run, so it
	// is supplied once here rather than repeated in every story.
	args: { today: TODAY },
} satisfies Meta<typeof CurrentProjects>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shipped: Story = {
	render: () => <CurrentProjects projects={currentProjectsFor(TODAY)} today={TODAY} />,
};

export const Grouped: Story = {
	render: () => <CurrentProjects projects={GROUPED} today={TODAY} />,
};

export const Flat: Story = {
	render: () => <CurrentProjects projects={FLAT} today={TODAY} />,
};

export const Stopped: Story = {
	render: () => <CurrentProjects projects={STOPPED} today={TODAY} />,
};

export const Empty: Story = {
	render: () => <CurrentProjects projects={[]} today={TODAY} />,
};
