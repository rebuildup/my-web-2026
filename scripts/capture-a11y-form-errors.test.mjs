import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
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
	resolveStaticTarget,
	screenshotBudgetVerdict,
	writeHarness,
} from './capture-a11y-form-errors.mjs';

/**
 * Capture-harness invariants for the Issue #404 verification artefact.
 *
 * The harness is what produces the committed screenshot, so its POLICY is
 * what this file guards: WebP-only output, a size budget, a capture that
 * renders the shipped story rather than a copy of it, and a static server
 * that cannot escape its root.
 *
 * There is no Chromium here — driving a browser is a heavy local step
 * (`node scripts/capture-a11y-form-errors.mjs`), not a unit test. What
 * must never regress silently is the policy, and that is pure.
 */

describe('capture-a11y-form-errors — artefact policy', () => {
	it('refuses a non-WebP artefact path', () => {
		// Issue #404 names `form-error-story.png`; committing that raster
		// would put a permanently large binary in the tree for a
		// verification artefact.
		assert.throws(
			() => assertWebpOutputPath('docs/verification/a11y/form-error-story.png'),
			/refusing to write a non-WebP/,
		);
		assert.equal(
			assertWebpOutputPath('docs/verification/a11y/form-error-story.webp'),
			'docs/verification/a11y/form-error-story.webp',
		);
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
		assert.equal(SCREENSHOT_BUDGET_BYTES, 300 * 1024);
	});
});

describe('capture-a11y-form-errors — harness', () => {
	it('renders the shipped story, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, new RegExp(`from '\\.\\./\\.\\./\\.\\./${STORY_MODULE}'`));
		assert.match(main, new RegExp(`\\{ ${STORY_EXPORT} \\}`));
		assert.match(main, new RegExp(`${STORY_EXPORT}\\.render\\?\\.\\(\\)`));
		assert.match(main, /src\/styles\.css/);
	});

	it('wires the repository PostCSS config so the capture uses the shipped CSS', () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'form-errors-css-'));
		try {
			const config = harnessViteConfig(HARNESS_DIR, repoRoot);
			// Without the repository PostCSS config the capture would render
			// unstyled HTML and still look like a plausible artefact.
			assert.match(config, new RegExp(`postcss: '${join(repoRoot, 'postcss.config.mjs')}'`));
			assert.match(config, /root: '\.tmp\/a11y-form-errors\/harness'/);
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
		const repoRoot = mkdtempSync(join(tmpdir(), 'form-errors-repo-'));
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
		assert.match(STORY_MODULE, /^src\/editorial\/forms\//);
	});
});

describe('capture-a11y-form-errors — static serving', () => {
	it('resolves requests inside the served root and refuses traversal', () => {
		const root = mkdtempSync(join(tmpdir(), 'form-error-gallery-'));
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
