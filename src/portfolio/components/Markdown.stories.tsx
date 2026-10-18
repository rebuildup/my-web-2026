import type { Meta, StoryObj } from '@storybook/react';
import { HOSTILE_MD, TECHNICAL_ARTICLE_MD } from '../fixtures/markdown';
import { PortfolioMarkdown } from './Markdown';

/**
 * Portfolio Markdown stories — the visual half of the safety contract
 * pinned in `src/portfolio/markdown.safety.test.tsx` (Issue #435).
 *
 * The tests decide whether the output is CORRECT; these stories decide
 * whether it is READABLE. Both read the same two fixture files, so a
 * reviewer can look at the rendered article without booting the Worker
 * or the database, and the preview cannot drift away from the assertions.
 *
 * What to look at in each story:
 *
 *   - `SupportedSyntax` — the article fixture. Headings land on h3/h4/h5
 *     (h1/h2 belong to the page), code keeps its own block, and the
 *     unsupported constructs are visible as the literal characters they
 *     are: `[^1]`, the pipe table, `$E = mc^2$`, `~~…~~`, `- [ ]`.
 *   - `HostileInput` — the payload fixture. Every script tag, event
 *     handler and dangerous scheme appears as inert text on screen. If a
 *     payload ever disappears from this view, it was dropped rather than
 *     escaped, which is a contract change, not a security fix.
 *
 * Typography is deterministic and locale-free: no smart quotes, no
 * ellipsis folding, no locale-driven line breaking. Rewriting prose for
 * quality is the editor's job and happens before publication — see
 * `docs/portfolio/markdown-format.md`.
 */

const meta = {
	title: 'portfolio/Markdown',
	component: PortfolioMarkdown,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div style={{ padding: '2rem', maxWidth: '72rem', margin: '0 auto' }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof PortfolioMarkdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SupportedSyntax: Story = {
	args: { source: TECHNICAL_ARTICLE_MD },
};

export const HostileInput: Story = {
	args: { source: HOSTILE_MD },
};

export const EmptyBody: Story = {
	args: { source: '' },
};
