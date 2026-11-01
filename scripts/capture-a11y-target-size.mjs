#!/usr/bin/env node

/**
 * capture-a11y-target-size — capture the Issue #401 verification screen
 * into `docs/verification/a11y/tap-target-overlay.webp`.
 *
 * What this captures
 * ------------------
 * TWO halves, in one artefact, because the criterion is a size claim
 * about RENDERED boxes and the two halves can only say half of it:
 *
 *   1. The FIXTURE specimens. The repository's own
 *      `scripts/fixtures/a11y-target-size/{pass,fail}` files are rendered
 *      side by side, each with the 24 × 24 CSS px minimum drawn over it:
 *      a green box for a target that meets the criterion, a red box for
 *      one that does not. The pass specimens and the fail specimens are
 *      in the same picture on purpose — the point of the Issue is the
 *      DIFFERENCE between them, and a picture of only the passing half
 *      would prove nothing.
 *   2. The SHIPPED surfaces. The real application — the local preview
 *      server (`scripts/e2e-local-bootstrap.mjs`, the same one
 *      Playwright's `webServer` uses) serves the built Worker on
 *      loopback — is opened at the three surfaces Issue #401 names
 *      (the reaction picker, the nav, the filter), every interactive
 *      target is measured, and the same overlay is drawn over it.
 *
 * It is also an ASSERTION, not only a screenshot. The script measures,
 * decides, and refuses to write anything when the measurements
 * contradict the contract:
 *
 *   - the static gate must be green before the capture starts, so the
 *     artefact can never be the evidence for a broken source contract;
 *   - every target of the three shipped surfaces must meet the 24 × 24
 *     minimum, or the exceptions the criterion names;
 *   - every `pass/` specimen must measure compliant and every `fail/`
 *     specimen must measure a violation — that is the capture's
 *     NEGATIVE CONTROL: a check that cannot fail is not a check.
 *
 * The exceptions, and who decides them
 * ------------------------------------
 *   inline    — DECIDED HERE, by measurement: the target's computed
 *               `display` is `inline`, so its size is constrained by the
 *               line-height of the surrounding text. A declared size
 *               below 24 px does not qualify; only a target whose size
 *               the text flow constrains does.
 *   spacing   — DECLARED with a reason, then CHECKED here: a 24 CSS px
 *               diameter circle centred on the target must not intersect
 *               any other target's circle or bounding box. A claim the
 *               geometry refuses is a failure, not a pass.
 *   equivalent — DECLARED with a reason AND the name of the equivalent
 *               control, then CHECKED here: the named control has to be
 *               on the same page and to meet the 24 × 24 minimum
 *               itself. What the capture CANNOT check is that the other
 *               control offers the same FUNCTION — that stays human
 *               evaluation, and the artefact says so instead of
 *               implying a machine verdict.
 *   user-agent / essential — DECLARED with a reason; the capture accepts
 *               the declaration and records it in the report.
 *
 * What is deliberately NOT captured
 * ---------------------------------
 * Whether a 24 px target is comfortable with a thumb, whether a spacing
 * exception is good design, whether a drag gesture is the right
 * interaction, whether a DECLARED alternative operation offers the same
 * function as the drag gesture it replaces, whether the control an
 * "equivalent" exception names offers the same function, and how the
 * three surfaces feel on a real phone. Those stay human evaluation, and
 * the artefact says so on its face instead of implying a machine
 * verdict.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The preview server is loopback-only.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules from `file://`.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG, but a verification artefact does not justify
 * a permanently large binary in the tree. The capture is taken into
 * `.tmp/`, encoded with the existing `sharp` devDependency at width
 * <= 1600 / quality 80, and the committed file is the `.webp` sibling.
 * The script REFUSES any non-`.webp` output path and deletes the
 * intermediate PNGs.
 *
 * Usage:
 *   node scripts/capture-a11y-target-size.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/tap-target-overlay.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-target-size)
 *   --json-out=<path>    report destination (default .tmp/a11y-target-size/report.json)
 *   --port=<n>           preview server port (default 3140)
 *   --no-build           reuse an existing harness build in .tmp
 *   --no-capture         start nothing browser-side; write no artefact
 */

import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	EXCEPTION_KINDS,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	MIN_TARGET_PX,
	SHIPPED_EXCEPTIONS,
	WCAG,
	WCAG_DRAGGING,
	collectEvidence,
	renderGateSummary,
} from './check-a11y-target-size.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** The canvas geometry of the composed artefact. */
export const RENDER_WIDTH = 900;
export const PANEL_WIDTH = SCREENSHOT_MAX_WIDTH - RENDER_WIDTH - 24;
export const GUTTER = 24;
export const STRIP_GAP = 14;
export const STRIP_MAX_HEIGHT = 420;
export const ROW_STEP = 19;
export const HEADER_PAD = 30;
export const TITLE_FONT_SIZE = 20;

/** The viewports the capture drives. */
export const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
export const MOBILE_VIEWPORT = { width: 600, height: 800 };
export const HARNESS_VIEWPORT = { width: 1280, height: 900 };

/** The WCAG 2.2 criteria this artefact speaks to, with their levels. */
export const WCAG_MAPPING = [
	{ sc: WCAG.sc, name: WCAG.name, level: WCAG.level },
	{ sc: WCAG_DRAGGING.sc, name: WCAG_DRAGGING.name, level: WCAG_DRAGGING.level },
	{ sc: '2.1.1', name: 'Keyboard', level: 'A' },
	{ sc: '1.4.4', name: 'Resize Text', level: 'AA' },
];

