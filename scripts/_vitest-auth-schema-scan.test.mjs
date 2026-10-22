import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import {
	discoverAuthSchemaTestFiles,
	extractSpecifiers,
	resolveLocalSpecifier,
} from './_vitest-auth-schema-scan.mjs';

/**
 * Pool-connection scanner (Issue #618).
 *
 * `test/setup/better-auth-schema.ts` only connects a test file to the
 * Workers pool when the scanner says the file can reach
 * `cloudflare:test` (bindings) or `cloudflare:workers` (the `env`
 * accessor). The two failure directions are not symmetric: including a
 * pure file costs ~2.4s, excluding a connected file removes its test,
 * so every ambiguous edge must resolve to "included".
 */

const root = mkdtempSync(join(tmpdir(), 'my-web-2026-vitest-scan-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Write `contents` to `relativePath`, creating parent directories. */
function write(relativePath, contents = '') {
	const path = join(root, relativePath);
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, contents);
	return path;
}

/** Absolute path under the fixture root. */
function abs(relativePath) {
	return resolve(root, relativePath);
}

/** Relative path of each discovered file, for readable assertions. */
function discovered() {
	return discoverAuthSchemaTestFiles(root).map((path) => path.slice(root.length + 1));
}

describe('discoverAuthSchemaTestFiles', () => {
	it('includes a file that imports cloudflare:test directly', () => {
		write('src/direct.test.ts', "import { env } from 'cloudflare:test';\n");
		assert.ok(discovered().includes('src/direct.test.ts'));
	});

	it('includes a file that imports cloudflare:workers directly', () => {
		write('src/workers.spec.ts', "import { env } from 'cloudflare:workers';\n");
		assert.ok(discovered().includes('src/workers.spec.ts'));
	});

	it('includes a file whose local import reaches cloudflare:workers', () => {
		write('src/transitive.test.ts', "import { helper } from './chain/helper';\n");
		write(
			'src/chain/helper.ts',
			"import { env } from 'cloudflare:workers';\nexport const helper = env;\n",
		);
		write('src/chain/leaf.ts', "import { env } from 'cloudflare:workers';\nexport { env };\n");
		write('src/chain/helper.ts', "import { env } from './leaf';\nexport const helper = env;\n");
		assert.ok(discovered().includes('src/transitive.test.ts'));
	});

	it('follows the ~/ alias into src', () => {
		write('src/alias.test.ts', "import { db } from '~/database';\n");
		write('src/database.ts', "import { env } from 'cloudflare:test';\nexport const db = env.DB;\n");
		assert.ok(discovered().includes('src/alias.test.ts'));
	});

	it('follows a dynamic import', () => {
		write('src/dynamic.test.ts', "it('x', async () => { await import('./dynamic-helper'); });\n");
		write('src/dynamic-helper.ts', "export { env } from 'cloudflare:workers';\n");
		assert.ok(discovered().includes('src/dynamic.test.ts'));
	});

	it('resolves a directory import to its index file', () => {
		write('src/directory.test.ts', "import { mock } from './mock';\n");
		write(
			'src/mock/index.ts',
			"import { env } from 'cloudflare:test';\nexport const mock = env;\n",
		);
		assert.ok(discovered().includes('src/directory.test.ts'));
	});

	it('ignores a file that only imports bare packages', () => {
		write(
			'src/pure.test.ts',
			"import { describe, it } from 'vitest';\nimport { Hono } from 'hono';\n",
		);
		assert.ok(!discovered().includes('src/pure.test.ts'));
	});

	it('includes a file with a local import that does not resolve', () => {
		write('src/broken.test.ts', "import { thing } from './missing-module';\n");
		assert.ok(discovered().includes('src/broken.test.ts'));
	});

	it('stops at generated output outside src and test', () => {
		write('src/generated.test.ts', "import { css } from '../styled-system/css';\n");
		write('styled-system/css/index.mjs', 'export const css = {};\n');
		assert.ok(!discovered().includes('src/generated.test.ts'));
	});

	it('stops at imported assets', () => {
		write('src/asset.test.ts', "import icon from './digits/0.webp?url';\n");
		write('src/digits/0.webp', 'not really an image');
		assert.ok(!discovered().includes('src/asset.test.ts'));
	});

	it('terminates on an import cycle with no connection', () => {
		write('src/cycle.test.ts', "import './cycle/a';\n");
		write('src/cycle/a.ts', "import './b';\n");
		write('src/cycle/b.ts', "import './a';\n");
		assert.ok(!discovered().includes('src/cycle.test.ts'));
	});

	it('finds test files under test/ as well as src/', () => {
		write('test/integration/runtime.test.ts', "import { SELF } from 'cloudflare:test';\n");
		assert.ok(discovered().includes('test/integration/runtime.test.ts'));
	});

	it('returns only test entry points, sorted and absolute', () => {
		write('src/support/helper.ts', "import { env } from 'cloudflare:workers';\n");
		const files = discoverAuthSchemaTestFiles(root);
		assert.deepEqual(files, [...files].sort());
		for (const file of files) {
			assert.ok(file.startsWith(root));
			assert.match(file, /\.(?:test|spec)\.(?:ts|tsx)$/);
		}
		assert.ok(!files.includes(abs('src/support/helper.ts')));
	});

	it('does not follow imports out of the repository tree', () => {
		write('src/outside.test.ts', "import '../../outside-does-not-exist';\n");
		// Unresolvable, so the fail-safe direction applies.
		assert.ok(discovered().includes('src/outside.test.ts'));
	});
});

describe('extractSpecifiers', () => {
	it('reads static imports, re-exports, and dynamic imports', () => {
		const source = [
			"import { a } from './a';",
			"import './side-effect';",
			"export { b } from './b';",
			"const c = await import('./c');",
			'const d = import(`./d`);',
		].join('\n');
		assert.deepEqual(extractSpecifiers(source), ['./a', './side-effect', './b', './c']);
	});
});

describe('resolveLocalSpecifier', () => {
	const from = abs('src/example/file.ts');

	it('returns null for bare and node: specifiers', () => {
		assert.equal(resolveLocalSpecifier('hono', from, root), null);
		assert.equal(resolveLocalSpecifier('node:fs', from, root), null);
	});

	it('returns undefined for a missing relative module', () => {
		assert.equal(resolveLocalSpecifier('./missing', from, root), undefined);
	});

	it('resolves extensionless relative paths', () => {
		const target = write('src/example/target.ts', 'export {};\n');
		assert.equal(resolveLocalSpecifier('./target', from, root), target);
	});

	it('ignores a Vite query suffix', () => {
		const target = write('src/example/state.tsx', 'export {};\n');
		assert.equal(resolveLocalSpecifier('./state.tsx?raw', from, root), target);
	});
});
