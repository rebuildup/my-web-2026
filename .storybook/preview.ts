import type { Preview } from '@storybook/react';

/**
 * Storybook preview configuration.
 *
 * Loads the Panda CSS layer order declared in src/styles.css so
 * recipes and semantic tokens resolve correctly in stories. Panda's
 * PostCSS plugin emits the reset / base / tokens / recipes /
 * utilities layers for the running Storybook build; an explicit
 * `styled-system/styles.css` import is unnecessary and previously
 * pointed above the repo root (`../../styled-system/styles.css`).
 */
import '../src/styles.css';

const preview: Preview = {
	parameters: {
		backgrounds: {
			default: 'canvas',
			values: [
				{ name: 'canvas', value: '#ffffff' },
				{ name: 'surface', value: '#f7f8fa' },
				{ name: 'inverse', value: '#0b1020' },
			],
		},
		controls: { expanded: true },
		layout: 'centered',
	},
};

export default preview;
