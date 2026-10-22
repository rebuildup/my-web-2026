#!/usr/bin/env node

/**
 * capture-status-incident-context — capture the Issue #502 status /
 * incident-context gallery for
 * `docs/verification/ops/status-incident-context.webp`.
 *
 * What this captures
 * ------------------
 * The shipped status section with the two facts Issue #502 adds:
 *
 *   - a service that was NOT observed (no entry in the snapshot),
 *     rendered with its own word and its own silhouette, next to a
 *     service whose read FAILED — the two are different facts and the
 *     capture has to show that they read differently;
 *   - the known-incident block: the committed list, the explicit
 *     "no incidents recorded" state and the public tracker link, plus
 *     the record shape a real incident would render.
 *
 * Why a generated harness instead of the Storybook gallery
 * --------------------------------------------------------
 * `pnpm run build-storybook` in this repository currently emits a
 * MANAGER-ONLY static build (no `iframe.html`, no preview bundle): the
 * `@storybook/react-vite` builder merges the project's `vite.config.ts`,
 * and the `@cloudflare/vite-plugin` + TanStack Start plugins in it take
 * over the output. Fixing that Storybook build is a different ticket.
 * So the capture renders the SAME shipped story
 * (`src/home/status/tiles.stories.tsx`) through a small Vite harness
 * this script generates into `.tmp/`. The harness imports the story
 * module itself, so the capture and the Storybook surface cannot
 * diverge, and the component is reachable with NO Infisical, NO D1 and
 * NO R2 — the gallery renders fixture props only.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, and no secret
 *     value is read or printed. The only build is a local Vite build of
 *     a generated harness.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules loaded from `file://`,
 *     which is the only reason an origin exists at all.
 *   - The output is status-only: path, size, viewport. Never a secret.
 *   - Chromium screenshots are not byte-reproducible across processes, so
 *     the report records conditions instead of claiming a deterministic
 *     artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #502 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is taken to `.tmp/`, encoded with the existing
 * `sharp` devDependency at width <= 1600 / quality 80, and the committed
 * file is the `.webp` sibling of the Issue's path. The script REFUSES
 * any non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-status-incident-context.mjs [options]
 *
 *   --screenshot=<path>  committed desktop artefact destination
 *                         (default docs/verification/ops/status-incident-context.webp)
 *   --mobile=<path>      committed mobile artefact destination
 *                         (default docs/verification/ops/status-incident-context-mobile.webp)
 *   --png=<path>          temporary PNG capture (default .tmp/status-incident-context/capture.png)
 *   --json-out=<path>     report destination
 *                         (default .tmp/status-incident-context/report.json)
 *   --width=<n>           desktop viewport width (default 1440)
 *   --height=<n>          desktop viewport height (default 900)
 *   --mobile-width=<n>    mobile viewport width (default 390)
 *   --mobile-height=<n>   mobile viewport height (default 844)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The shipped story the capture renders.
 *
 * `IncidentContext` is the Issue #502 verification gallery: the
 * published surface (a service with no reading, an empty incident
 * list) next to the record shape. The harness imports this module
 * directly, so renaming the story or moving the gallery makes the
 * capture fail loudly instead of quietly photographing an empty page.
 */
export const STORY_MODULE = 'src/home/status/tiles.stories.tsx';
export const STORY_EXPORT = 'IncidentContext';

/** Readiness marker the capture waits for before taking the screenshot. */
export const GALLERY_TEST_ID = 'status-incident-context';

export const HARNESS_DIR = '.tmp/status-incident-context/harness';
export const HARNESS_DIST = '.tmp/status-incident-context/harness-dist';

/**
 * Committed captures are WebP: width cap, quality, and a size budget.
 *
 * The budget is the same one the Issue #501 gallery capture uses: a
 * screenshot is meant to be looked at, not to become a second copy of
 * the DOM in the repository history.
 */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** The desktop and the mobile viewport the artefact is captured at. */
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
}

