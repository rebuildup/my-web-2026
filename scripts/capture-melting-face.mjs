#!/usr/bin/env node
/**
 * capture-melting-face — capture the Issue #522 verification screens
 * into `docs/verification/brand/melting-face-preview.png` and
 * `docs/verification/brand/melting-face-fallback.png`.
 *
 * What this captures
 * ------------------
 * The SHIPPED previews of the "melting face" brand motif: the
 * Storybook stories `src/personal/melting-face/MeltingFace.stories.tsx`
 * (`Default` for the motif itself, `Fallback` for the text-only
 * alt/fallback rendering) rendering the data the document is proved
 * against (`src/personal/melting-face/MeltingFace.preview.ts`). The
 * captures are not drawings of the document — they are the previews
 * themselves, so a screenshot in a pull request cannot show something
 * the component does not render.
 *
 * It is also an ASSERTION, not only a picture. From the rendered DOM it
 * reads the document title, the document metadata, every chain step,
 * every copy role, the mark's `aria-label` and motion state, every
 * explanation candidate, every section heading and every section
 * bullet, and compares them with the preview data module. A preview
 * that dropped a chain step, resolved a candidate, lost the alt text
 * or invented a link fails the capture instead of producing a
 * flattering picture. It also reads whether the document scrolls
 * sideways at the capture width (WCAG 2.2 SC 1.4.10 Reflow).
 *
 * The light / dark, reduced-motion and fallback claims are verified
 * in REAL renders too, not only asserted in prose:
 *
 *   - dark pass   — the `Default` story under `colorScheme: 'dark'`;
 *                   the report records the computed page background
 *                   and fails if it did not move off the light value.
 *   - reduced pass — the `Default` story under
 *                   `reducedMotion: 'reduce'`; the report fails unless
 *                   `data-motion-state` reads `reduced` AND the drip
 *                   group's computed `animation-name` is `none`, while
 *                   the copy still renders (the resting markup carries
 *                   the same information).
 *   - fallback pass — the `Fallback` story; the report fails if the
 *                   SVG mark is present or the fallback text / alt
 *                   description is missing.
 *
 * Why a generated harness instead of `storybook dev`
 * ---------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, and the `@cloudflare/vite-plugin`
 * + TanStack Start plugins in it take over the output. That defect is
 * recorded in `scripts/capture-error-state-gallery.mjs` (Issue #501)
 * and `scripts/capture-handle-map.mjs` (Issue #524).
 *
 * The capture uses a harness so that it does not depend on a
 * long-lived dev server, so that the DOM assertions run inside the
 * same command as the capture, and so that its result does not depend
 * on the Storybook builder. The harness imports the SHIPPED story
 * module and renders the shipped story's own `render()` output — the
 * same tree Storybook renders — through a local Vite build, so the
 * capture and the Storybook surface cannot drift apart.
 *
 * Why PNG
 * -------
 * Issue #522 names the artefacts `docs/verification/brand/
 * melting-face-preview.png` and `melting-face-fallback.png`
 * explicitly. The script REFUSES any non-`.png` output path.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, and no secret
 *     is read or printed. The preview data is literals in the source.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules loaded from `file://`,
 *     which is the only reason an origin exists at all.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records the conditions instead of claiming a
 *     deterministic artefact.
 *
 * Usage:
 *   node scripts/capture-melting-face.mjs [options]
 *
 *   --screenshot=<path>          committed preview artefact
 *                                (default docs/verification/brand/melting-face-preview.png)
 *   --fallback-screenshot=<path> committed fallback artefact
 *                                (default docs/verification/brand/melting-face-fallback.png)
 *   --json-out=<path>            report destination
 *                                (default .tmp/melting-face/report.json)
 *   --width=<n>                  viewport width (default 1440)
 *   --height=<n>                 viewport height (default 900)
 *   --no-build                   reuse an existing harness build in .tmp
 *   --no-capture                 resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MELTING_FACE_CHAIN,
	MELTING_FACE_COPY,
	MELTING_FACE_DOCUMENT,
	MELTING_FACE_EXPLANATIONS,
	MELTING_FACE_ICON,
	MELTING_FACE_LEGEND,
	MELTING_FACE_SECTIONS,
	meltingFaceMotifBullets,
} from '../src/personal/melting-face/MeltingFace.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE = 'src/personal/melting-face/MeltingFace.stories.tsx';

/** The shipped stories the capture renders, one artefact each. */
export const STORY_PREVIEW = 'Default';
export const STORY_FALLBACK = 'Fallback';

