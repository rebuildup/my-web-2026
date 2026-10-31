import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { checkArchitecture } from './check-architecture.mjs';

/**
 * Write a file into a fixture tree, creating its directory.
 *
 * @param {string} root fixture root
 * @param {string} relativePath path relative to the fixture root
 * @param {string} contents file contents
 */
async function writeFixtureFile(root, relativePath, contents) {
	const target = join(root, relativePath);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents);
}

/**
 * Create an empty fixture tree with a `src/` directory.
 *
 * @param {string} prefix temporary-directory prefix
 * @returns {Promise<string>} the fixture root
 */
async function makeFixture(prefix) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await mkdir(join(root, 'src'), { recursive: true });
	return root;
}

test('a leaf obligation that imports another owner fails — the rule is reachable', async (t) => {
	const root = await makeFixture('my-web-arch-leaf-');
	t.after(() => rm(root, { recursive: true, force: true }));

	await writeFixtureFile(
		root,
		'src/i18n/policy.ts',
		[
			"import { headingGlyphs } from '../editorial/primitives/heading';",
			'export const policy = headingGlyphs;',
		].join('\n'),
	);
	await writeFixtureFile(
		root,
		'src/editorial/primitives/heading.ts',
		'export const headingGlyphs = [];\n',
	);

	const errors = checkArchitecture(root);

	assert.equal(errors.length, 1, `expected exactly one violation, got: ${JSON.stringify(errors)}`);
	assert.match(errors[0], /i18n is a leaf obligation and must not depend on editorial/);
	assert.match(errors[0], /src\/i18n\/policy\.ts/);
});

test('a leaf obligation that dynamic-imports another owner fails', async (t) => {
	const root = await makeFixture('my-web-arch-leaf-dynamic-');
	t.after(() => rm(root, { recursive: true, force: true }));

	await writeFixtureFile(
		root,
		'src/privacy/lifecycle.ts',
		[
			'export async function load() {',
			"  const { helper } = await import('../editorial/primitives/heading');",
			'  return helper;',
			'}',
		].join('\n'),
	);
	await writeFixtureFile(root, 'src/editorial/primitives/heading.ts', 'export const helper = 1;\n');

	const errors = checkArchitecture(root);

	assert.equal(errors.length, 1, `expected exactly one violation, got: ${JSON.stringify(errors)}`);
	assert.match(errors[0], /privacy is a leaf obligation and must not depend on editorial/);
});

test('a leaf obligation that imports only within itself passes', async (t) => {
	const root = await makeFixture('my-web-arch-leaf-clean-');
	t.after(() => rm(root, { recursive: true, force: true }));

	await writeFixtureFile(
		root,
		'src/i18n/policy.ts',
		["import { slugGrammar } from './grammar';", 'export const policy = slugGrammar;'].join('\n'),
	);
	await writeFixtureFile(root, 'src/i18n/grammar.ts', 'export const slugGrammar = /[a-z]+/;\n');

	const errors = checkArchitecture(root);

	assert.deepEqual(errors, []);
});

test('a test file under a leaf obligation is exempt from the leaf rule', async (t) => {
	const root = await makeFixture('my-web-arch-leaf-test-');
	t.after(() => rm(root, { recursive: true, force: true }));

	await writeFixtureFile(
		root,
		'src/i18n/fixtures.test.ts',
		[
			"import { headingGlyphs } from '../editorial/primitives/heading';",
			'export const used = headingGlyphs;',
		].join('\n'),
	);
	await writeFixtureFile(
		root,
		'src/editorial/primitives/heading.ts',
		'export const headingGlyphs = [];\n',
	);

	const errors = checkArchitecture(root);

	assert.deepEqual(errors, []);
});

test('a non-leaf owner that imports a forbidden owner still fails', async (t) => {
	const root = await makeFixture('my-web-arch-forbidden-');
	t.after(() => rm(root, { recursive: true, force: true }));

	await writeFixtureFile(
		root,
		'src/editorial/primitives/card.tsx',
		["import { composer } from '../../home/composer';", 'export const card = composer;'].join('\n'),
	);
	await writeFixtureFile(root, 'src/home/composer.tsx', 'export const composer = 1;\n');

	const errors = checkArchitecture(root);

	assert.equal(errors.length, 1, `expected exactly one violation, got: ${JSON.stringify(errors)}`);
	assert.match(errors[0], /editorial must not depend on home/);
});

test('the type-only edge accepts a type import and rejects a value import', async (t) => {
	const root = await makeFixture('my-web-arch-type-only-');
	t.after(() => rm(root, { recursive: true, force: true }));

	await writeFixtureFile(
		root,
		'src/home/typed.ts',
		[
			"import type { CounterResult } from '../http/access-counter/schema';",
			'export const typed: CounterResult = {};',
		].join('\n'),
	);
	await writeFixtureFile(
		root,
		'src/http/access-counter/schema.ts',
		'export type CounterResult = { count: number };\n',
	);

	assert.deepEqual(checkArchitecture(root), []);

	await writeFixtureFile(
		root,
		'src/home/typed.ts',
		[
			"import { COUNTER_LIMIT } from '../http/access-counter/schema';",
			'export const typed = COUNTER_LIMIT;',
		].join('\n'),
	);
	await writeFixtureFile(
		root,
		'src/http/access-counter/schema.ts',
		'export const COUNTER_LIMIT = 10;\n',
	);

	const errors = checkArchitecture(root);

	assert.equal(errors.length, 1, `expected exactly one violation, got: ${JSON.stringify(errors)}`);
	assert.match(errors[0], /home may only import types from http/);
});

test('a legacy classifier root is reported', async (t) => {
	const root = await makeFixture('my-web-arch-legacy-');
	t.after(() => rm(root, { recursive: true, force: true }));

	await mkdir(join(root, 'src', 'modules'), { recursive: true });

	const errors = checkArchitecture(root);

	assert.equal(errors.length, 1, `expected exactly one violation, got: ${JSON.stringify(errors)}`);
	assert.match(errors[0], /src\/modules\/ is a legacy classifier root/);
});

test('the real repository tree has no obligation-boundary violation', () => {
	const repoRoot = resolve(import.meta.dirname, '..');
	const errors = checkArchitecture(repoRoot);

	assert.deepEqual(errors, []);
});