/**
 * The shipped surfaces the capture opens, and how it finds them.
 *
 * The three surfaces are the ones Issue #401 names. The `selector` is
 * the container the measurement walks; the `clip` is the element the
 * screenshot is cropped to, so the overlay is drawn on the surface and
 * not on the whole page.
 */
export const SURFACE_CAPTURES = [
	{
		id: 'nav-desktop',
		label: 'public nav (desktop)',
		path: '/about',
		viewport: DESKTOP_VIEWPORT,
		selector: 'nav[aria-label="Public"]',
		clip: 'nav[aria-label="Public"]',
		open: null,
	},
	{
		id: 'nav-mobile',
		label: 'public nav (mobile panel)',
		path: '/about',
		viewport: MOBILE_VIEWPORT,
		selector: 'nav[aria-label="Public"]',
		clip: 'nav[aria-label="Public"]',
		open: { trigger: 'nav[aria-label="Public"] button[aria-controls]' },
	},
	{
		id: 'filter',
		label: 'portfolio facet filter',
		path: '/portfolio',
		viewport: DESKTOP_VIEWPORT,
		selector: '[aria-label="facet filter chips"]',
		clip: '[aria-label="facet filter chips"]',
		open: null,
	},
	{
		id: 'picker',
		label: 'reaction picker (dialog)',
		path: '/design-system',
		viewport: DESKTOP_VIEWPORT,
		selector: 'dialog[aria-label="Add a reaction"]',
		clip: 'dialog[aria-label="Add a reaction"]',
		open: { trigger: '[data-testid="design-system-reaction-picker-open"]' },
	},
];

/** Where the generated harness lives. */
export const HARNESS_DIR = '.tmp/a11y-target-size/harness';
export const HARNESS_DIST = '.tmp/a11y-target-size/harness-dist';

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

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
}

/** Minimal XML escaping: the panel text is computed, not source. */
export function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ *
 * The geometry of the spacing exception (pure)
 * ------------------------------------------------------------------ */

