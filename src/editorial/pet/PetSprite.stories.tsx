import type { Meta, StoryObj } from '@storybook/react';
import { PetSprite } from './PetSprite';

/**
 * The companion character (Issue #274).
 *
 * The `Interactive` story is the only one that animates, and it does
 * so because a reader pressed the button — the platform ships no
 * autoplaying motion (`src/editorial/reduced-motion.ts`). The
 * `ReducedMotion` story pins the preference so the reduced render can
 * be inspected without changing the OS setting: it shows the still
 * frame and no trigger, because a control whose only effect is motion
 * is not offered to a visitor who asked for less motion.
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
					'Melty, the site companion. Still by default; one finite four-frame greeting behind an explicit trigger; the strip and the trigger are not rendered at all under `prefers-reduced-motion: reduce`.',
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
