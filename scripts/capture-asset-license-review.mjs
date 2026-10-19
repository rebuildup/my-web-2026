#!/usr/bin/env node

/**
 * capture-asset-license-review — capture the Issue #497 verification
 * screen for `docs/verification/legal/asset-license-review.webp`.
 *
 * What this captures
 * ------------------
 * `AssetLicenseReviewGallery` from
 * `src/legal/AssetLicenseReview.stories.tsx`: the rights, provenance,
 * licence, conditions and evidence of ONE content item (the
 * `procon2026` guide, already public), the same card for the case that
 * decides the contract (bundled fonts whose provenance this repository
 * does not record), every record's derived decision, and the audit's
 * declared scope.
 *
 * The fixtures are the COMMITTED RECORD
 * (`quality/asset-license-inventory.json`), so the committed image cannot
 * document a licence nobody ships. It is the same component and the same
 * record a Storybook reviewer sees.
 *
 * Why a generated harness instead of the Storybook build
 * --------------------------------------------------------
 * `pnpm run build-storybook` in this repository merges the project's
 * `vite.config.ts` (Cloudflare + TanStack plugins), and fixing that
 * build is a different ticket. The harness below is a small Vite app
 * generated into `.tmp/` that imports the story module directly.
 *
 * Safety
 * ------
 *   - No deploy, no remote binding, no secret value is read or printed.
 *     The only build is local, and the gallery is a committed record
 *     rendered offline: it issues NO request to any host.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules from `file://`, which
 *     is the only reason an origin exists.
 *   - The non-loopback request count is MEASURED over Playwright's
 *     request events rather than asserted, so a future edit that fetches
 *     something fails the run instead of the sentence.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG, but verification artefacts in this
 * repository are stored as compressed WebP (Issues #446 / #457): the
 * capture buffer is re-encoded with the existing `sharp` devDependency
 * (width <= 1600, quality 80) and the committed file is the `.webp`
 * sibling of the Issue's `.png` path. The script REFUSES any non-`.webp`
 * output path and writes no PNG file at all.
 *
 * Staged, then promoted
 * ---------------------
 * A candidate capture is encoded into `.tmp/` FIRST. Only after the size
 * budget, the rendered-card count and the zero-outbound-request
 * measurement have passed is it moved onto the committed path, so a
 * failed run leaves the previously committed artefact untouched.
 *
 * Usage:
 *   node scripts/capture-asset-license-review.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/legal/asset-license-review.webp)
 *   --json-out=<path>     report destination
 *                         (default .tmp/asset-license-review/report.json)
 *   --width=<n>           viewport width (default 1440)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import {
	createReadStream,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped module the capture renders. Importing it (not a copy) is the point. */
export const STORY_MODULE = 'src/legal/AssetLicenseReview.stories.tsx';

/** The exported gallery component inside that module. */
export const GALLERY_EXPORT = 'AssetLicenseReviewGallery';

/** Readiness marker the capture waits for before taking the screenshot. */
export const GALLERY_TEST_ID = 'asset-license-gallery';

/** Per-card marker, counted so an empty page cannot pass. */
export const REVIEW_TEST_ID = 'asset-license-review';

/** How many review cards the gallery renders (featured + held). */
export const EXPECTED_REVIEW_CARDS = 2;

/** The record the gallery renders: proof the screen has one real source. */
export const RECORD_RELATIVE_PATH = 'quality/asset-license-inventory.json';

export const HARNESS_DIR = '.tmp/asset-license-review/harness';
export const HARNESS_DIST = '.tmp/asset-license-review/harness-dist';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Where a candidate capture is encoded before it has passed every check. */
export const STAGING_DIR = '.tmp/asset-license-review/staging';

/** The staged candidate for an output path (pure). Always under `.tmp/`. */
export function stagedCapturePath(screenshot, repoRoot = REPO_ROOT) {
	return join(resolve(repoRoot, STAGING_DIR), basename(screenshot));
}

/**
 * Move a fully validated candidate onto the committed path (pure).
 *
 * Single write, and only after the checks: a failed run leaves the
 * committed artefact exactly as it was.
 */
export function promoteStagedCapture({ staged, screenshot, repoRoot = REPO_ROOT }) {
	const finalPath = resolve(repoRoot, screenshot);
	mkdirSync(dirname(finalPath), { recursive: true });
	renameSync(resolve(repoRoot, staged), finalPath);
	return finalPath;
}

/** Drop a candidate that was never promoted. Safe when it never existed. */
export function discardStagedCapture(staged, repoRoot = REPO_ROOT) {
	rmSync(resolve(repoRoot, staged), { force: true });
}

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return { bytes, kb: Math.round(bytes / 1024), withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES };
}

