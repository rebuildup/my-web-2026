import { createServerFn } from '@tanstack/react-start';
import type { DataSourceDescriptor, DataSourceEnv } from '../../cloudflare/data-source';

/**
 * The home's view of the runtime data source (Issue #377).
 *
 * Why this module exists
 * ----------------------
 * The RULE ("which data am I looking at, and may I write?") is owned by
 * the `cloudflare` obligation — it is a property of the Cloudflare
 * runtime, not of the home surface. The home may not import
 * `cloudflare` directly (AGENTS.md §3), but `home/status` MAY
 * (AGENTS.md §3, "home/status -> cloudflare"), so the rule reaches the
 * rest of the home through this one file. `src/home/access/load.ts` and
 * `src/home/reactions/load.ts` reach it from their `.handler(…)`
 * bodies; they never import the Cloudflare obligation.
 *
 * Why the import is DYNAMIC
 * -------------------------
 * Two gates shape this file:
 *
 *   - the Storybook ownership gate refuses a preview that reaches a
 *     foreign boundary, and `src/cloudflare/**` is one (it owns the
 *     bindings);
 *   - the architecture gate allows `home/status -> cloudflare` but
 *     not `home -> cloudflare`.
 *
 * A dynamic import inside the `.handler(…)` body satisfies both: the
 * start compiler plugin removes that body from the client build, so a
 * preview never evaluates it (the same rule the home's other
 * server-only imports follow — see `src/home/reactions/load.ts`), and
 * the only module-level edge to the Cloudflare obligation is a TYPE,
 * which erases at build time.
 *
 * What the home publishes
 * -----------------------
 * A closed descriptor (the shape is owned by `cloudflare/data-source`):
 * the recognised source, a label, a one-line explanation, the write
 * policy, and — when the runtime could not classify itself — a
 * warning. The development screen renders exactly this, so the screen
 * can never disagree with the runtime that produced it.
 */

export type { DataSourceDescriptor };

/**
 * Resolve the current data source from an env-like object.
 *
 * The caller reaches this function with a dynamic import inside its
 * `.handler(…)` body, so the Cloudflare obligation never enters a
 * preview graph.
 */
export async function resolveHomeDataSource(envLike: DataSourceEnv): Promise<DataSourceDescriptor> {
	const { resolveDataSource } = await import('../../cloudflare/data-source');
	return resolveDataSource(envLike);
}

/**
 * Server function used by the home route loader to publish the
 * current data source to the development screen.
 */
export const getHomeDataSource = createServerFn({ method: 'GET' }).handler(
	async (): Promise<DataSourceDescriptor> => {
		const { env } = await import('cloudflare:workers');
		return resolveHomeDataSource(env as unknown as DataSourceEnv);
	},
);