/** The centre of a box (pure). */
export function boxCentre(box) {
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Whether a circle and a box intersect (pure). */
export function circleIntersectsBox(circle, box) {
	const nearestX = Math.max(box.x, Math.min(circle.x, box.x + box.width));
	const nearestY = Math.max(box.y, Math.min(circle.y, box.y + box.height));
	const dx = circle.x - nearestX;
	const dy = circle.y - nearestY;
	return dx * dx + dy * dy <= circle.radius * circle.radius;
}

/** Whether two circles intersect (pure). */
export function circlesIntersect(a, b) {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const reach = a.radius + b.radius;
	return dx * dx + dy * dy <= reach * reach;
}

/**
 * Whether the spacing exception's claim holds for one target (pure).
 *
 * The claim is the criterion's own wording: a 24 CSS px diameter circle
 * centred on the target must not intersect any other target's circle or
 * bounding box.
 */
export function spacingClaimHolds(target, others) {
	const circle = { ...boxCentre(target.box), radius: MIN_TARGET_PX / 2 };
	for (const other of others) {
		if (other.id === target.id) continue;
		if (circleIntersectsBox(circle, other.box)) return false;
		if (circlesIntersect(circle, { ...boxCentre(other.box), radius: MIN_TARGET_PX / 2 }))
			return false;
	}
	return true;
}

/**
 * Whether the "equivalent" exception's claim holds (pure).
 *
 * The claim the capture CAN check: the named control is on the same page
 * and meets the 24 × 24 minimum itself. The claim it CANNOT check — that
 * the other control offers the same FUNCTION — stays human evaluation,
 * and the reason it returns never claims it.
 */
export function equivalentClaimHolds(declaration) {
	const equivalent = declaration?.equivalent ?? null;
	if (!equivalent) {
		return { holds: false, reason: 'no equivalent control is named' };
	}
	if (!equivalent.found) {
		return {
			holds: false,
			reason: `the named control "${equivalent.ref}" is not on the same page`,
		};
	}
	if (!equivalent.meets) {
		return {
			holds: false,
			reason: `the named control "${equivalent.ref}" measures ${Math.round(equivalent.width)} × ${Math.round(equivalent.height)} px, below the ${MIN_TARGET_PX} px minimum`,
		};
	}
	return {
		holds: true,
		reason: `the named control "${equivalent.ref}" is on the same page and measures ${Math.round(equivalent.width)} × ${Math.round(equivalent.height)} px, so it meets the minimum itself`,
	};
}

/**
 * Decide one measured target (pure).
 *
 * `verdict` is one of `compliant`, `compliant-by-exception` or
 * `violation`; `exception` names the exception that carried it, if any.
 */
export function evaluateMeasuredTarget({ target, others, declaredException }) {
	const width = target.width;
	const height = target.height;
	const where = target.label ? `"${target.label}"` : target.id;
	if (width >= MIN_TARGET_PX && height >= MIN_TARGET_PX) {
		return {
			verdict: 'compliant',
			exception: null,
			reason: `the target measures ${Math.round(width)} × ${Math.round(height)} px`,
		};
	}
	if (target.display === 'inline') {
		return {
			verdict: 'compliant-by-exception',
			exception: 'inline',
			reason: `the target measures ${Math.round(width)} × ${Math.round(height)} px, but it is an inline target in a text flow, so its size is constrained by the line-height of the surrounding text (SC ${WCAG.sc}, inline)`,
		};
	}
	if (declaredException) {
		if (declaredException.kind === 'spacing') {
			const holds = spacingClaimHolds(target, others);
			return {
				verdict: holds ? 'compliant-by-exception' : 'violation',
				exception: holds ? 'spacing' : null,
				reason: holds
					? `the target measures ${Math.round(width)} × ${Math.round(height)} px, and the declared spacing claim holds: a ${MIN_TARGET_PX} px circle centred on it reaches no other target (SC ${WCAG.sc}, spacing)`
					: `the target measures ${Math.round(width)} × ${Math.round(height)} px and declares the spacing exception, but the claim does not hold: a ${MIN_TARGET_PX} px circle centred on it intersects another target (SC ${WCAG.sc}, spacing)`,
			};
		}
		if (declaredException.kind === 'equivalent') {
			const claim = equivalentClaimHolds(declaredException);
			return {
				verdict: claim.holds ? 'compliant-by-exception' : 'violation',
				exception: claim.holds ? 'equivalent' : null,
				reason: claim.holds
					? `the target measures ${Math.round(width)} × ${Math.round(height)} px, and the declared equivalent claim holds: ${claim.reason} (SC ${WCAG.sc}, equivalent). Whether that control offers the same FUNCTION is human evaluation, not proven here`
					: `the target measures ${Math.round(width)} × ${Math.round(height)} px and declares the equivalent exception, but the claim does not hold: ${claim.reason} (SC ${WCAG.sc}, equivalent)`,
			};
		}
		if (declaredException.kind === 'essential' || declaredException.kind === 'user-agent') {
			return {
				verdict: 'compliant-by-exception',
				exception: declaredException.kind,
				reason: `the target measures ${Math.round(width)} × ${Math.round(height)} px, and the surface declares the "${declaredException.kind}" exception: ${declaredException.reason}`,
			};
		}
		return {
			verdict: 'violation',
			exception: null,
			reason: `the target measures ${Math.round(width)} × ${Math.round(height)} px and declares an exception that is not one of the five SC ${WCAG.sc} names`,
		};
	}
	return {
		verdict: 'violation',
		exception: null,
		reason: `the target measures ${Math.round(width)} × ${Math.round(height)} px, below the ${MIN_TARGET_PX} px minimum of SC ${WCAG.sc}, and no exception applies`,
	};
}

/**
 * Decide every measured target of one surface (pure).
 *
 * The declared exceptions of a surface are matched by target id, so a
 * declaration reaches the box it was written for and no other.
 */
export function evaluateMeasuredTargets({ targets, declaredExceptions = [] }) {
	const rows = [];
	for (const target of targets) {
		const declared = declaredExceptions.find((entry) => entry.targetId === target.id) ?? null;
		const decision = evaluateMeasuredTarget({
			target,
			others: targets,
			declaredException: declared,
		});
		rows.push({ ...target, ...decision });
	}
	return rows;
}

/**
 * Decide the whole observation (pure).
 *
 * The shipped surfaces have to be clean, and the fixture specimens have
 * to reproduce the state their directory stands for: that is the
 * negative control of the capture.
 */
export function evaluateObservation(observation) {
	const failures = [];
	const rows = [];

	for (const surface of observation.surfaces ?? []) {
		const surfaceRows = evaluateMeasuredTargets({
			targets: surface.targets,
			declaredExceptions: surface.declaredExceptions ?? [],
		});
		for (const row of surfaceRows) {
			rows.push({ scope: surface.id, ...row });
			if (row.verdict === 'violation') {
				failures.push(
					`${surface.label}: the target ${row.label ? `"${row.label}"` : row.id} violates SC ${WCAG.sc} — ${row.reason}`,
				);
			}
		}
	}

	for (const specimen of observation.specimens ?? []) {
		// The expected size verdict comes from the harness (the fixture
		// file declares it), and falls back to the roster's expectation.
		// A missing expectation must never silently skip the check: an
		// unchecked specimen is a specimen nobody looks at.
		const expectedVerdict =
			specimen.sizeVerdict ?? (specimen.expectation === 'fail' ? 'fail' : 'pass');
		// A declaration written on a target is that target's own; a
		// declaration written on the specimen reaches every target that
		// does not carry one of its own.
		const declaredExceptions = specimen.targets
			.map((target) => {
				const kind = target.exceptionKind ?? specimen.exceptionKind;
				if (!kind) return null;
				return {
					targetId: target.id,
					kind,
					reason: target.exceptionReason ?? specimen.exceptionReason ?? '',
					equivalent: target.equivalent ?? null,
				};
			})
			.filter((entry) => entry !== null);
		const specimenRows = evaluateMeasuredTargets({
			targets: specimen.targets,
			declaredExceptions,
		});
		const failing = specimenRows.filter((row) => row.verdict === 'violation');
		for (const row of specimenRows) {
			rows.push({ scope: specimen.specimenId, ...row });
		}
		if (expectedVerdict === 'pass' && failing.length > 0) {
			failures.push(
				`the pass specimen "${specimen.specimenId}" measures a violation — ${failing[0].reason}; the passing state is no longer reproduced`,
			);
		}
		if (expectedVerdict === 'fail' && failing.length === 0) {
			failures.push(
				`the fail specimen "${specimen.specimenId}" measures no violation; the defect it stands for is not detected any more, so the capture's negative control is gone`,
			);
		}
	}

	return { ok: failures.length === 0, failures, rows };
}

/* ------------------------------------------------------------------ *
 * The fixture harness
 * ------------------------------------------------------------------ */

/** The fixture cases, derived from the gate's roster (pure). */
export function fixtureCases() {
	const cases = [];
	for (const [directory, expectations] of Object.entries(FIXTURE_EXPECTATIONS)) {
		for (const [name, expected] of Object.entries(expectations)) {
			cases.push({
				caseId: `${directory}/${name.replace(/\.tsx$/, '')}`,
				directory,
				name,
				module: `${FIXTURE_ROOT}/${directory}/${name}`,
				exportName: expected.exportName,
				expectation: directory === 'pass' ? 'pass' : 'fail',
				sizeVerdict: expected.sizeVerdict,
			});
		}
	}
	return cases;
}

/** The generated harness page. Deterministic, so the report can hash it. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>tap target size (#401)</title>
		<style>
			body {
				margin: 0;
				padding: 28px;
				background: #ffffff;
				color: #1c2030;
				font-family: ui-sans-serif, system-ui, sans-serif;
			}
			h1 {
				font-size: 19px;
				margin: 0 0 4px;
			}
			p.lead {
				margin: 0 0 22px;
				color: #5a6072;
				font-size: 13px;
			}
			.cases {
				display: flex;
				flex-wrap: wrap;
				gap: 34px;
				align-items: flex-start;
			}
			.case {
				flex: 0 0 auto;
				border: 1px solid #d8d2c0;
				border-radius: 8px;
				padding: 14px 16px 16px;
				min-width: 180px;
			}
			.case h2 {
				font-size: 12px;
				margin: 0 0 3px;
			}
			.case p {
				font-size: 11px;
				color: #5a6072;
				margin: 0 0 12px;
			}
			.case p.reason {
				margin: 12px 0 0;
				max-width: 260px;
			}
		</style>
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
 * It imports the fixture files themselves, so the capture shows the same
 * specimens the gate reads — a rewritten fixture changes the artefact
 * instead of leaving a stale one behind.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	const imports = fixtureCases()
		.map(
			(entry) =>
				`import { ${entry.exportName} } from '${up}${entry.module.replace(/\.tsx$/, '')}';`,
		)
		.join('\n');
	const cases = fixtureCases()
		.map(
			(entry) => `		<section
			data-target-case="${entry.caseId}"
			data-target-expectation="${entry.expectation}"
			data-target-size-verdict="${entry.sizeVerdict}"
			data-target-module="${entry.module}"
		>
			<h2>${entry.caseId}</h2>
			<p>${entry.module.split('/').pop()}</p>
			<${entry.exportName} />
		</section>`,
		)
		.join('\n');
	return `import { createRoot } from 'react-dom/client';
${imports}

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

createRoot(container).render(
	<div data-target-root="true">
		<h1>Tap and click target size — Issue #401</h1>
		<p class="lead">
			Every target carries a 24 × 24 CSS px minimum. Green meets it; red misses it.
		</p>
		<div class="cases">
${cases}
		</div>
	</div>,
);
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

/* ------------------------------------------------------------------ *
 * The browser side
 * ------------------------------------------------------------------ */

/**
 * The measurement, run in the browser.
 *
 * It returns, for every interactive target inside the container, the
 * border box (the hit area the criterion talks about), the computed
 * `display` (the inline exception is decided by it) and the number of
 * line boxes (an inline target that wraps is not measured reliably).
 */
export const MEASURE_TARGETS = (selector) => {
	const container = document.querySelector(selector);
	if (!container) return { found: false, targets: [], hidden: 0 };
	// The "equivalent" exception is a claim about ANOTHER control, so
	// the capture has to find that control and measure it. The reference
	// is an id or a selector; a reference that resolves to nothing is
	// recorded as "not found" rather than guessed at.
	const resolveEquivalent = (ref) => {
		if (!ref) return null;
		let element = null;
		try {
			element = document.getElementById(ref) ?? document.querySelector(ref);
		} catch {
			element = null;
		}
		if (!element) {
			return { ref, found: false, width: null, height: null, meets: false, tag: null, id: null };
		}
		const rect = element.getBoundingClientRect();
		return {
			ref,
			found: true,
			width: rect.width,
			height: rect.height,
			meets: rect.width >= 24 && rect.height >= 24,
			tag: element.tagName.toLowerCase(),
			id: element.id ?? null,
		};
	};
	const interactive = container.querySelectorAll(
		'a[href], button, input, select, textarea, summary, [role="button"], [role="link"]',
	);
	const targets = [];
	let hidden = 0;
	let index = 0;
	for (const element of interactive) {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		if (rect.width === 0 && rect.height === 0) {
			// A hidden element has no hit area, so it is not a pointer
			// target at all. The count is reported so the reader can see
			// that the skip happened rather than guessing.
			hidden += 1;
			continue;
		}
		const label = (element.getAttribute('aria-label') ?? element.textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 48);
		targets.push({
			id: `${selector}#${index}`,
			tag: element.tagName.toLowerCase(),
			label,
			width: rect.width,
			height: rect.height,
			display: style.display,
			lineBoxes: element.getClientRects().length,
			box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
			exceptionKind: element.getAttribute('data-target-exception'),
			exceptionReason: element.getAttribute('data-target-reason'),
			equivalent: resolveEquivalent(element.getAttribute('data-target-equivalent')),
		});
		index += 1;
	}
	return { found: true, targets, hidden };
};

/**
 * The overlay, drawn in the browser.
 *
 * A green (or red) rectangle around the border box of every target, and
 * the 24 CSS px circle the criterion asks for. The circle is drawn at the
 * MINIMUM size, so a target larger than the minimum shows the circle
 * inside it and a target smaller than the minimum shows the circle
 * reaching past it.
 */
export const DRAW_OVERLAY = (selector) => {
	const container = document.querySelector(selector);
	if (!container) return { drawn: 0 };
	const previous = document.getElementById('__target_size_overlay__');
	if (previous) previous.remove();
	const interactive = container.querySelectorAll(
		'a[href], button, input, select, textarea, summary, [role="button"], [role="link"]',
	);
	const svgNs = 'http://www.w3.org/2000/svg';
	const layer = document.createElementNS(svgNs, 'svg');
	layer.setAttribute('id', '__target_size_overlay__');
	layer.setAttribute('width', '100%');
	layer.setAttribute('height', '100%');
	layer.style.position = 'fixed';
	layer.style.inset = '0';
	layer.style.pointerEvents = 'none';
	layer.style.zIndex = '2147483647';
	let drawn = 0;
	for (const element of interactive) {
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;
		const style = getComputedStyle(element);
		const meets = rect.width >= 24 && rect.height >= 24;
		const colour = meets ? '#1f7a3d' : '#c02a1e';
		const box = document.createElementNS(svgNs, 'rect');
		box.setAttribute('x', String(rect.x - 1));
		box.setAttribute('y', String(rect.y - 1));
		box.setAttribute('width', String(rect.width + 2));
		box.setAttribute('height', String(rect.height + 2));
		box.setAttribute('fill', 'none');
		box.setAttribute('stroke', colour);
		box.setAttribute('stroke-width', '2');
		layer.appendChild(box);
		const circle = document.createElementNS(svgNs, 'circle');
		circle.setAttribute('cx', String(rect.x + rect.width / 2));
		circle.setAttribute('cy', String(rect.y + rect.height / 2));
		circle.setAttribute('r', '12');
		circle.setAttribute('fill', 'none');
		circle.setAttribute('stroke', meets ? '#1f7a3d' : '#c02a1e');
		circle.setAttribute('stroke-width', '1.5');
		circle.setAttribute('stroke-dasharray', '4 3');
		layer.appendChild(circle);
		drawn += 1;
		void style;
	}
	document.body.appendChild(layer);
	return { drawn };
};

/** Wait until the preview server answers on the loopback port. */
export async function waitForServer(url, attempts = 60, intervalMs = 1_000) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const response = await fetch(url, { redirect: 'manual' });
			if (response.status > 0) return true;
		} catch {
			// The server is not up yet.
		}
		await new Promise((done) => setTimeout(done, intervalMs));
	}
	return false;
}

