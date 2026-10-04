#!/usr/bin/env node
/**
 * Sync post-Vite Tool artifacts into the cf Build Output (Issue #247).
 *
 * Why this exists
 * ---------------
 * The old deploy path declared `assets: { directory: "./dist/client" }`,
 * so Wrangler uploaded everything under `dist/client` — including the
 * Tool bundles that `scripts/build-tools.mjs` writes *after* `vite
 * build` finished. The Tool iframe shells at `/tools/<slug>/app/` were
 * part of the deploy artifact by construction.
 *
 * The Cloudflare Vite Plugin 2 native path does not work that way. Vite
 * owns the asset pipeline and materialises `.cloudflare/output/v0/`
 * during `vite build`, so anything `build-tools.mjs` writes afterwards
 * is invisible to it. Measured before this step existed:
 *
 *     dist/client/tools/**                  13 files
 *     .cloudflare/output/v0/.../assets/tools  0 files
 *
 * Migrating the deploy gate without fixing that would have shipped a
 * Worker with no Tool artifacts — a silent break of `/tools/<slug>`.
 *
 * This step copies the already-built Tool bundles into the Build
 * Output assets directory and then **verifies** the result, so a
 * missing artifact fails the build instead of reaching production.
 *
 * It is a copy, not a rebuild: the Tool bundles are already built and
 * their `dist/client` location is what the local preview server and
 * `pnpm run build`'s bundle check also read.
 */

import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Vite's build output; the source of truth for the client bundle. */
const CLIENT_DIR = join(REPO_ROOT, 'dist', 'client');
/** The deploy artifact the cf native path produces. */
const CF_OUTPUT_ASSETS = join(
	REPO_ROOT,
	'.cloudflare',
	'output',
	'v0',
	'workers',
	'default',
	'assets',
);
/** Tool bundles, built post-Vite by scripts/build-tools.mjs. */
const TOOLS_SRC = join(CLIENT_DIR, 'tools');
const TOOLS_DEST = join(CF_OUTPUT_ASSETS, 'tools');

/**
 * Count files under a directory, for the before/after report.
 */
function countFiles(dir) {
	if (!existsSync(dir)) return 0;
	let n = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		n += entry.isDirectory() ? countFiles(p) : statSync(p).isFile() ? 1 : 0;
	}
	return n;
}

function main() {
	// A non-cf build (e.g. `vite build` without the plugin, or a
	// library consumer) legitimately has no Build Output. Skip rather
	// than fail, so the step is safe in every build mode.
	if (!existsSync(CF_OUTPUT_ASSETS)) {
		console.log('[sync-cf-build-output] no cf Build Output present — nothing to sync');
		return;
	}

	const source = countFiles(TOOLS_SRC);
	if (source === 0) {
		// No Tool bundles were produced. Only a problem if the manifest
		// actually declares buildable Tools, which build-tools.mjs
		// already enforces; do not invent a failure here.
		console.log('[sync-cf-build-output] no Tool artifacts to sync');
		return;
	}

	cpSync(TOOLS_SRC, TOOLS_DEST, { recursive: true });
	const synced = countFiles(TOOLS_DEST);

	// Fail closed: the deploy artifact must carry what the app serves.
	if (synced !== source) {
		throw new Error(
			`Tool artifacts incomplete in cf Build Output: expected ${source} file(s), found ${synced}. The deploy artifact would ship /tools/<slug> without its bundle.`,
		);
	}

	// Spot-check that a bundle entry point actually landed, so a
	// directory that exists but is empty cannot pass.
	const slugs = existsSync(TOOLS_DEST)
		? readdirSync(TOOLS_DEST, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => e.name)
		: [];
	for (const slug of slugs) {
		const index = join(TOOLS_DEST, slug, 'app', 'index.html');
		if (!existsSync(index)) {
			throw new Error(`Tool "${slug}" has no app/index.html in the cf Build Output`);
		}
	}

	console.log(
		`[sync-cf-build-output] Tool artifacts synced into Build Output: ${synced} file(s) across ${slugs.length} tool(s) [${slugs.join(', ')}]`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error) {
		console.error(`[sync-cf-build-output] failed: ${error?.message ?? error}`);
		process.exit(1);
	}
}

export { countFiles, TOOLS_DEST, TOOLS_SRC, CF_OUTPUT_ASSETS, CLIENT_DIR };
