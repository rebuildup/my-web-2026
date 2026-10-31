#!/usr/bin/env node
/**
 * capture-audience-purpose-matrix — capture the Issue #516 verification
 * screen into `docs/verification/vision/audience-purpose-matrix.webp`.
 *
 * What this captures
 * ------------------
 * The SHIPPED preview of the editorial policy: the Storybook story
 * `src/personal/audience-purpose/AudiencePurposeMatrix.stories.tsx`
 * rendering the data the policy document is proved against. The capture
 * is not a drawing of the policy — it is the policy's own preview, so a
 * screenshot in a pull request cannot show something the site does not
 * render.
 *
 * It is also an ASSERTION, not only a picture. From the rendered DOM it
 * reads the document title, the section headings, the two tables
 * (caption, header row, body rows) and every bullet, and compares them
 * with the preview data module. A preview that stopped rendering a
 * section, a table or a bullet fails the capture instead of producing a
 * flattering image of half the policy. It also reads whether the
 * document scrolls sideways at the capture width (WCAG 2.2 SC 1.4.10
 * Reflow).
 *
 * Why a generated harness instead of `storybook dev`
 * ---------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, and the `@cloudflare/vite-plugin`
 * + TanStack Start plugins in it take over the output. That defect is
 * recorded in `scripts/capture-error-state-gallery.mjs` (Issue #501)
 * and `scripts/capture-a11y-table-code.mjs` (Issue #407).
 *
 * `storybook dev` itself DOES start and DOES render the stories
 * (measured 2026-10-31: `pnpm exec storybook dev --port 6013` serves
 * the index and `iframe.html?id=<story id>` renders the story; the
 * `Missing required secrets for Worker "my-web-2026"` line it prints
 * is a warning, not a startup failure). The capture still uses a
 * harness so that it does not depend on a long-lived dev server, so
 * that the DOM assertions run inside the same command as the capture,
 * and so that its result does not depend on the Storybook builder.
 * The harness below imports the SHIPPED story module and renders the
 * shipped story's component with the shipped story's args — the same
 * tree Storybook renders — through a local Vite build, so the capture
 * and the Storybook surface cannot drift apart.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, and no secret
 *     is read or printed. The preview data is literals in the source.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records the conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #516 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is encoded with the existing `sharp`
 * devDependency at width <= 1600 / quality 80, and the committed file
 * is the `.webp` sibling of the Issue's path. The script REFUSES any
 * non-`.webp` output path.
 *
 * Usage:
 *   node scripts/capture-audience-purpose-matrix.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/vision/audience-purpose-matrix.webp)
 *   --json-out=<path>     report destination
 *                         (default .tmp/audience-purpose-matrix/report.json)
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
import {
	AUDIENCE_PURPOSE_SECTIONS,
	AUDIENCE_PURPOSE_TITLE,
} from '../src/personal/audience-purpose/AudiencePurposeMatrix.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE = 'src/personal/audience-purpose/AudiencePurposeMatrix.stories.tsx';

/** The component the shipped story renders. */
export const COMPONENT_EXPORT = 'AudiencePurposeMatrixPreview';

/** The shipped story whose args the capture renders the component with. */
export const STORY_EXPORT = 'Preview';

export const HARNESS_DIR = '.tmp/audience-purpose-matrix/harness';
export const HARNESS_DIST = '.tmp/audience-purpose-matrix/harness-dist';

