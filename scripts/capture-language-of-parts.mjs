#!/usr/bin/env node

/**
 * capture-language-of-parts — capture the Issue #409 language-of-parts
 * gallery for `docs/verification/a11y/mixed-language-content.webp`.
 *
 * What this captures
 * ------------------
 * `Gallery` from `src/editorial/language-of-parts.stories.tsx`: the
 * shipped `LanguageOfParts` in every state this Issue is about (正常 /
 * 空 / 失敗 / 縮小表示), with the WCAG mapping table that separates the
 * machine-checked rows from the human ones. It is the verification
 * screen for `docs/verification/a11y/mixed-language-content.md`.
 *
 * What is MEASURED, not just photographed
 * ---------------------------------------
 * A screenshot of a fixture proves nothing about the attribute, so the
 * capture reads the rendered document and fails when the reading and the
 * contract disagree:
 *
 *   - `document.documentElement.lang` must equal the policy's document
 *     language (SC 3.1.1). The harness page declares it, exactly as
 *     `src/routes/__root.tsx` declares it for the product.
 *   - every `[data-lang-part]` element must report the verdict its
 *     policy verdict predicts, and a run the policy tagged must carry
 *     the canonical tag while a refused one carries NO `lang` at all.
 *   - the `lang` values the live DOM carries must equal the values
 *     `expectedLanguageAttributes()` predicts, in document order.
 *     A renderer that forgot the attribute therefore fails the capture
 *     instead of producing a pretty picture of a broken document.
 *
 * The accessibility snapshot of each panel is recorded too: the claim
 * this Issue makes is that a `lang` changes the VOICE of a run, and the
 * snapshot is what proves the attribute did not also change the role or
 * the content of the run.
 *
 * Why a generated harness instead of the Storybook build
 * --------------------------------------------------------
 * `pnpm run build-storybook` merges the project's `vite.config.ts`
 * (Cloudflare + TanStack Start plugins) and emits a manager-only build;
 * fixing that is a different ticket. The harness is a small Vite app
 * generated into `.tmp/` that imports the story module DIRECTLY, so
 * this capture and the Storybook gallery cannot diverge — renaming the
 * story makes the capture fail loudly instead of photographing an
 * empty page.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret
 *     value is read or printed. The gallery is a fixture: it issues no
 *     request to anything.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules loaded from
 *     `file://`, which is the only reason an origin exists.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Issue #409 names a `.png` path, but Playwright cannot encode WebP and
 * a verification artefact does not justify a large binary in the tree.
 * The capture goes to `.tmp/`, is re-encoded with the existing `sharp`
 * devDependency (width <= 1600, quality 80, 300 kB budget), and the
 * committed file is the `.webp` sibling of the Issue's path. The script
 * REFUSES any non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-language-of-parts.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/mixed-language-content.webp)
 *   --png=<path>          temporary PNG capture
 *                         (default .tmp/a11y-mixed-language/capture.png)
 *   --json-out=<path>     report destination
 *                         (default .tmp/a11y-mixed-language/report.json)
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
 * The shipped story this capture renders.
 *
 * `Gallery` is the story that stacks every state; the harness imports
 * the module itself, so renaming the story or moving the gallery makes
 * the capture fail instead of quietly producing a stale artefact.
 * `scripts/check-language-of-parts.mjs` asserts these three constants
 * still agree with the story on disk (`capture-drift`).
 */
export const STORY_MODULE = 'src/editorial/language-of-parts.stories.tsx';
export const STORY_EXPORT = 'Gallery';
/** Readiness marker the capture waits for before taking the screenshot. */
export const GALLERY_TEST_ID = 'a11y-mixed-language-gallery';

export const HARNESS_DIR = '.tmp/a11y-mixed-language/harness';
export const HARNESS_DIST = '.tmp/a11y-mixed-language/harness-dist';

/** The language the harness page declares, as the product declares it. */
export const DOCUMENT_LANGUAGE = 'ja';

export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return { bytes, kb: Math.round(bytes / 1024), withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES };
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

/** The generated harness page. Deterministic, so the report can hash it. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="${DOCUMENT_LANGUAGE}">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>language-of-parts gallery (#409)</title>
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

/** The generated Vite config (harness root, repository PostCSS config). */
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

/**
 * Compare what the live DOM reported against what the shipped policy
 * predicts (pure) — the assertion that makes this a measurement.
 *
 * `observed` is one entry per rendered body: its fixture id, whether it
 * is the 320 px instance, and the `[data-lang-part]` runs the browser
 * found inside it. `expected` carries the same bodies with the values
 * the policy predicts (`resolveLanguageRuns` over the same fixture).
 * Returns a list of problems; an empty list is the pass.
 *
 * Matching is by `id:compact`, not by document order: the gallery's
 * panel order is a layout decision, and a capture that failed merely
 * because a panel moved would train people to regenerate the artefact
 * instead of reading the failure.
 */