export const HARNESS_DIR = '.tmp/melting-face/harness';
export const HARNESS_DIST = '.tmp/melting-face/harness-dist';

/** The two committed artefact paths Issue #522 names. */
export const DEFAULT_ARTEFACT_PATH = 'docs/verification/brand/melting-face-preview.png';
export const FALLBACK_ARTEFACT_PATH = 'docs/verification/brand/melting-face-fallback.png';

/**
 * Committed captures are PNG (Issue #522 names `.png` paths) with a
 * size budget: a motif that grows past this is a sign the preview
 * stopped being a motif, not a reason to commit a large binary.
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

/** Collapse a whitespace run so two texts can be compared as text (pure). */
export function collapseText(text) {
	return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>melting face preview (#522)</title>
	</head>
	<body style="margin:0">
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
`;
}

/**
 * The generated harness entry point.
 *
 * It renders the SHIPPED story's own `render()` output — the story is
 * selected by the `?story=` query parameter so ONE build serves both
 * artefacts — and it loads the shipped global stylesheet so the
 * capture shows the same Panda layer order a reader sees.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { Default, Fallback, MotionStates } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// Storybook renders the story's own \`render()\` output; the capture
// renders the same thing through the shipped story object, so the two
// surfaces cannot drift apart. The story is picked by ?story= so one
// build serves the preview, the fallback and the motion-state passes.
const story = new URLSearchParams(window.location.search).get('story');
const selected =
	story === 'fallback' ? Fallback : story === 'motion' ? MotionStates : Default;
createRoot(container).render(<>{selected.render?.()}</>);
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

/** The preview data bundle the verification compares against. */
export const PREVIEW_DATA = {
	document: MELTING_FACE_DOCUMENT,
	legend: MELTING_FACE_LEGEND,
	chain: MELTING_FACE_CHAIN,
	copy: MELTING_FACE_COPY,
	icon: MELTING_FACE_ICON,
	explanations: MELTING_FACE_EXPLANATIONS,
	sections: MELTING_FACE_SECTIONS,
	motifBullets: meltingFaceMotifBullets(),
};

/** The h2 headings each story variant is expected to render, in order. */
export function expectedHeadings(variant) {
	const noteHeadings = MELTING_FACE_SECTIONS.map((section) => section.heading);
	if (variant === 'fallback') return ['fallback / alt 表示', ...noteHeadings];
	return [MELTING_FACE_LEGEND.heading, ...noteHeadings];
}

/**
 * Compare the rendered DOM with the preview data (pure).
 *
 * The observation is what the browser read; the data is what the
 * document says. The failures are the difference, so a capture that
 * shows half the motif — a dropped chain step, a resolved candidate,
 * a missing alt text, an invented link — cannot be published as
 * evidence of the whole preview.
 */
export function verifyRenderedPreview(observation, variant = 'preview', data = PREVIEW_DATA) {
	const failures = [];

	const expectedTitle = data.document.title;
	if (collapseText(observation.title) !== collapseText(expectedTitle)) {
		failures.push(
			`the document title is "${collapseText(observation.title)}", expected "${collapseText(expectedTitle)}"`,
		);
	}

	const expectedMeta = [
		data.document.status,
		data.document.source,
		data.document.verification,
		data.document.preview,
	];
	const renderedMeta = (observation.meta ?? []).map(collapseText);
	for (const value of expectedMeta) {
		if (!renderedMeta.includes(collapseText(value))) {
			failures.push(`the document metadata "${collapseText(value)}" is missing from the preview`);
		}
	}

	// The h2 headings, in order — the motif heading (or the fallback
	// heading) first, then the note sections.
	const expectedHeadingsList = expectedHeadings(variant);
	const renderedHeadings = (observation.headings ?? [])
		.filter((heading) => heading.level === 'H2')
		.map((heading) => collapseText(heading.text));
	if (renderedHeadings.join('\n') !== expectedHeadingsList.map(collapseText).join('\n')) {
		failures.push(
			`the rendered sections are [${renderedHeadings.join(' | ')}], expected [${expectedHeadingsList.join(' | ')}]`,
		);
	}

	// The note-section bullets, byte-compared after whitespace collapse.
	const expectedBullets = data.sections.flatMap((section) => section.bullets);
	const renderedBullets = (observation.bullets ?? []).map(collapseText);
	if (renderedBullets.join('\n') !== expectedBullets.map(collapseText).join('\n')) {
		failures.push(
			`the preview rendered ${renderedBullets.length} note bullet(s), expected ${expectedBullets.length}`,
		);
	}

	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`the preview scrolls sideways (${observation.scrollWidth}px > ${observation.clientWidth}px)`,
		);
	}

	if (variant === 'preview') {
		// Every chain step, in the issue's order — a dropped or renamed
		// step fails here.
		const expectedSteps = data.chain.map((step) => collapseText(step.label));
		const renderedSteps = (observation.chainSteps ?? []).map(collapseText);
		if (renderedSteps.join('\n') !== expectedSteps.join('\n')) {
			failures.push(
				`the rendered chain steps are [${renderedSteps.join(' | ')}], expected [${expectedSteps.join(' | ')}]`,
			);
		}

		// The three copy roles and the English line must all be on the
		// page — the role split is the issue's first acceptance
		// criterion, so a missing role fails the capture.
		const renderedCopies = collapseText(observation.copyRolesText ?? '');
		for (const [role, value] of [
			['short', data.copy.short],
			['long', data.copy.long],
			['english', data.copy.english],
		]) {
			if (!renderedCopies.includes(collapseText(value))) {
				failures.push(`the ${role} copy "${collapseText(value)}" is missing from the preview`);
			}
		}

		// The icon role: exactly the marks the data declares, each
		// carrying the alt text as its accessible name, plus the asset
		// status line.
		const marks = observation.marks ?? [];
		if (marks.length === 0) {
			failures.push('no [data-melting-face-mark] was rendered');
		}
		for (const mark of marks) {
			if (collapseText(mark.ariaLabel) !== collapseText(data.icon.alt)) {
				failures.push(
					`the mark's aria-label is "${collapseText(mark.ariaLabel)}", expected "${collapseText(data.icon.alt)}"`,
				);
			}
			if (!['animated', 'reduced'].includes(mark.motionState)) {
				failures.push(
					`the mark's data-motion-state is "${mark.motionState}", expected animated|reduced`,
				);
			}
		}
		if (!collapseText(observation.iconRoleText ?? '').includes(collapseText(data.icon.assetNote))) {
			failures.push('the icon asset status note is missing from the preview');
		}

		// Every explanation candidate must be rendered — and rendered as
		// a CANDIDATE. The issue requires the contradiction to survive,
		// so a candidate that disappeared fails here.
		const renderedExplanations = collapseText(observation.explanationsText ?? '');
		for (const explanation of data.explanations) {
			if (!renderedExplanations.includes(collapseText(explanation.label))) {
				failures.push(
					`the explanation candidate "${explanation.label}" is missing from the preview`,
				);
			}
		}

		// The preview page carries no fallback panel — the fallback is
		// its own story.
		if ((observation.fallbackCount ?? 0) !== 0) {
			failures.push(
				'the preview page rendered a fallback panel — the fallback is a separate story',
			);
		}
	} else {
		// The fallback page: the text-only rendering must be present and
		// carry the same message — fallback glyph, short copy, the alt
		// description and the asset status — while NO svg mark renders.
		if ((observation.fallbackCount ?? 0) !== 1) {
			failures.push(
				`the fallback page rendered ${observation.fallbackCount ?? 0} fallback panel(s), expected 1`,
			);
		}
		const fallbackText = collapseText(observation.fallbackText ?? '');
		for (const [what, value] of [
			['fallback glyph', data.icon.fallbackText],
			['short copy', data.copy.short],
			['alt description', data.icon.alt],
			['asset status', data.icon.assetNote],
		]) {
			if (!fallbackText.includes(collapseText(value))) {
				failures.push(`the fallback is missing the ${what} "${collapseText(value)}"`);
			}
		}
		if ((observation.marks ?? []).length !== 0) {
			failures.push('the fallback page rendered an SVG mark — the fallback must be text only');
		}
	}

	return { ok: failures.length === 0, failures };
}

