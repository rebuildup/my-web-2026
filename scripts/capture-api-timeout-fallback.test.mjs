import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	GALLERY_EXPORT,
	GALLERY_TEST_ID,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY,
	STORY_MODULE,
	assertWebpOutputPath,
	harnessIndexHtml,
	harnessMainTsx,
	harnessViteConfig,
	resolveStaticTarget,
	screenshotBudgetVerdict,
} from './capture-api-timeout-fallback.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

test('committed captures are WebP under the artefact budget', () => {
	assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
	assert.equal(SCREENSHOT_QUALITY, 80);
	assert.equal(SCREENSHOT_BUDGET_BYTES, 300 * 1024);
	assert.equal(screenshotBudgetVerdict(299 * 1024).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(301 * 1024).withinBudget, false);
	// The verdict reports a rounded size a human can compare to the budget.
	assert.deepEqual(screenshotBudgetVerdict(150 * 1024), {
		bytes: 153_600,
		kb: 150,
		withinBudget: true,
	});
});

test('a non-WebP output path is refused, not silently converted', () => {
	// The Issue names a `.png` path; the committed artefact is the
	// `.webp` sibling. Writing a PNG into the tree would defeat that.
	assert.throws(() => assertWebpOutputPath('docs/verification/ops/api-timeout-fallback.png'));
	assert.throws(() => assertWebpOutputPath('docs/verification/ops/api-timeout-fallback.WEBP2'));
	assert.equal(
		assertWebpOutputPath('docs/verification/ops/api-timeout-fallback.webp'),
		'docs/verification/ops/api-timeout-fallback.webp',
	);
});

test('an output path outside the repository is refused', () => {
	assert.throws(() => assertWebpOutputPath('../elsewhere/api-timeout-fallback.webp'));
	assert.throws(() => assertWebpOutputPath('/tmp/api-timeout-fallback.webp'));
});

test('the harness renders the SHIPPED gallery, not a copy', () => {
	const entry = harnessMainTsx();
	// `.tmp/api-timeout-fallback/harness` is three levels below the root.
	assert.ok(entry.includes(`'../../../${STORY_MODULE}'`), 'imports the story module itself');
	assert.ok(entry.includes(GALLERY_EXPORT), 'renders the exported gallery component');
	assert.ok(entry.includes('src/styles.css'), 'loads the repository editorial CSS');
	assert.ok(!entry.includes('fetch('), 'issues no request of its own');
});

test('the harness page and entry are deterministic', () => {
	// The report hashes these strings; a non-deterministic harness would
	// make the recorded evidence meaningless.
	assert.equal(harnessIndexHtml(), harnessIndexHtml());
	assert.ok(harnessIndexHtml().includes('<div id="root"></div>'));
	assert.ok(harnessIndexHtml().includes('./main.tsx'));
});

test('the harness build resolves outDir against the repository, not the harness root', () => {
	const config = harnessViteConfig();
	assert.ok(
		config.includes(`outDir: '${resolve(REPO_ROOT, '.tmp/api-timeout-fallback/harness-dist')}'`),
	);
	assert.ok(config.includes(`postcss: '${resolve(REPO_ROOT, 'postcss.config.mjs')}'`));
	assert.ok(config.includes("root: '.tmp/api-timeout-fallback/harness'"));
});

test('static resolution cannot escape the served root', () => {
	// A throwaway served root, so the traversal rule is exercised
	// against real files without depending on a prior capture run.
	const dist = resolve(REPO_ROOT, '.tmp/api-timeout-fallback-test-fixture');
	rmSync(dist, { force: true, recursive: true });
	mkdirSync(join(dist, 'assets'), { recursive: true });
	writeFileSync(join(dist, 'index.html'), '<!doctype html><title>harness</title>');
	writeFileSync(join(dist, 'assets', 'app.js'), 'export const built = true;\n');
	try {
		assert.equal(resolveStaticTarget(dist, '/').file, join(dist, 'index.html'));
		assert.equal(resolveStaticTarget(dist, '/index.html').file, join(dist, 'index.html'));
		assert.equal(resolveStaticTarget(dist, '/assets/app.js').file, join(dist, 'assets', 'app.js'));
		assert.equal(
			resolveStaticTarget(dist, '/assets/app.js').contentType,
			'text/javascript; charset=utf-8',
		);
		assert.equal(resolveStaticTarget(dist, '/../secrets.txt').status, 403);
		assert.equal(resolveStaticTarget(dist, '/%2e%2e/%2e%2e/secrets.txt').status, 403);
		assert.equal(resolveStaticTarget(dist, '/does-not-exist.js').status, 404);
	} finally {
		rmSync(dist, { force: true, recursive: true });
	}
});

test('the readiness marker is the one the gallery renders', () => {
	assert.equal(GALLERY_TEST_ID, 'api-timeout-fallback');
});
