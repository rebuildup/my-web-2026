#!/usr/bin/env node
/**
 * Verify the cf Build Output is a COMPLETE deploy artifact.
 *
 * Replaces the retired `wrangler:dry-run` / `wrangler:production:dry-run`
 * bundler gates (Issue #247). Those validated the Wrangler bundler's
 * output; the canonical deploy artifact is now `.cloudflare/output/v0/`,
 * so the gate must validate that instead.
 *
 * A Build Output that merely *exists* is not acceptance. `/tools/<slug>`
 * is served from the artifact, so the check is deliberately about the
 * file set, not about the directory being non-empty.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(REPO_ROOT, '.cloudflare', 'output', 'v0');
const WORKER_DIR = join(OUTPUT_DIR, 'workers', 'default');
const ASSETS_DIR = join(WORKER_DIR, 'assets');
const CLIENT_DIR = join(REPO_ROOT, 'dist', 'client');

function fail(message) {
	console.error(`[verify-cf-build-output] FAIL: ${message}`);
	process.exit(1);
}

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
	// 1. The Build Output exists at all.
	if (!existsSync(OUTPUT_DIR)) {
		fail('no .cloudflare/output/v0 — run `pnpm run build:cf:production` first');
	}
	if (!existsSync(join(WORKER_DIR, 'worker.config.json'))) {
		fail('no worker.config.json in the Build Output — the build did not complete');
	}

	// 2. It was built in production mode. The build context lives in the
	//    OUTPUT root config; the per-worker config carries bindings only.
	const outputConfig = JSON.parse(readFileSync(join(OUTPUT_DIR, 'config.json'), 'utf8'));
	const mode = outputConfig?.buildContext?.mode;
	if (mode !== 'production') {
		fail(`Build Output mode is ${JSON.stringify(mode)}, expected "production"`);
	}

	// 3. It carries a Worker bundle.
	if (!existsSync(join(WORKER_DIR, 'bundle'))) {
		fail('no worker bundle in the Build Output');
	}

	// 4. Tool artifacts are present. This is the check that would have
	//    caught the silent regression: Vite materialises the Build Output
	//    during `vite build`, so the Tool bundles built afterwards by
	//    `build-tools.mjs` are absent unless `sync-cf-build-output` runs.
	const clientTools = join(CLIENT_DIR, 'tools');
	const outputTools = join(ASSETS_DIR, 'tools');
	const clientCount = countFiles(clientTools);
	if (clientCount > 0) {
		const outputCount = countFiles(outputTools);
		if (outputCount !== clientCount) {
			fail(
				`Tool artifacts incomplete in the deploy artifact: ${clientCount} built, ` +
					`${outputCount} present. /tools/<slug> would ship without its bundle.`,
			);
		}
		const slugs = existsSync(outputTools)
			? readdirSync(outputTools, { withFileTypes: true })
					.filter((e) => e.isDirectory())
					.map((e) => e.name)
			: [];
		for (const slug of slugs) {
			if (!existsSync(join(outputTools, slug, 'app', 'index.html'))) {
				fail(`Tool "${slug}" has no app/index.html in the deploy artifact`);
			}
		}
		console.log(
			`[verify-cf-build-output] Tool artifacts: ${outputCount} file(s) [${slugs.join(', ')}]`,
		);
	}

	console.log(
		`[verify-cf-build-output] OK — mode=${mode}, assets=${countFiles(ASSETS_DIR)} file(s), bundle present`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