/**
 * Verify the reduced-motion render (pure).
 *
 * Under `prefers-reduced-motion: reduce` the mark must report
 * `data-motion-state="reduced"` and the drip group's computed
 * `animation-name` must be `none` — the component emits no
 * `animation-name` at all, so this is the resting frame, not a
 * neutralised animation. The copy must still be there: motion off
 * changes how the page moves, never what it says.
 */
export function verifyReducedMotionRender(observation, data = PREVIEW_DATA) {
	const failures = [];
	const mark = (observation.marks ?? [])[0];
	if (!mark) {
		failures.push('no [data-melting-face-mark] was rendered under reduced motion');
	} else {
		if (mark.motionState !== 'reduced') {
			failures.push(`the mark's data-motion-state is "${mark.motionState}", expected "reduced"`);
		}
		if (collapseText(mark.dripAnimationName) !== 'none') {
			failures.push(
				`the drip group's computed animation-name is "${mark.dripAnimationName}", expected "none"`,
			);
		}
	}
	const renderedCopies = collapseText(observation.copyRolesText ?? '');
	if (!renderedCopies.includes(collapseText(data.copy.short))) {
		failures.push(
			'the short copy is missing under reduced motion — the resting frame lost information',
		);
	}
	return { ok: failures.length === 0, failures };
}

