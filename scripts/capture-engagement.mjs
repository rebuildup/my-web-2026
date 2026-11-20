#!/usr/bin/env node
/**
 * capture-engagement — capture the Issue #517 verification screens into
 * `docs/verification/experience/engagement-*.png`.
 *
 * What this captures
 * ------------------
 * The SHIPPED previews of the "見てて楽しい" experiment: the Storybook
 * stories `src/personal/engagement/Engagement.stories.tsx` (`Static`
 * and `Interactive`) rendering the data the verification document is
 * proved against (`src/personal/engagement/Engagement.preview.ts`).
 * Each variant is captured at 1440px:
 *
 *   - engagement-static.png       Static @ 1440
 *   - engagement-interactive.png  Interactive @ 1440
 *
 * It is also an ASSERTION, not only a picture:
 *
 *   - BOTH variants must render the SAME information: the static
 *     render must carry every work's facts at once; the interactive
 *     render is driven through every work with the next control and
 *     must visit all six ids in seed order, each card carrying its
 *     title / period / role / fact / technologies.
 *   - The interactive variant must be OPERABLE: prev/next buttons, a
 *     position readout, a progressbar, and ArrowLeft / ArrowRight on
 *     the deck region (exercised for real, not assumed).
 *   - The interactive variant is opened a SECOND time in a
 *     `reducedMotion: 'reduce'` context: the step panel must report
 *     `data-motion-state="reduced"` and computed `animation-name:
 *     none`, while the normal context reports `animated` — the
 *     reduced-motion row of the Issue's comparison is a DOM fact.
 *   - No undeclared link may appear, every colophon note must render,
 *     and neither variant may scroll sideways.
 *
 * Loading cost is measured, not asserted: each story's harness build
 * output bytes are summed and recorded in the report, so the
 * verification document can quote a real number per variant.
 *
 * Why a generated harness instead of `storybook dev`
 * ---------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, and the
 * `@cloudflare/vite-plugin` + TanStack Start plugins in it take over
 * the output. That defect is recorded in
 * `scripts/capture-manifesto.mjs` (Issue #535) and
 * `scripts/capture-handle-map.mjs` (Issue #524).
 *
 * The harness imports the SHIPPED story module and renders the
 * shipped story's own `render()` output — the same tree Storybook
 * renders — through a local Vite build, so the capture and the
 * Storybook surface cannot drift apart.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret
 *     is read or printed. The preview data is literals in the source.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules loaded from
 *     `file://`, which is the only reason an origin exists at all.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records the conditions instead of claiming a
 *     deterministic artefact.
 *
 * Usage:
 *   node scripts/capture-engagement.mjs [options]
 *
 *   --screenshot=<path>  NOT used — the two artefact paths are fixed
 *                        by CAPTURES below (the Issue names them).
 *   --json-out=<path>     report destination
 *                         (default .tmp/engagement/report.json)
 *   --only=<key>          capture a subset: static, interactive
 *                         (default: both)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import {
	createReadStream,
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ENGAGEMENT_CRITERIA,
	ENGAGEMENT_DOCUMENT,
	ENGAGEMENT_LINKS,
	ENGAGEMENT_NOTES,
	ENGAGEMENT_SOURCES,
	ENGAGEMENT_VARIANTS,
	ENGAGEMENT_WORKS,
} from '../src/personal/engagement/Engagement.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE = 'src/personal/engagement/Engagement.stories.tsx';

/**
 * The two captures Issue #517 requires.
 *
 * `key` is the `--only` selector; `story` is the exported story the
 * harness renders; `variant` is the DOM marker the story stamps;
 * `artefact` is the committed PNG path the Issue names.
 */
export const CAPTURES = [
	{
		key: 'static',
		story: 'Static',
		variant: 'static',
		width: 1440,
		height: 900,
		artefact: 'docs/verification/experience/engagement-static.png',
	},
	{
		key: 'interactive',
		story: 'Interactive',
		variant: 'interactive',
		width: 1440,
		height: 900,
		artefact: 'docs/verification/experience/engagement-interactive.png',
	},
];