/* ------------------------------------------------------------------ *
 * The artefact
 * ------------------------------------------------------------------ */

/** The compact form of one measured target. */
function targetLine(row) {
	const mark = row.verdict === 'violation' ? 'NO ' : row.exception ? 'exc' : 'ok ';
	return `   ${mark} ${String(Math.round(row.width)).padStart(3)} × ${String(Math.round(row.height)).padStart(3)} px  ${row.display.padEnd(12)} ${row.label || row.tag}`;
}

/**
 * The rows of one group, in a form a reader can scan.
 *
 * The full list lives in the report JSON; the panel shows a summary and
 * the targets that MATTER: every exception and every violation, then the
 * smallest ones (a target at the minimum is the interesting one). The
 * emoji picker alone exposes well over a hundred buttons, and a panel
 * that lists all of them would push the rest of the artefact off the
 * page.
 */
export function evidenceRows(observation, verdict, limit = 8) {
	const rows = [];
	const group = (title, entries) => {
		if (entries.length === 0) return;
		rows.push(`— ${title}`);
		const smallest = entries.reduce(
			(minimum, row) => Math.min(minimum, row.width, row.height),
			Number.POSITIVE_INFINITY,
		);
		const exceptions = entries.filter((row) => row.exception).length;
		rows.push(
			`   ${entries.length} target(s), the smallest is ${Number.isFinite(smallest) ? Math.round(smallest) : 0} px, ${exceptions} exception(s)`,
		);
		const notable = entries.filter((row) => row.exception || row.verdict === 'violation');
		const rest = entries
			.filter((row) => !notable.includes(row))
			.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
		for (const row of [...notable, ...rest].slice(0, limit)) rows.push(targetLine(row));
	};
	for (const surface of observation.surfaces ?? []) {
		group(
			`${surface.label} (${surface.path})`,
			verdict.rows.filter((entry) => entry.scope === surface.id),
		);
	}
	for (const specimen of observation.specimens ?? []) {
		group(
			`specimen ${specimen.specimenId} (${specimen.sizeVerdict})`,
			verdict.rows.filter((entry) => entry.scope === specimen.specimenId),
		);
	}
	return rows;
}

