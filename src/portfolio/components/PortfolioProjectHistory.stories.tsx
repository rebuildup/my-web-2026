import type { Meta, StoryObj } from '@storybook/react';
import { MY_WEB_2026_PROJECT_HISTORY } from '../fixtures/project-history';
import { PortfolioProjectHistory } from './PortfolioProjectHistory';

/**
 * PortfolioProjectHistory stories — Issue #518.
 *
 * The element draws one published work's production timeline:
 * 制作開始 / 改版 / 公開 events, each carrying its sources, with the
 * epistemic axis (記録 / 記憶) kept separate from the chronology
 * axis. The fixture is `my-web-2026` itself — a work whose
 * repository is already public — so the preview uses no unpublished
 * material, and because the work has no published project media the
 * whole timeline renders text-only: the Issue's fallback requirement
 * is the default state, not a degraded one.
 *
 * What to look at:
 *
 *   - `Default` — the full timeline. Every event shows its date at
 *     the record's own granularity (2025-09 stays month-precision),
 *     its kind badge, its basis mark + word, and its 出典 list.
 *     The 記憶 event keeps the maker's estimate labelled as an
 *     estimate — it is never restated as fact.
 *   - `Sparse` — only the publication and the ongoing note render;
 *     the chronology does not need every kind to be present.
 *   - `Empty` — no events renders nothing. A timeline frame around
 *     zero events would itself be a claim.
 *
 * Each story carries an explicit `render()` (not only `args`) so the
 * verification harness `scripts/capture-project-history.mjs` renders
 * the story's own output — the same contract
 * `PortfolioCaseStudy.stories.tsx` keeps for the #519 capture.
 */

const meta = {
	title: 'portfolio/ProjectHistory',
	component: PortfolioProjectHistory,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div style={{ padding: '2rem', maxWidth: '72rem', margin: '0 auto' }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof PortfolioProjectHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		title: MY_WEB_2026_PROJECT_HISTORY.title,
		periodLabel: MY_WEB_2026_PROJECT_HISTORY.periodLabel,
		summary: MY_WEB_2026_PROJECT_HISTORY.summary,
		events: MY_WEB_2026_PROJECT_HISTORY.events,
	},
	render: () => <PortfolioProjectHistory {...MY_WEB_2026_PROJECT_HISTORY} />,
};

export const Sparse: Story = {
	args: {
		title: MY_WEB_2026_PROJECT_HISTORY.title,
		periodLabel: MY_WEB_2026_PROJECT_HISTORY.periodLabel,
		events: MY_WEB_2026_PROJECT_HISTORY.events.filter((e) =>
			['publication', 'note'].includes(e.kind),
		),
	},
	render: () => (
		<PortfolioProjectHistory
			title={MY_WEB_2026_PROJECT_HISTORY.title}
			periodLabel={MY_WEB_2026_PROJECT_HISTORY.periodLabel}
			events={MY_WEB_2026_PROJECT_HISTORY.events.filter((e) =>
				['publication', 'note'].includes(e.kind),
			)}
		/>
	),
};

export const Empty: Story = {
	args: {
		title: MY_WEB_2026_PROJECT_HISTORY.title,
		events: [],
	},
	render: () => <PortfolioProjectHistory title={MY_WEB_2026_PROJECT_HISTORY.title} events={[]} />,
};
