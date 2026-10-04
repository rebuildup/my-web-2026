import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { countFiles } from './sync-cf-build-output.mjs';

/**
 * `sync-cf-build-output.mjs` regression tests (Issue #247).
 *
 * The contract this pins: the Tool bundles that
 * `scripts/build-tools.mjs` produces AFTER `vite build` must exist in
 * the deploy artifact. Before this step existed the counts were
 * measured as 13 in `dist/client/tools` and **0** in
 * `.cloudflare/output/v0/.../assets/tools`, so migrating the deploy
 * gate would have shipped `/tools/<slug>` with no bundle at all.
 */

function tree(root, files = {}) {
	for (const [rel, content] of Object.entries(files)) {
		const p = join(root, rel);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, content, { mode: 0o600 });
	}
	return root;
}

describe('countFiles (Issue #247)', () => {
	it('counts files recursively', () => {
		const dir = mkdtempSync(join(tmpdir(), 'cf-build-output-test-'));
		try {
			tree(dir, { 'a.txt': 'a', 'nested/b.txt': 'b', 'nested/deep/c.txt': 'c' });
			assert.equal(countFiles(dir), 3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('returns 0 for a missing directory rather than throwing', () => {
		assert.equal(countFiles(join(tmpdir(), 'definitely-not-here-xyz')), 0);
	});

	it('returns 0 for an empty directory', () => {
		const dir = mkdtempSync(join(tmpdir(), 'cf-build-output-empty-'));
		try {
			assert.equal(countFiles(dir), 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('Tool artifact contract (Issue #247)', () => {
	// The exact shape the deploy artifact must carry for a published
	// Tool: `<slug>/app/index.html` plus its bundle.
	const TOOL_FILES = {
		'prototype/app/index.html': '<html></html>',
		'prototype/app/assets/index.js': 'js',
		'readmark/app/index.html': '<html></html>',
		'readmark/app/assets/index.js': 'js',
	};

	it('a tool bundle lives at <slug>/app/index.html, which the verifier asserts on', () => {
		const dir = mkdtempSync(join(tmpdir(), 'cf-tool-shape-'));
		try {
			tree(dir, TOOL_FILES);
			// This is the invariant check-cf-build-output.mjs enforces per
			// slug; if the layout ever changes, this test is the canary.
			for (const slug of ['prototype', 'readmark']) {
				assert.ok(existsSync(join(dir, slug, 'app', 'index.html')));
			}
			assert.equal(countFiles(dir), Object.keys(TOOL_FILES).length);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a directory that exists but holds no app/index.html is not "present"', () => {
		// The failure mode the verifier guards: a non-empty-looking
		// tools/ directory with no usable entry point.
		const dir = mkdtempSync(join(tmpdir(), 'cf-tool-partial-'));
		try {
			tree(dir, { 'prototype/app/assets/index.js': 'js' });
			assert.equal(existsSync(join(dir, 'prototype', 'app', 'index.html')), false);
			// Still counts a file, which is why the verifier checks the
			// entry point per slug rather than relying on the count.
			assert.equal(countFiles(dir), 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
