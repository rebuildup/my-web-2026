#!/usr/bin/env node

/**
 * capture-a11y-reflow — capture the Issue #400 verification screen into
 * `docs/verification/a11y/reflow.webp`.
 *
 * What this captures
 * ------------------
 * TWO measurements, in one artefact:
 *
 *   1. the reflow fixture specimens rendered at the 320 CSS px budget
 *      (WCAG 2.2 SC 1.4.10, the 400% zoom viewport) and again at 200%
 *      text (SC 1.4.4), with the measured `scrollWidth` / `clientWidth`
 *      of every specimen printed next to it; and
 *   2. the SHIPPED routes, opened at the same 320 CSS px budget, with
 *      the document's own `scrollWidth` / `clientWidth` printed for
 *      each of them.
 *
 * It is an ASSERTION, not only a screenshot. For every specimen on the
 * screen the script reads the live DOM box and computes
 * `scrollWidth > clientWidth`. The `pass/` specimens must NOT overflow;
 * the `fail/` specimens MUST overflow. A defect that stopped
 * overflowing fails the capture instead of producing a plausible-looking
 * picture, which is the negative control the Issue asks for.
 *
 * The shipped routes are asserted the same way: a shipped page that
 * scrolls in two dimensions at 320 CSS px is a SC 1.4.10 defect, and
 * the capture fails instead of photographing it.
 *
 * The specimens are NOT written twice. The browser's case table is
 * derived from the fixture FILES (`check-a11y-reflow.mjs` reads them),
 * so the static half and the browser half judge the same declaration.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The harness is generated inline.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port.
 *   - The shipped routes are read from the LOCAL preview server
 *     (`scripts/e2e-local-bootstrap.mjs`), never from a deployment. A
 *     non-loopback origin is refused.
 *   - Chromium screenshots are not byte-reproducible across processes, so
 *     the report records conditions instead of claiming a deterministic
 *     artefact.
 *
 * WebP, not PNG
 * -------------
 * Issue #400 names a `.png` path, but Chromium only writes PNG and a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture goes to `.tmp/`, is re-encoded with the existing
 * `sharp` devDependency at width <= 1600 / quality 80, and the committed
 * file is the `.webp` sibling. The script REFUSES any non-`.webp` output
 * path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-reflow.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/reflow.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-reflow)
 *   --json-out=<path>    report destination
 *                         (default .tmp/a11y-reflow/report.json)
 *   --width=<n>          page viewport width (default 1600)
 *   --base-url=<url>     loopback origin of the local preview server
 *                         (default http://127.0.0.1:3100)
 *   --no-capture         write no artefact
 */

import { execFileSync, spawn } from 'node:child_process';
import {
	copyFileSync,
	createReadStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	REFLOW_BUDGET_PX,
	UNBREAKABLE_KINDS,
	deriveSpecimenCases,
	readFixtureEntries,
} from './check-a11y-reflow.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The two stages every specimen is measured in. */
export const STAGES = [
	{ id: 'base', label: '320 px (SC 1.4.10 reflow)', fontScale: 1 },
	{ id: 'text-200', label: '320 px @ 200% text (SC 1.4.4)', fontScale: 2 },
];

/**
 * The font-size declaration that applies a text scale (pure).
 *
 * The harness puts it in the stage element's inline style; the shipped
 * route puts the same declaration on the ROOT element, which is what a
 * browser's text-only zoom does: the root font size grows, and every
 * rem-based size grows with it. The two halves therefore scale the
 * text the same way.
 */
export function textScaleDeclaration(fontScale) {
	return `font-size: ${(fontScale || 1) * 100}%`;
}

/**
 * The rule that applies a text scale to a selector (pure).
 */
export function textScaleCss(fontScale, selector = 'html') {
	if (!fontScale || fontScale === 1) return '';
	return `${selector} { ${textScaleDeclaration(fontScale)} !important; }`;
}

/** The page viewport the harness is captured at. */
export const PAGE_WIDTH = 1600;

/** The two specimen groups the screen compares. */
export const GROUPS = ['fixture: pass state', 'fixture: fail state'];

