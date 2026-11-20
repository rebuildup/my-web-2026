import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Cluster, Stack } from './Flow';
import { Grid, Split } from './Grid';
import { PageSection } from './PageSection';
import { Panel } from './Panel';
import { SectionHeading } from './SectionHeading';

const meta: Meta = { title: 'Editorial/Layout' };
export default meta;

type Story = StoryObj;

const TONES = [
	'ground',
	'sunken',
	'raised',
	'inverse',
	'field.design',
	'field.code',
	'field.writing',
	'field.tool',
] as const;

export const SectionTones: Story = {
	render: () => (
		<div>
			{TONES.map((tone) => (
				<PageSection key={tone} tone={tone} labelledBy={`tone-${tone}`}>
					<SectionHeading
						id={`tone-${tone}`}
						title={tone}
						description="Section tone rebinds ink and surfaces inside its subtree."
					/>
					<Stack gap="4">
						<p className={css({ fontSize: 'sm', color: 'text.muted' })}>
							Muted text, a{' '}
							<a
								className={css({ color: 'text.accent', textDecoration: 'underline' })}
								href="/design-system"
							>
								link
							</a>{' '}
							and panels all stay legible on this surface.
						</p>
						<Grid columns={3} gap="4">
							<Panel variant="surface" padding="4">
								Surface panel
							</Panel>
							<Panel variant="subtle" padding="4">
								Subtle panel
							</Panel>
							<Panel variant="field.design" padding="4">
								Field panel
							</Panel>
						</Grid>
					</Stack>
				</PageSection>
			))}
		</div>
	),
};

export const Rhythms: Story = {
	render: () => (
		<div>
			<PageSection rhythm="hero" labelledBy="rhythm-hero">
				<SectionHeading id="rhythm-hero" title="hero" />
			</PageSection>
			<PageSection rhythm="body" labelledBy="rhythm-body">
				<SectionHeading id="rhythm-body" title="body" />
			</PageSection>
			<PageSection rhythm="closing" labelledBy="rhythm-closing" separator>
				<SectionHeading id="rhythm-closing" title="closing" />
			</PageSection>
		</div>
	),
};

export const GridPresets: Story = {
	render: () => (
		<Stack gap="10">
			{([1, 2, 3, 4] as const).map((columns) => (
				<Grid key={columns} columns={columns} gap="4">
					{Array.from({ length: columns * 2 }, (_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static catalog fixture, order never changes
						<Panel key={`c${columns}-i${i}`} variant="subtle" padding="4">
							columns={columns} · item {i + 1}
						</Panel>
					))}
				</Grid>
			))}
		</Stack>
	),
};

export const SplitLayout: Story = {
	render: () => (
		<Split>
			<Stack gap="2">
				<span
					className={css({
						fontSize: 'sm',
						fontWeight: '600',
						textTransform: 'uppercase',
						letterSpacing: '0.04em',
						color: 'text.muted',
					})}
				>
					Label cluster
				</span>
				<p className={css({ fontSize: 'sm', color: 'text.muted' })}>Left column — 4/12.</p>
			</Stack>
			<Stack gap="2">
				<p>Right column — 8/12 content measure.</p>
				<p className={css({ fontSize: 'sm', color: 'text.muted' })}>
					Stacks, panels and lists compose inside the wide column.
				</p>
			</Stack>
		</Split>
	),
};

export const FlowPrimitives: Story = {
	render: () => (
		<div
			className={css({
				display: 'grid',
				gap: '10',
				gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
			})}
		>
			<Stack gap="2">
				<strong>Stack gap=2</strong>
				<Panel variant="subtle" padding="4">
					first
				</Panel>
				<Panel variant="subtle" padding="4">
					second
				</Panel>
			</Stack>
			<Cluster gap="2">
				<Panel variant="subtle" padding="4">
					chip a
				</Panel>
				<Panel variant="subtle" padding="4">
					chip b
				</Panel>
				<Panel variant="subtle" padding="4">
					chip c
				</Panel>
			</Cluster>
		</div>
	),
};
