import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	GALLERY_EXPORT,
	GALLERY_TEST_ID,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY,
	STAGING_DIR,
	STORY_MODULE,
	assertWebpOutputPath,
	discardStagedCapture,
	harnessIndexHtml,
	harnessMainTsx,
	harnessViteConfig,
	isLoopbackRequestUrl,
	parseArgs,
	promoteStagedCapture,
	resolveStaticTarget,
	screenshotBudgetVerdict,
	stagedCapturePath,
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
		// A malformed percent-encoding throws inside `decodeURIComponent`.
		// Refusing it as a bad request keeps the single-run dev server
		// from dying on a URL Chromium would never send.
		assert.equal(resolveStaticTarget(dist, '/%').status, 400);
		assert.equal(resolveStaticTarget(dist, '/%zz').status, 400);
	} finally {
		rmSync(dist, { force: true, recursive: true });
	}
});

test('the outbound-request measurement counts only what leaves loopback', () => {
	// The report claims zero third-party requests; this predicate is
	// what turns that claim into an observation.
	assert.equal(isLoopbackRequestUrl('http://127.0.0.1:41234/assets/app.js'), true);
	assert.equal(isLoopbackRequestUrl('http://localhost:4173/'), true);
	assert.equal(isLoopbackRequestUrl('https://api.github.com/repos/rebuildup/my-web-2026'), false);
	assert.equal(isLoopbackRequestUrl('data:text/css,'), false);
	// Unparseable input must not be silently treated as loopback.
	assert.equal(isLoopbackRequestUrl('not a url'), false);
});

test('the readiness marker is the one the gallery renders', () => {
	assert.equal(GALLERY_TEST_ID, 'api-timeout-fallback');
});

test('a candidate capture is staged under .tmp/, never on the committed path', () => {
	// Overwriting the committed artefact BEFORE the checks run is what
	// left a failed capture in the tree; staging makes the committed
	// path reachable only through a successful promotion.
	const staged = stagedCapturePath('docs/verification/ops/api-timeout-fallback.webp');
	assert.equal(staged, join(REPO_ROOT, STAGING_DIR, 'api-timeout-fallback.webp'));
	assert.ok(
		staged.startsWith(join(REPO_ROOT, '.tmp')),
		'staged outside the repository tree proper',
	);
	assert.notEqual(staged, join(REPO_ROOT, 'docs/verification/ops/api-timeout-fallback.webp'));
});

test('promotion replaces the artefact once and discards the candidate', () => {
	const root = resolve(REPO_ROOT, '.tmp/api-timeout-fallback-test-promotion');
	const artefact = 'docs/verification/ops/api-timeout-fallback.webp';
	rmSync(root, { force: true, recursive: true });
	mkdirSync(join(root, STAGING_DIR), { recursive: true });
	mkdirSync(join(root, 'docs/verification/ops'), { recursive: true });
	const committed = join(root, artefact);
	writeFileSync(committed, 'previous artefact');
	const staged = stagedCapturePath(artefact, root);
	writeFileSync(staged, 'validated candidate');
	try {
		assert.equal(promoteStagedCapture({ staged, screenshot: artefact, repoRoot: root }), committed);
		assert.equal(readFileSync(committed, 'utf8'), 'validated candidate');
		assert.equal(existsSync(staged), false);
		// A candidate that was never promoted is dropped, not left behind.
		writeFileSync(staged, 'rejected candidate');
		discardStagedCapture(staged, root);
		assert.equal(existsSync(staged), false);
		assert.equal(readFileSync(committed, 'utf8'), 'validated candidate');
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test('no option deletes a file the capture never wrote', () => {
	// `--png` used to be accepted and then `rm`-ed unconditionally,
	// so `--png=../existing.webp` deleted a file the script had never
	// created. The option is gone: the PNG is a memory buffer only.
	assert.throws(() => parseArgs(['--png=/tmp/existing.png']), /unknown option: --png/);
	assert.throws(() => parseArgs(['--png=../existing.webp']), /unknown option: --png/);
	assert.equal(existsSync(join(REPO_ROOT, '.tmp/api-timeout-fallback/capture.png')), false);
	const options = parseArgs(['--screenshot=docs/verification/ops/other.webp']);
	assert.deepEqual(Object.keys(options).sort(), [
		'build',
		'capture',
		'jsonOut',
		'screenshot',
		'width',
	]);
});