/**
 * The shipped routes the capture measures at the reflow budget.
 *
 * `/` is the canonical Home surface. `/portfolio/my-web-2026` is the
 * long-form project page (the Article-shaped surface of this platform):
 * the seeded detail route of the portfolio obligation.
 */
export const SHIPPED_ROUTES = [
	{ path: '/', label: 'Home' },
	{ path: '/portfolio/my-web-2026', label: 'Article (portfolio detail)' },
];

/** The viewport the shipped routes are opened at (SC 1.4.10 budget). */
export const SHIPPED_VIEWPORT_PX = 320;

/** How long the local preview server may take to become ready. */
export const SERVER_READY_TIMEOUT_MS = 90_000;

/**
 * The specimens, in render order — DERIVED from the fixture files.
 *
 * The browser half used to keep its own copy of the six specimens. Two
 * copies of the same six things drift silently, and the drift is
 * invisible: the static half would judge one declaration while the
 * browser measured another. The fixture files are the only definition
 * now, and this table is read from them.
 *
 * `expectOverflow` is the negative control: a `pass/` specimen must fit
 * and a `fail/` specimen must overflow. If either flips, the capture
 * fails.
 */
export const EXPECTED_CASES = deriveSpecimenCases(readFixtureEntries());

/** The WCAG 2.2 criteria this artefact speaks to. */
export const WCAG_MAPPING = [
	{ sc: '1.4.10', name: 'Reflow', level: 'AA' },
	{ sc: '1.4.4', name: 'Resize Text', level: 'AA' },
];

export const HARNESS_DIR = '.tmp/a11y-reflow/harness';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return { bytes, kb: Math.round(bytes / 1024), withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES };
}

/** Reject an output path that is not WebP, or that leaves the repository. */
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

/** Minimal XML escaping: the panel text is computed, not source. */
export function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * The inline style of one specimen.
 *
 * `max-width:100%` is the HARNESS's measuring frame, not the specimen:
 * the specimen is measured inside a 320 px budget box, and the box has
 * to stay inside the budget for the measurement to mean anything. Every
 * other declaration is the fixture's own, read from the fixture file.
 */
export function specimenStyle(entry) {
	const declarations = ['max-width:100%'];
	for (const declaration of entry.declarations ?? []) {
		declarations.push(`${declaration.property}:${declaration.value}`);
	}
	return declarations.join(';');
}

/** One specimen element: a fixed 320 px frame holding the styled content. */
function specimenEntry(entry, stageId) {
	return `<div class="frame" data-case="${escapeXml(entry.id)}" data-stage="${escapeXml(stageId)}" data-group="${escapeXml(entry.group)}" data-expect-overflow="${entry.expectOverflow}" data-kind="${escapeXml(entry.kind)}">
	<div class="case" style="${specimenStyle(entry)}">${escapeXml(entry.text)}</div>
</div>`;
}

/**
 * The generated harness page.
 *
 * Both the shipped-contract and the reproduced-defect specimens are on ONE
 * screen, in both stages, so a reviewer can compare them without opening
 * two files — and the measurement reads all of them.
 */
