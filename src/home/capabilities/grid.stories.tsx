import type { Meta, StoryObj } from '@storybook/react';
import { CapabilitiesGrid } from './grid';
import type { Capability } from './capability';

/**
 * CapabilitiesGrid stories. The component is a function of
 * `readonly Capability[]`; each variant exercises a different mix of
 * `live` / `planned` statuses to confirm the editorial spread layout
 * survives content variation.
 *
 * The section uses the spread `SectionHeading` so the heading cluster
 * (eyebrow / h2 / description) sits in the narrow 4/12 left column
 * and the card grid lives in the wide 8/12 right column. Cards are
 * raw flex stacks — no border, no background fill, no padding box;
 * the ordinal caption (`01 · Portfolio`) sits inline with the English
 * label. Card rowGap is `10` (40px), columnGap is `6` (24px) — both
 * are golden-ratio jumps from the in-cluster gaps.
 *
 * Per-card semantics — per-element `marginBlockStart`:
 * - h3 ↔ badge: flex row, gap 4 — one title cluster.
 * - h3 ↔ ordinal: 1 (4px) — the ordinal is a decoration on the
 *   title, not a separate line.
 * - ordinal ↔ JP summary: 4 (16px) — cluster separator.
 * - JP ↔ EN summary: 1 (4px) — translation pair, one thought in
 *   two languages.
 */
const meta = {
	title: 'home/CapabilitiesGrid',
	component: CapabilitiesGrid,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof CapabilitiesGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const allPlanned: readonly Capability[] = [
	{
		id: 'portfolio',
		label: 'Portfolio',
		labelJa: 'ポートフォリオ',
		summary: 'Selected projects with short write-ups and source links.',
		summaryJa: '主要な作品と、その解説・ソースへのリンク。',
		status: 'planned',
	},
	{
		id: 'content',
		label: 'Content',
		labelJa: 'コンテンツ',
		summary: 'Long-form notes and posts, surfaced via RSS and JSON feed.',
		summaryJa: '長めのノートや記事。RSS と JSON フィードで配信。',
		status: 'planned',
	},
	{
		id: 'activity',
		label: 'Activity',
		labelJa: 'アクティビティ',
		summary: 'Recent commits, releases, and shipped work in one timeline.',
		summaryJa: '最近のコミット・リリース・出荷した仕事を 1 本のタイムラインに。',
		status: 'planned',
	},
];

const oneLive: readonly Capability[] = [
	{ ...allPlanned[0], status: 'live' },
	allPlanned[1],
	allPlanned[2],
];

const singleCapability: readonly Capability[] = [allPlanned[0]];

export const AllPlanned: Story = {
	args: { capabilities: allPlanned },
};

export const OneLive: Story = {
	args: { capabilities: oneLive },
};

export const Single: Story = {
	args: { capabilities: singleCapability },
};
