import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { withPublicErrorBoundary } from '../portfolio/public-errors';
import { type AboutEnv, loadAbout } from './load';
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
 *
 * Error contract (Issue #457): the `experience` subset is read from
 * D1 through the canonical portfolio loader, so a storage failure
 * used to throw the provider's own message straight into the
 * `/_serverFn/*` payload and the rendered error screen (see
 * `src/portfolio/public-errors.ts` for the mechanism). The read runs
 * through `withPublicErrorBoundary('about', …)` — the same
 * redaction contract `/portfolio` uses — so the screen shows
 * `portfolio_unavailable (ref=…)` and the internal exception stays in
 * the Worker log under that reference.
 */
export const loadAboutPage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<AboutPageData> =>
		withPublicErrorBoundary('about', async () => loadAbout(env as unknown as AboutEnv)),
);