export function harnessIndexHtml(pageWidth = PAGE_WIDTH) {
	const stages = STAGES.map((stage) => {
		const cases = EXPECTED_CASES.map((entry) => specimenEntry(entry, stage.id)).join('\n\t\t');
		return `<section class="stage" data-stage="${escapeXml(stage.id)}" style="${escapeXml(textScaleDeclaration(stage.fontScale))}">
		<h2>${escapeXml(stage.label)}</h2>
		<div class="frames">${cases}</div>
	</section>`;
	}).join('\n\t');
	const legend = EXPECTED_CASES.map(
		(entry) =>
			`<tr><td><code>${escapeXml(entry.id)}</code></td><td>${escapeXml(entry.kind)}</td><td>${escapeXml(entry.group)}</td><td>${entry.expectOverflow ? 'must overflow' : 'must fit'}</td></tr>`,
	).join('\n\t\t');
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>text reflow — Issue #400</title>
		<style>
			* { box-sizing: border-box; }
			body { margin: 0; padding: 20px 24px 32px; width: ${pageWidth}px; background: #ffffff; color: #101828;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
			h1 { font-size: 20px; margin: 0 0 6px; }
			p.lede { margin: 0 0 18px; color: #475467; }
			h2 { font-size: 13px; margin: 14px 0 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #344054; }
			.stage { margin-bottom: 10px; }
			.frames { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
			.frame { width: ${REFLOW_BUDGET_PX}px; overflow: hidden; border: 1px dashed #98a2b3; padding: 6px; }
			.case { background: #f8fafc; border: 1px solid #d0d5dd; padding: 4px 6px; }
			table { border-collapse: collapse; margin-top: 8px; font-size: 12px; }
			td, th { border: 1px solid #d0d5dd; padding: 2px 8px; text-align: left; }
			code { color: #101828; }
		</style>
	</head>
	<body>
		<h1>text reflow — Issue #400 (WCAG 2.2 SC 1.4.10 / 1.4.4, level AA)</h1>
		<p class="lede">Every specimen is rendered inside a ${REFLOW_BUDGET_PX} px frame, at 100% and at 200% text. The pass-state rows carry the countermeasure the fixture declares; the fail-state rows reproduce the defect it stands for.</p>
	${stages}
		<table>
			<thead><tr><th>specimen</th><th>kind</th><th>group</th><th>expectation</th></tr></thead>
			<tbody>
		${legend}
			</tbody>
		</table>
	</body>
</html>
`;
}

const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
};

/** Resolve one request path inside the served root (pure). */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	const candidate = resolve(base, `.${decodeURIComponent(requestPath)}`);
	if (candidate !== base && !candidate.startsWith(`${base}/`)) return { status: 403, file: null };
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

/** Write the generated harness (idempotent, so a re-run reuses it). */
export function writeHarness(repoRoot = REPO_ROOT, pageWidth = PAGE_WIDTH) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml(pageWidth));
	return dir;
}

/* ------------------------------------------------------------------ *
 * The shipped routes, measured at the same budget
 * ------------------------------------------------------------------ */

/** Only a loopback origin may be measured. */
export function assertLoopbackBaseUrl(baseUrl) {
	if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(baseUrl)) {
		throw new Error(
			`refusing to measure a non-loopback origin: ${baseUrl}. The capture measures the local preview build, not a deployment.`,
		);
	}
	return baseUrl;
}

/**
 * A measurement that could not be taken.
 *
 * The repository's gate contract: 0 = no violation, 1 = a violation,
 * 2 = the repository could not be decided. A capture that could not
 * measure the shipped routes must not look like a capture that measured
 * them and found nothing.
 */
export class UndecidableError extends Error {
	constructor(message) {
		super(message);
		this.name = 'UndecidableError';
		this.exitCode = 2;
	}
}

/** Is the loopback origin already answering? */
export async function isOriginReady(baseUrl) {
	try {
		const response = await fetch(baseUrl, { redirect: 'manual' });
		return response.status > 0;
	} catch {
		return false;
	}
}

/**
 * The build output whose static assets the preview serves.
 *
 * The identity of a preview is proven by its BYTES, not by the fact
 * that it answers: a foreign SPA answers every path with 200, and
 * another worktree's preview of the same repository answers with a
 * DIFFERENT build.
 */
export const BUILD_ASSETS_DIR = '.cloudflare/output/v0/workers/default/assets';

/**
 * One file of this repository's build, with the URL path the preview
 * serves it under (filesystem).
 *
 * A hashed client chunk is used on purpose: its name changes with
 * every build, so an origin that serves it byte for byte is serving
 * THIS build. `null` when there is no build to compare against.
 */
export function buildAssetProbe(repoRoot = REPO_ROOT) {
	const root = join(repoRoot, BUILD_ASSETS_DIR);
	if (!existsSync(root)) return null;
	for (const relative of ['assets', '']) {
		const dir = relative ? join(root, relative) : root;
		if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
		const names = readdirSync(dir)
			.filter((name) => name.endsWith('.js'))
			.sort();
		if (names.length === 0) continue;
		const name = names[0];
		return {
			urlPath: `/${relative ? `${relative}/` : ''}${name}`,
			bytes: readFileSync(join(dir, name)),
		};
	}
	return null;
}

/**
 * Whether the origin serves THIS repository's build (browser side).
 *
 * The probe compares the bytes, so an origin that answers 200 with
 * something else — a foreign SPA, another worktree's preview — is not
 * mistaken for the build under measurement.
 */
export async function originServesBuild(baseUrl, probe) {
	if (!probe) return false;
	try {
		const response = await fetch(new URL(probe.urlPath, baseUrl), { redirect: 'manual' });
		if (!response.ok) return false;
		const body = Buffer.from(await response.arrayBuffer());
		return body.length === probe.bytes.length && body.equals(probe.bytes);
	} catch {
		return false;
	}
}

/**
 * A free loopback port (filesystem / network).
 *
 * The capture starts its own preview on a port nobody else uses, so a
 * server that is already there can never be measured by mistake.
 */
export function findFreePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolvePort(port));
		});
	});
}

/**
 * Start the local preview server and wait until it answers.
 *
 * The server is the same one the Playwright gate uses
 * (`scripts/e2e-local-bootstrap.mjs`): it migrates and seeds the local
 * D1 first, then hands over to `vite preview`. Nothing is deployed and
 * no binding outside the local state directory is touched.
 */
export async function startPreviewServer(port, repoRoot = REPO_ROOT) {
	const child = spawn(process.execPath, ['scripts/e2e-local-bootstrap.mjs', `--port=${port}`], {
		cwd: repoRoot,
		stdio: ['ignore', 'ignore', 'inherit'],
	});
	const baseUrl = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isOriginReady(baseUrl)) return { baseUrl, child };
		await new Promise((done) => setTimeout(done, 500));
	}
	child.kill('SIGTERM');
	throw new Error(
		`the local preview server did not become ready within ${SERVER_READY_TIMEOUT_MS} ms (is the build present? run \`pnpm run build\` first)`,
	);
}

/**
 * Read the shipped document's own width (browser side).
 *
 * The criterion is the DOCUMENT's width: a page that scrolls in two
 * dimensions at the 320 CSS px budget is the SC 1.4.10 defect. The
 * offenders are diagnostics only — an element whose content is wider
 * than its own box is worth showing, but it is not the criterion.
 */
export const READ_SHIPPED_DOCUMENT = () => ({
	documentScrollWidth: document.documentElement.scrollWidth,
	documentClientWidth: document.documentElement.clientWidth,
	bodyScrollWidth: document.body.scrollWidth,
	offenders: [...document.querySelectorAll('body *')]
		.filter(
			(element) =>
				// A visually hidden element (clientWidth 1) is not a reflow
				// defect: it is off-screen by design.
				element.clientWidth >= 8 && element.scrollWidth > element.clientWidth + 1,
		)
		.slice(0, 5)
		.map((element) => ({
			tag: element.tagName.toLowerCase(),
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
			text: (element.textContent ?? '').trim().slice(0, 40),
		})),
	// The elements that HIDE their own text: a box that clips its
	// content loses the text when the text grows. This is the SC 1.4.4
	// condition (no loss of content at 200% text), and it is read at
	// every stage.
	clipped: [...document.querySelectorAll('body *')]
		.filter((element) => {
			if (element.clientWidth < 8 || element.clientHeight < 8) return false;
			if (!(element.textContent ?? '').trim()) return false;
			const style = getComputedStyle(element);
			const clips = ['hidden', 'clip'].includes(style.overflowY);
			return clips && element.scrollHeight > element.clientHeight + 1;
		})
		.slice(0, 5)
		.map((element) => ({
			tag: element.tagName.toLowerCase(),
			scrollHeight: element.scrollHeight,
			clientHeight: element.clientHeight,
			text: (element.textContent ?? '').trim().slice(0, 40),
		})),
});

/**
 * Decide whether the shipped routes honour the reflow contract (pure).
 *
 * Two criteria, two stages:
 *
 *   - SC 1.4.10 (Reflow, AA) is defined at 320 CSS px. The 100% stage
 *     therefore FAILS when the document scrolls horizontally.
 *   - SC 1.4.4 (Resize Text, AA) requires no LOSS OF CONTENT at 200%
 *     text. Text hidden by a clipping box fails at every stage; a
 *     horizontal scroll at 200% is not a loss of content, so it is
 *     RECORDED (the row says how wide the document became) instead of
 *     failed — the criterion the capture asserts is the one WCAG
 *     states.
 *
 * A route that was not measured at all is a failure: an empty
 * measurement is not a measurement.
 */
export function evaluateShippedRoutes(observations) {
	const failures = [];
	const rows = [];
	const notes = [];
	for (const observation of observations ?? []) {
		const overflow = observation.documentScrollWidth > observation.documentClientWidth + 1;
		const clipped = observation.clipped ?? [];
		const stage = observation.stage ?? 'base';
		if (stage === 'base' && overflow) {
			failures.push(
				`the shipped route ${observation.path} scrolls horizontally at ${observation.viewportWidth} px (${observation.documentScrollWidth} px > ${observation.documentClientWidth} px)`,
			);
		}
		if (stage !== 'base' && overflow) {
			notes.push(
				`${observation.path} [${stage}]: the document scrolls horizontally (${observation.documentScrollWidth} px > ${observation.documentClientWidth} px); SC 1.4.4 forbids a loss of content, not a scroll, so this is recorded and not failed`,
			);
		}
		for (const element of clipped) {
			failures.push(
				`the shipped route ${observation.path} [${stage}] hides its own text (${element.tag}: ${element.scrollHeight} px of text in a ${element.clientHeight} px box): "…${element.text}…"; the text is lost at ${observation.fontScale ?? 1}x`,
			);
		}
		rows.push(
			`${overflow ? 'scroll' : 'ok   '} ${observation.path.padEnd(24)} [${stage.padEnd(8)}] document scroll=${observation.documentScrollWidth} client=${observation.documentClientWidth} clipped=${clipped.length} (${observation.label})`,
		);
	}
	if ((observations ?? []).length === 0) {
		failures.push('no shipped route was measured; the shipped half of the evidence would be empty');
	}
	return { ok: failures.length === 0, failures, rows, notes };
}

/**
 * Open every shipped route at the reflow budget and read its width.
 *
 * The routes are served by the local preview server; a route that cannot
 * be opened is a failure, not a skipped measurement. Every route is
 * measured in BOTH stages: at 100% text (the SC 1.4.10 condition) and
 * at 200% text (the SC 1.4.4 condition), with the same text scale the
 * fixture harness uses.
 */
export async function measureShippedRoutes(
	page,
	baseUrl,
	routes = SHIPPED_ROUTES,
	stages = STAGES,
) {
	const observations = [];
	for (const route of routes) {
		for (const stage of stages) {
			const response = await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
			if (!response || response.status() >= 400) {
				throw new Error(
					`the shipped route ${route.path} answered ${response ? response.status() : 'nothing'}; the shipped half of the evidence cannot be measured`,
				);
			}
			if (stage.fontScale !== 1) {
				await page.addStyleTag({ content: textScaleCss(stage.fontScale) });
				// Two frames: the first applies the new root font size, the
				// second reflows the boxes the first one resized.
				await page.evaluate(
					() =>
						new Promise((done) => {
							requestAnimationFrame(() => requestAnimationFrame(() => done(null)));
						}),
				);
			}
			const reading = await page.evaluate(READ_SHIPPED_DOCUMENT);
			observations.push({
				path: route.path,
				label: route.label,
				stage: stage.id,
				fontScale: stage.fontScale,
				viewportWidth: SHIPPED_VIEWPORT_PX,
				...reading,
			});
		}
	}
	return observations;
}

/**
 * Read the live boxes out of the rendered page.
 *
 * Runs in the browser, so it is written as a function body Chromium
 * serialises — no imports, no closure variables.
 */
export const READ_DOCUMENT = () => ({
	viewportWidth: document.documentElement.clientWidth,
	documentWidth: document.documentElement.scrollWidth,
	cases: [...document.querySelectorAll('[data-case]')].map((element) => ({
		id: element.getAttribute('data-case'),
		stage: element.getAttribute('data-stage'),
		group: element.getAttribute('data-group'),
		expectOverflow: element.getAttribute('data-expect-overflow') === 'true',
		scrollWidth: element.scrollWidth,
		clientWidth: element.clientWidth,
	})),
});

/** The measured overflow facts for one observation (pure). */
export function overflowOf(observation) {
	return observation.scrollWidth > observation.clientWidth + 1;
}

/**
 * Decide whether the browser observations prove the reflow contract (pure).
 *
 * The negative control lives here: a `pass/` specimen that overflows is
 * a failure, and a `fail/` specimen that does NOT overflow is a failure
 * too.
 */
export function evaluateObservation(observation) {
	const failures = [];
	const rows = [];
	if (observation.documentWidth > observation.viewportWidth + 1) {
		failures.push(
			`the document scrolls horizontally (${observation.documentWidth} px > ${observation.viewportWidth} px)`,
		);
	}
	for (const expected of EXPECTED_CASES) {
		for (const stage of STAGES) {
			const entry = (observation.cases ?? []).find(
				(candidate) => candidate.id === expected.id && candidate.stage === stage.id,
			);
			if (!entry) {
				failures.push(`specimen ${expected.id} was not rendered in stage ${stage.id}`);
				continue;
			}
			if (entry.clientWidth > REFLOW_BUDGET_PX + 1) {
				failures.push(
					`${expected.id} [${stage.id}]: the box is ${entry.clientWidth} px wide, not rendered inside the ${REFLOW_BUDGET_PX} px reflow budget`,
				);
			}
			const overflow = overflowOf(entry);
			if (overflow !== expected.expectOverflow) {
				failures.push(
					`${expected.id} [${stage.id}]: ${overflow ? 'overflows' : 'fits'} where the screen claims it must ${expected.expectOverflow ? 'overflow' : 'fit'}`,
				);
			}
			rows.push(
				`${stage.id.padEnd(8)} ${expected.id.padEnd(20)} scroll=${entry.scrollWidth} client=${entry.clientWidth} ${overflow ? 'OVERFLOW' : 'fits'} (expect ${expected.expectOverflow ? 'overflow' : 'fit'})`,
			);
		}
	}
	return { ok: failures.length === 0, failures, rows };
}

/**
 * Wrap one header row so the evidence stays readable at any width
 * (pure).
 *
 * The header is an SVG text band, so a row that is wider than the
 * band would be cut off — and a cut-off row is a missing piece of the
 * evidence. The rows are wrapped instead.
 */
export function wrapRow(row, width, fontSize = 12) {
	const maxChars = Math.max(24, Math.floor((width - 32) / (fontSize * 0.6)));
	if (row.length <= maxChars) return [row];
	const lines = [];
	let current = '';
	for (const word of String(row).split(' ')) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length <= maxChars) {
			current = candidate;
			continue;
		}
		if (current) lines.push(current);
		current = word;
		while (current.length > maxChars) {
			lines.push(current.slice(0, maxChars));
			current = current.slice(maxChars);
		}
	}
	if (current) lines.push(current);
	return lines;
}

/** The header band: what was measured, what was not. */
export function headerSvg({ gate, verdict, shipped, browser, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'text reflow — Issue #400 (WCAG 2.2 SC 1.4.10 / 1.4.4, AA)';
	const rows = [
		`${EXPECTED_CASES.length} fixture specimen(s) x ${STAGES.length} stage(s) = ${EXPECTED_CASES.length * STAGES.length} measured box(es) at the ${REFLOW_BUDGET_PX} px reflow budget`,
		'machine-checked: every fixture box measured from the live DOM (scrollWidth > clientWidth); the fail fixtures must overflow, the pass fixtures must fit',
		`machine-checked: ${verdict.ok ? 'every specimen resolved to the box the screen claims' : 'a specimen did NOT resolve to the claimed box'}`,
		`machine-checked: gate ${gate.violations.length} violation(s); base floor = ${gate.base.breaks.join(', ') || 'none'}; shipped source scanned: ${gate.shipped?.filesScanned ?? 0} file(s)`,
		`machine-checked: ${SHIPPED_ROUTES.length} shipped route(s) opened at ${SHIPPED_VIEWPORT_PX} CSS px in ${STAGES.length} stage(s) (100% and 200% text); at 100% the document must not scroll horizontally (SC 1.4.10), at 200% no box may hide its own text (SC 1.4.4)`,
		`measured in ${browser ? `${browser.name} ${browser.version} (deviceScaleFactor ${browser.deviceScaleFactor})` : 'an unrecorded browser'} at the ${SHIPPED_VIEWPORT_PX} CSS px budget`,
		...(shipped?.rows ?? []),
		...(shipped?.notes ?? []).map((note) => `observed, not failed: ${note}`),
		'not machine-checked: whether a broken URL still reads correctly, hyphenation quality, how the reflowed page feels',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
		'',
		...verdict.rows,
	];
	const rowTop = 34 + 30;
	const lines = rows.flatMap((row) => wrapRow(row, width));
	const height = rowTop + lines.length * 19 + 16;
	const text = lines
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * 19}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="28" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${text}
</svg>
`,
	};
}

/** Compose the artefact: the header band above the rendered screen. */
export async function composeArtefact({ sharp, pagePng, header, outPath }) {
	const page = await sharp(pagePng)
		.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
		.png()
		.toBuffer();
	const meta = await sharp(page).metadata();
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

/**
 * Move the candidate artefact into place — but only if it fits the
 * budget (filesystem).
 *
 * The candidate is written to a temporary path first, so a capture that
 * fails the budget leaves NEITHER a budget-breaking artefact in the
 * tree NOR a hole where the previous valid artefact used to be. The
 * committed file is replaced only on success.
 */
export function promoteArtefact({
	candidatePath,
	outPath,
	bytes,
	budgetBytes = SCREENSHOT_BUDGET_BYTES,
}) {
	const verdict = screenshotBudgetVerdict(bytes);
	if (!verdict.withinBudget) {
		rmSync(candidatePath, { force: true });
		return {
			promoted: false,
			verdict,
			reason: `capture is ${verdict.kb} kB, over the ${Math.round(budgetBytes / 1024)} kB budget; the committed artefact was left untouched`,
		};
	}
	copyFileSync(candidatePath, outPath);
	rmSync(candidatePath, { force: true });
	return { promoted: true, verdict, reason: null };
}

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/a11y/reflow.webp',
		pngDir: '.tmp/a11y-reflow',
		jsonOut: '.tmp/a11y-reflow/report.json',
		width: PAGE_WIDTH,
		baseUrl: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100',
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
			case 'png-dir':
				options.pngDir = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'width':
				options.width = Number(value);
				break;
			case 'base-url':
				options.baseUrl = value;
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

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const { collectEvidence, renderGateSummary } = await import('./check-a11y-reflow.mjs');
	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`${renderGateSummary(gate)}\n`);
		throw new Error(
			`the reflow gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
		);
	}

	writeHarness(REPO_ROOT, options.width);
	assertLoopbackBaseUrl(options.baseUrl);
	const server = await serveDirectory(resolve(REPO_ROOT, HARNESS_DIR));
	let capture = null;
	let browserInfo = null;
	let verdict = null;
	let observation = null;
	let shipped = null;
	let preview = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness written, nothing captured\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'screen.png');
			const candidatePath = resolve(REPO_ROOT, options.pngDir, 'artefact.webp');
			ensureDir(join(options.pngDir, 'x.png'));
			const browser = await chromium.launch();
			// The measurement conditions are part of the record: Issue #400
			// asks for the command, the browser and the viewport to be
			// written down, and a width measurement without the browser
			// that produced it is not reproducible.
			browserInfo = {
				name: 'chromium',
				version: browser.version(),
				deviceScaleFactor: 1,
				harnessViewport: { width: options.width, height: 1000 },
				shippedViewport: { width: SHIPPED_VIEWPORT_PX, height: 720 },
			};
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: 1000 },
					deviceScaleFactor: 1,
					isMobile: false,
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				observation = await page.evaluate(READ_DOCUMENT);
				writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
				await context.close();

				// The SHIPPED half: the real routes, opened at the same
				// 320 CSS px budget, read from the local preview server.
				//
				// The origin is identified by its BYTES: the origin has to
				// serve one file of THIS repository's build, byte for
				// byte. An origin that answers but serves something else
				// (a foreign SPA, another worktree's preview) is not
				// measured at all — a dedicated preview is started on a
				// free port instead.
				let baseUrl = options.baseUrl;
				const probe = buildAssetProbe();
				if (!(await originServesBuild(baseUrl, probe))) {
					const port = await findFreePort();
					process.stdout.write(
						`[capture] ${baseUrl} does not serve this repository's build; starting a dedicated preview on port ${port}…\n`,
					);
					try {
						preview = await startPreviewServer(port);
					} catch (error) {
						throw new UndecidableError(
							`the shipped routes could not be measured: ${error.message}`,
						);
					}
					baseUrl = preview.baseUrl;
					if (!(await originServesBuild(baseUrl, probe))) {
						throw new UndecidableError(
							`the preview on ${baseUrl} does not serve this repository's build; the shipped half of the evidence would be a measurement of something else`,
						);
					}
				} else {
					process.stdout.write(`[capture] measuring the build of this repository at ${baseUrl}\n`);
				}
				const shippedContext = await browser.newContext({
					viewport: { width: SHIPPED_VIEWPORT_PX, height: 720 },
					deviceScaleFactor: 1,
					isMobile: false,
				});
				const shippedPage = await shippedContext.newPage();
				let shippedObservations;
				try {
					shippedObservations = await measureShippedRoutes(shippedPage, baseUrl);
				} catch (error) {
					throw new UndecidableError(`the shipped routes could not be measured: ${error.message}`);
				}
				await shippedContext.close();
				shipped = {
					observations: shippedObservations,
					...evaluateShippedRoutes(shippedObservations),
				};
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation(observation);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the browser observations contradict the reflow contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}
			for (const failure of shipped.failures) process.stderr.write(`- ${failure}\n`);
			for (const note of shipped.notes ?? []) process.stdout.write(`[capture] observed: ${note}\n`);
			if (!shipped.ok) {
				throw new Error(
					`a shipped route does not honour the reflow contract (${shipped.failures.length} failure(s)); no artefact was written`,
				);
			}

			const header = headerSvg({
				gate,
				verdict,
				shipped,
				browser: browserInfo,
				width: Math.min(options.width, SCREENSHOT_MAX_WIDTH),
			});
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			// The candidate is written first and moved into place only
			// after the budget check: a capture that breaks the budget
			// must not leave a breaking artefact in the tree, and it
			// must not delete the valid one either.
			const geometry = await composeArtefact({ sharp, pagePng, header, outPath: candidatePath });
			const promotion = promoteArtefact({
				candidatePath,
				outPath,
				bytes: statSync(candidatePath).size,
			});
			rmSync(pagePng, { force: true });
			if (!promotion.promoted) {
				throw new Error(promotion.reason);
			}
			const meta = await sharp(outPath).metadata();
			const budget = promotion.verdict;
			capture = {
				artefact: options.screenshot,
				viewport: { width: options.width, height: 1000 },
				shippedViewport: { width: SHIPPED_VIEWPORT_PX, height: 720 },
				quality: SCREENSHOT_QUALITY,
				width: meta.width ?? null,
				height: meta.height ?? null,
				...geometry,
				...budget,
			};
			process.stdout.write(
				`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${budget.kb} kB)\n`,
			);
		}
	} finally {
		await server.close();
		if (preview?.child) preview.child.kill('SIGTERM');
	}

	const report = {
		issue: '#400',
		generatedBy: 'scripts/capture-a11y-reflow.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, html: harnessIndexHtml() },
		stages: STAGES,
		observation,
		verdict,
		shipped,
		gate: {
			violations: gate.violations,
			baseBreaks: gate.base.breaks,
			shippedFilesScanned: gate.shipped?.filesScanned ?? 0,
			shippedExcluded: gate.shipped?.excluded ?? [],
		},
		kinds: UNBREAKABLE_KINDS,
		wcag: WCAG_MAPPING,
		browser: browserInfo,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/reflow-400-percent.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] wrote ${options.jsonOut}\n`);
	return 0;
}

if (process.argv[1]?.endsWith('capture-a11y-reflow.mjs')) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = error?.exitCode ?? 1;
		},
	);
}