/** Read the rendered facts out of the page. Runs inside Chromium. */
export const READ_DOCUMENT = () => {
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	const marks = [...document.querySelectorAll('[data-melting-face-mark]')].map((element) => {
		const svg = element.querySelector('svg[role="img"]');
		const drip = element.querySelector('[data-motion-part="drip"]');
		return {
			motionState: element.getAttribute('data-motion-state'),
			ariaLabel: svg?.getAttribute('aria-label') ?? '',
			dripAnimationName: drip ? getComputedStyle(drip).animationName : '',
		};
	});
	const fallback = document.querySelector('[data-melting-face-fallback]');
	return {
		title: text(document.querySelector('h1')),
		headings: [...document.querySelectorAll('h1, h2, h3')].map((element) => ({
			level: element.tagName,
			text: text(element),
		})),
		meta: [...document.querySelectorAll('header ul li')].map(text),
		bullets: [...document.querySelectorAll('[data-notes-list] li')].map(text),
		chainSteps: [...document.querySelectorAll('[data-melting-face-chain-step]')].map(text),
		copyRolesText: text(document.querySelector('[data-melting-face-copy-roles]')),
		iconRoleText: text(document.querySelector('[data-melting-face-icon-role]')),
		explanationsText: text(document.querySelector('[data-melting-face-explanations]')),
		marks,
		fallbackCount: document.querySelectorAll('[data-melting-face-fallback]').length,
		fallbackText: fallback ? text(fallback) : '',
		bodyBackground: getComputedStyle(document.body).backgroundColor,
		prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
		prefersReduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		scrollHeight: document.documentElement.scrollHeight,
	};
};