/** The header band: what was measured, what was decided, what was not. */
export function headerSvg({ observation, verdict, gate, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'tap / click target size — Issue #401';
	const measured = (observation.surfaces ?? []).reduce(
		(total, surface) => total + surface.targets.length,
		0,
	);
	const specimens = (observation.specimens ?? []).reduce(
		(total, specimen) => total + specimen.targets.length,
		0,
	);
	const rows = [
		`shipped surfaces: ${(observation.surfaces ?? []).map((surface) => surface.label).join(' · ')}`,
		`machine-checked: ${measured} shipped target(s) measured in Chromium, ${specimens} specimen target(s) measured`,
		`machine-checked: the minimum is ${MIN_TARGET_PX} × ${MIN_TARGET_PX} CSS px (SC ${WCAG.sc} ${WCAG.name}, ${WCAG.level})`,
		`machine-checked: the drag rule answers to SC ${WCAG_DRAGGING.sc} ${WCAG_DRAGGING.name} — a drag gesture must DECLARE an alternative operation`,
		`machine-checked: green = meets the minimum, red = misses it, dashed circle = the ${MIN_TARGET_PX} px minimum`,
		`machine-checked: ${verdict.failures.length} failure(s); the static gate reports ${gate.violations.length} violation(s)`,
		'not machine-checked: thumb comfort, whether a spacing exception is good design, whether a declared alternative offers the same function, a real device pass',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
	];
	const rowTop = HEADER_PAD + 34;
	const height = rowTop + rows.length * ROW_STEP + 18;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * ROW_STEP}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="${HEADER_PAD}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${TITLE_FONT_SIZE}" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${lines}
</svg>
`,
	};
}

/** The evidence panel: one row per measured target, beside the render. */
export function evidencePanelSvg({ observation, verdict, gate, width }) {
	const body = [
		'machine-checked per target',
		'',
		...evidenceRows(observation, verdict),
		'',
		'exceptions (SC 2.5.8)',
		...Object.entries(EXCEPTION_KINDS).map(
			([kind, entry]) => `  ${kind.padEnd(11)} ${entry.decided.padEnd(24)} ${entry.describe}`,
		),
		`  shipped declaration-only exceptions: ${SHIPPED_EXCEPTIONS.length}`,
		'',
		`gate: ${gate.violations.length} violation(s)`,
		`fixture: ${gate.fixture.rows.length} file(s) reproduce the states they stand for`,
		'',
		'human evaluation (not measured here)',
		...gate.humanEvaluation.map((item) => `- ${item}`),
	];
	const rowTop = 18;
	const panelHeight = body.length * ROW_STEP + rowTop + 12;
	const lines = body
		.map(
			(row, index) =>
				`<text x="14" y="${rowTop + index * ROW_STEP}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height: panelHeight,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${panelHeight}">
	<rect width="${width}" height="${panelHeight}" fill="#ffffff" />
	<rect x="0" y="0" width="${width}" height="${panelHeight}" fill="none" stroke="#d8d2c0" stroke-width="2" />
	${lines}
</svg>
`,
	};
}

/**
 * Stack the captured strips into one column image (pure over buffers).
 *
 * Every strip is scaled to the column width, but never UP — a strip that
 * is narrower than the column keeps its own size, so a small dialog is
 * not blown up into a blur. A strip that is TALLER than
 * {@link STRIP_MAX_HEIGHT} is scaled down until it fits, so one surface
 * cannot push the rest of the artefact out of the reader's eye (and out
 * of the artefact's size budget).
 */
export async function stackStrips(sharp, strips, width) {
	const prepared = [];
	for (const strip of strips) {
		const meta = await sharp(strip.png).metadata();
		const sourceWidth = meta.width ?? width;
		const sourceHeight = meta.height ?? 0;
		const targetWidth = Math.min(width, sourceWidth);
		const scaledHeight = Math.round((sourceHeight * targetWidth) / sourceWidth);
		const targetHeight = Math.min(scaledHeight, STRIP_MAX_HEIGHT);
		const buffer = await sharp(strip.png)
			.resize(
				targetHeight === scaledHeight
					? { width: targetWidth, withoutEnlargement: true }
					: { height: targetHeight },
			)
			.png()
			.toBuffer();
		const resized = await sharp(buffer).metadata();
		prepared.push({ buffer, width: resized.width ?? targetWidth, height: resized.height ?? 0 });
	}
	const totalHeight = prepared.reduce(
		(total, entry, index) => total + entry.height + (index === 0 ? 0 : STRIP_GAP),
		0,
	);
	const composites = [];
	let top = 0;
	for (const entry of prepared) {
		composites.push({ input: entry.buffer, left: 0, top });
		top += entry.height + STRIP_GAP;
	}
	return sharp({
		create: { width, height: Math.max(totalHeight, 1), channels: 3, background: '#ffffff' },
	})
		.composite(composites)
		.png()
		.toBuffer();
}

/** Compose the artefact: header band, then the strips and the evidence. */
export async function composeArtefact({ sharp, strips, header, panel }) {
	const column = await stackStrips(sharp, strips, RENDER_WIDTH);
	const columnMeta = await sharp(column).metadata();
	const columnHeight = columnMeta.height ?? 0;
	const bodyHeight = Math.max(columnHeight, panel.height);
	const body = await sharp({
		create: {
			width: SCREENSHOT_MAX_WIDTH,
			height: bodyHeight,
			channels: 3,
			background: '#ffffff',
		},
	})
		.composite([
			{ input: column, left: 0, top: 0 },
			{ input: Buffer.from(panel.svg), left: RENDER_WIDTH + GUTTER, top: 0 },
		])
		.png()
		.toBuffer();
	const artefact = await sharp(body)
		.extend({
			top: header.height,
			bottom: 0,
			left: 0,
			right: 0,
			background: { r: 244, g: 239, b: 223 },
		})
		.composite([{ input: Buffer.from(header.svg), left: 0, top: 0 }])
		.webp({ quality: SCREENSHOT_QUALITY })
		.toBuffer();
	return {
		buffer: artefact,
		columnHeight,
		bodyHeight,
		headerHeight: header.height,
		panelWidth: PANEL_WIDTH,
	};
}

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/a11y/tap-target-overlay.webp',
		pngDir: '.tmp/a11y-target-size',
		jsonOut: '.tmp/a11y-target-size/report.json',
		port: 3140,
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
			case 'png-dir':
				options.pngDir = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'port':
				options.port = Number(value);
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

/** Start the local preview server (the same one Playwright's webServer uses). */
function startPreviewServer(port) {
	const child = spawn(process.execPath, ['scripts/e2e-local-bootstrap.mjs', `--port=${port}`], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const log = [];
	child.stdout.on('data', (chunk) => log.push(String(chunk)));
	child.stderr.on('data', (chunk) => log.push(String(chunk)));
	return { child, log };
}

/**
 * Measure a surface once its contents have settled.
 *
 * A surface that loads its contents asynchronously (the emoji picker
 * fills its grid after the dialog opens) would otherwise be measured
 * half-empty, and a half-empty measurement is not a measurement: the
 * targets that are missing are exactly the ones nobody looked at. The
 * count is therefore read until it stops changing, and the wait is
 * bounded so a surface that never settles reports what it saw instead
 * of hanging.
 */
export async function measureStable(page, selector, attempts = 12, intervalMs = 600) {
	let previous = null;
	let stable = 0;
	let measured = { found: false, targets: [], hidden: 0 };
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		measured = await page.evaluate(MEASURE_TARGETS, selector);
		const count = measured.targets.length;
		if (measured.found && count > 0 && count === previous) stable += 1;
		else stable = 0;
		previous = count;
		// Three consecutive equal counts: one pair can coincide while a
		// grid is still filling, three is a surface that has stopped.
		if (stable >= 3) return { ...measured, settled: true };
		await page.waitForTimeout(intervalMs);
	}
	return { ...measured, settled: false };
}

/** Open the surface the capture needs, and measure it. */
async function captureSurface(context, surface, baseUrl, pngDir) {
	const page = await context.newPage();
	try {
		await page.goto(`${baseUrl}${surface.path}`, { waitUntil: 'networkidle' });
		if (surface.open) {
			const trigger = page.locator(surface.open.trigger);
			await trigger.waitFor({ state: 'visible', timeout: 15_000 });
			await trigger.click();
			await page.locator(surface.selector).waitFor({ state: 'visible', timeout: 15_000 });
		}
		const measured = await measureStable(page, surface.selector);
		if (!measured.found) {
			throw new Error(
				`the surface "${surface.label}" was not found on ${surface.path} (${surface.selector}); the capture would measure nothing`,
			);
		}
		if (!measured.settled) {
			throw new Error(
				`the surface "${surface.label}" never settled (${measured.targets.length} target(s)); a measurement of a moving target is not a measurement`,
			);
		}
		await page.evaluate(DRAW_OVERLAY, surface.selector);
		const clip = await page.locator(surface.clip).first().boundingBox();
		if (!clip) {
			throw new Error(`the surface "${surface.label}" has no box to photograph`);
		}
		const png = resolve(REPO_ROOT, pngDir, `${surface.id}.png`);
		await page.screenshot({
			path: png,
			clip: {
				x: Math.max(clip.x, 0),
				y: Math.max(clip.y, 0),
				width: Math.min(clip.width, surface.viewport.width),
				height: Math.min(clip.height, surface.viewport.height),
			},
		});
		return { surface, measured, png };
	} finally {
		await page.close();
	}
}

/** Measure the fixture specimens in the harness. */
async function captureSpecimens(page, pngDir) {
	await page.waitForSelector('[data-target-root]', { timeout: 20_000 });
	const specimens = await page.evaluate(() => {
		// The "equivalent" exception names another control, so the
		// capture resolves the reference and measures the control it
		// points at. A reference that resolves to nothing is recorded as
		// "not found" rather than guessed at.
		const resolveEquivalent = (ref) => {
			if (!ref) return null;
			let element = null;
			try {
				element = document.getElementById(ref) ?? document.querySelector(ref);
			} catch {
				element = null;
			}
			if (!element) {
				return { ref, found: false, width: null, height: null, meets: false, tag: null, id: null };
			}
			const rect = element.getBoundingClientRect();
			return {
				ref,
				found: true,
				width: rect.width,
				height: rect.height,
				meets: rect.width >= 24 && rect.height >= 24,
				tag: element.tagName.toLowerCase(),
				id: element.id ?? null,
			};
		};
		const sections = [...document.querySelectorAll('[data-target-case]')];
		return sections.map((section) => {
			const specimen = section.querySelector('[data-target-specimen]');
			const targets = [...(specimen?.querySelectorAll('[data-target-target]') ?? [])].map(
				(element, index) => {
					const rect = element.getBoundingClientRect();
					const style = getComputedStyle(element);
					if (rect.width === 0 && rect.height === 0) {
						return null;
					}
					return {
						id: `${section.getAttribute('data-target-case')}#${index}`,
						tag: element.tagName.toLowerCase(),
						label: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48),
						width: rect.width,
						height: rect.height,
						display: style.display,
						lineBoxes: element.getClientRects().length,
						box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
						exceptionKind:
							element.getAttribute('data-target-exception') ??
							specimen?.getAttribute('data-target-exception') ??
							null,
						exceptionReason:
							element.getAttribute('data-target-reason') ??
							specimen?.getAttribute('data-target-reason') ??
							null,
						equivalent: resolveEquivalent(
							element.getAttribute('data-target-equivalent') ??
								specimen?.getAttribute('data-target-equivalent') ??
								null,
						),
					};
				},
			);
			return {
				specimenId: section.getAttribute('data-target-case'),
				expectation: section.getAttribute('data-target-expectation'),
				sizeVerdict: section.getAttribute('data-target-size-verdict'),
				exceptionKind: specimen?.getAttribute('data-target-exception') ?? null,
				exceptionReason: specimen?.getAttribute('data-target-reason') ?? null,
				targets,
			};
		});
	});
	await page.evaluate(() => {
		for (const section of document.querySelectorAll('[data-target-case]')) {
			const specimen = section.querySelector('[data-target-specimen]');
			if (!specimen) continue;
			for (const element of specimen.querySelectorAll('[data-target-target]')) {
				const rect = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				const meets = rect.width >= 24 && rect.height >= 24;
				const colour = meets ? '#1f7a3d' : '#c02a1e';
				const box = document.createElement('div');
				box.style.position = 'fixed';
				box.style.left = `${rect.x - 1}px`;
				box.style.top = `${rect.y - 1}px`;
				box.style.width = `${rect.width + 2}px`;
				box.style.height = `${rect.height + 2}px`;
				box.style.border = `2px solid ${colour}`;
				box.style.pointerEvents = 'none';
				box.style.zIndex = '2147483646';
				document.body.appendChild(box);
				const circle = document.createElement('div');
				circle.style.position = 'fixed';
				circle.style.left = `${rect.x + rect.width / 2 - 12}px`;
				circle.style.top = `${rect.y + rect.height / 2 - 12}px`;
				circle.style.width = '24px';
				circle.style.height = '24px';
				circle.style.border = `1.5px dashed ${colour}`;
				circle.style.borderRadius = '50%';
				circle.style.boxSizing = 'border-box';
				circle.style.pointerEvents = 'none';
				circle.style.zIndex = '2147483645';
				void style;
				document.body.appendChild(circle);
			}
		}
	});
	const png = resolve(REPO_ROOT, pngDir, 'specimens.png');
	const clip = await page.locator('[data-target-root]').boundingBox();
	if (!clip) throw new Error('the specimen harness has no box to photograph');
	await page.screenshot({
		path: png,
		clip: {
			x: Math.max(clip.x, 0),
			y: Math.max(clip.y, 0),
			width: Math.min(clip.width, HARNESS_VIEWPORT.width),
			height: Math.min(clip.height, HARNESS_VIEWPORT.height),
		},
		type: 'png',
	});
	return { specimens, png };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`${renderGateSummary(gate)}\n`);
		throw new Error(
			`the target-size gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
		);
	}

	if (!existsSync(join(REPO_ROOT, 'dist/client/bundle-graph.json'))) {
		throw new Error(
			'no build output found — run `pnpm run build` before the capture (the capture drives the built Worker, not the dev server)',
		);
	}

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the target-size harness…\n');
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

	mkdirSync(resolve(REPO_ROOT, options.pngDir), { recursive: true });
	const harnessServer = await serveDirectory(distRoot);
	const baseUrl = `http://127.0.0.1:${options.port}`;
	const preview = startPreviewServer(options.port);
	let observation = null;
	let verdict = null;
	let capture = null;

	try {
		const ready = await waitForServer(baseUrl);
		if (!ready) {
			throw new Error(
				`the local preview server never answered on ${baseUrl}; the capture would photograph nothing`,
			);
		}

		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: nothing browser-side was written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const browser = await chromium.launch();
			const strips = [];
			try {
				const harnessContext = await browser.newContext({
					viewport: HARNESS_VIEWPORT,
					deviceScaleFactor: 1,
				});
				const harnessPage = await harnessContext.newPage();
				await harnessPage.goto(`${harnessServer.baseUrl}/`, { waitUntil: 'networkidle' });
				const { specimens, png } = await captureSpecimens(harnessPage, options.pngDir);
				await harnessContext.close();

				const surfaces = [];
				for (const surface of SURFACE_CAPTURES) {
					const context = await browser.newContext({
						viewport: surface.viewport,
						deviceScaleFactor: 1,
					});
					const result = await captureSurface(context, surface, baseUrl, options.pngDir);
					await context.close();
					surfaces.push({
						id: result.surface.id,
						label: result.surface.label,
						path: result.surface.path,
						viewport: result.surface.viewport,
						targets: result.measured.targets,
						hidden: result.measured.hidden,
						declaredExceptions: SHIPPED_EXCEPTIONS.filter(
							(entry) => entry.surface === result.surface.id,
						),
					});
					strips.push({ label: result.surface.label, png: result.png });
				}
				strips.unshift({ label: 'fixture specimens', png });

				observation = { surfaces, specimens };
				verdict = evaluateObservation(observation);
				for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
				if (!verdict.ok) {
					throw new Error(
						`the browser observations contradict the target-size contract (${verdict.failures.length} failure(s)); no artefact was written`,
					);
				}

				const header = headerSvg({ observation, verdict, gate });
				const panel = evidencePanelSvg({
					observation,
					verdict,
					gate,
					width: PANEL_WIDTH,
				});
				const outPath = resolve(REPO_ROOT, options.screenshot);
				ensureDir(options.screenshot);
				const { buffer, ...geometry } = await composeArtefact({
					sharp,
					strips,
					header,
					panel,
				});
				const budget = screenshotBudgetVerdict(buffer.length);
				if (!budget.withinBudget) {
					throw new Error(
						`capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget; no artefact was written`,
					);
				}
				writeFileSync(outPath, buffer);
				const meta = await sharp(outPath).metadata();
				rmSync(resolve(REPO_ROOT, options.pngDir), { recursive: true, force: true });
				capture = {
					artefact: options.screenshot,
					surfaces: SURFACE_CAPTURES.map((entry) => entry.id),
					specimens: fixtureCases().map((entry) => entry.caseId),
					quality: SCREENSHOT_QUALITY,
					width: meta.width ?? null,
					height: meta.height ?? null,
					...geometry,
					...budget,
				};
				process.stdout.write(
					`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${budget.kb} kB)\n`,
				);
			} finally {
				await browser.close();
			}
		}
	} finally {
		await harnessServer.close();
		preview.child.kill('SIGTERM');
	}

	const report = {
		issue: '#401',
		generatedBy: 'scripts/capture-a11y-target-size.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		minimumPx: MIN_TARGET_PX,
		wcag: WCAG_MAPPING,
		fixtures: fixtureCases(),
		harness: { dir: HARNESS_DIR, dist: HARNESS_DIST, entry: harnessIndexHtml() },
		observation,
		verdict,
		gate: { violations: gate.violations, rows: gate.fixture.rows },
		exceptions: SHIPPED_EXCEPTIONS,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/tap-target-overlay.png -> .webp',
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

if (process.argv[1]?.endsWith('capture-a11y-target-size.mjs')) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
		},
	);
}
