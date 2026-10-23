import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { discoverWarmupTestFiles, importsSelf } from './_vitest-warmup-scan.mjs';

/**
 * Warm-up scanner (Issue #261).
 *
 * The scanner decides which test files pay the workerd cold start
 * before their timed tests run. Only a file that imports the `SELF`
 * binding can issue the request that carries the cold start, so the
 * scan is a direct one — no import-graph walk.
 *
 * The two failure directions are not symmetric: including a file that
 * does not need the warm-up costs one cheap request, excluding a file
 * that does need it restores the flake. Every ambiguous case therefore
 * resolves to "included".
 */

const root = mkdtempSync(join(tmpdir(), 'my-web-2026-vitest-warmup-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Write `contents` to `relativePath`, creating parent directories. */
function write(relativePath, contents = '') {
	const path = join(root, relativePath);
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, contents);
	return path;
}

/** Relative path of each discovered file, for readable assertions. */
function discovered() {
	return discoverWarmupTestFiles(root).map((path) => path.slice(root.length + 1));
}

describe('importsSelf', () => {
	it('detects a named import of SELF from cloudflare:test', () => {
		assert.equal(importsSelf("import { SELF, env } from 'cloudflare:test';"), true);
	});

	it('detects a named import written with double quotes', () => {
		assert.equal(importsSelf('import { SELF } from "cloudflare:test";'), true);
	});

	it('detects an aliased import of SELF', () => {
		assert.equal(importsSelf("import { SELF as worker } from 'cloudflare:test';"), true);
	});

	it('detects a namespace import of the module that exports SELF', () => {
		assert.equal(importsSelf("import * as cf from 'cloudflare:test';"), true);
	});

	it('ignores an import of another binding from the same module', () => {
		assert.equal(importsSelf("import { env } from 'cloudflare:test';"), false);
	});

	it('ignores a binding named SELF from another module', () => {
		assert.equal(importsSelf("import { SELF } from './helpers/self';"), false);
	});

	it('ignores a file that only mentions SELF in prose', () => {
		assert.equal(importsSelf('// the SELF binding is documented here\n'), false);
	});
});

describe('discoverWarmupTestFiles', () => {
	it('includes a test file that imports SELF', () => {
		write('src/uses-self.test.ts', "import { SELF } from 'cloudflare:test';\n");
		assert.ok(discovered().includes('src/uses-self.test.ts'));
	});

	it('excludes a test file that only reaches env', () => {
		write('src/uses-env.test.ts', "import { env } from 'cloudflare:test';\n");
		assert.ok(!discovered().includes('src/uses-env.test.ts'));
	});

	it('excludes a file that is not a test file', () => {
		write('src/helper.ts', "import { SELF } from 'cloudflare:test';\n");
		assert.ok(!discovered().includes('src/helper.ts'));
	});

	it('scans the integration tree too', () => {
		write('test/integration/uses-self.test.ts', "import { SELF } from 'cloudflare:test';\n");
		assert.ok(discovered().includes('test/integration/uses-self.test.ts'));
	});

	it('returns absolute sorted paths', () => {
		write('test/integration/b.test.ts', "import { SELF } from 'cloudflare:test';\n");
		write('test/integration/a.test.ts', "import { SELF } from 'cloudflare:test';\n");
		const found = discoverWarmupTestFiles(root);
		assert.ok(found.every((path) => path.startsWith(resolve(root))));
		assert.deepEqual(found, [...found].sort());
	});
});
