/**
 * Playwright globalSetup — bootstrap the local D1 binding BEFORE
 * the webServer (vite dev) starts.
 *
 * Why this exists:
 *
 *   `pnpm dev` starts a vite + wrangler-miniflare process that
 *   exposes the local D1 binding at `.wrangler/state/v3/d1/`.
 *   On a fresh checkout (CI runner, new clone, or after
 *   `rm -rf .wrangler`) that SQLite file does not exist yet —
 *   the loader hits "no such table: portfolio_project" and the
 *   `/portfolio` route returns 500. The home route works
 *   because it does not touch D1 in SSR, but the portfolio
 *   list / detail routes do.
 *
 *   The vitest workerd pool bakes the schema into its own
 *   per-test SQLite instance via `load.test.ts`'s in-line DDL.
 *   The Playwright pool runs against the SAME wrangler local D1
 *   that `pnpm dev` uses, so we need to populate that one with
 *   the production-shape schema + skeleton seed.
 *
 * Idempotency:
 *
 *   * `wrangler d1 migrations apply --local` tracks applied
 *     migrations in `d1_migrations` and skips them on re-run.
 *   * `scripts/seed-portfolio.mjs` uses INSERT OR IGNORE keyed
 *     on `portfolio_project.slug`.
 *
 *   Both are safe to re-run on every Playwright invocation.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url));
// `import.meta.url` for `e2e/global-setup.ts` is `<repoRoot>/e2e/global-setup.ts`.
// Walk up one level to reach the repository root that owns
// `wrangler.jsonc` and `scripts/seed-portfolio.mjs`.
const repoRoot = resolve(here, '..', '..');

function run(command: string, args: readonly string[]): void {
	execFileSync(command, args, {
		cwd: repoRoot,
		stdio: 'inherit',
		env: process.env,
	});
}

export default async function globalSetup(): Promise<void> {
	// 1. Apply migrations — creates portfolio_project / portfolio_link /
	//    portfolio_media on a fresh `.wrangler/state` and is a no-op
	//    thereafter (D1 tracks applied migrations).
	run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']);

	// 2. Skeleton seed — inserts `my-web-2026` + other canonical
	//    public+published rows so the list / detail routes render
	//    non-empty content. INSERT OR IGNORE means re-runs are no-op.
	run('node', ['scripts/seed-portfolio.mjs']);
}
