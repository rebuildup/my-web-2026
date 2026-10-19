import type { Meta, StoryObj } from '@storybook/react';
import { TableCodeFixture } from './table-code';

/**
 * Storybook surface for the Issue #407 fixture.
 *
 * The fixture itself — the four states, the columns, the sample code
 * and the `data-table-*` / `data-code-*` hooks the machine gate and
 * the Chromium capture read — lives in `./table-code.tsx`, so this
 * file carries no content of its own and cannot drift from the
 * measured DOM.
 *
 * `Normal` renders every state at once because the Issue's completion
 * condition is that the empty / failure / compact states are
 * *reproducible*, not that they are hypothetical: a reviewer has to be
 * able to see all four in one place.
 *
 * `build-storybook` compiles these stories as part of
 * `validate:integration`. See `docs/verification/a11y/table-code.md`
 * for the measured artefact; the capture drives the same component
 * through its own harness rather than the Storybook iframe because
 * `@storybook/react-vite` currently emits a manager-only static build
 * in this repository (see the Issue #403 capture for the same note).
 */
const meta = {
	title: 'editorial/Table & code readability',
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'Table / code-block readability fixture — caption, header scope, confined scroll (Issue #407)',
			},
		},
	},
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {
	render: () => <TableCodeFixture />,
};

export const MobileWidth: Story = {
	render: () => (
		<div style={{ width: '375px' }}>
			<TableCodeFixture />
		</div>
	),
	parameters: { viewport: { defaultViewport: 'mobile1' } },
};
