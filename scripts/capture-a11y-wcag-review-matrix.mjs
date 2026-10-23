#!/usr/bin/env node

/**
 * capture-a11y-wcag-review-matrix — capture the Issue #410 verification
 * screen into `docs/verification/a11y/wcag-review-matrix.webp`.
 *
 * What this captures
 * ------------------
 * Three things, in one image, because the Issue asks for all three:
 *
 *   1. **the states the manual review table covers, as they actually
 *      render** — the shipped form-state gallery
 *      (`src/editorial/forms/form-errors.stories.tsx#Gallery`), which is
 *      the surface the matrix reviews for SC 3.3.1 / 3.3.2 / 1.4.4 /
 *      1.4.12 / 4.1.3 / 2.5.8. The harness imports the story module
 *      DIRECTLY, so the picture cannot drift from the component: a
 *      renamed panel makes the capture fail instead of producing a
 *      plausible-looking artefact.
 *   2. **the assistive-technology result** — the accessibility tree
 *      Chromium resolves for the failure panel (the state a screen
 *      reader announces), printed beside the picture.
 *   3. **the verification report** — the gate's own summary, rendered
 *      by the gate's own renderer. The capture never decides anything
 *      the gate did not decide.
 *
 * The image is NOT a substitute for the review
 * --------------------------------------------
 * The picture proves that the states exist and that the browser resolves
 * the names it resolves. It does not perform the manual review, and it
 * is not a conformance claim: the header says so in the same words the
 * gate prints.
 *
 * Why a generated harness instead of the Storybook build
 * ------------------------------------------------------
 * `pnpm run build-storybook` merges the project's `vite.config.ts`
 * (Cloudflare + TanStack Start plugins) and emits a manager-only build;
 * fixing that is a different ticket. The harness is a small Vite app
 * generated into `.tmp/` that imports the story module DIRECTLY, so
 * this capture and the Storybook gallery cannot diverge.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The gallery is a fixture: it issues no request.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules loaded from `file://`,
 *     which is the only reason an origin exists.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Issue #410 names a `.png` path, but a verification artefact does not
 * justify a permanently large binary in the tree. The capture goes to
 * `.tmp/`, is re-encoded with the existing `sharp` devDependency (width
 * <= 1600, quality 80), and the committed file is the `.webp` sibling
 * of the Issue's path. The script REFUSES any non-`.webp` output path
 * and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-wcag-review-matrix.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/wcag-review-matrix.webp)
 *   --png=<path>          temporary PNG capture
 *                         (default .tmp/a11y-wcag-review-matrix/capture.png)
 *   --json-out=<path>    report destination
 *                         (default .tmp/a11y-wcag-review-matrix/report.json)
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
import { collectEvidence, renderGateSummary } from './check-a11y-wcag-review-matrix.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The shipped story this capture renders.
 *
 * `Gallery` is the story that stacks every state the matrix reviews;
 * the harness imports the module itself, so renaming the story or
 * moving the gallery makes the capture fail instead of quietly
 * producing a stale artefact.
 */
export const STORY_MODULE = 'src/editorial/forms/form-errors.stories.tsx';
export const STORY_EXPORT = 'Gallery';

/** Readiness marker the capture waits for before taking the screenshot. */
export const GALLERY_TEST_ID = 'a11y-form-error-gallery';

/**
 * The failure panel, snapshotted as an accessibility tree so the
 * picture records what the browser resolved (label, description, link
 * targets) instead of only what the markup intended.
 */
export const FAILURE_PANEL_TEST_ID = 'a11y-form-error-failure';

export const HARNESS_DIR = '.tmp/a11y-wcag-review-matrix/harness';
export const HARNESS_DIST = '.tmp/a11y-wcag-review-matrix/harness-dist';

/** The committed artefact. */
export const ARTEFACT = 'docs/verification/a11y/wcag-review-matrix.webp';