/**
 * Reject an output path that is not WebP, or that leaves the repository
 * (pure).
 */
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
		<title>status incident context (#502)</title>
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
 * It renders the SHIPPED story's `render()` output with the story's own
 * `args`, so the capture shows the same tree a Storybook reviewer sees.
 * Panda's PostCSS plugin is wired through the repository's own
 * `postcss.config.mjs`, which is what makes `src/styles.css` resolve to
 * the real editorial layer order and tokens.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// \`${STORY_EXPORT}.render(args)\` is the shipped gallery. Rendering it
// through Storybook's own story object is what keeps this capture and
// the Storybook surface from drifting apart.
const story = ${STORY_EXPORT};
createRoot(container).render(<>{story.render?.(story.args)}</>);
`;
}

/**
 * The generated Vite config (harness root, repo PostCSS config).
 *
 * `outDir` is emitted ABSOLUTE on purpose: Vite resolves a relative
 * `outDir` against `root`, which here is already inside `.tmp/`, and
 * the build would then land in `.tmp/status-incident-context/harness/.tmp/…`.
 */
export function harnessViteConfig(harnessDir = HARNESS_DIR, repoRoot = REPO_ROOT) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	const outDir = join(repoRoot, HARNESS_DIST);
	return `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	root: '${harnessDir}',
	base: './',
	plugins: [react()],
	css: {
		// The repository's Panda config: layer order, tokens and recipes come
		// from ${up}postcss.config.mjs so the capture shows the shipped
		// editorial CSS rather than a bare browser default.
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
 * Resolve one request path inside the served root (pure).
 *
 * Kept separate from the HTTP wiring so the traversal rule is testable
 * without a socket: a request may never leave the served directory, and a
 * directory request falls back to its `index.html`.
 */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	const candidate = resolve(base, `.${decodeURIComponent(requestPath)}`);
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

/**
 * Serve `root` over loopback on an ephemeral port, for the duration of
 * the capture only.
 */
export function serveDirectory(root) {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const resolved = resolveStaticTarget(root, url.pathname);
		if (resolved.status !== 200) {
			res.writeHead(resolved.status).end(resolved.status === 403 ? 'forbidden' : 'not found');
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

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/ops/status-incident-context.webp',
		mobile: 'docs/verification/ops/status-incident-context-mobile.webp',
		png: '.tmp/status-incident-context/capture.png',
		jsonOut: '.tmp/status-incident-context/report.json',
		width: DESKTOP_VIEWPORT.width,
		height: DESKTOP_VIEWPORT.height,
		mobileWidth: MOBILE_VIEWPORT.width,
		mobileHeight: MOBILE_VIEWPORT.height,
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
			case 'mobile':
				options.mobile = value;
				break;
			case 'png':
				options.png = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'width':
				options.width = Number(value);
				break;
			case 'height':
				options.height = Number(value);
				break;
			case 'mobile-width':
				options.mobileWidth = Number(value);
				break;
			case 'mobile-height':
				options.mobileHeight = Number(value);
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

/**
 * Capture one viewport of the harness (pure decision, the I/O is in the
 * caller).
 */
export async function captureViewport(browser, baseUrl, { width, height, output, png }) {
	const sharp = (await import('sharp')).default;
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
	await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
	// The gallery's own marker is the readiness signal: without it the
	// capture would photograph an empty page and still write a
	// plausible-looking artefact.
	await page.waitForSelector(`[data-testid="${GALLERY_TEST_ID}"]`, { timeout: 30_000 });
	const shot = await page.screenshot({ fullPage: true, type: 'png' });
	ensureDir(png);
	writeFileSync(resolve(REPO_ROOT, png), shot);
	const outPath = resolve(REPO_ROOT, output);
	ensureDir(output);
	await sharp(shot)
		.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(outPath);
	const meta = await sharp(outPath).metadata();
	const verdict = screenshotBudgetVerdict(statSync(outPath).size);
	// The intermediate PNG never reaches the repository.
	rmSync(resolve(REPO_ROOT, png), { force: true });
	return {
		artefact: output,
		viewport: { width, height },
		deviceScaleFactor: 1,
		width: meta.width ?? null,
		height: meta.height ?? null,
		quality: SCREENSHOT_QUALITY,
		...verdict,
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) {
		assertWebpOutputPath(options.screenshot);
		assertWebpOutputPath(options.mobile);
	}

	const harness = writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the status incident harness…\n');
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
	const captures = [];
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			// Imported lazily so a `--no-capture` run needs no browser.
			const { chromium } = await import('@playwright/test');
			const browser = await chromium.launch();
			try {
				const desktop = await captureViewport(browser, server.baseUrl, {
					width: options.width,
					height: options.height,
					output: options.screenshot,
					png: options.png,
				});
				captures.push(desktop);
				process.stdout.write(
					`[capture] wrote ${desktop.artefact} (${desktop.width}x${desktop.height}, ${desktop.kb} kB, viewport ${desktop.viewport.width}x${desktop.viewport.height})\n`,
				);
				const mobile = await captureViewport(browser, server.baseUrl, {
					width: options.mobileWidth,
					height: options.mobileHeight,
					output: options.mobile,
					png: options.png,
				});
				captures.push(mobile);
				process.stdout.write(
					`[capture] wrote ${mobile.artefact} (${mobile.width}x${mobile.height}, ${mobile.kb} kB, viewport ${mobile.viewport.width}x${mobile.viewport.height})\n`,
				);
				for (const capture of captures) {
					if (!capture.withinBudget) {
						throw new Error(
							`capture ${capture.artefact} is ${capture.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
						);
					}
				}
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#502',
		generatedBy: 'scripts/capture-status-incident-context.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, testId: GALLERY_TEST_ID },
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, dist: HARNESS_DIST, entry: harnessIndexHtml() },
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/ops/status-incident-context.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
			externalCommunication: 'none — the harness renders fixture props offline',
		},
		captures,
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
