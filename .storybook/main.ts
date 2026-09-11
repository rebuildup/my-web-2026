import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook configuration for my-web-2026.
 *
 * The Vite builder is used because the project already runs on Vite +
 * `@cloudflare/vite-plugin`. We do NOT register the Cloudflare plugin
 * here — Storybook is a frontend-only preview, it does not need the
 * Worker entrypoint.
 *
 * Stories live next to their components under
 * `src/design-system/components/*.stories.tsx` and a single design
 * tokens documentation story lives at
 * `src/design-system/tokens.stories.tsx`.
 */
const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(ts|tsx)'],
	addons: ['@storybook/addon-essentials', '@storybook/addon-docs'],
	framework: {
		name: '@storybook/react-vite',
		options: {},
	},
	docs: {},
	core: {
		disableTelemetry: true,
	},
	typescript: {
		check: false,
	},
};

export default config;