export const HARNESS_DIR = '.tmp/engagement/harness';
export const HARNESS_DIST = '.tmp/engagement/harness-dist';

/**
 * Committed captures are PNG with a size budget: an engagement
 * preview that grows past this is a sign the experiment stopped
 * being a one-screen comparison, not a reason to commit a large
 * binary.
 */
export const PNG_BUDGET_BYTES = 1024 * 1024;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= PNG_BUDGET_BYTES,
	};
}

/** Reject an output path that is not PNG, or that leaves the repository (pure). */
export function assertPngOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.png') {
		throw new Error(`refusing to write a non-PNG verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return resolve(repoRoot, path);
}

/** Collapse a whitespace run so DOM text and data literals compare equal. */
export function collapseText(value) {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Sum the bytes of every file under `dir` — the harness build's cost (pure). */
export function bundleBytes(dir) {
	let total = 0;
	let files = 0;
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(path);
			} else {
				total += statSync(path).size;
				files += 1;
			}
		}
	};
	if (existsSync(dir)) walk(dir);
	return { bytes: total, files };
}

/** The generated harness entry — imports the shipped story module. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>engagement preview harness</title>
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
 * `STORY_EXPORT` is substituted per capture: the harness renders the
 * shipped story's own `render()` output — the same tree Storybook
 * renders — so the capture and the Storybook surface cannot drift.
 */
export function harnessMainTsx(storyExport, harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${storyExport} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// Storybook renders the story's own \`render()\` output; the capture
// renders the same thing through the shipped story object, so the two
// surfaces cannot drift apart.
createRoot(container).render(<>{${storyExport}.render?.()}</>);
`;
}

