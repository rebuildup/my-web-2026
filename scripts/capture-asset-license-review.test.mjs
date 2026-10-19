import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
	EXPECTED_REVIEW_CARDS,
	GALLERY_EXPORT,
	GALLERY_TEST_ID,
	RECORD_RELATIVE_PATH,
	REVIEW_TEST_ID,
	SCREENSHOT_BUDGET_BYTES,
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
	writeHarness,
} from './capture-asset-license-review.mjs';

/**
 * Tests for the Issue #497 capture script.
 *
 * The capture is the artefact a reviewer reads instead of running the
 * review, so its refusals are part of the contract: the committed path
 * must be WebP inside the repository, the candidate must be staged so a
 * failed run cannot replace a good artefact with a broken one, and the
 * harness must import the SHIPPED story module rather than a copy — a
 * capture that photographs a copy documents code nobody runs.
 */

const temporaryDirs = [];

function makeTempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'asset-license-capture-'));
	temporaryDirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

describe('output path policy', () => {
	it('accepts the Issue path in its WebP form', () => {
		const root = makeTempDir();
		assert.equal(
			assertWebpOutputPath('docs/verification/legal/asset-license-review.webp', root),
			'docs/verification/legal/asset-license-review.webp',
		);
	});

	it('refuses a PNG, because the repository ships WebP verification artefacts', () => {
		const root = makeTempDir();
		assert.throws(
			() => assertWebpOutputPath('docs/verification/legal/asset-license-review.png', root),
			/non-WebP/,
		);
	});

	it('refuses a path outside the repository', () => {
		const root = makeTempDir();
		assert.throws(() => assertWebpOutputPath('../elsewhere/shot.webp', root), /outside/);
	});

	it('measures the size budget in kB', () => {
		assert.equal(screenshotBudgetVerdict(1024 * 100).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
	});
});

describe('staging', () => {
	it('stages inside .tmp so a failed run never touches the committed artefact', () => {
		const root = makeTempDir();
		const staged = stagedCapturePath('docs/verification/legal/asset-license-review.webp', root);
		assert.match(staged, /\.tmp\/asset-license-review\/staging\//);
	});

	it('promotes a candidate onto the committed path and cleans up', () => {
		const root = makeTempDir();
		const screenshot = 'docs/verification/legal/asset-license-review.webp';
		const staged = stagedCapturePath(screenshot, root);
		mkdirSync(dirname(staged), { recursive: true });
		writeFileSync(staged, 'webp-bytes');
		const finalPath = promoteStagedCapture({ staged, screenshot, repoRoot: root });
		assert.equal(existsSync(finalPath), true);
		discardStagedCapture(staged, root);
		assert.equal(existsSync(staged), false);
	});
});

describe('harness generation', () => {
	it('renders the shipped gallery from the shipped story module', () => {
		const main = harnessMainTsx();
		assert.match(main, new RegExp(STORY_MODULE.replace(/[/.]/g, '\\$&')));
		assert.match(main, new RegExp(GALLERY_EXPORT));
		assert.match(main, /src\/styles\.css/);
	});

	it('writes the repository Panda config into the harness build', () => {
		const config = harnessViteConfig();
		assert.match(config, /postcss\.config\.mjs/);
		assert.match(config, /outDir/);
	});

	it('generates an empty root element for the gallery to mount into', () => {
		assert.match(harnessIndexHtml(), /id="root"/);
	});

	it('is idempotent, so --no-build can reuse it', () => {
		const root = makeTempDir();
		const first = writeHarness(root);
		const second = writeHarness(root);
		assert.equal(first, second);
	});

	it('keeps the readiness markers the capture waits for', () => {
		assert.equal(GALLERY_TEST_ID, 'asset-license-gallery');
		assert.equal(REVIEW_TEST_ID, 'asset-license-review');
		assert.equal(EXPECTED_REVIEW_CARDS, 3);
	});

	it('renders the committed record, not a hand-written sample', () => {
		assert.equal(RECORD_RELATIVE_PATH, 'quality/asset-license-inventory.json');
	});
});

describe('loopback server', () => {
	it('treats only loopback hosts as local', () => {
		assert.equal(isLoopbackRequestUrl('http://127.0.0.1:1234/'), true);
		assert.equal(isLoopbackRequestUrl('http://localhost:1234/'), true);
		assert.equal(isLoopbackRequestUrl('https://fonts.gstatic.com/x.woff2'), false);
		assert.equal(isLoopbackRequestUrl('not a url'), false);
	});

	it('refuses a traversal out of the served directory', () => {
		const root = makeTempDir();
		mkdirSync(join(root, 'nested'), { recursive: true });
		writeFileSync(join(root, 'nested', 'index.html'), 'ok');
		assert.equal(resolveStaticTarget(root, '/nested/').status, 200);
		assert.equal(resolveStaticTarget(root, '/../../etc/passwd').status, 403);
		assert.equal(resolveStaticTarget(root, '/missing.html').status, 404);
		assert.equal(resolveStaticTarget(root, '/%E0%A4%A').status, 400);
	});
});

describe('options', () => {
	it('defaults to the Issue artefact path', () => {
		const options = parseArgs([]);
		assert.equal(options.screenshot, 'docs/verification/legal/asset-license-review.webp');
		assert.equal(options.width, 1440);
	});

	it('supports --no-build and --no-capture', () => {
		const options = parseArgs(['--no-build', '--no-capture']);
		assert.equal(options.build, false);
		assert.equal(options.capture, false);
	});

	it('refuses an unknown option rather than ignoring it', () => {
		assert.throws(() => parseArgs(['--png']), /unknown option/);
	});
});
