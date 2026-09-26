import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { createD1PortfolioLoader } from './load';
import { type ListPortfolioProjectsOptions, SlugSchema } from './schema';

/**
 * TanStack Start server-function surface for the portfolio
 * obligation.
 *
 * Each exported function follows the home reactions pattern:
 *   * `createServerFn().validator(zSchema).handler(...)`
 *   * the handler resolves `env` inside `.handler()` so client
 *     bundles never see `cloudflare:workers`,
 *   * tests reach the underlying `Impl` directly via DI (see
 *     `load.test.ts`).
 *
 * Cross-references:
 *   * `src/home/reactions/load.ts` — the pattern this file mirrors.
 *   * ADR-0011 consumer pattern — D1 is read by the loader,
 *     never by routes directly.
 */

const ListOptsSchema = z
	.object({
		facets: z.array(z.enum(['develop', 'video', 'design', 'other'])).optional(),
		visibility: z.array(z.enum(['public', 'unlisted', 'draft'])).optional(),
		limit: z.number().int().min(1).max(500).optional(),
	})
	.optional();

export const loadPortfolioProject = createServerFn({ method: 'GET' })
	.validator(z.object({ slug: SlugSchema }))
	.handler(async ({ data }) => {
		const loader = createD1PortfolioLoader(
			env as unknown as Parameters<typeof createD1PortfolioLoader>[0],
		);
		return loader.loadPortfolioProject(data.slug);
	});

export const listPortfolioProjects = createServerFn({ method: 'GET' })
	.validator(ListOptsSchema)
	.handler(async ({ data }) => {
		const loader = createD1PortfolioLoader(
			env as unknown as Parameters<typeof createD1PortfolioLoader>[0],
		);
		const opts: ListPortfolioProjectsOptions = data ?? {};
		return loader.listPortfolioProjects(opts);
	});
