#!/usr/bin/env node
/**
 * capture-tech-interests — capture the Issue #528 verification screen
 * into `docs/verification/influences/tech-interests-preview.webp`.
 *
 * What this captures
 * ------------------
 * The SHIPPED preview of the tech-interest inventory: the Storybook
 * story `src/personal/tech-interests/TechInterests.stories.tsx`
 * rendering the data the record `docs/influences/tech-interests.md`
 * is proved against. The capture is not a drawing of the record — it
 * is the record's own preview, so a screenshot in a pull request
 * cannot show something the site does not render.
 *
 * It is also an ASSERTION, not only a picture. From the rendered DOM
 * it reads the document title, every section heading, every section
 * summary, every prose point, every entry (name / state label /
 * observation date), and the two derived lists (`現在の推奨` and
 * `保留`), and compares them with the preview data module. A preview
 * that stopped rendering a section, a point or an entry fails the
 * capture instead of producing a flattering picture of half the
 * inventory. It also reads whether the document scrolls sideways at
 * the capture width (WCAG 2.2 SC 1.4.10 Reflow).
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
 * shipped story's OWN `render` output — the very tree Storybook
 * renders for that story — through a local Vite build, so the capture
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
 * A verification artefact does not justify a permanently large binary
 * in the tree. The capture is encoded with the existing `sharp`
 * devDependency at width <= 1440 / quality 80, and the committed file
 * is the `.webp` artefact the record names. The script REFUSES any
 * non-`.webp` output path.
 *
 * Usage:
 *   node scripts/capture-tech-interests.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/influences/tech-interests-preview.webp)
 *   --json-out=<path>     report destination
 *                         (default .tmp/tech-interests/report.json)
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
	CURRENT_RECOMMENDATIONS,
	INTEREST_CATEGORY_LABELS,
	INTEREST_STATE_LABELS,
	SUPERSEDED_OBSERVATIONS,
	TECH_INTEREST_ENTRIES,
	TECH_INTEREST_SECTIONS,
} from '../src/personal/tech-interests/TechInterests.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE = 'src/personal/tech-interests/TechInterests.stories.tsx';

/** The shipped story whose `render` output the capture renders. */
export const STORY_EXPORT = 'Default';

export const HARNESS_DIR = '.tmp/tech-interests/harness';
export const HARNESS_DIST = '.tmp/tech-interests/harness-dist';

/** The one committed artefact path. */
export const DEFAULT_ARTEFACT_PATH = 'docs/verification/influences/tech-interests-preview.webp';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1440;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/**
 * The width the committed artefact is encoded at.
 *
 * The inventory is long: every entry is rendered as a card (name,
 * state, category, observation date, evidence, note), and the whole
 * inventory is drawn twice — once under its state section and once
 * under the derived `現在の推奨` list. The full-page capture at the
 * 1440 px viewport therefore costs more than the 300 kB budget a
 * committed verification artefact may occupy, and the budget is never
 * raised to fit a bigger picture. The artefact is encoded narrower
 * instead: the same page, downsampled, stays inside the budget.
 */
export const ARTEFACT_WIDTH = 860;

/** The device pixel ratio of the capture (the artefact is downsampled). */
export const SCREENSHOT_DEVICE_SCALE_FACTOR = 1;

