#!/usr/bin/env node
/**
 * Client bundle map — route dependency, duplicated chunks, Tool
 * isolation (Issue #483).
 *
 * Usage
 * -----
 *     node scripts/report-client-bundle.mjs [options]
 *     pnpm run verify:bundle-map -- [options]      # same thing
 *
 *     --client=<dir>     Emitted client root. Default: auto-detect the
 *                         Cloudflare Build Output asset directory, then
 *                         the legacy `dist/client` layout.
 *     --base-url=<url>   Serve the built output and measure which assets
 *                         each route really requests, in Chromium.
 *                         Omit for a static-only pass.
 *     --routes=<a,b>     Routes to measure. Default: the public routes.
 *     --out=<dir>        Where the report files land. Default:
 *                         `.tmp/bundle-report` (gitignored).
 *     --screenshot=<p>   Render the HTML report and store it as WebP at
 *                         this path (Issue #483 requires
 *                         `docs/verification/perf/bundle-map.png`; the
 *                         committed artefact uses the `.webp` extension).
 *     --report-only      Always exit 0, even when a finding fails.
 *
 * Scope
 * -----
 * This is a REPORT, not a gate. It is not referenced by any
 * `validate:fast` / `validate:integration` / `validate:release` entry
 * point (recorded in `quality/profile.yaml`), so it can never block a
 * build or a release; `quality/profile.yaml` keeps those three entry
 * points as the only deterministic gates. The exit code exists for a
 * human running the command, not for CI.
 *
 * It also does not change the bundle. It reads the build output that
 * already exists and describes it. Fixing a bundle regression is a
 * separate ticket (Issue #383 owns the perf budgets, #384–#387 own the
 * measurement infrastructure); this one only makes the bundle
 * observable.
 *
 * Data sources
 * ------------
 *   static  — the emitted files themselves. Sizes are raw bytes plus a
 *             local `gzip -9` estimate; the estimate is NOT the encoding
 *             Cloudflare negotiates at the edge, and the report says so.
 *   dynamic — an optional Chromium pass over a production-equivalent
 *             preview (`node scripts/e2e-local-bootstrap.mjs`). Each
 *             route is visited in a FRESH browser context, so the numbers
 *             are cold-cache per route and the route-to-asset mapping is
 *             the browser's own, not a guess from chunk filenames.
 *
 * The Tool isolation question ("does Home load the heavy Tool
 * libraries?") is answered from both: the static pass proves no host
 * chunk imports anything under `tools/**`, and the dynamic pass proves
 * the browser never requests one while rendering Home.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { arch, cpus, release, type } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
	buildChunkGraph,
	classifyAssetPath,
	collectClientInventory,
	evaluateBundleFindings,
	parseChunkImports,
	renderHtmlReport,
	renderMarkdownReport,
	sharedEntryChunks,
	summarizeRouteLoads,
} from './_client-bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Public routes measured by default — the representative pages of Issue #483. */
const DEFAULT_ROUTES = [
	'/',
	'/about',
	'/contact',
	'/portfolio',
	'/tools',
	'/tools/prototype',
	'/design-system',
];

/**
 * Where the Cloudflare Vite plugin materialises the client build when
 * `vite build` runs, relative to the repository root.
 */
const BUILD_OUTPUT_ASSETS = '.cloudflare/output/v0/workers/default/assets';
/** Pre-#247 layout: Vite wrote the client build to `dist/client`. */
const LEGACY_CLIENT_DIR = 'dist/client';

/** Only these get a gzip estimate; compressing a 3 MB font to prove it is a font is waste. */
const COMPRESSED_EXTENSIONS = ['.js', '.mjs', '.css', '.html', '.json', '.svg'];

function parseArgs(argv) {
	const options = {
		client: null,
		baseUrl: null,
		routes: DEFAULT_ROUTES,
		out: resolve(ROOT, '.tmp/bundle-report'),
		screenshot: null,
		reportOnly: false,
	};
	for (const arg of argv) {
		if (arg.startsWith('--client=')) options.client = resolve(ROOT, arg.slice('--client='.length));
		else if (arg.startsWith('--base-url='))
			options.baseUrl = arg.slice('--base-url='.length).replace(/\/+$/, '');
		else if (arg.startsWith('--routes='))
			options.routes = arg
				.slice('--routes='.length)
				.split(',')
				.map((route) => route.trim())
				.filter(Boolean);
		else if (arg.startsWith('--out=')) options.out = resolve(ROOT, arg.slice('--out='.length));
		else if (arg.startsWith('--screenshot='))
			options.screenshot = resolve(ROOT, arg.slice('--screenshot='.length));
		else if (arg === '--report-only') options.reportOnly = true;
		else throw new Error(`Unknown option: ${arg}`);
	}
	return options;
}

