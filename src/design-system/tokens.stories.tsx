import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../styled-system/css';

/**
 * Design tokens documentation.
 *
 * Renders the raw palette and the semantic layer side-by-side so
 * designers and engineers can audit them in Storybook. This is a
 * docs-only story — no interactive controls.
 */
function TokenSwatch({ name, value }: { name: string; value: string }) {
	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				width: '40',
			})}
		>
			<div
				className={css({
					h: '12',
					borderRadius: 'md',
					border: '1px solid',
					borderColor: 'border.subtle',
					backgroundColor: value,
				})}
			/>
			<code className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}>
				{name}
			</code>
			<code className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.default' })}>
				{value}
			</code>
		</div>
	);
}

function PaletteGrid() {
	const raw = {
		'colors.brand.50': '#f5f7ff',
		'colors.brand.100': '#e6ecff',
		'colors.brand.500': '#3a6cff',
		'colors.brand.600': '#2b54cc',
		'colors.brand.900': '#0d1d4d',
		'colors.neutral.0': '#ffffff',
		'colors.neutral.50': '#f7f8fa',
		'colors.neutral.100': '#eef0f4',
		'colors.neutral.500': '#7a8194',
		'colors.neutral.900': '#0b1020',
	};
	return (
		<div className={css({ display: 'flex', flexWrap: 'wrap', gap: '4' })}>
			{Object.entries(raw).map(([name, value]) => (
				<TokenSwatch key={name} name={name} value={value} />
			))}
		</div>
	);
}

function SemanticGrid() {
	const semantic = {
		'bg.canvas': 'var(--colors-bg-canvas)',
		'bg.surface': 'var(--colors-bg-surface)',
		'bg.subtle': 'var(--colors-bg-subtle)',
		'bg.accent': 'var(--colors-bg-accent)',
		'bg.inverse': 'var(--colors-bg-inverse)',
		'text.default': 'var(--colors-text-default)',
		'text.muted': 'var(--colors-text-muted)',
		'text.accent': 'var(--colors-text-accent)',
		'border.subtle': 'var(--colors-border-subtle)',
		'border.strong': 'var(--colors-border-strong)',
		'border.focus': 'var(--colors-border-focus)',
	};
	return (
		<div className={css({ display: 'flex', flexWrap: 'wrap', gap: '4' })}>
			{Object.entries(semantic).map(([name, value]) => (
				<TokenSwatch key={name} name={name} value={value} />
			))}
		</div>
	);
}

const meta: Meta = {
	title: 'Design System/Tokens',
	parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj;

export const RawPalette: Story = {
	render: () => <PaletteGrid />,
};

export const SemanticLayer: Story = {
	render: () => <SemanticGrid />,
};
