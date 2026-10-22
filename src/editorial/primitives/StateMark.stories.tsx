import type { Meta, StoryObj } from '@storybook/react';
import type { StateMarkKind } from './StateMark';
import { StateMark } from './StateMark';

/**
 * StateMark stories (Issue #411).
 *
 * The shape vocabulary is editorial's contract, so it is documented
 * next to the primitive: each kind renders with the word a consumer
 * pairs it with, which is what makes the two-channel rule visible —
 * a mark is never the only thing on screen.
 *
 * Every kind paints in `currentColor`, so the frames below are the
 * default-appearance proof that the mark adds no colour of its own
 * and therefore no contrast obligation (SC 1.4.11) beyond the label
 * it sits beside.
 */
const meta = {
	title: 'Editorial/StateMark',
	component: StateMark,
	parameters: { layout: 'centered' },
	tags: ['autodocs'],
} satisfies Meta<typeof StateMark>;

export default meta;
type Story = StoryObj<typeof meta>;

const LABELS: Readonly<Record<StateMarkKind, string>> = {
	ok: 'reachable',
	degraded: 'degraded',
	unreachable: 'unreachable',
	unobserved: 'not observed',
	design: 'Design',
	code: 'Develop',
	tool: 'Video',
	writing: 'Other',
};

function Frame() {
	return (
		<ul
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: 8,
				listStyle: 'none',
				margin: 0,
				padding: 0,
			}}
		>
			{(Object.keys(LABELS) as StateMarkKind[]).map((kind) => (
				<li key={kind} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<StateMark kind={kind} size="sm" />
					<span style={{ fontSize: 12, fontWeight: 600 }}>{LABELS[kind]}</span>
					<code style={{ fontSize: 11, color: '#666' }}>{kind}</code>
				</li>
			))}
		</ul>
	);
}

export const Vocabulary: Story = { args: { kind: 'ok', size: 'sm' }, render: () => <Frame /> };

/** The `sm` size a status badge uses — the size that has to survive at 200% zoom. */
export const SmallSize: Story = {
	args: { kind: 'degraded', size: 'sm' },
	render: (args) => <StateMark {...args} />,
};

export const DefaultSize: Story = {
	args: { kind: 'degraded' },
	render: (args) => <StateMark {...args} />,
};