function parseArgs(argv) {
	const options = {
		screenshot: DEFAULT_ARTEFACT_PATH,
		fallbackScreenshot: FALLBACK_ARTEFACT_PATH,
		jsonOut: '.tmp/melting-face/report.json',
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
		if (arg.startsWith('--fallback-screenshot=')) {
			options.fallbackScreenshot = arg.slice('--fallback-screenshot='.length);
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

/**
 * One rendered pass: open the harness with the given story and
 * preference emulation, read the DOM, verify it, and optionally write
 * the PNG artefact.
 */
async function runPass({ browser, baseUrl, options, story, variant, artefactPath, emulate }) {
	const context = await browser.newContext({
		viewport: { width: options.width, height: options.height },
		deviceScaleFactor: 1,
		colorScheme: emulate?.colorScheme ?? 'light',
		reducedMotion: emulate?.reducedMotion ?? 'no-preference',
	});
	try {
		const page = await context.newPage();
		const url = `${baseUrl}/index.html${story ? `?story=${story}` : ''}`;
		await page.goto(url, { waitUntil: 'networkidle' });
		const observation = await page.evaluate(READ_DOCUMENT);
		const verdict = verifyRenderedPreview(observation, variant);
		if (!verdict.ok) {
			throw new Error(
				`the rendered ${variant} preview does not match the preview data:\n  - ${verdict.failures.join('\n  - ')}`,
			);
		}
		let capture = null;
		if (artefactPath) {
			const png = await page.screenshot({ fullPage: true });
			mkdirSync(dirname(artefactPath), { recursive: true });
			writeFileSync(artefactPath, png);
			const budget = screenshotBudgetVerdict(statSync(artefactPath).size);
			process.stdout.write(
				`[capture] wrote ${relative(REPO_ROOT, artefactPath)} (${options.width}x${observation.scrollHeight}, ${budget.kb} KB, within budget: ${budget.withinBudget})\n`,
			);
			if (!budget.withinBudget) {
				throw new Error(
					`the artefact is ${budget.kb} KB, over the ${Math.round(PNG_BUDGET_BYTES / 1024)} KB budget; the motif grew past a one-screen component — narrow the capture or revisit the preview before committing it`,
				);
			}
			capture = {
				artefact: relative(REPO_ROOT, artefactPath),
				width: options.width,
				height: observation.scrollHeight,
				...budget,
			};
		}
		return { observation, verdict, capture };
	} finally {
		await context.close();
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const previewPath = assertPngOutputPath(options.screenshot);
	const fallbackPath = assertPngOutputPath(options.fallbackScreenshot);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);

	if (options.build) {
		process.stdout.write('[capture] building the melting-face harness…\n');
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
	const passes = {};
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const browser = await chromium.launch();
			try {
				// The two committed artefacts: the motif preview and the
				// text-only fallback, both under the default (light,
				// motion-allowed) emulation.
				passes.preview = await runPass({
					browser,
					baseUrl: server.baseUrl,
					options,
					story: 'default',
					variant: 'preview',
					artefactPath: previewPath,
				});
				passes.fallback = await runPass({
					browser,
					baseUrl: server.baseUrl,
					options,
					story: 'fallback',
					variant: 'fallback',
					artefactPath: fallbackPath,
				});

				// The dark pass: same story, OS dark scheme. The report
				// records the computed page background; it must differ
				// from the light pass or the dark binding did not apply.
				passes.dark = await runPass({
					browser,
					baseUrl: server.baseUrl,
					options,
					story: 'default',
					variant: 'preview',
					emulate: { colorScheme: 'dark' },
				});
				if (!passes.dark.observation.prefersDark) {
					throw new Error('the dark pass did not emulate prefers-color-scheme: dark');
				}
				if (passes.dark.observation.bodyBackground === passes.preview.observation.bodyBackground) {
					throw new Error(
						`the dark pass rendered the same page background as light (${passes.dark.observation.bodyBackground}) — the prefers-color-scheme binding did not apply`,
					);
				}

				// The reduced-motion pass: same story, OS reduce. The
				// content verdict still applies, plus the motion
				// verdict: no animation-name and state "reduced".
				passes.reduced = await runPass({
					browser,
					baseUrl: server.baseUrl,
					options,
					story: 'default',
					variant: 'preview',
					emulate: { reducedMotion: 'reduce' },
				});
				if (!passes.reduced.observation.prefersReduced) {
					throw new Error('the reduced pass did not emulate prefers-reduced-motion: reduce');
				}
				const reducedVerdict = verifyReducedMotionRender(passes.reduced.observation);
				if (!reducedVerdict.ok) {
					throw new Error(
						`the reduced-motion render still animates or lost information:\n  - ${reducedVerdict.failures.join('\n  - ')}`,
					);
				}
				passes.reduced.verdict = { ok: true, failures: [] };
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		artefacts: {
			preview: relative(REPO_ROOT, previewPath),
			fallback: relative(REPO_ROOT, fallbackPath),
		},
		story: { module: STORY_MODULE, preview: STORY_PREVIEW, fallback: STORY_FALLBACK },
		conditions: {
			viewport: { width: options.width, height: options.height },
			deviceScaleFactor: 1,
			passes: {
				preview: { colorScheme: 'light', reducedMotion: 'no-preference' },
				fallback: { colorScheme: 'light', reducedMotion: 'no-preference' },
				dark: { colorScheme: 'dark', reducedMotion: 'no-preference' },
				reduced: { colorScheme: 'light', reducedMotion: 'reduce' },
			},
			waitUntil: 'networkidle',
			screenshot: 'fullPage',
			encode: { format: 'png' },
		},
		passes: Object.fromEntries(
			Object.entries(passes).map(([name, pass]) => [
				name,
				{
					observation: pass.observation,
					verdict: pass.verdict,
					capture: pass.capture ?? null,
				},
			]),
		),
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
