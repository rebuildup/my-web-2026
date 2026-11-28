import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SKILLS } from '../skills';
import { SkillsList } from './SkillsList';

/**
 * SkillsList — the standalone preview of the Issue #391 skills view.
 *
 * What this preview is
 * --------------------
 * The evidence-linked skills list drawn on its own with the committed
 * `SKILLS` data: every item names the work or record that demonstrates
 * the use, the list groups technologies by the body of work they
 * primarily belong to (Issue #1296 — the project relationship replaces
 * the flat current/past inventory), and no proficiency level is
 * claimed anywhere — the data type has no field for one
 * (`src/about/skills.test.ts` pins that).
 *
 * `Empty` shows the honest empty state for the case where no skill has
 * a verifiable evidence link.
 *
 * Composes editorial primitives only — no route, no binding, no peer
 * obligation.
 */

const meta = {
	title: 'about/Skills',
	component: SkillsList,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof SkillsList>;

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
					eyebrow="Skills"
					title="使った技術 / Skills"
					description="ロゴの羅列ではなく、作品・記録への根拠リンクつきの一覧。"
					variant="spread"
				>
					{children}
				</SectionHeading>
			</Container>
		</div>
	);
}

/** The committed evidence-linked list. */
export const EvidenceLinked: Story = {
	args: { skills: SKILLS },
	render: (args) => (
		<Frame>
			<SkillsList {...args} />
		</Frame>
	),
};

/** The honest empty state. */
export const Empty: Story = {
	args: { skills: [] },
	render: (args) => (
		<Frame>
			<SkillsList {...args} />
		</Frame>
	),
};