/** Committed captures are WebP: width cap, quality and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 400 * 1024;

/** How many lines of the accessibility tree the header prints. */
export const AX_TREE_MAX_LINES = 18;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
}

/** Reject an output path that is not WebP, or that leaves the repo (pure). */
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

/** Minimal XML / HTML escaping. */
export function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** The generated harness page. Deterministic, so the report can hash it. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>WCAG review matrix (#410)</title>
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
 * It renders the SHIPPED story's `render()` output, so the capture shows
 * the same tree a Storybook reviewer sees, styled by the repository's
 * own Panda configuration through `postcss.config.mjs`.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

createRoot(container).render(<>{${STORY_EXPORT}.render?.()}</>);
`;
}

/**
 * The generated Vite config (harness root, repository PostCSS config).
 *
 * `outDir` is ABSOLUTE on purpose: Vite resolves a relative `outDir`
 * against `root`, which is already inside `.tmp/`.
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
 * A request may never leave the served directory, and a directory
 * request falls back to its `index.html`.
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

/** Serve `root` over loopback on an ephemeral port, for the capture only. */
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
 * The header band: the report, the exclusion list and the accessibility
 * tree the browser resolved.
 *
 * The wording comes from the gate's own renderer, so the picture cannot
 * claim more than the gate decided.
 */
export function headerSvg({ gate, summary, accessibilitySnapshot, width = SCREENSHOT_MAX_WIDTH }) {
	const title =
		'WCAG 2.2 A/AA manual review matrix — the states, the report, the AX tree (Issue #410)';
	const automatic = gate.items
		.filter((item) => item.review?.state === 'auto-pass')
		.map((item) => item.id);
	const outstanding = gate.items
		.filter((item) => item.review?.state === 'not-reviewed')
		.map((item) => item.id);
	const lines = [
		`matrix: ${gate.matrixPath} (revision ${gate.updatedAt}, review window ${gate.reviewWindowDays} day(s))`,
		`${gate.items.length} item(s): ${gate.machineChecked} machine-checked, ${gate.humanReviewed} human review(s) — ${gate.humanVerified} human-verified, ${gate.outstanding} outstanding`,
		`machine-checked (an automatic pass is NOT a human verification): ${automatic.join(', ')}`,
		`human review outstanding (a person performs it): ${outstanding.length} item(s) — ${outstanding.slice(0, 6).join(', ')}${outstanding.length > 6 ? ', …' : ''}`,
		`excluded criteria: ${gate.excluded.map((entry) => `SC ${entry.sc}`).join(', ') || '(none)'}`,
		`scope decisions: ${gate.scopeDecisions.length} A/AA criteria are outside this table (listed in docs/verification/a11y/wcag-review-matrix.md)`,
		`states rendered below: ${STORY_MODULE}#${STORY_EXPORT} (正常 / 空欄 / 形式違反 / 失敗 / 縮小表示)`,
		`gate verdict: ${gate.violations.length} violation(s) — a green run means the TABLE is intact, not that the site conforms to WCAG 2.2 AA`,
		'',
		'assistive technology result — Chromium accessibility tree of the failure panel:',
	];
	const tree = String(accessibilitySnapshot ?? '')
		.split('\n')
		.filter((line) => line.trim().length > 0);
	const shown = tree.slice(0, AX_TREE_MAX_LINES);
	for (const line of shown) lines.push(`  ${line.trim()}`);
	if (tree.length > shown.length) {
		lines.push(`  … ${tree.length - shown.length} more line(s) in the report JSON`);
	}

	const rowTop = 34;
	const step = 17;
	const height = rowTop + lines.length * step + 16;
	const text = lines
		.map(
			(line, index) =>
				`<text x="16" y="${rowTop + index * step}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" fill="#1c2030">${escapeXml(line)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="21" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${text}
</svg>
`,
	};
}