/** The document title the preview renders. */
export const PREVIEW_TITLE = '技術関心 inventory';

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
		<title>技術関心 inventory preview (#528)</title>
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
 * The shipped story declares `render:` (not `component` + `args`), so the
 * harness renders the story's OWN render output — the very tree
 * Storybook renders for that story — and loads the shipped global
 * stylesheet so the capture shows the same Panda layer order a reader
 * sees.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

const render = ${STORY_EXPORT}.render;
if (typeof render !== 'function') {
	throw new Error('the shipped story declares no render function');
}

// Storybook renders the story's own \`render\` output; the capture
// renders the same tree, so the two surfaces cannot drift apart.
createRoot(container).render(render(undefined, undefined));
`;
}

/** The generated Vite config (harness root, repo PostCSS config). */
export function harnessViteConfig(harnessDir = HARNESS_DIR, repoRoot = REPO_ROOT) {
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
 * record says. The failures are the difference, so a capture that shows
 * half the inventory cannot be published as evidence of the whole
 * inventory.
 */
export function verifyRenderedPreview(
	observation,
	data = {
		title: PREVIEW_TITLE,
		sections: TECH_INTEREST_SECTIONS,
		entries: TECH_INTEREST_ENTRIES,
		recommendations: CURRENT_RECOMMENDATIONS,
		held: SUPERSEDED_OBSERVATIONS,
		stateLabels: INTEREST_STATE_LABELS,
		categoryLabels: INTEREST_CATEGORY_LABELS,
	},
) {
	const failures = [];
	if (!observation?.present) {
		return { ok: false, failures: ['the preview surface was not rendered'] };
	}

	if (observation.title !== data.title) {
		failures.push(`the document title is "${observation.title}", expected "${data.title}"`);
	}

	const renderedSections = observation.sections ?? [];
	if (renderedSections.length !== data.sections.length) {
		failures.push(
			`the preview rendered ${renderedSections.length} section(s), expected ${data.sections.length}`,
		);
	}

	/** Every rendered entry that carries this name (pure). */
	const findByName = (entries, name) => entries.filter((entry) => entry.name === name);

	for (const expected of data.sections) {
		const rendered = renderedSections.find((section) => section.heading === expected.heading);
		if (!rendered) {
			failures.push(`the section "${expected.heading}" is missing from the preview`);
			continue;
		}
		if (rendered.summary !== expected.summary) {
			failures.push(
				`the summary of "${expected.heading}" is "${rendered.summary}", expected "${expected.summary}"`,
			);
		}
		const renderedPoints = rendered.points ?? [];
		const missingPoints = expected.points.filter((point) => !renderedPoints.includes(point));
		if (missingPoints.length > 0) {
			failures.push(
				`the section "${expected.heading}" did not render ${missingPoints.length} of its ${expected.points.length} point(s)`,
			);
		}
		for (const entry of expected.entries) {
			const matches = findByName(rendered.entries ?? [], entry.name);
			if (matches.length === 0) {
				failures.push(`the entry "${entry.name}" is missing from "${expected.heading}"`);
				continue;
			}
			const stateLabel = data.stateLabels[entry.state];
			if (!matches.some((match) => match.badges.includes(stateLabel))) {
				failures.push(`the entry "${entry.name}" does not render the state label "${stateLabel}"`);
			}
			const categoryLabel = data.categoryLabels[entry.category];
			if (!matches.some((match) => match.badges.includes(categoryLabel))) {
				failures.push(
					`the entry "${entry.name}" does not render the category label "${categoryLabel}"`,
				);
			}
			if (!matches.some((match) => match.observedOn === entry.observedOn)) {
				failures.push(
					`the entry "${entry.name}" does not render the observation date "${entry.observedOn}"`,
				);
			}
		}
		const renderedNames = new Set((rendered.entries ?? []).map((entry) => entry.name));
		const expectedNames = new Set(expected.entries.map((entry) => entry.name));
		for (const name of renderedNames) {
			if (!expectedNames.has(name)) {
				failures.push(`the section "${expected.heading}" renders an unexpected entry "${name}"`);
			}
		}
	}

	// The derived lists. Their counts are the headline of the record:
	// an observation that was replaced must never appear in the current
	// recommendations.
	const current = observation.current ?? {};
	const expectedCurrentHeading = `現在の推奨（${data.recommendations.length} 件）`;
	if (current.heading !== expectedCurrentHeading) {
		failures.push(
			`the current-recommendation heading is "${current.heading}", expected "${expectedCurrentHeading}"`,
		);
	}
	const renderedCurrent = current.entries ?? [];
	if (renderedCurrent.length !== data.recommendations.length) {
		failures.push(
			`the current-recommendation list rendered ${renderedCurrent.length} entry(ies), expected ${data.recommendations.length}`,
		);
	}
	for (const entry of data.recommendations) {
		const matches = findByName(renderedCurrent, entry.name);
		if (matches.length === 0) {
			failures.push(`the current recommendation "${entry.name}" is missing`);
			continue;
		}
		const stateLabel = data.stateLabels[entry.state];
		if (!matches.some((match) => match.badges.includes(stateLabel))) {
			failures.push(`the current recommendation "${entry.name}" does not render "${stateLabel}"`);
		}
		if (!matches.some((match) => match.observedOn === entry.observedOn)) {
			failures.push(
				`the current recommendation "${entry.name}" does not render the observation date "${entry.observedOn}"`,
			);
		}
	}

	const held = observation.held ?? {};
	const expectedHeldHeading = `保留（置き換わった観察 ${data.held.length} 件）`;
	if (held.heading !== expectedHeldHeading) {
		failures.push(`the held heading is "${held.heading}", expected "${expectedHeldHeading}"`);
	}
	const renderedHeld = held.entries ?? [];
	if (renderedHeld.length !== data.held.length) {
		failures.push(
			`the held list rendered ${renderedHeld.length} entry(ies), expected ${data.held.length}`,
		);
	}
	for (const entry of data.held) {
		const matches = findByName(renderedHeld, entry.name);
		if (matches.length === 0) {
			failures.push(`the held observation "${entry.name}" is missing`);
			continue;
		}
		if (!matches.some((match) => match.observedOn === entry.observedOn)) {
			failures.push(
				`the held observation "${entry.name}" does not render the observation date "${entry.observedOn}"`,
			);
		}
	}

	// The honesty rule: a replaced observation is history, never a
	// current recommendation.
	for (const entry of data.held) {
		if (findByName(renderedCurrent, entry.name).length > 0) {
			failures.push(
				`the replaced observation "${entry.name}" is rendered as a current recommendation`,
			);
		}
	}

	// Every entry of the inventory is rendered somewhere, with its
	// state label and observation date.
	const renderedEverywhere = [...renderedSections.flatMap((section) => section.entries ?? [])];
	for (const entry of data.entries) {
		const matches = findByName(renderedEverywhere, entry.name);
		if (matches.length === 0) {
			failures.push(`the entry "${entry.name}" is not rendered anywhere`);
			continue;
		}
		const stateLabel = data.stateLabels[entry.state];
		if (!matches.some((match) => match.badges.includes(stateLabel))) {
			failures.push(`the entry "${entry.name}" does not render the state label "${stateLabel}"`);
		}
		if (!matches.some((match) => match.observedOn === entry.observedOn)) {
			failures.push(
				`the entry "${entry.name}" does not render the observation date "${entry.observedOn}"`,
			);
		}
	}

	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`the preview scrolls sideways (${observation.scrollWidth}px > ${observation.clientWidth}px)`,
		);
	}

	return { ok: failures.length === 0, failures };
}

/**
 * Read the rendered facts out of the page. Runs inside Chromium.
 *
 * An entry card renders its name as an `<h3>`, its state label and
 * its category label as badges, and its observation date as a
 * `観測日 <date>` span. The observation therefore keeps the three
 * facts the record has to be checked against, separately.
 */
export const READ_PREVIEW = () => {
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	const readRenderedEntry = (element) => {
		const meta = element.querySelector('p');
		const spans = meta ? [...meta.querySelectorAll(':scope > span')].map(text) : [];
		const observedOnText = spans.find((span) => span.startsWith('観測日')) ?? '';
		return {
			name: text(element.querySelector('h3')),
			badges: spans.filter((span) => !span.startsWith('観測日')),
			observedOn: observedOnText.replace(/^観測日\s*/, '').trim(),
		};
	};
	const root = document.querySelector('[data-testid="tech-interests-preview"]');
	if (!root) {
		return {
			present: false,
			title: null,
			sections: [],
			current: null,
			held: null,
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		};
	}
	const readPanel = (id) => {
		const section = root.querySelector(`section[aria-labelledby="${id}"]`);
		if (!section) return null;
		const items = [...section.querySelectorAll('li')];
		return {
			heading: text(section.querySelector('h2')),
			entries: items
				.filter((item) => item.querySelector('h3'))
				.map((item) => readRenderedEntry(item)),
		};
	};
	return {
		present: true,
		title: text(root.querySelector('h1')),
		sections: [...root.querySelectorAll('section[aria-labelledby^="tech-interests-section-"]')].map(
			(section) => {
				const items = [...section.querySelectorAll('li')];
				return {
					heading: text(section.querySelector('h2')),
					summary: text(section.querySelector('header p')),
					points: items.filter((item) => !item.querySelector('h3')).map(text),
					entries: items
						.filter((item) => item.querySelector('h3'))
						.map((item) => readRenderedEntry(item)),
				};
			},
		),
		current: readPanel('tech-interests-current'),
		held: readPanel('tech-interests-held'),
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		pageHeight: document.documentElement.scrollHeight,
	};
};

function parseArgs(argv) {
	const options = {
		screenshot: DEFAULT_ARTEFACT_PATH,
		jsonOut: '.tmp/tech-interests/report.json',
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
		process.stdout.write('[capture] building the tech-interests harness…\n');
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
					deviceScaleFactor: SCREENSHOT_DEVICE_SCALE_FACTOR,
					colorScheme: 'light',
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'networkidle' });
				observation = await page.evaluate(READ_PREVIEW);
				verdict = verifyRenderedPreview(observation);
				if (!verdict.ok) {
					// A failed verification must not leave a picture behind
					// that claims to be the verified artefact.
					rmSync(artefactPath, { force: true });
					throw new Error(
						`the rendered preview does not match the record data:\n  - ${verdict.failures.join('\n  - ')}`,
					);
				}
				const png = await page.screenshot({ fullPage: true });
				mkdirSync(dirname(artefactPath), { recursive: true });
				await sharp(png)
					.resize({
						width: Math.min(ARTEFACT_WIDTH, SCREENSHOT_MAX_WIDTH),
						withoutEnlargement: true,
					})
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
		story: { module: STORY_MODULE, story: STORY_EXPORT },
		conditions: {
			viewport: { width: options.width, height: options.height },
			deviceScaleFactor: SCREENSHOT_DEVICE_SCALE_FACTOR,
			colorScheme: 'light',
			waitUntil: 'networkidle',
			screenshot: 'fullPage',
			encode: {
				width: Math.min(ARTEFACT_WIDTH, SCREENSHOT_MAX_WIDTH),
				maxWidth: SCREENSHOT_MAX_WIDTH,
				quality: SCREENSHOT_QUALITY,
				format: 'webp',
			},
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
