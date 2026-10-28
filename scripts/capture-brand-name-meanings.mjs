#!/usr/bin/env node

/**
 * capture-brand-name-meanings — capture the Issue #521 brand naming
 * preview into `docs/verification/brand/361do-name-meanings.webp`.
 *
 * What this captures
 * ------------------
 * The shipped Storybook story
 * (`src/personal/brand-naming/BrandNameMeanings.stories.tsx`,
 * export `Standard`) rendered in one Chromium: the name `361do`, the
 * state of its symbol, the five competing readings and the short copy
 * candidates — the public half of `docs/brand/361do-name-meanings.md`.
 *
 * Why a generated harness instead of `storybook dev`
 * --------------------------------------------------
 * The brief asks for the screenshot to come from the Storybook story,
 * and it does: the harness imports the SHIPPED story module and
 * renders that story's own `render()` output, so the capture and the
 * Storybook surface cannot drift apart. The Storybook SERVER cannot be
 * used to take it, though: `pnpm exec storybook dev` in this repository
 * merges the project's `vite.config.ts`, whose `@cloudflare/vite-plugin`
 * requires Worker secrets and refuses to start without them — the
 * same defect that makes `pnpm run build-storybook` emit a manager-only
 * build (recorded in `scripts/capture-error-state-gallery.mjs`,
 * Issue #501). The harness is the repository's established answer to
 * that defect, so this capture follows it.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, and no secret
 *     value is read or printed. The preview data is literals in the
 *     source file.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules loaded from `file://`,
 *     which is the only reason an origin exists at all.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #521 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is taken to `.tmp/`, encoded with the existing
 * `sharp` devDependency at width <= 1600 / quality 80, and the
 * committed file is the `.webp` sibling of the Issue's path. The script
 * REFUSES any non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-brand-name-meanings.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/brand/361do-name-meanings.webp)
 *   --png=<path>          temporary PNG capture
 *                         (default .tmp/brand-name-meanings/capture.png)
 *   --json-out=<path>     report destination
 *                         (default .tmp/brand-name-meanings/report.json)
 *   --width=<n>           viewport width (default 1440)
 *   --height=<n>          viewport height (default 900)
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
 * `Standard` is the story that shows the whole public record; the
 * harness imports this module directly, so renaming the story or moving
 * the preview makes the capture fail loudly instead of quietly
 * photographing an empty page.
 */
export const STORY_MODULE = 'src/personal/brand-naming/BrandNameMeanings.stories.tsx';
export const STORY_EXPORT = 'Standard';

/** Readiness marker the capture waits for before taking the screenshot. */
export const READY_SELECTOR = '[data-brand-name-meanings-preview]';

export const HARNESS_DIR = '.tmp/brand-name-meanings/harness';
export const HARNESS_DIST = '.tmp/brand-name-meanings/harness-dist';

/**
 * Committed captures are WebP: width cap, quality, and a size budget.
 *
 * The budget is the one `scripts/capture-error-state-gallery.mjs`
 * declares for the first committed verification image, so the two
 * artefacts are comparable.
 */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/**
 * Whether a capture fits the verification-artefact budget (pure).
 *
 * @param {number} bytes
 */
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
 *
 * @param {string} path
 * @param {string} [repoRoot]
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
		<title>361do name meanings preview (#521)</title>
	</head>
	<body style="margin:0;background:#ffffff">
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
`;
}

/**
 * The generated harness entry point.
 *
 * It renders the SHIPPED story's `render()` output, so the capture
 * shows the same tree a Storybook reviewer sees. Panda's PostCSS
 * plugin is wired through the repository's own `postcss.config.mjs`,
 * which is what makes `src/styles.css` resolve to the real editorial
 * layer order and tokens.
 *
 * @param {string} [harnessDir]
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// \`${STORY_EXPORT}.render()\` is the shipped story. Rendering it through
// Storybook's own story object is what keeps this capture and the
// Storybook surface from drifting apart.
createRoot(container).render(<>{${STORY_EXPORT}.render?.()}</>);
`;
}

/**
 * The generated Vite config (harness root, repo PostCSS config).
 *
 * `outDir` is emitted ABSOLUTE on purpose: Vite resolves a relative
 * `outDir` against `root`, which here is already inside `.tmp/`, and
 * the build would then land in `.tmp/brand-name-meanings/harness/.tmp/…`.
 *
 * @param {string} [harnessDir]
 * @param {string} [repoRoot]
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
 * @param {string} root
 * @param {string} requestPath
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
 *
 * @param {string} root
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

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/brand/361do-name-meanings.webp',
		png: '.tmp/brand-name-meanings/capture.png',
		jsonOut: '.tmp/brand-name-meanings/report.json',
		width: 1440,
		height: 900,
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

/**
 * @param {string} path
 */
function ensureDir(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

/**
 * Write the generated harness (idempotent, so `--no-build` can reuse it).
 *
 * @param {string} [repoRoot]
 */
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
		process.stdout.write('[capture] building the brand naming harness…\n');
		execFileSync(
			'pnpm',
			['exec', 'vite', 'build', '--config', join(HARNESS_DIR, 'vite.config.ts')],
			{
				cwd: REPO_ROOT,
				stdio: 'inherit',
			},
		);
	} else {
		process.stdout.write('[capture] reusing the existing harness build\n');
	}
	if (!existsSync(join(distRoot, 'index.html'))) {
		throw new Error(`harness build produced no ${HARNESS_DIST}/index.html`);
	}

	const server = await serveDirectory(distRoot);
	let capture = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			// Imported lazily so a `--no-capture` run needs no browser.
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			ensureDir(options.png);
			const browser = await chromium.launch();
			try {
				const page = await browser.newPage({
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: 1,
				});
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				// The preview's own marker is the readiness signal: without it
				// the capture would photograph an empty page and still write a
				// plausible-looking artefact.
				await page.waitForSelector(READY_SELECTOR, { timeout: 30_000 });
				const png = await page.screenshot({ fullPage: true, type: 'png' });
				const outPath = resolve(REPO_ROOT, options.screenshot);
				ensureDir(options.screenshot);
				await sharp(png)
					.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
					.webp({ quality: SCREENSHOT_QUALITY })
					.toFile(outPath);
				const meta = await sharp(outPath).metadata();
				// `metadata()` carries dimensions but not the encoded byte size,
				// so the budget is measured from the file on disk.
				const verdict = screenshotBudgetVerdict(statSync(outPath).size);
				capture = {
					artefact: options.screenshot,
					story: `${STORY_MODULE}#${STORY_EXPORT}`,
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: 1,
					width: meta.width ?? null,
					height: meta.height ?? null,
					quality: SCREENSHOT_QUALITY,
					...verdict,
				};
				// The intermediate PNG never reaches the repository.
				rmSync(resolve(REPO_ROOT, options.png), { force: true });
				if (!verdict.withinBudget) {
					throw new Error(
						`capture is ${verdict.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
					);
				}
				process.stdout.write(
					`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${verdict.kb} kB)\n`,
				);
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#521',
		generatedBy: 'scripts/capture-brand-name-meanings.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, readySelector: READY_SELECTOR },
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
			issuePathSubstituted: 'docs/verification/brand/361do-name-meanings.png -> .webp',
			harness:
				'`pnpm exec storybook dev` cannot start in this repository (the Cloudflare Vite plugin requires Worker secrets), so the shipped story module is rendered through a generated Vite harness — the same answer as scripts/capture-error-state-gallery.mjs.',
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