/** Reject an output path that is not WebP, or that leaves the repository (pure). */
export function assertWebpOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return rel;
}

/** The generated harness page. Deterministic, so the report can hash it. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>asset license review (#497)</title>
	</head>
	<body>
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
`;
}

/**
 * The generated harness entry point.
 *
 * It imports the SHIPPED story module — which itself imports the
 * committed record — so the capture, the Storybook surface and the
 * reviewed record cannot diverge.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${GALLERY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// The shipped gallery. Rendering the component the Storybook story
// renders is what keeps this capture from photographing a copy.
createRoot(container).render(<${GALLERY_EXPORT} />);
`;
}

/**
 * The generated Vite config (harness root, repository PostCSS config).
 *
 * `outDir` is emitted ABSOLUTE on purpose: Vite resolves a relative
 * `outDir` against `root`, which here is already inside `.tmp/`, and the
 * build would then land in `.tmp/asset-license-review/harness/.tmp/…`.
 */
export function harnessViteConfig(harnessDir = HARNESS_DIR, repoRoot = REPO_ROOT) {
	const outDir = join(repoRoot, HARNESS_DIST);
	return `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	root: '${harnessDir}',
	base: './',
	plugins: [react()],
	css: {
		// The repository's Panda config: layer order, tokens and recipes
		// come from ${join(repoRoot, 'postcss.config.mjs')} so the capture
		// shows the shipped editorial CSS rather than browser defaults.
		postcss: '${join(repoRoot, 'postcss.config.mjs')}',
	},
	build: {
		outDir: '${outDir}',
		emptyOutDir: true,
	},
});
`;
}

/** Content types the generated harness build needs. */
const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.map': 'application/json; charset=utf-8',
};

/**
 * Whether a request URL is the loopback harness itself (pure).
 *
 * The report claims the capture issues no third-party request. That
 * claim is MEASURED with this predicate over Playwright's request events
 * rather than asserted as a literal.
 */
export function isLoopbackRequestUrl(url) {
	try {
		const { hostname } = new URL(url);
		return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
	} catch {
		return false;
	}
}

/**
 * Resolve one request path inside the served root (pure).
 *
 * Kept separate from the HTTP wiring so the traversal rule is testable
 * without a socket: a request may never leave the served directory, a
 * directory request falls back to its `index.html`, and a path that is
 * not valid percent-encoding is refused as a bad request instead of
 * throwing out of the request listener.
 */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	let decoded;
	try {
		decoded = decodeURIComponent(requestPath);
	} catch {
		return { status: 400, file: null };
	}
	const candidate = resolve(base, `.${decoded}`);
	if (candidate !== base && !candidate.startsWith(`${base}/`)) {
		return { status: 403, file: null };
	}
	const isDirectory = existsSync(candidate) && statSync(candidate).isDirectory();
	const target = existsSync(candidate) && !isDirectory ? candidate : join(candidate, 'index.html');
	if (!existsSync(target)) return { status: 404, file: null };
	return {
		status: 200,
		file: target,
		contentType: CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
	};
}

/** Serve `root` over loopback on an ephemeral port, for the duration of the capture. */
export function serveDirectory(root) {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const resolved = resolveStaticTarget(root, url.pathname);
		if (resolved.status !== 200) {
			const body =
				resolved.status === 403
					? 'forbidden'
					: resolved.status === 400
						? 'bad request'
						: 'not found';
			res.writeHead(resolved.status).end(body);
			return;
		}
		res.writeHead(200, { 'content-type': resolved.contentType });
		createReadStream(resolved.file).pipe(res);
	});
	return new Promise((resolveServer) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolveServer({
				baseUrl: `http://127.0.0.1:${port}`,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections?.();
						server.close(() => done());
					}),
			});
		});
	});
}

export function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/legal/asset-license-review.webp',
		jsonOut: '.tmp/asset-license-review/report.json',
		width: 1440,
		build: true,
		capture: true,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = (
			arg.startsWith('--') ? arg.slice(2, separator === -1 ? undefined : separator) : arg
		).replace(/^--/, '');
		const value = separator === -1 ? null : arg.slice(separator + 1);
		switch (flag) {
			case 'screenshot':
				options.screenshot = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'width':
				options.width = Number(value);
				break;
			case 'no-build':
				options.build = false;
				break;
			case 'no-capture':
				options.capture = false;
				break;
			default:
				throw new Error(`unknown option: --${flag}`);
		}
	}
	return options;
}

