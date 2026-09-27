import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SECRET_NAME,
	SOURCE_ENV,
	TARGET_ENV,
	buildInfisicalSetArgs,
	buildYamlContent,
	parseArgs,
	secretValuesEqual,
} from './reconcile-prod-auth-secret.mjs';

test('scope is hard-coded to dev -> prod BETTER_AUTH_SECRET', () => {
	assert.equal(SOURCE_ENV, 'dev');
	assert.equal(TARGET_ENV, 'prod');
	assert.equal(SECRET_NAME, 'BETTER_AUTH_SECRET');
});

test('default mode is dry-run', () => {
	assert.deepEqual(parseArgs([]), { help: false, mode: 'dry-run' });
});

test('modes are mutually exclusive', () => {
	assert.throws(() => parseArgs(['--verify', '--execute']), /Choose exactly one/);
});

test('unknown arguments are rejected', () => {
	assert.throws(() => parseArgs(['--environment=staging']), /Unknown argument/);
});

test('secretValuesEqual compares bytes and handles unequal lengths', () => {
	assert.equal(secretValuesEqual('abc', 'abc'), true);
	assert.equal(secretValuesEqual('abc', 'abd'), false);
	assert.equal(secretValuesEqual('abc', 'abcd'), false);
	assert.equal(secretValuesEqual('秘密', '秘密'), true);
});

test('YAML content safely quotes values without changing key scope', () => {
	const value = 'a"b\\c\nnext';
	const yaml = buildYamlContent(value);
	assert.match(yaml, /^---\n"BETTER_AUTH_SECRET": /);
	assert.equal(yaml.includes('BETTER_AUTH_SECRETS'), false);
	assert.equal(yaml.includes('\nnext\n'), false);
	assert.match(yaml, /\\nnext/);
});

test('Infisical CLI argv contains only file path and fixed prod metadata', () => {
	const secret = 'must-not-appear-in-argv';
	const args = buildInfisicalSetArgs('/tmp/secret.yaml');
	assert.deepEqual(args, [
		'secrets',
		'set',
		'--file',
		'/tmp/secret.yaml',
		'--env',
		'prod',
		'--path',
		'/',
	]);
	assert.equal(args.join(' ').includes(secret), false);
});