/** The generated Vite config (harness root, repo PostCSS config). */
export function harnessViteConfig(harnessDir = HARNESS_DIR, repoRoot = REPO_ROOT) {
	const depth = harnessDir.split('/').length;
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

/**
 * Write the generated harness for ONE story export (idempotent, so
 * `--no-build` can reuse a matching build only when the story is the
 * same — the caller rebuilds whenever the story changes).
 */
export function writeHarness(storyExport, repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	writeFileSync(join(dir, 'main.tsx'), harnessMainTsx(storyExport));
	writeFileSync(join(dir, 'vite.config.ts'), harnessViteConfig(HARNESS_DIR, repoRoot));
	return dir;
}

/**
 * Compare the rendered DOM with the preview data (pure).
 *
 * `observation` is what the browser read — including, for the
 * interactive variant, the cards visited while the driver clicked
 * through the deck and the keyboard check. The data is what the
 * document says. The failures are the difference, so a capture that
 * shows half the works, drops a control, or invents a link cannot be
 * published as evidence of the whole preview.
 */
export function verifyRenderedPreview(observation, variant, data = defaultData()) {
	const failures = [];

	const expectedTitle = data.document.title;
	if (collapseText(observation.title) !== collapseText(expectedTitle)) {
		failures.push(
			`the document title is "${collapseText(observation.title)}", expected "${collapseText(expectedTitle)}"`,
		);
	}

	// The variant marker the stage element stamps — a capture pointed
	// at the wrong story fails here, not silently.
	if (observation.variant !== variant) {
		failures.push(`the rendered variant is "${observation.variant}", expected "${variant}"`);
	}

	const expectedMeta = [
		data.document.status,
		data.document.source,
		data.document.verification,
		data.document.document,
	];
	const renderedMeta = (observation.meta ?? []).map(collapseText);
	for (const value of expectedMeta) {
		if (!renderedMeta.includes(collapseText(value))) {
			failures.push(`the document metadata "${collapseText(value)}" is missing from the preview`);
		}
	}

	const renderedText = collapseText(observation.bodyText ?? '');

	// The variant cards and the comparison axes are shared chrome —
	// both stories must carry them verbatim.
	for (const entry of data.variants) {
		if (!renderedText.includes(collapseText(entry.label))) {
			failures.push(`the variant card "${collapseText(entry.label)}" is missing`);
		}
		for (const fact of entry.facts) {
			if (!renderedText.includes(collapseText(fact))) {
				failures.push(`the variant fact "${collapseText(fact)}" is missing`);
			}
		}
	}
	for (const criterion of data.criteria) {
		if (!renderedText.includes(collapseText(criterion.label))) {
			failures.push(`the comparison axis "${collapseText(criterion.label)}" is missing`);
		}
		if (!renderedText.includes(collapseText(criterion.question))) {
			failures.push(`the axis question "${collapseText(criterion.question)}" is missing`);
		}
	}

	// THE experiment's control: the SAME information in both variants.
	// Static renders every work card at once; interactive is driven
	// through the deck and must visit every work id in seed order,
	// each visited card carrying that work's own title, period, role,
	// fact and every technology.
	const expectedIds = data.works.map((work) => work.id);
	if (variant === 'static') {
		const renderedIds = (observation.workCards ?? []).map((card) => card.id);
		if (JSON.stringify(renderedIds) !== JSON.stringify(expectedIds)) {
			failures.push(
				`the static preview rendered work ids ${JSON.stringify(renderedIds)}, expected ${JSON.stringify(expectedIds)}`,
			);
		}
		for (const work of data.works) {
			const card = (observation.workCards ?? []).find((entry) => entry.id === work.id);
			assertWorkCardFacts(card, work, variant, failures);
		}
	} else {
		const visitedIds = (observation.visited ?? []).map((entry) => entry.id);
		if (JSON.stringify(visitedIds) !== JSON.stringify(expectedIds)) {
			failures.push(
				`driving the deck visited work ids ${JSON.stringify(visitedIds)}, expected ${JSON.stringify(expectedIds)}`,
			);
		}
		for (const work of data.works) {
			const card = (observation.visited ?? []).find((entry) => entry.id === work.id);
			assertWorkCardFacts(card, work, variant, failures);
		}

		// Operability is a DOM fact: both controls exist, the position
		// readout tracks the index, the progressbar agrees, and the
		// keyboard path really moved the deck.
		const controls = observation.controls ?? {};
		if (controls.hasPrev !== true || controls.hasNext !== true) {
			failures.push('the interactive preview is missing its prev/next controls');
		}
		const position = collapseText(controls.positionText ?? '');
		if (
			!new RegExp(`^1 \\/ ${data.works.length}$`).test(position) &&
			!position.endsWith(` / ${data.works.length}`)
		) {
			failures.push(`the position readout "${position}" does not report the deck position`);
		}
		if (controls.progressbar !== true) {
			failures.push('the interactive preview is missing its progressbar');
		}
		const keys = observation.keyboard ?? {};
		if (keys.before == null || keys.after == null || keys.after >= keys.before) {
			failures.push(
				`ArrowLeft on the deck did not move backwards (position ${keys.before} → ${keys.after})`,
			);
		}
	}

	// Every published link must be an actual <a href>, and the page
	// must not carry a URL the data does not declare. Both variants
	// render the same footer link list, so the unique-href comparison
	// is an equality here — an invented link fails by name.
	const expectedHrefs = new Set(data.links.map((link) => link.url));
	const renderedHrefs = new Set((observation.hrefs ?? []).filter(Boolean));
	for (const href of expectedHrefs) {
		if (!renderedHrefs.has(href)) {
			failures.push(`the published link "${href}" is missing from the ${variant} preview`);
		}
	}
	for (const href of renderedHrefs) {
		if (!expectedHrefs.has(href)) {
			failures.push(
				`the ${variant} preview rendered an undeclared link "${href}" — an invented link`,
			);
		}
	}

	// The source paths and the note bullets.
	for (const source of data.sources) {
		if (!renderedText.includes(source.path)) {
			failures.push(`the source path "${source.path}" is missing from the ${variant} preview`);
		}
	}
	const renderedNotes = (observation.notes ?? []).map(collapseText);
	const expectedNotes = data.notes.map(collapseText);
	for (const note of expectedNotes) {
		if (!renderedNotes.includes(note)) {
			failures.push(`the note "${note}" is missing from the ${variant} preview`);
		}
	}
	if (renderedNotes.length !== expectedNotes.length) {
		failures.push(
			`the ${variant} preview rendered ${renderedNotes.length} note(s), expected ${expectedNotes.length}`,
		);
	}

	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`the ${variant} preview scrolls sideways (${observation.scrollWidth}px > ${observation.clientWidth}px)`,
		);
	}

	return { ok: failures.length === 0, failures };
}