/** The one committed artefact path (the Issue names the `.png` sibling). */
export const DEFAULT_ARTEFACT_PATH = 'docs/verification/vision/audience-purpose-matrix.webp';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1440;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
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
	return resolve(repoRoot, path);
}

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>訪問者目的別の編集方針 preview (#516)</title>
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
 * It renders the SHIPPED component with the SHIPPED story's args, which
 * is what Storybook renders for that story, and it loads the shipped
 * global stylesheet so the capture shows the same Panda layer order a
 * reader sees.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${COMPONENT_EXPORT}, ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// Storybook renders \`meta.component\` with \`story.args\`; the capture
// renders the same pair, so the two surfaces cannot drift apart.
createRoot(container).render(<${COMPONENT_EXPORT} {...${STORY_EXPORT}.args} />);
`;
}

/** The generated Vite config (harness root, repo PostCSS config). */
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

/** Resolve one request path inside the served root (pure). */
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
 * Compare the rendered DOM with the preview data (pure).
 *
 * The observation is what the browser read; the sections are what the
 * policy says. The failures are the difference, so a capture that shows
 * half the policy cannot be published as evidence of the whole policy.
 */
export function verifyRenderedPolicy(observation, sections = AUDIENCE_PURPOSE_SECTIONS) {
	const failures = [];
	const expectedHeadings = sections.map((section) => section.heading);
	const renderedHeadings = (observation.headings ?? [])
		.filter((heading) => heading.level === 'H2')
		.map((heading) => heading.text);

	if (observation.title !== AUDIENCE_PURPOSE_TITLE) {
		failures.push(
			`the document title is "${observation.title}", expected "${AUDIENCE_PURPOSE_TITLE}"`,
		);
	}
	if (renderedHeadings.join('\n') !== expectedHeadings.join('\n')) {
		failures.push(
			`the rendered sections are [${renderedHeadings.join(' | ')}], expected [${expectedHeadings.join(' | ')}]`,
		);
	}

	const expectedTables = sections.filter((section) => section.matrix);
	const renderedTables = observation.tables ?? [];
	if (renderedTables.length !== expectedTables.length) {
		failures.push(
			`the preview rendered ${renderedTables.length} table(s), expected ${expectedTables.length}`,
		);
	}
	for (const [index, expected] of expectedTables.entries()) {
		const rendered = renderedTables[index];
		if (!rendered) {
			failures.push(`the table "${expected.matrix.caption}" is missing from the preview`);
			continue;
		}
		if (rendered.caption !== expected.matrix.caption) {
			failures.push(
				`the table caption is "${rendered.caption}", expected "${expected.matrix.caption}"`,
			);
		}
		if (rendered.header.join('\n') !== expected.matrix.columns.join('\n')) {
			failures.push(
				`the table header is [${rendered.header.join(' | ')}], expected [${expected.matrix.columns.join(' | ')}]`,
			);
		}
		const expectedRows = expected.matrix.rows.map((row) => row.join('\n'));
		const renderedRows = rendered.rows.map((row) => row.join('\n'));
		if (renderedRows.join('\n---\n') !== expectedRows.join('\n---\n')) {
			failures.push(
				`the table body of "${expected.matrix.caption}" does not match the preview data`,
			);
		}
	}

	const expectedBullets = sections.flatMap((section) => [...(section.points ?? [])]);
	const renderedBullets = observation.bullets ?? [];
	if (renderedBullets.join('\n') !== expectedBullets.join('\n')) {
		failures.push(
			`the preview rendered ${renderedBullets.length} bullet(s), expected ${expectedBullets.length}`,
		);
	}

	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`the preview scrolls sideways (${observation.scrollWidth}px > ${observation.clientWidth}px)`,
		);
	}

	return { ok: failures.length === 0, failures };
}

/** Read the rendered facts out of the page. Runs inside Chromium. */
export const READ_DOCUMENT = () => {
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	return {
		title: text(document.querySelector('h1')),
		headings: [...document.querySelectorAll('h1, h2')].map((element) => ({
			level: element.tagName,
			text: text(element),
		})),
		tables: [...document.querySelectorAll('table')].map((table) => ({
			caption: text(table.querySelector('caption')),
			header: [...table.querySelectorAll('thead th')].map(text),
			rows: [...table.querySelectorAll('tbody tr')].map((row) => [...row.children].map(text)),
		})),
		bullets: [...document.querySelectorAll('li')].map(text),
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	};
};

function parseArgs(argv) {
	const options = {
		screenshot: DEFAULT_ARTEFACT_PATH,
		jsonOut: '.tmp/audience-purpose-matrix/report.json',
		width: 1440,
		height: 900,
		build: true,
		capture: true,
	};
	for (const arg of argv) {
		if (arg === '--no-build') {
			options.build = false;
			continue;
		}
		if (arg === '--no-capture') {
			options.capture = false;
			continue;
		}
		if (arg.startsWith('--screenshot=')) {
			options.screenshot = arg.slice('--screenshot='.length);
			continue;
		}
		if (arg.startsWith('--json-out=')) {
			options.jsonOut = arg.slice('--json-out='.length);
			continue;
		}
		if (arg.startsWith('--width=')) {
			options.width = Number(arg.slice('--width='.length));
			continue;
		}
		if (arg.startsWith('--height=')) {
			options.height = Number(arg.slice('--height='.length));
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const artefactPath = assertWebpOutputPath(options.screenshot);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);

	if (options.build) {
		process.stdout.write('[capture] building the audience-purpose harness…\n');
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
	let observation = null;
	let verdict = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: 2,
					colorScheme: 'light',
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'networkidle' });
				observation = await page.evaluate(READ_DOCUMENT);
				verdict = verifyRenderedPolicy(observation);
				if (!verdict.ok) {
					throw new Error(
						`the rendered preview does not match the policy data:\n  - ${verdict.failures.join('\n  - ')}`,
					);
				}
				const png = await page.screenshot({ fullPage: true });
				mkdirSync(dirname(artefactPath), { recursive: true });
				await sharp(png)
					.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
					.webp({ quality: SCREENSHOT_QUALITY })
					.toFile(artefactPath);
				const meta = await sharp(artefactPath).metadata();
				const budget = screenshotBudgetVerdict(statSync(artefactPath).size);
				process.stdout.write(
					`[capture] wrote ${relative(REPO_ROOT, artefactPath)} (${meta.width}x${meta.height}, ${budget.kb} KB, within budget: ${budget.withinBudget})\n`,
				);
				if (!budget.withinBudget) {
					throw new Error(
						`the artefact is ${budget.kb} KB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} KB budget; narrow the capture or lower the quality before committing it`,
					);
				}
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		artefact: relative(REPO_ROOT, artefactPath),
		story: { module: STORY_MODULE, component: COMPONENT_EXPORT, story: STORY_EXPORT },
		conditions: {
			viewport: { width: options.width, height: options.height },
			deviceScaleFactor: 2,
			colorScheme: 'light',
			waitUntil: 'networkidle',
			screenshot: 'fullPage',
			encode: { width: SCREENSHOT_MAX_WIDTH, quality: SCREENSHOT_QUALITY, format: 'webp' },
		},
		observation,
		verdict,
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
	};
	const reportPath = resolve(REPO_ROOT, options.jsonOut);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] report: ${relative(REPO_ROOT, reportPath)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`capture failed: ${error.message}\n`);
		process.exit(1);
	});
}