function ensureDir(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

/** Write the generated harness (idempotent, so `--no-build` can reuse it). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	writeFileSync(join(dir, 'main.tsx'), harnessMainTsx());
	writeFileSync(join(dir, 'vite.config.ts'), harnessViteConfig(HARNESS_DIR, repoRoot));
	return dir;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const harness = writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the asset license review harness…\n');
		execFileSync(
			'pnpm',
			['exec', 'vite', 'build', '--config', join(HARNESS_DIR, 'vite.config.ts')],
			{ cwd: REPO_ROOT, stdio: 'inherit' },
		);
	} else {
		process.stdout.write('[capture] reusing the existing harness build\n');
	}
	if (!existsSync(join(distRoot, 'index.html'))) {
		throw new Error(`harness build produced no ${HARNESS_DIST}/index.html`);
	}

	const server = await serveDirectory(distRoot);
	let capture = null;
	/** Measured, not asserted: every non-loopback URL the page requested. */
	const outboundUrls = [];
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			// Imported lazily so a `--no-capture` run needs no browser.
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const stagedPath = stagedCapturePath(options.screenshot);
			ensureDir(stagedPath);
			const browser = await chromium.launch();
			try {
				const page = await browser.newPage({
					viewport: { width: options.width, height: 900 },
					deviceScaleFactor: 1,
				});
				page.on('request', (request) => {
					if (!isLoopbackRequestUrl(request.url())) outboundUrls.push(request.url());
				});
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				// The gallery's own marker is the readiness signal: without
				// it the capture would photograph an empty page and still
				// write a plausible-looking artefact.
				await page.waitForSelector(`[data-testid="${GALLERY_TEST_ID}"]`, { timeout: 30_000 });
				const cards = await page.locator(`[data-testid="${REVIEW_TEST_ID}"]`).count();
				const decisions = await page
					.locator(`[data-testid="${REVIEW_TEST_ID}"]`)
					.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-decision')));
				const png = await page.screenshot({ fullPage: true, type: 'png' });
				await sharp(png)
					.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
					.webp({ quality: SCREENSHOT_QUALITY })
					.toFile(stagedPath);
				const meta = await sharp(stagedPath).metadata();
				const verdict = screenshotBudgetVerdict(statSync(resolve(REPO_ROOT, stagedPath)).size);
				capture = {
					artefact: options.screenshot,
					component: `${STORY_MODULE}#${GALLERY_EXPORT}`,
					viewport: { width: options.width, height: 900 },
					deviceScaleFactor: 1,
					cardsRendered: cards,
					decisionsRendered: decisions,
					width: meta.width ?? null,
					height: meta.height ?? null,
					quality: SCREENSHOT_QUALITY,
					...verdict,
				};
				if (!verdict.withinBudget) {
					throw new Error(
						`capture is ${verdict.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
					);
				}
				if (cards !== EXPECTED_REVIEW_CARDS) {
					throw new Error(`expected ${EXPECTED_REVIEW_CARDS} review cards, found ${cards}`);
				}
				if (outboundUrls.length > 0) {
					throw new Error(
						`the gallery renders a committed record but issued ${outboundUrls.length} non-loopback request(s): ${outboundUrls.join(', ')}`,
					);
				}
				// Every check passed: replace the committed artefact once.
				promoteStagedCapture({ staged: stagedPath, screenshot: options.screenshot });
				process.stdout.write(
					`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${cards} cards [${decisions.join(', ')}], ${verdict.kb} kB)\n`,
				);
			} finally {
				await browser.close();
				// A candidate that was never promoted never reaches the tree.
				discardStagedCapture(stagedPath);
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#497',
		generatedBy: 'scripts/capture-asset-license-review.mjs',
		component: {
			module: STORY_MODULE,
			export: GALLERY_EXPORT,
			testId: GALLERY_TEST_ID,
			reviewTestId: REVIEW_TEST_ID,
		},
		record: RECORD_RELATIVE_PATH,
		recordSha256: execFileSync(
			'sh',
			['-c', `shasum -a 256 ${RECORD_RELATIVE_PATH} | cut -d" " -f1`],
			{
				cwd: REPO_ROOT,
				encoding: 'utf8',
			},
		).trim(),
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, dist: HARNESS_DIST, root: harness },
		// Observed over Playwright request events, not asserted: `null` on a
		// `--no-capture` run, where no browser ever opened.
		outboundRequests: capture === null ? null : outboundUrls.length,
		outboundRequestUrls: outboundUrls,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			stagingDir: STAGING_DIR,
			issuePathSubstituted:
				'docs/verification/legal/asset-license-review.png -> .webp (repository convention: verification artefacts are compressed WebP, never PNG)',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] report ${options.jsonOut}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`capture failed: ${error.message}\n`);
		process.exit(1);
	});
}