/** One work card must carry its own facts — verbatim from the seed (pure). */
function assertWorkCardFacts(card, work, variant, failures) {
	if (!card) {
		failures.push(`work "${work.id}" was never rendered in the ${variant} preview`);
		return;
	}
	const text = collapseText(card.text ?? '');
	for (const expected of [
		work.title,
		work.periodLabel,
		work.role,
		work.fact,
		...work.technologies,
	]) {
		if (!text.includes(collapseText(expected))) {
			failures.push(
				`work "${work.id}" in the ${variant} preview is missing "${collapseText(expected).slice(0, 60)}"`,
			);
		}
	}
}

/**
 * The reduced-motion assertion (pure): the interactive deck's step
 * panel must be animated in the normal context and fully opted out
 * in the reduce context — same facts, no motion.
 */
export function verifyReducedMotionPair(normal, reduced) {
	const failures = [];
	if (normal?.motionState !== 'animated' || normal?.animationName === 'none') {
		failures.push(
			`the normal context did not animate the step (state=${normal?.motionState}, animation=${normal?.animationName})`,
		);
	}
	if (reduced?.motionState !== 'reduced' || reduced?.animationName !== 'none') {
		failures.push(
			`the reduce context still animates the step (state=${reduced?.motionState}, animation=${reduced?.animationName})`,
		);
	}
	return { ok: failures.length === 0, failures };
}

function defaultData() {
	return {
		document: ENGAGEMENT_DOCUMENT,
		sources: ENGAGEMENT_SOURCES,
		works: ENGAGEMENT_WORKS,
		variants: ENGAGEMENT_VARIANTS,
		criteria: ENGAGEMENT_CRITERIA,
		links: ENGAGEMENT_LINKS,
		notes: ENGAGEMENT_NOTES,
	};
}

