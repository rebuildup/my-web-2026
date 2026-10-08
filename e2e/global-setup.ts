/**
 * Playwright globalSetup — VERIFY the local D1 state, do not create it.
 *
 * Why this is a check and not a bootstrap (Issue #262)
 * ----------------------------------------------------
 * This file used to apply the migrations and the skeleton seed. It was
 * the thing that hung `release-0-6-0` for eight commits
 * (`spawnSync pnpm ETIMEDOUT`, 600s, no output).
 *
 * The cause was this file's own assumption. Its header said it ran
 * "BEFORE the webServer (vite dev) starts", and `playwright.config.ts`
 * said the same. Playwright does the opposite. In
 * `playwright@1.63.0` `lib/runner/index.js`:
 *
 *     function createGlobalSetupTasks(config) {
 *       return [
 *         createRemoveOutputDirsTask(),
 *         ...createPluginSetupTasks(config),        // <- webServer plugin setup
 *         ...config.globalTeardowns.map(...),
 *         ...config.globalSetups.map(...),          // <- this file runs AFTER
 *       ];
 *     }
 *
 * The webServer plugin's `setup()` boots `vite preview` and waits for
 * its URL before any globalSetup file loads. So the migration ran
 * against a `.tmp/d1state` that workerd was already serving from, and
 * it never returned. Locally the same sequence hangs identically — it
 * is not a CI-only failure.
 *
 * The mutation now lives in `scripts/e2e-local-bootstrap.mjs`, wired
 * into `webServer.command`, which IS guaranteed to run before the
 * server starts.
 *
 * What remains here is the fail-closed half. `globalSetup` is the last
 * point before any spec runs, so it is the right place to prove the
 * bootstrap actually produced the artifact. If the state is missing a
 * table, this throws and the run is red — a bootstrap that silently
 * stopped working cannot present as a green E2E.
 *
 * Idempotency
 * -----------
 *   * `cf d1 migrations apply --local` tracks applied migrations in
 *     `d1_migrations` and skips them on re-run.
 *   * `scripts/seed-portfolio.mjs` uses INSERT OR IGNORE keyed on
 *     `portfolio_project.slug`.
 *
 *   Both are safe to re-run on every Playwright invocation, and both
 *   run before the server binds.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_STATE_DIR } from '../scripts/_cloudflare-identity.mjs';

/**
 * Tables the portfolio E2E specs depend on. `portfolio_project` is the
 * one the list / detail routes 500 without; the other two are its
 * declared children, so a partial migration is caught here too rather
 * than as a confusing assertion failure inside a spec.
 */
const REQUIRED_TABLES = ['portfolio_project', 'portfolio_link', 'portfolio_media'];

// `import.meta.url` for `e2e/global-setup.ts` is `<repoRoot>/e2e/global-setup.ts`.
// Walk up to reach the repository root that owns the local D1 state directory.
const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * The local D1 database `cf d1 --persist-to` writes, as opposed to the
 * bookkeeping sidecars miniflare keeps beside it.
 *
 * miniflare lays the state out as
 * `v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`, where `<hash>` is
 * derived from the binding and is therefore not predictable, so the
 * directory is scanned rather than a path constructed. `metadata.sqlite`
 * is excluded: it is miniflare's own catalog, not the database the
 * migrations created.
 */
function localD1Databases(stateDir: string): string[] {
	const d1Dir = resolve(stateDir, 'v3', 'd1');
	if (!existsSync(d1Dir)) return [];
	return readdirSync(d1Dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const bucket = resolve(d1Dir, entry.name);
			return readdirSync(bucket)
				.filter((file) => file.endsWith('.sqlite') && !file.endsWith('.sqlite-wal'))
				.filter((file) => file !== 'metadata.sqlite')
				.map((file) => resolve(bucket, file))
				.filter((path) => existsSync(path));
		});
}

export default async function globalSetup(): Promise<void> {
	// The canonical state directory, imported rather than spelled out:
	// AGENTS.md forbids any caller inventing its own persistence path,
	// and a second literal here is how the dev server and the E2E gate
	// would drift apart.
	const stateDir = resolve(repoRoot, LOCAL_STATE_DIR);
	const databases = localD1Databases(stateDir);

	if (databases.length === 0) {
		throw new Error(
			`The local D1 state at ${stateDir} holds no database.\n\n\`scripts/e2e-local-bootstrap.mjs\` must create it before the preview\nserver starts, and it runs as Playwright's webServer command. Reaching\nthis point with an empty state means that bootstrap did not run — the\nwebServer wiring in playwright.config.ts has regressed.\n`,
		);
	}

	// `node:sqlite` is the same engine miniflare writes with, so this
	// reads the committed state rather than a copy.
	const { DatabaseSync } = await import('node:sqlite');
	const missing = new Set<string>();

	for (const path of databases) {
		const db = new DatabaseSync(path, { readOnly: true });
		try {
			const present = new Set(
				db
					.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
					.all()
					.map((row) => String(row.name)),
			);
			for (const table of REQUIRED_TABLES) {
				if (present.has(table)) missing.delete(table);
				else missing.add(table);
			}
		} finally {
			db.close();
		}
		if (missing.size === 0) break;
	}

	if (missing.size > 0) {
		throw new Error(
			`The local D1 state is missing ${[...missing].sort().join(', ')}.\n\nFound databases: ${databases.join(', ')}\n\n\`scripts/e2e-local-bootstrap.mjs\` applies \`cf d1 migrations apply\n--local\` before the server binds. Tables missing here mean the\nmigrations did not run, or ran against a different \`--persist-to\`\npath than the one the dev server reads. The portfolio E2E specs\nwould 500 against this state, so failing here keeps the reason\nclose to its cause instead of surfacing it as three red specs.\n`,
		);
	}

	process.stdout.write(
		`[e2e global-setup] local D1 verified: ${databases.length} database(s), required tables present\n`,
	);
}