/** Compose the artefact: the header band above the rendered states. */
export async function composeArtefact({ sharp, pagePng, headerFor, outPath }) {
	const page = await sharp(pagePng)
		.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
		.png()
		.toBuffer();
	const meta = await sharp(page).metadata();
	// The header band is as wide as the page it sits on, so the two
	// composite without a resize (a narrower band would leave a gap, a
	// wider one would fail the composite).
	const header = headerFor(meta.width ?? SCREENSHOT_MAX_WIDTH);
	const body = await sharp(page)
		.extend({
			top: header.height,
			bottom: 0,
			left: 0,
			right: 0,
			background: { r: 244, g: 239, b: 223 },
		})
		.png()
		.toBuffer();
	await sharp(body)
		.composite([{ input: Buffer.from(header.svg), left: 0, top: 0 }])
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(outPath);
	return {
		pageWidth: meta.width ?? null,
		pageHeight: meta.height ?? null,
		headerHeight: header.height,
	};
}

function parseArgs(argv) {
	const options = {
		screenshot: ARTEFACT,
		png: '.tmp/a11y-wcag-review-matrix/capture.png',
		jsonOut: '.tmp/a11y-wcag-review-matrix/report.json',
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

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the review-state harness…\n');
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

	const gate = collectEvidence({ repoRoot: REPO_ROOT });
	if (gate.violations.length > 0) {
		throw new Error(
			`the review matrix gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken record`,
		);
	}
	const summary = renderGateSummary(gate);

	const server = await serveDirectory(distRoot);
	let capture = null;
	let accessibilitySnapshot = null;
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
				// The gallery's own marker is the readiness signal: without it
				// the capture would photograph an empty page and still write a
				// plausible-looking artefact.
				await page.waitForSelector(`[data-testid="${GALLERY_TEST_ID}"]`, { timeout: 30_000 });
				accessibilitySnapshot = await page
					.locator(`[data-testid="${FAILURE_PANEL_TEST_ID}"]`)
					.ariaSnapshot();
				const png = await page.screenshot({ fullPage: true, type: 'png' });
				const outPath = resolve(REPO_ROOT, options.screenshot);
				ensureDir(options.screenshot);
				const geometry = await composeArtefact({
					sharp,
					pagePng: png,
					headerFor: (width) => headerSvg({ gate, summary, accessibilitySnapshot, width }),
					outPath,
				});
				const meta = await sharp(outPath).metadata();
				// `metadata()` carries dimensions but not the encoded byte
				// size, so the budget is measured from the file on disk.
				const verdict = screenshotBudgetVerdict(statSync(outPath).size);
				capture = {
					artefact: options.screenshot,
					story: `${STORY_MODULE}#${STORY_EXPORT}`,
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: 1,
					width: meta.width ?? null,
					height: meta.height ?? null,
					quality: SCREENSHOT_QUALITY,
					accessibilitySnapshot,
					...geometry,
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
					`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${capture.kb} kB)\n`,
				);
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#410',
		generatedBy: 'scripts/capture-a11y-wcag-review-matrix.mjs',
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
			accessibilitySnapshot:
				'.tmp/a11y-wcag-review-matrix/report.json#capture.accessibilitySnapshot (Chromium ariaSnapshot of the failure panel)',
			issuePathSubstituted: 'docs/verification/a11y/wcag-review-matrix.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
			notAConformanceClaim:
				'the picture shows the states, the report and the accessibility tree; it does not perform the manual review and it is not a WCAG conformance claim',
		},
		gate: {
			matrixPath: gate.matrixPath,
			updatedAt: gate.updatedAt,
			items: gate.items.length,
			machineChecked: gate.machineChecked,
			humanVerified: gate.humanVerified,
			outstanding: gate.outstanding,
			violations: gate.violations,
			summary,
		},
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] report ${options.jsonOut}\n`);
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`capture failed: ${error.message}\n`);
		process.exit(1);
	});
}