/** Read the rendered facts out of the page. Runs inside Chromium. */
export const READ_DOCUMENT = () => {
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	const cardText = (element) => (element?.innerText ?? '').replace(/\s+/g, ' ').trim();
	const root = document.querySelector('[data-engagement-variant]');
	const stepPanel = document.querySelector('[data-motion="engagement-step"]');
	return {
		title: text(document.querySelector('h1')),
		variant: root?.getAttribute('data-engagement-variant') ?? null,
		meta: [...document.querySelectorAll('header dl dd')].map(text),
		// Static renders every card at once; interactive renders the
		// current one. Both are read the same way — `workCards` is
		// whatever the DOM currently shows.
		workCards: [...document.querySelectorAll('[data-engagement-work]')].map((el) => ({
			id: el.getAttribute('data-engagement-work'),
			text: cardText(el),
		})),
		controls: {
			hasPrev: Boolean(document.querySelector('[data-engagement-prev]')),
			hasNext: Boolean(document.querySelector('[data-engagement-next]')),
			positionText: text(document.querySelector('[data-engagement-position]')),
			progressbar: Boolean(document.querySelector('[data-engagement-progress]')),
		},
		motion: stepPanel
			? {
					motionState: stepPanel.getAttribute('data-motion-state'),
					animationName: getComputedStyle(stepPanel).animationName,
				}
			: null,
		notes: [...document.querySelectorAll('[data-notes-list] li')].map(text),
		hrefs: [...document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href')),
		bodyText: document.body.innerText,
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		scrollHeight: document.documentElement.scrollHeight,
	};
};

/** Position readout as a number ("3 / 6" → 3). Runs inside Chromium. */
export const READ_POSITION = () => {
	const raw = document
		.querySelector('[data-engagement-position]')
		?.textContent?.replace(/\s+/g, ' ')
		.trim();
	const match = /^(\d+)\s*\/\s*\d+$/.exec(raw ?? '');
	return match ? Number(match[1]) : null;
};

function parseArgs(argv) {
	const options = {
		jsonOut: '.tmp/engagement/report.json',
		only: null,
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
		if (arg.startsWith('--json-out=')) {
			options.jsonOut = arg.slice('--json-out='.length);
			continue;
		}
		if (arg.startsWith('--only=')) {
			options.only = arg.slice('--only='.length);
			continue;
		}
		if (arg.startsWith('--screenshot=')) {
			throw new Error(
				'--screenshot is not supported: the Issue names the two artefact paths (see CAPTURES)',
			);
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

function selectedCaptures(only) {
	if (!only) return CAPTURES;
	const selected = CAPTURES.filter((capture) => capture.key === only);
	if (selected.length === 0) {
		throw new Error(
			`unknown --only key "${only}"; expected one of ${CAPTURES.map((c) => c.key).join(', ')}`,
		);
	}
	return selected;
}

/** Drive the interactive deck through every work, collecting each card. */
async function driveDeck(page, workCount) {
	const visited = [];
	const readCard = () =>
		page.evaluate(() => {
			const el = document.querySelector('[data-engagement-work]');
			return {
				id: el?.getAttribute('data-engagement-work') ?? null,
				text: (el?.innerText ?? '').replace(/\s+/g, ' ').trim(),
			};
		});
	visited.push(await readCard());
	for (let step = 0; step < workCount; step += 1) {
		const exhausted = await page.evaluate(() => {
			const next = document.querySelector('[data-engagement-next]');
			return !next || next.disabled;
		});
		if (exhausted) break;
		await page.click('[data-engagement-next]');
		// Let the step transition settle before reading the new card.
		await page.waitForTimeout(50);
		visited.push(await readCard());
	}
	return visited;
}

/** Prove the keyboard path moves the deck (ArrowLeft from the end). */
async function keyboardCheck(page) {
	// Focus a real control — the deck's onKeyDown receives the
	// bubbled keydown, which is exactly the path a keyboard visitor
	// takes (Tab to a button, then arrows). The PREV button is used
	// because the check runs at the deck's last position, where NEXT
	// is legitimately disabled.
	await page.locator('[data-engagement-prev]').focus();
	const before = await page.evaluate(READ_POSITION);
	await page.keyboard.press('ArrowLeft');
	await page.waitForTimeout(50);
	const after = await page.evaluate(READ_POSITION);
	return { before, after };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const captures = selectedCaptures(options.only);

	// Group by story so the harness is built once per story export.
	const byStory = new Map();
	for (const capture of captures) {
		if (!byStory.has(capture.story)) byStory.set(capture.story, []);
		byStory.get(capture.story).push(capture);
	}

	const results = [];
	for (const [story, storyCaptures] of byStory) {
		writeHarness(story);
		const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
		if (options.build) {
			process.stdout.write(`[capture] building the engagement harness (${story})…\n`);
			execFileSync(
				'pnpm',
				['exec', 'vite', 'build', '--config', join(HARNESS_DIR, 'vite.config.ts')],
				{ cwd: REPO_ROOT, stdio: 'inherit' },
			);
		} else {
			process.stdout.write(`[capture] reusing the existing harness build (${story})\n`);
		}
		if (!existsSync(join(distRoot, 'index.html'))) {
			throw new Error(`harness build produced no ${HARNESS_DIST}/index.html`);
		}
		const bundle = bundleBytes(distRoot);

		const server = await serveDirectory(distRoot);
		try {
			if (!options.capture) {
				process.stdout.write(`[capture] --no-capture: harness built (${story}), nothing written\n`);
				continue;
			}
			const { chromium } = await import('@playwright/test');
			const browser = await chromium.launch();
			try {
				for (const capture of storyCaptures) {
					const artefactPath = assertPngOutputPath(capture.artefact);
					const context = await browser.newContext({
						viewport: { width: capture.width, height: capture.height },
						deviceScaleFactor: 1,
						colorScheme: 'light',
					});
					const page = await context.newPage();
					await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'networkidle' });

					// Drive the interactive deck BEFORE the screenshot so
					// the artefact shows an operated state, then the
					// observation carries every visited card.
					let observation = await page.evaluate(READ_DOCUMENT);
					let visited = null;
					let keyboard = null;
					if (capture.variant === 'interactive') {
						visited = await driveDeck(page, ENGAGEMENT_WORKS.length);
						keyboard = await keyboardCheck(page);
						// Return to the first work for the artefact.
						await page.click('[data-engagement-prev]', { clickCount: ENGAGEMENT_WORKS.length - 1 });
						await page.waitForTimeout(50);
						observation = await page.evaluate(READ_DOCUMENT);
					}
					observation.visited = visited;
					observation.keyboard = keyboard;

					const verdict = verifyRenderedPreview(observation, capture.variant);
					if (!verdict.ok) {
						throw new Error(
							`the rendered ${capture.variant} preview does not match the preview data:\n  - ${verdict.failures.join('\n  - ')}`,
						);
					}

					// The reduced-motion pair — only the interactive
					// variant has motion to opt out of.
					let reducedMotion = null;
					if (capture.variant === 'interactive') {
						const normalMotion = observation.motion;
						const reduceContext = await browser.newContext({
							viewport: { width: capture.width, height: capture.height },
							deviceScaleFactor: 1,
							colorScheme: 'light',
							reducedMotion: 'reduce',
						});
						try {
							const reducePage = await reduceContext.newPage();
							await reducePage.goto(`${server.baseUrl}/index.html`, {
								waitUntil: 'networkidle',
							});
							const reducedObservation = await reducePage.evaluate(READ_DOCUMENT);
							reducedMotion = {
								normal: normalMotion,
								reduced: reducedObservation.motion,
								verdict: verifyReducedMotionPair(normalMotion, reducedObservation.motion),
							};
							if (!reducedMotion.verdict.ok) {
								throw new Error(
									`the reduced-motion pair failed:\n  - ${reducedMotion.verdict.failures.join('\n  - ')}`,
								);
							}
						} finally {
							await reduceContext.close();
						}
					}

					const png = await page.screenshot({ fullPage: true });
					mkdirSync(dirname(artefactPath), { recursive: true });
					writeFileSync(artefactPath, png);
					const budget = screenshotBudgetVerdict(statSync(artefactPath).size);
					process.stdout.write(
						`[capture] wrote ${relative(REPO_ROOT, artefactPath)} (${capture.width}x${observation.scrollHeight}, ${budget.kb} KB, within budget: ${budget.withinBudget})\n`,
					);
					if (!budget.withinBudget) {
						throw new Error(
							`the artefact is ${budget.kb} KB, over the ${Math.round(PNG_BUDGET_BYTES / 1024)} KB budget; the preview grew past a one-screen experiment — narrow the capture or revisit the preview before committing it`,
						);
					}
					results.push({
						key: capture.key,
						story: { module: STORY_MODULE, story: capture.story },
						artefact: relative(REPO_ROOT, artefactPath),
						conditions: {
							viewport: { width: capture.width, height: capture.height },
							deviceScaleFactor: 1,
							colorScheme: 'light',
							waitUntil: 'networkidle',
							screenshot: 'fullPage',
							encode: { format: 'png' },
						},
						observation: {
							variant: observation.variant,
							scrollWidth: observation.scrollWidth,
							clientWidth: observation.clientWidth,
							scrollHeight: observation.scrollHeight,
							visitedWorkIds: visited?.map((entry) => entry.id) ?? null,
							keyboard,
							motion: observation.motion ?? null,
						},
						reducedMotion,
						bundle,
						verdict,
						capture: { width: capture.width, height: observation.scrollHeight, ...budget },
					});
					await context.close();
				}
			} finally {
				await browser.close();
			}
		} finally {
			await server.close();
		}
	}

	const report = {
		captures: results,
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