export function auditObservedDom({ documentLanguage, observed, expected }) {
	const problems = [];
	if (documentLanguage !== expected.documentLanguage) {
		problems.push(
			`document.documentElement.lang is "${documentLanguage}", expected "${expected.documentLanguage}" (SC 3.1.1)`,
		);
	}
	if (observed.length !== expected.bodies.length) {
		problems.push(
			`the document rendered ${observed.length} bodies, the fixture declares ${expected.bodies.length}`,
		);
	}
	for (const body of expected.bodies) {
		const key = `${body.id}:${body.compact}`;
		const found = observed.find((entry) => `${entry.id}:${entry.compact}` === key);
		if (!found) {
			problems.push(`no rendered body for ${key}`);
			continue;
		}
		const observedTags = found.parts.map((part) => part.lang);
		if (observedTags.join(',') !== body.tags.join(',')) {
			problems.push(
				`${key}: rendered lang attributes are [${observedTags.join(', ')}], policy predicts [${body.tags.join(', ')}]`,
			);
		}
		const observedIds = found.parts.map((part) => part.id);
		if (observedIds.join(',') !== body.ids.join(',')) {
			problems.push(
				`${key}: rendered parts are [${observedIds.join(', ')}], policy expects [${body.ids.join(', ')}]`,
			);
		}
		for (const part of found.parts) {
			if (part.verdict === 'tagged' && part.lang === null) {
				problems.push(`part "${part.id}" is classified tagged but the DOM carries no lang`);
			}
			if (part.verdict !== 'tagged' && part.lang !== null) {
				problems.push(
					`part "${part.id}" is refused (${part.verdict}) but the DOM carries lang="${part.lang}"`,
				);
			}
		}
	}
	return problems;
}

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/a11y/mixed-language-content.webp',
		png: '.tmp/a11y-mixed-language/capture.png',
		jsonOut: '.tmp/a11y-mixed-language/report.json',
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
		process.stdout.write('[capture] building the language-of-parts harness…\n');
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

	// The expectations come from the SHIPPED policy, not from the
	// rendered document: comparing the document with itself would prove
	// nothing. One expectation per rendered body, keyed by
	// `<fixture id>:<compact>` — the `article` body is rendered twice
	// (full width + 320 px) and both instances carry the same attributes.
	const policy = await import('../src/i18n/language-of-parts.ts');
	const expectedBodies = [
		{ id: 'article', compact: false },
		{ id: 'plain', compact: false },
		{ id: 'refusals', compact: false },
		{ id: 'article', compact: true },
	].map(({ id, compact }) => {
		const fixture = policy.findLanguageDocument(id);
		if (!fixture) throw new Error(`fixture document "${id}" is missing`);
		const runs = policy.resolveLanguageRuns(fixture, policy.DOCUMENT_LANGUAGE);
		const partRuns = runs.filter((run) => run.part !== null);
		return {
			id,
			compact,
			// Only authored parts are compared: prose runs carry no
			// element, so they have nothing in the DOM to read back.
			tags: partRuns.map((run) => run.lang),
			ids: partRuns.map((run) => run.part?.id),
		};
	});
	const expectedRuns = { documentLanguage: policy.DOCUMENT_LANGUAGE, bodies: expectedBodies };

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
				// The gallery's own marker is the readiness signal: without
				// it the capture would photograph an empty page and still
				// write a plausible-looking artefact.
				await page.waitForSelector(`[data-testid="${GALLERY_TEST_ID}"]`, { timeout: 30_000 });
				const documentLanguage = await page.evaluate(() => document.documentElement.lang || null);
				const observedBodies = await page.$$eval('[data-language-document]', (nodes) =>
					nodes.map((node) => ({
						id: node.getAttribute('data-language-document'),
						state: node.getAttribute('data-language-case'),
						compact: node.getAttribute('data-language-compact') === 'true',
						parts: [...node.querySelectorAll('[data-lang-part]')].map((part) => ({
							id: part.getAttribute('data-lang-part'),
							lang: part.getAttribute('lang'),
							verdict: part.getAttribute('data-lang-verdict'),
						})),
					})),
				);
				const problems = auditObservedDom({
					documentLanguage,
					observed: observedBodies,
					expected: expectedRuns,
				});
				const accessibilitySnapshot = await page
					.locator('[data-language-document="article"][data-language-compact="false"]')
					.ariaSnapshot();
				const png = await page.screenshot({ fullPage: true, type: 'png' });
				const outPath = resolve(REPO_ROOT, options.screenshot);
				ensureDir(options.screenshot);
				await sharp(png)
					.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
					.webp({ quality: SCREENSHOT_QUALITY })
					.toFile(outPath);
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
					documentLanguage,
					bodies: observedBodies,
					parts: observedBodies.flatMap((body) => body.parts),
					accessibilitySnapshot,
					...verdict,
				};
				// The intermediate PNG never reaches the repository.
				rmSync(resolve(REPO_ROOT, options.png), { force: true });
				if (!verdict.withinBudget) {
					throw new Error(
						`capture is ${verdict.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
					);
				}
				if (problems.length > 0) {
					throw new Error(
						`the rendered document disagrees with the shipped policy:\n  ${problems.join('\n  ')}`,
					);
				}
				process.stdout.write(
					`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${verdict.kb} kB, ${capture.parts.length} parts, document lang "${documentLanguage}")\n`,
				);
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#409',
		generatedBy: 'scripts/capture-language-of-parts.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, testId: GALLERY_TEST_ID },
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, dist: HARNESS_DIST, entry: harnessIndexHtml() },
		policy: {
			documentLanguage: policy.DOCUMENT_LANGUAGE,
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/mixed-language-content.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
			humanRows:
				'SC 3.1.2 read aloud in VoiceOver / NVDA / Orca, and 320 px reflow, are NOT measured here and are reported as open in docs/verification/a11y/mixed-language-content.md',
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
