import type { Meta, StoryObj } from '@storybook/react';
import { ABOUT_LINK_GROUPS } from '../links';
import { LinksPage } from './LinksPage';

/**
 * LinksPage — the standalone preview of the Issue #390 `/links`
 * surface.
 *
 * What this preview is
 * --------------------
 * The whole page composition drawn on its own with the SAME committed
 * data the route adapter passes: `ABOUT_LINK_GROUPS` from
 * `src/about/links.ts`. `Empty` demonstrates the acceptance criterion
 * 「空のfixture」: with no publishable group the page renders an honest
 * empty message — never an empty frame and never a fabricated link.
 * `EmptyGroups` covers the same state reached through declared-but-
 * empty groups (a group whose `links` array is empty is not rendered).
 *
 * There is deliberately no "disabled link" story: the data contract
 * (`AboutLink`) has no disabled/invalid state — every committed row is
 * either published or absent, and `src/about/links.test.ts` pins the
 * URL shape so an invalid target cannot enter the inventory.
 *
 * Each story carries an explicit `render()` (not only `args`) so the
 * verification harness `scripts/capture-links-empty.mjs` renders the
 * same tree Storybook does.
 *
 * No route, no binding, no peer obligation — the component composes
 * editorial primitives only, so `scripts/check-storybook-ownership.mjs`
 * treats this story as a standalone surface.
 */

const meta = {
	title: 'about/Links',
	component: LinksPage,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof LinksPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The committed link inventory, exactly as `/links` renders it. */
export const Published: Story = {
	args: { groups: ABOUT_LINK_GROUPS },
	render: () => <LinksPage groups={ABOUT_LINK_GROUPS} />,
};

/** The honest empty state (acceptance: 空の fixture). */
export const Empty: Story = {
	args: { groups: [] },
	render: () => <LinksPage groups={[]} />,
};

/** Declared groups whose link lists are all empty — same honest state. */
export const EmptyGroups: Story = {
	args: {
		groups: ABOUT_LINK_GROUPS.map((group) => ({ ...group, links: [] })),
	},
	render: () => <LinksPage groups={ABOUT_LINK_GROUPS.map((group) => ({ ...group, links: [] }))} />,
};
