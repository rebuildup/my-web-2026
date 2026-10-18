import type { Meta, StoryObj } from '@storybook/react';
import { CJK_MODES, CjkLineBreakShowcase } from './cjk-line-break';

/**
 * Storybook surface for the Issue #431 CJK fixture.
 *
 * Each story renders one opt-in level of `cjk-line-break.tsx` at the
 * current viewport width, so the same three levels a designer reads on
 * `/design-system` can be opened side by side here. The fixture
 * itself — the copy, the three modes and the `data-cjk-*` hooks the
 * measurement harness reads — lives in `./cjk-line-break.tsx`, so this
 * file carries no content of its own and cannot drift from the
 * measured DOM.
 *
 * `build-storybook` compiles these stories as part of
 * `validate:integration`. See `docs/verification/i18n/` for the
 * measured artefact; the harness drives the `/design-system` route
 * rather than this iframe because the preview bundle of
 * `@storybook/builder-vite` is currently emitted only to the manager
 * in this repository (see the Issue #431 PR body).
 */
const meta = {
	title: 'editorial/CJK line-break',
	parameters: {
		layout: 'fullscreen',
		docs: { description: { component: 'CJK 禁則処理 / 折り返し検証 fixture（Issue #431）' } },
	},
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: () => <CjkLineBreakShowcase spec={CJK_MODES[0]} />,
};

export const LocaleOptIn: Story = {
	render: () => <CjkLineBreakShowcase spec={CJK_MODES[1]} />,
};

export const LocaleOptInWithCjkTypography: Story = {
	render: () => <CjkLineBreakShowcase spec={CJK_MODES[2]} />,
};
