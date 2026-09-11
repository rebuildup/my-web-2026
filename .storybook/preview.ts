import type { Preview } from '@storybook/react';

/**
 * Storybook preview configuration.
 *
 * Loads the Panda CSS layer order declared in src/styles.css so
 * recipes and semantic tokens resolve correctly in stories. The
 * `styled-system/styles.css` import brings in Panda's reset, base,
 * tokens, recipes, and utilities layers.
 */
import '../src/styles.css';
import '../../styled-system/styles.css';

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
