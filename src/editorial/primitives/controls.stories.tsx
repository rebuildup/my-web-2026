import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Button } from './Button';
import { Disclosure } from './Disclosure';
import { MediaFrame } from './MediaFrame';
import { RecordList, RecordRow } from './RecordList';
import { TextLink } from './TextLink';

const meta: Meta = { title: 'Editorial/Controls' };
export default meta;

type Story = StoryObj;

export const Buttons: Story = {
	render: () => (
		<div className={css({ display: 'flex', flexWrap: 'wrap', gap: '4', alignItems: 'center' })}>
			<Button variant="primary">Primary</Button>
			<Button variant="secondary">Secondary</Button>
			<Button variant="ghost">Ghost</Button>
			<Button variant="link">Link button</Button>
			<Button variant="primary" size="sm">
				Small primary
			</Button>
			<Button variant="secondary" size="sm">
				Small secondary
			</Button>
		</div>
	),
};

export const Links: Story = {
	render: () => (
		<p>
			An <TextLink href="#">inline link</TextLink> inside prose, and a standalone row:{' '}
			<TextLink variant="standalone" href="#">
				Standalone link →
			</TextLink>
		</p>
	),
};

export const RecordRows: Story = {
	render: () => (
		<RecordList>
			<RecordRow label="Status">Shipped</RecordRow>
			<RecordRow label="Stack">Cloudflare Workers</RecordRow>
			<RecordRow label="License">MIT</RecordRow>
		</RecordList>
	),
};

export const Disclosures: Story = {
	render: () => (
		<div>
			<Disclosure summary="Secondary detail — collapsed by default">
				<p className={css({ color: 'text.muted' })}>
					Expanded content stays inside the section's measure.
				</p>
			</Disclosure>
			<Disclosure summary="Another disclosure">
				<p className={css({ color: 'text.muted' })}>Second item.</p>
			</Disclosure>
		</div>
	),
};

export const Media: Story = {
	render: () => (
		<MediaFrame ratio="16/9" caption="MediaFrame owns ratio, well and caption measure.">
			<div
				className={css({
					width: '100%',
					height: '100%',
					display: 'grid',
					placeItems: 'center',
					color: 'text.muted',
				})}
			>
				media
			</div>
		</MediaFrame>
	),
};
