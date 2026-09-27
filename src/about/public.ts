import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { loadAbout, type AboutEnv } from './load';
import type { AboutPageData } from './types';

/**
 * TanStack Start server-function surface for the `/about`
 * obligation.
 *
 * The `env` resolution happens inside `.handler()` so client
 * bundles never transitively pull `cloudflare:workers` — same
 * pattern as `src/portfolio/public.ts` and `src/home/public.ts`.
 *
 * The function takes no input: the page is a single canonical
 * snapshot whose data layer is repo-controlled. If a future
 * surface ever needs a per-visitor variation (e.g. a /cv-style
 * machine-readable alternate), it must live on a different
 * route — not as a parameter on this one (decision §「/about
 * structure」).
 */
export const loadAboutPage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<AboutPageData> => {
		return loadAbout(env as unknown as AboutEnv);
	},
);