async function listFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? listFiles(path) : [path];
		}),
	);
	return nested.flat();
}

async function resolveClientDir(explicit) {
	if (explicit) return explicit;
	for (const candidate of [resolve(ROOT, BUILD_OUTPUT_ASSETS), resolve(ROOT, LEGACY_CLIENT_DIR)]) {
		const files = await listFiles(candidate).catch(() => []);
		if (files.some((file) => classifyAssetPath(relative(candidate, file)) === 'host-js')) {
			return candidate;
		}
	}
	throw new Error(
		[
			'No emitted client output found.',
			'Run `pnpm exec vite build` first, or pass --client=<dir>.',
			`Looked at: ${BUILD_OUTPUT_ASSETS}/ and ${LEGACY_CLIENT_DIR}/.`,
		].join(' '),
	);
}

function git(args) {
	try {
		return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}

async function viteVersion() {
	try {
		const pkg = JSON.parse(await readFile(resolve(ROOT, 'node_modules/vite/package.json'), 'utf8'));
		return pkg.version;
	} catch {
		return 'unknown';
	}
}

/**
 * Collect every emitted file with the sizes the report shows.
 * `gzipBytes` is a local `gzip -9` estimate and is labelled as such in
 * the report; it is comparable across runs, not a prediction of what
 * Cloudflare negotiates per client.
 */
async function collectFiles(clientDir) {
	const paths = await listFiles(clientDir);
	const files = [];
	for (const absolute of paths.sort()) {
		const path = relative(clientDir, absolute).split('\\').join('/');
		const buffer = await readFile(absolute);
		const compress = COMPRESSED_EXTENSIONS.some((extension) => path.endsWith(extension));
		files.push({
			path,
			bytes: buffer.length,
			gzipBytes: compress ? gzipSync(buffer, { level: 9 }).length : null,
			sha256:
				classifyAssetPath(path) === 'static'
					? null
					: createHash('sha256').update(buffer).digest('hex'),
			source: classifyAssetPath(path) === 'host-js' ? buffer.toString('utf8') : null,
		});
	}
	return files;
}

/**
 * Visit each route in a fresh browser context and record which emitted
 * assets the browser actually requested.
 *
 * @returns {{ route, status, assets }[]}
 */
async function measureRoutes({ baseUrl, routes, inventoryByPath }) {
	const { chromium } = await import('@playwright/test');
	const origin = new URL(baseUrl).origin;
	const browser = await chromium.launch();
	const version = `chromium ${browser.version()} (Playwright)`;
	const measurements = [];
	try {
		for (const route of routes) {
			const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			const page = await context.newPage();
			const seen = new Map();
			page.on('response', (response) => {
				if (response.request().method() !== 'GET') return;
				const url = new URL(response.url());
				if (url.origin !== origin) return;
				const path = decodeURIComponent(url.pathname).replace(/^\//, '');
				if (path === '') return;
				// The navigation response is the SSR document rendered by the
				// Worker. It is not an emitted file, so it must not be counted
				// as an asset — nor as a missing one.
				const kind = response.request().resourceType() === 'document' ? 'document' : 'asset';
				const known = kind === 'document' ? undefined : inventoryByPath.get(path);
				seen.set(path, {
					path,
					kind,
					bytes: known?.bytes ?? null,
					gzipBytes: known?.gzipBytes ?? null,
					known: kind === 'document' || Boolean(known),
					status: response.status(),
				});
			});
			let response = null;
			let failure = null;
			try {
				response = await page.goto(`${baseUrl}${route}`, {
					waitUntil: 'load',
					timeout: 60_000,
				});
				await page.waitForLoadState('networkidle').catch(() => {});
			} catch (error) {
				// A route that never finishes loading is recorded, never
				// dropped: a silently skipped route would read as a clean
				// route in the report.
				failure = error instanceof Error ? error.message.split('\n')[0] : String(error);
			}
			measurements.push({
				route,
				status: response?.status() ?? null,
				error: failure,
				assets: [...seen.values()].sort((a, b) => a.path.localeCompare(b.path)),
			});
			await context.close();
		}
	} finally {
		await browser.close();
	}
	return { measurements, version };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const clientDir = await resolveClientDir(options.client);
	const files = await collectFiles(clientDir);

	const chunks = files
		.filter((file) => file.source !== null)
		.map((file) => ({ path: file.path, imports: parseChunkImports(file.source) }));
	const inventory = collectClientInventory(files);
	const inventoryByPath = new Map(files.map((file) => [file.path, file]));

	let routeSummary = null;
	let measurements = null;
	let browserVersion = null;
	let entryChunks = null;
	if (options.baseUrl) {
		const measured = await measureRoutes({
			baseUrl: options.baseUrl,
			routes: options.routes,
			inventoryByPath,
		});
		measurements = measured.measurements;
		browserVersion = measured.version;
		routeSummary = summarizeRouteLoads(measurements);
		entryChunks = sharedEntryChunks(measurements);
	}

	// The graph is built AFTER the measurement so the entry chunk the
	// browser proved (the one chunk every route loads) can seed the
	// reachability walk. Without it the walk has no seed and the
	// finding reports itself as skipped instead of a false "clean".
	const graph = buildChunkGraph(chunks, entryChunks ? { entryChunks } : {});

	const cpuList = cpus();
	const report = {
		generatedAt: new Date().toISOString(),
		clientDir: relative(ROOT, clientDir) || '.',
		mode: options.baseUrl ? `static + Chromium pass on ${options.baseUrl}` : 'static only',
		conditions: {
			sourceSha: git(['rev-parse', 'HEAD']),
			sourceRef: git(['rev-parse', '--abbrev-ref', 'HEAD']),
			measuredAt: new Date().toISOString(),
			node: process.version,
			vite: await viteVersion(),
			os: `${type()} ${release()}`,
			arch,
			cpu: cpuList.length > 0 ? `${cpuList[0].model} (${cpuList.length} logical CPUs)` : 'unknown',
			browser: browserVersion,
			network: options.baseUrl
				? `${options.baseUrl} loopback, no throttling, fresh context per route`
				: 'not measured (static pass only)',
		},
		inventory,
		graph: {
			entryChunks: graph.entryChunks,
			graphRoots: graph.graphRoots,
			entriesResolved: graph.entriesResolved,
			unreachableChunks: graph.unreachableChunks,
			danglingEdges: graph.danglingEdges,
			edges: Object.fromEntries(graph.edges),
		},
		routeSummary,
		measurements,
		findings: evaluateBundleFindings({
			inventory,
			graph,
			routeSummary,
			homeRoute: '/',
		}),
	};

	await mkdir(options.out, { recursive: true });
	await writeFile(join(options.out, 'bundle-map.json'), `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(join(options.out, 'bundle-map.md'), renderMarkdownReport(report));
	const html = renderHtmlReport(report);
	await writeFile(join(options.out, 'bundle-map.html'), html);

	if (options.screenshot) {
		if (!options.screenshot.endsWith('.webp')) {
			throw new Error(
				`--screenshot must end with .webp (Issue #483's literal .png is substituted; a committed PNG would bloat the repository): ${options.screenshot}`,
			);
		}
		const { chromium } = await import('@playwright/test');
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
			await page.setContent(html, { waitUntil: 'load' });
			const png = await page.screenshot({ fullPage: true });
			const sharp = (await import('sharp')).default;
			await mkdir(dirname(options.screenshot), { recursive: true });
			await sharp(png)
				.resize({ width: 1600, withoutEnlargement: true })
				.webp({ quality: 80 })
				.toFile(options.screenshot);
		} finally {
			await browser.close();
		}
	}

	const failed = report.findings.filter((item) => item.status === 'fail');
	for (const item of report.findings) {
		const label = item.status === 'pass' ? 'PASS' : item.status === 'skipped' ? 'SKIP' : 'FAIL';
		console.log(`${label}  ${item.title} — ${item.detail}`);
	}
	if (routeSummary) {
		for (const route of routeSummary.routes) {
			console.log(
				`route ${route.route} status=${route.status ?? 'n/a'} assets=${route.assetCount} raw=${route.bytes}B tool=${route.toolBytes}B`,
			);
		}
	}
	console.log(`report written to ${relative(ROOT, options.out)}/bundle-map.{json,md,html}`);
	if (options.screenshot) {
		console.log(`screenshot written to ${relative(ROOT, options.screenshot)}`);
	}
	if (failed.length > 0 && !options.reportOnly) process.exitCode = 1;
}

await main();
