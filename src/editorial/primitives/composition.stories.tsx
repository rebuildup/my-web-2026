import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Breakout } from './Breakout';
import { Grid, GridItem } from './Grid';
import { Overlap, OverlapLayer } from './Overlap';
import { PageSection } from './PageSection';
import { Panel } from './Panel';
import { SectionHeading } from './SectionHeading';

/**
 * Composition primitives (ADR-0023 §3) — the vocabulary for
 * intentional asymmetry, breakout, media-led structure and
 * figure/ground layering. These stories are the reference for "what
 * a deliberate composition looks like"; they are also the rendered
 * fixtures the composition lint collector can measure.
 */

const meta: Meta = { title: 'Editorial/Composition' };
export default meta;

type Story = StoryObj;

const block = (label: string, tone?: string) => (
	<Panel variant="subtle" padding="6">
		<div className={css({ fontSize: 'sm', color: 'text.muted' })}>{tone ?? label}</div>
		<div className={css({ fontSize: 'lg', fontWeight: 'bold' })}>{label}</div>
	</Panel>
);

export const AsymmetricGrid: Story = {
	render: () => (
		<PageSection labelledBy="asym-h">
			<SectionHeading
				id="asym-h"
				variant="spread"
				title="Asymmetric composition"
				description="A lead block takes five tracks, a supporting rail takes four, and an offset item breaks the row — the 12-track grid makes the relationship explicit instead of implied by margins."
			/>
			<Grid template="12" gap="6">
				<GridItem span={{ base: 12, md: 6, lg: 5 }}>{block('Lead story', 'span 5')}</GridItem>
				<GridItem span={{ base: 12, md: 6, lg: 4 }} start={{ lg: 6 }}>
					{block('Supporting index', 'span 4 / offset')}
				</GridItem>
				<GridItem span={{ base: 12, md: 12, lg: 3 }} start={{ lg: 10 }}>
					{block('Margin note', 'span 3 / start 10')}
				</GridItem>
			</Grid>
		</PageSection>
	),
};

export const BreakoutMedia: Story = {
	render: () => (
		<PageSection labelledBy="breakout-h" name="media-feature">
			<SectionHeading
				id="breakout-h"
				title="Breakout media"
				description="When the media IS the section's subject, the canonical measure would only shrink it. Breakout declares the escape instead of faking it with margins."
			/>
			<Breakout variant="wide">
				<Panel variant="surface" padding="1">
					<div
						className={css({
							aspectRatio: '21 / 9',
							backgroundColor: 'bg.subtle',
							display: 'grid',
							placeItems: 'center',
							color: 'text.muted',
							fontSize: 'sm',
						})}
					>
						media surface — 1440px measure
					</div>
				</Panel>
			</Breakout>
		</PageSection>
	),
};

export const OverlapFigure: Story = {
	render: () => (
		<PageSection labelledBy="overlap-h">
			<SectionHeading
				id="overlap-h"
				title="Overlap — figure over ground"
				description="Layers share one grid cell. The caption sits on the image's ground instead of beside it; DOM order keeps the reading order honest."
			/>
			<Grid template="12" gap="6">
				<GridItem span={{ base: 12, lg: 7 }}>
					<Overlap>
						<OverlapLayer align="stretch" justify="stretch">
							<Panel variant="subtle" padding="1">
								<div
									className={css({
										aspectRatio: '4 / 3',
										backgroundColor: 'bg.subtle',
										display: 'grid',
										placeItems: 'center',
										color: 'text.muted',
									})}
								>
									figure
								</div>
							</Panel>
						</OverlapLayer>
						<OverlapLayer align="end" justify="start">
							<div
								className={css({
									padding: '4',
									backgroundColor: 'bg.surface',
									borderRadius: 'sm',
								})}
							>
								caption plate
							</div>
						</OverlapLayer>
					</Overlap>
				</GridItem>
				<GridItem span={{ base: 12, lg: 4 }} start={{ lg: 9 }}>
					{block('Rail note', 'offset column')}
				</GridItem>
			</Grid>
		</PageSection>
	),
};

export const RhythmChange: Story = {
	render: () => (
		<div>
			<PageSection labelledBy="rhythm-a">
				<SectionHeading id="rhythm-a" title="Body rhythm" />
				<p className={css({ color: 'text.muted' })}>Standard body beat.</p>
			</PageSection>
			<PageSection rhythm="feature" labelledBy="rhythm-b" name="feature-band">
				<SectionHeading
					id="rhythm-b"
					title="Feature rhythm"
					description="A deliberate larger beat marks this section as a turning point in the page's rhythm — used once, not as a default."
				/>
			</PageSection>
			<PageSection rhythm="closing" labelledBy="rhythm-c">
				<SectionHeading id="rhythm-c" title="Closing rhythm" />
			</PageSection>
		</div>
	),
};
