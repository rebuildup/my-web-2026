import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook configuration for my-web-2026.
 *
 * The Vite builder is used because the project already runs on Vite +
 * `@cloudflare/vite-plugin`. We do NOT register the Cloudflare plugin
 * here — Storybook is a frontend-only preview, it does not need the
 * Worker entrypoint.
 *
 * `cloudflare:workers` is marked external for the same reason as in
 * `vite.config.ts` — the TanStack Start route tree imports server
 * functions that pull `env` from `cloudflare:workers`, and Rollup's
 * preview-build graph reaches the virtual module before the
 * start-compiler-plugin can split the server function out. Treating
 * it as external keeps Storybook's preview build from failing the
 * resolve step; the module is never actually loaded in the browser
 * bundle. The same comment lives in `vite.config.ts`.
 *
 * Stories live next to the obligation they document. The currently
 * shipped visual language is under `src/editorial/`; Home composition
 * stories live under `src/home/`.
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
	viteFinal: (config) => ({
		...config,
		build: {
			...(config.build ?? {}),
			rollupOptions: {
				...(config.build?.rollupOptions ?? {}),
				external: [...(config.build?.rollupOptions?.external ?? []), 'cloudflare:workers'],
			},
		},
	}),
};

export default config;
