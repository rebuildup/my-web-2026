import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
	GALLERY_TEST_ID,
	HARNESS_DIR,
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
} from './capture-status-incident-context.mjs';

/**
 * Tests for the Issue #502 capture script.
 *
 * The capture is the artefact a reviewer reads instead of running the
 * section, so its refusals are part of the contract: the committed
 * path must be WebP inside the repository, and the harness must import
 * the SHIPPED story module rather than a copy — a capture that
 * photographs a copy documents code nobody runs.
 */

const temporaryDirs = [];

function temporaryDir() {
	const dir = mkdtempSync(join(tmpdir(), 'status-incident-capture-'));
	temporaryDirs.push(dir);
	return dir;
}

describe('the capture path', () => {
	it('accepts a WebP path inside the repository', () => {
		assert.equal(
			assertWebpOutputPath('docs/verification/ops/status-incident-context.webp'),
			'docs/verification/ops/status-incident-context.webp',
		);
	});

	it('refuses a PNG path — the Issue names one, the repository ships WebP', () => {
		assert.throws(
			() => assertWebpOutputPath('docs/verification/ops/status-incident-context.png'),
			/non-WebP/,
		);
	});

	it('refuses a path outside the repository', () => {
		assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	});
});

describe('the artefact budget', () => {
	it('accepts a capture inside the budget and rejects one above it', () => {
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('reports the size in kilobytes', () => {
		assert.equal(screenshotBudgetVerdict(1024).kb, 1);
	});
});

describe('the generated harness', () => {
	it('renders the SHIPPED story, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, new RegExp(STORY_MODULE.replace(/[/.]/g, '\\$&')));
		assert.match(main, new RegExp(STORY_EXPORT));
		// The story's own args are passed to its render function, so
		// the capture shows the tree a Storybook reviewer sees.
		assert.match(main, /story\.render\?\.\(story\.args\)/);
	});

	it('wires the repository PostCSS config, so the capture shows the shipped CSS', () => {
		const config = harnessViteConfig();
		assert.match(config, /postcss\.config\.mjs/);
		assert.match(config, /HARNESS_DIR|status-incident-context/);
	});

	it('writes a page that loads the harness entry point', () => {
		const html = harnessIndexHtml();
		assert.match(html, /<script type="module" src="\.\/main\.tsx"><\/script>/);
	});

	it('materialises the harness under the gitignored .tmp directory', () => {
		const repoRoot = temporaryDir();
		const dir = writeHarness(repoRoot);
		assert.equal(dir, resolve(repoRoot, HARNESS_DIR));
		assert.ok(existsSync(join(dir, 'index.html')));
		assert.ok(existsSync(join(dir, 'main.tsx')));
		assert.ok(existsSync(join(dir, 'vite.config.ts')));
		assert.match(
			readFileSync(join(dir, 'main.tsx'), 'utf8'),
			/src\/home\/status\/tiles\.stories\.tsx/,
		);
	});
});

describe('the static server', () => {
	it('never serves a file outside the served root', () => {
		const root = temporaryDir();
		assert.equal(resolveStaticTarget(root, '/../../etc/passwd').status, 403);
	});

	it('falls back to index.html for a directory request', () => {
		const root = temporaryDir();
		writeFileSync(join(root, 'index.html'), '<!doctype html><title>harness</title>');
		const resolved = resolveStaticTarget(root, '/');
		assert.equal(resolved.status, 200);
		assert.equal(resolved.file, join(root, 'index.html'));
	});
});

describe('the capture policy', () => {
	it('keeps the encode policy the repository expects', () => {
		assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
		assert.equal(SCREENSHOT_QUALITY, 80);
	});

	it('waits for the gallery marker before photographing the page', () => {
		assert.equal(GALLERY_TEST_ID, 'status-incident-context');
	});
});

process.on('exit', () => {
	for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});
