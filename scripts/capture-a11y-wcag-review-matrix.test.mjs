import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { collectEvidence } from './check-a11y-wcag-review-matrix.mjs';
import {
	ARTEFACT,
	AX_TREE_MAX_LINES,
	FAILURE_PANEL_TEST_ID,
	GALLERY_TEST_ID,
	HARNESS_DIR,
	HARNESS_DIST,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY,
	STORY_EXPORT,
	STORY_MODULE,
	assertWebpOutputPath,
	harnessIndexHtml,
	harnessMainTsx,
	harnessViteConfig,
	headerSvg,
	resolveStaticTarget,
	screenshotBudgetVerdict,
	writeHarness,
} from './capture-a11y-wcag-review-matrix.mjs';

/**
 * Capture-harness invariants for the Issue #410 verification artefact.
 *
 * The harness is what produces the committed screenshot, so its POLICY is
 * what this file guards: WebP-only output, a size budget, a capture that
 * renders the shipped story rather than a copy of it, a static server
 * that cannot escape its root, and a header that says the same thing the
 * gate says.
 *
 * There is no Chromium here — driving a browser is a heavy local step
 * (`node scripts/capture-a11y-wcag-review-matrix.mjs`), not a unit test.
 * What must never regress silently is the policy, and that is pure.
 */

describe('capture-a11y-wcag-review-matrix — artefact policy', () => {
	it('refuses a non-WebP artefact path', () => {
		// Issue #410 names `wcag-review-matrix.png`; committing that raster
		// would put a permanently large binary in the tree for a
		// verification artefact.
		assert.throws(
			() => assertWebpOutputPath('docs/verification/a11y/wcag-review-matrix.png'),
			/refusing to write a non-WebP/,
		);
		assert.equal(
			assertWebpOutputPath('docs/verification/a11y/wcag-review-matrix.webp'),
			'docs/verification/a11y/wcag-review-matrix.webp',
		);
		assert.equal(ARTEFACT, 'docs/verification/a11y/wcag-review-matrix.webp');
	});

	it('refuses to write outside the repository', () => {
		assert.throws(() => assertWebpOutputPath('/tmp/escape.webp'), /refusing to write outside/);
	});

	it('budgets the artefact and fails past the ceiling', () => {
		assert.deepEqual(screenshotBudgetVerdict(120 * 1024), {
			bytes: 120 * 1024,
			kb: 120,
			withinBudget: true,
		});
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
		assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
		assert.equal(SCREENSHOT_QUALITY, 80);
		assert.equal(SCREENSHOT_BUDGET_BYTES, 400 * 1024);
	});
});

describe('capture-a11y-wcag-review-matrix — harness', () => {
	it('renders the shipped story, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, new RegExp(`from '\\.\\./\\.\\./\\.\\./${STORY_MODULE}'`));
		assert.match(main, new RegExp(`\\{ ${STORY_EXPORT} \\}`));
		assert.match(main, new RegExp(`${STORY_EXPORT}\\.render\\?\\.\\(\\)`));
		assert.match(main, /src\/styles\.css/);
	});

	it('wires the repository PostCSS config so the capture uses the shipped CSS', () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'wcag-matrix-css-'));
		try {
			const config = harnessViteConfig(HARNESS_DIR, repoRoot);
			// Without the repository PostCSS config the capture would render
			// unstyled HTML and still look like a plausible artefact.
			assert.match(config, new RegExp(`postcss: '${join(repoRoot, 'postcss.config.mjs')}'`));
			assert.match(config, /root: '\.tmp\/a11y-wcag-review-matrix\/harness'/);
			assert.match(config, /@vitejs\/plugin-react/);
			assert.match(config, new RegExp(`outDir: '${join(repoRoot, HARNESS_DIST)}'`));
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it('generates a page with a root container and a module entry', () => {
		const html = harnessIndexHtml();
		assert.match(html, /<div id="root"><\/div>/);
		assert.match(html, /<script type="module" src="\.\/main\.tsx">/);
		// Deterministic: the same inputs must produce the same bytes.
		assert.equal(html, harnessIndexHtml());
	});

	it('writes the harness under the ephemeral .tmp directory', () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'wcag-matrix-repo-'));
		try {
			const dir = writeHarness(repoRoot);
			assert.equal(dir, join(repoRoot, HARNESS_DIR));
			assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), harnessIndexHtml());
			assert.equal(readFileSync(join(dir, 'main.tsx'), 'utf8'), harnessMainTsx());
			assert.equal(
				readFileSync(join(dir, 'vite.config.ts'), 'utf8'),
				harnessViteConfig(HARNESS_DIR, repoRoot),
			);
			assert.match(HARNESS_DIR, /^\.tmp\//);
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it('waits for the gallery marker before photographing', () => {
		// A readiness signal is what stops the capture from writing a blank
		// page that still looks like evidence.
		assert.equal(GALLERY_TEST_ID, 'a11y-form-error-gallery');
		// The failure panel is the accessibility snapshot source, so its
		// marker is part of the contract, not an incidental attribute.
		assert.equal(FAILURE_PANEL_TEST_ID, 'a11y-form-error-failure');
		assert.match(STORY_MODULE, /^src\/editorial\/forms\//);
	});
});

