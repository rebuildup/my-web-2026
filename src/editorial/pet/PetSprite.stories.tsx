import type { Meta, StoryObj } from '@storybook/react';
import { PetSprite } from './PetSprite';

/**
 * The companion character (Issue #274).
 *
 * The component is a page-level floating overlay, so every story is the
 * same picture in a different corner: drag it, scroll the story iframe,
 * or move the pointer near it to see the reactions. The stories exist
 * to inspect the two preference renders without changing the OS
 * setting.
 *
 * `ReducedMotion` is the render a visitor who asked for less motion
 * gets: the resting frame at full size, no greeting, no gaze, and a
 * drag that moves the character without playing the travel strip.
 *
 * Storybook is a demo surface, so this file stays outside the public
 * copy gate for the same reason every other `*.stories.tsx` does.
 */
const meta: Meta<typeof PetSprite> = {
	title: 'Editorial/PetSprite',
	component: PetSprite,
	argTypes: {
		reducedMotion: { control: { type: 'boolean' } },
	},
	parameters: {
		docs: {
			description: {
				component:
					'Melty, the site companion. A page-level fixed overlay that can be dragged, greets once on arrival, looks the way the reader scrolls, looks at a nearby pointer, and shows the travel strip only while it is actually being moved. No buttons. Under `prefers-reduced-motion: reduce` every automatic reaction is off and only the drag remains.',
			},
		},
	},
};
export default meta;

type Story = StoryObj<typeof PetSprite>;

export const Interactive: Story = { args: {} };

export const ReducedMotion: Story = { args: { reducedMotion: true } };

export const BothPreferences: Story = {
	render: () => (
		<div style={{ display: 'grid', gap: 24 }}>
			<div>
				<p style={{ font: '12px/1.4 ui-monospace, monospace', margin: '0 0 8px' }}>
					prefers-reduced-motion: no-preference
				</p>
				<PetSprite reducedMotion={false} />
			</div>
			<div>
				<p style={{ font: '12px/1.4 ui-monospace, monospace', margin: '0 0 8px' }}>
					prefers-reduced-motion: reduce
				</p>
				<PetSprite reducedMotion />
			</div>
		</div>
	),
};
