import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
	DOCUMENT_LANGUAGE,
	GALLERY_TEST_ID,
	HARNESS_DIR,
	HARNESS_DIST,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY,
	STORY_EXPORT,
	STORY_MODULE,
	assertWebpOutputPath,
	auditObservedDom,
	harnessIndexHtml,
	harnessMainTsx,
	harnessViteConfig,
	resolveStaticTarget,
	screenshotBudgetVerdict,
	writeHarness,
} from './capture-language-of-parts.mjs';

/**
 * Capture-harness invariants for the Issue #409 verification artefact.
 *
 * The harness is what produces the committed screenshot, so its POLICY is
 * what this file guards: WebP-only output, a size budget, a capture that
 * renders the shipped story rather than a copy of it, a static server
 * that cannot escape its root, and — the part that makes this capture a
 * measurement rather than a photograph — an assertion that compares the
 * rendered DOM with the shipped policy.
 *
 * There is no Chromium here — driving a browser is a heavy local step
 * (`node scripts/capture-language-of-parts.mjs`), not a unit test. What
 * must never regress silently is the policy, and that is pure.
 */

describe('capture-language-of-parts — artefact policy', () => {
	it('refuses a non-WebP artefact path', () => {
		// Issue #409 names `mixed-language-content.png`; committing that
		// raster would put a permanently large binary in the tree for a
		// verification artefact.
		assert.throws(
			() => assertWebpOutputPath('docs/verification/a11y/mixed-language-content.png'),
			/refusing to write a non-WebP/,
		);
		assert.equal(
			assertWebpOutputPath('docs/verification/a11y/mixed-language-content.webp'),
			'docs/verification/a11y/mixed-language-content.webp',
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

describe('capture-language-of-parts — harness', () => {
	it('renders the shipped story, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, new RegExp(`from '\\.\\./\\.\\./\\.\\./${STORY_MODULE}'`));
		assert.match(main, new RegExp(`\\{ ${STORY_EXPORT} \\}`));
		assert.match(main, new RegExp(`${STORY_EXPORT}\\.render\\?\\.\\(\\)`));
		assert.match(main, /src\/styles\.css/);
	});

	it('wires the repository PostCSS config so the capture uses the shipped CSS', () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'language-of-parts-css-'));
		try {
			const config = harnessViteConfig(HARNESS_DIR, repoRoot);
			// Without the repository PostCSS config the capture would render
			// unstyled HTML and still look like a plausible artefact.
			assert.match(config, new RegExp(`postcss: '${join(repoRoot, 'postcss.config.mjs')}'`));
			assert.match(config, /root: '\.tmp\/a11y-mixed-language\/harness'/);
			assert.match(config, /@vitejs\/plugin-react/);
			assert.match(config, new RegExp(`outDir: '${join(repoRoot, HARNESS_DIST)}'`));
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it('generates a page that declares the document language the policy compares against', () => {
		const html = harnessIndexHtml();
		assert.match(html, /<div id="root"><\/div>/);
		assert.match(html, /<script type="module" src="\.\/main\.tsx">/);
		// SC 3.1.1: the harness declares the same language the product
		// declares, so a mismatch the capture reports is about the
		// fixture, not about a harness that forgot the attribute.
		assert.match(html, new RegExp(`<html lang="${DOCUMENT_LANGUAGE}">`));
		// Deterministic: the same inputs must produce the same bytes.
		assert.equal(html, harnessIndexHtml());
	});

	it('writes the harness under the ephemeral .tmp directory', () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'language-of-parts-repo-'));
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
		assert.equal(GALLERY_TEST_ID, 'a11y-mixed-language-gallery');
		assert.match(STORY_MODULE, /^src\/editorial\/language-of-parts\.stories\.tsx$/);
	});
});

describe('capture-language-of-parts — the DOM assertion', () => {
	const expected = {
		documentLanguage: 'ja',
		bodies: [
			{
				id: 'article',
				compact: false,
				tags: [null, null, 'en', 'ko'],
				ids: ['code-architecture-check', 'loanword-dashboard', 'quote-english', 'sentence-korean'],
			},
			{ id: 'plain', compact: false, tags: [], ids: [] },
		],
	};

	it('passes when the DOM carries exactly the policy attributes', () => {
		const observed = [
			{
				id: 'article',
				compact: false,
				parts: [
					{ id: 'code-architecture-check', lang: null, verdict: 'not-a-passage' },
					{ id: 'loanword-dashboard', lang: null, verdict: 'not-a-passage' },
					{ id: 'quote-english', lang: 'en', verdict: 'tagged' },
					{ id: 'sentence-korean', lang: 'ko', verdict: 'tagged' },
				],
			},
			{ id: 'plain', compact: false, parts: [] },
		];
		assert.deepEqual(auditObservedDom({ documentLanguage: 'ja', observed, expected }), []);
	});

	it('fails when the renderer forgot an attribute', () => {
		const observed = [
			{
				id: 'article',
				compact: false,
				parts: [
					{ id: 'code-architecture-check', lang: null, verdict: 'not-a-passage' },
					{ id: 'loanword-dashboard', lang: null, verdict: 'not-a-passage' },
					{ id: 'quote-english', lang: null, verdict: 'tagged' },
					{ id: 'sentence-korean', lang: 'ko', verdict: 'tagged' },
				],
			},
			{ id: 'plain', compact: false, parts: [] },
		];
		const problems = auditObservedDom({ documentLanguage: 'ja', observed, expected });
		assert.equal(problems.length, 2);
		assert.match(problems.join('\n'), /rendered lang attributes are/);
		assert.match(problems.join('\n'), /classified tagged but the DOM carries no lang/);
	});

	it('fails when a refused part was tagged anyway (the mechanical-tagging regression)', () => {
		const observed = [
			{
				id: 'article',
				compact: false,
				parts: [
					// A code identifier tagged `en`: the exact failure the
					// Issue forbids ("全英単語に機械追加しない").
					{ id: 'code-architecture-check', lang: 'en', verdict: 'not-a-passage' },
					{ id: 'loanword-dashboard', lang: null, verdict: 'not-a-passage' },
					{ id: 'quote-english', lang: 'en', verdict: 'tagged' },
					{ id: 'sentence-korean', lang: 'ko', verdict: 'tagged' },
				],
			},
			{ id: 'plain', compact: false, parts: [] },
		];
		const problems = auditObservedDom({ documentLanguage: 'ja', observed, expected });
		assert.match(problems.join('\n'), /is refused \(not-a-passage\) but the DOM carries lang="en"/);
	});

	it('fails when the document language contradicts the policy', () => {
		const observed = [];
		const problems = auditObservedDom({ documentLanguage: 'en', observed, expected });
		assert.match(problems.join('\n'), /document\.documentElement\.lang is "en"/);
		// A body missing entirely is its own problem, not a silent pass.
		assert.match(problems.join('\n'), /no rendered body for article:false/);
	});
});

describe('capture-language-of-parts — static serving', () => {
	it('resolves requests inside the served root and refuses traversal', () => {
		const root = mkdtempSync(join(tmpdir(), 'language-of-parts-gallery-'));
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
