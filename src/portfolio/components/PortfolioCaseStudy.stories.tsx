import type { Meta, StoryObj } from '@storybook/react';
import { MY_WEB_2026_CASE_STUDY } from '../fixtures/case-study';
import { PortfolioCaseStudy } from './PortfolioCaseStudy';

/**
 * PortfolioCaseStudy stories — Issue #519.
 *
 * The element separates three kinds of statement that a portfolio
 * page usually blends together: 確定事実 (confirmed), 当時の推測
 * (period estimate) and 現在の評価 (current evaluation). The fixture
 * is `my-web-2026` itself — a work whose repository is already
 * public — so the preview uses no unpublished material.
 *
 * What to look at:
 *
 *   - `Default` — the full four-part case study (目的 / 選択肢 /
 *     決定 / 検証結果). The legend under the title defines the three
 *     claim classes; every entry carries its class mark AND its
 *     word, so the distinction survives without colour.
 *   - `Sparse` — only the sections that have statements render;
 *     empty sections are omitted rather than shown as empty frames.
 *   - `Empty` — no statements at all renders nothing. A case-study
 *     frame around zero claims would itself be a claim.
 *
 * Each story carries an explicit `render()` (not only `args`) so the
 * verification harness `scripts/capture-portfolio-case-study.mjs`
 * renders the story's own output — the same contract
 * `ProjectCard.stories.tsx` keeps for the #794 captures.
 */

const meta = {
	title: 'portfolio/CaseStudy',
	component: PortfolioCaseStudy,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div style={{ padding: '2rem', maxWidth: '72rem', margin: '0 auto' }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof PortfolioCaseStudy>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		title: MY_WEB_2026_CASE_STUDY.title,
		periodLabel: MY_WEB_2026_CASE_STUDY.periodLabel,
		summary: MY_WEB_2026_CASE_STUDY.summary,
		sections: MY_WEB_2026_CASE_STUDY.sections,
	},
	render: () => <PortfolioCaseStudy {...MY_WEB_2026_CASE_STUDY} />,
};

export const Sparse: Story = {
	args: {
		title: MY_WEB_2026_CASE_STUDY.title,
		periodLabel: MY_WEB_2026_CASE_STUDY.periodLabel,
		sections: MY_WEB_2026_CASE_STUDY.sections.slice(2),
	},
	render: () => (
		<PortfolioCaseStudy
			title={MY_WEB_2026_CASE_STUDY.title}
			periodLabel={MY_WEB_2026_CASE_STUDY.periodLabel}
			sections={MY_WEB_2026_CASE_STUDY.sections.slice(2)}
		/>
	),
};

export const Empty: Story = {
	args: {
		title: MY_WEB_2026_CASE_STUDY.title,
		sections: [],
	},
	render: () => <PortfolioCaseStudy title={MY_WEB_2026_CASE_STUDY.title} sections={[]} />,
};