describe('capture-a11y-wcag-review-matrix — the header band', () => {
	it('prints the report, the states and the accessibility tree', () => {
		const gate = collectEvidence();
		const header = headerSvg({
			gate,
			summary: 'the gate summary',
			accessibilitySnapshot: ['- textbox "Email"', '  - generic: Email'].join('\n'),
		});
		assert.match(header.svg, /WCAG 2\.2 A\/AA manual review matrix/);
		assert.match(header.svg, /an automatic pass is NOT a human verification/);
		assert.match(header.svg, /a green run means the TABLE is intact, not that the site conforms/);
		assert.match(header.svg, /textbox &quot;Email&quot;/);
	});

	it('truncates a long accessibility tree and says so', () => {
		const gate = collectEvidence();
		const tree = Array.from({ length: AX_TREE_MAX_LINES + 5 }, (_, index) => `- node ${index}`);
		const header = headerSvg({ gate, summary: 's', accessibilitySnapshot: tree.join('\n') });
		assert.match(header.svg, /more line\(s\) in the report JSON/);
	});

	it('does not claim a conformance the matrix does not have', () => {
		const gate = collectEvidence();
		const header = headerSvg({ gate, summary: 's', accessibilitySnapshot: '' });
		assert.equal(gate.humanVerified, 0);
		assert.match(header.svg, /human review outstanding/);
	});
});

describe('capture-a11y-wcag-review-matrix — static serving', () => {
	it('resolves requests inside the served root and refuses traversal', () => {
		const root = mkdtempSync(join(tmpdir(), 'wcag-matrix-gallery-'));
		try {
			writeFileSync(join(root, 'index.html'), '<!doctype html><title>harness</title>');
			mkdirSync(join(root, 'assets'));
			writeFileSync(join(root, 'assets', 'index.css'), 'body{}');

			// A directory request falls back to `index.html`; Chromium needs a
			// real origin because it refuses ES modules over `file://`.
			assert.deepEqual(resolveStaticTarget(root, '/'), {
				status: 200,
				file: join(root, 'index.html'),
				contentType: 'text/html; charset=utf-8',
			});
			assert.deepEqual(resolveStaticTarget(root, '/assets/index.css'), {
				status: 200,
				file: join(root, 'assets', 'index.css'),
				contentType: 'text/css; charset=utf-8',
			});
			assert.equal(resolveStaticTarget(root, '/missing.html').status, 404);
			assert.equal(resolveStaticTarget(root, '/../../etc/hosts').status, 403);
			assert.equal(resolveStaticTarget(root, '/%2e%2e/%2e%2e/etc/hosts').status, 403);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
