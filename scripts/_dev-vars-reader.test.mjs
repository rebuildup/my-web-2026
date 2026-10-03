#!/usr/bin/node --test
/**
 * Unit tests for `scripts/_dev-vars-reader.mjs` (Issue #186 — the
 * LOCAL_API_MODE=mock dev-server passthrough). The helper is loaded
 * directly via dynamic import; the file uses Node's built-in test
 * runner so it runs under `node --test` like the other `scripts/*.test.mjs`
 * files wired into `pnpm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER_URL = pathToFileURL(resolve(HERE, '_dev-vars-reader.mjs')).href;
const { parseDevVarsContents, readDevVars, buildLocalApiModeConfigOverride } = await import(
	HELPER_URL
);

test('parseDevVarsContents: empty / blank / all-comment returns {}', () => {
	assert.deepEqual(parseDevVarsContents(''), {});
	assert.deepEqual(parseDevVarsContents('\n\n   \n'), {});
	assert.deepEqual(parseDevVarsContents('# only comments\n# nothing else\n'), {});
});

test('parseDevVarsContents: parses plain KEY=value lines', () => {
	const contents = [
		'# header comment',
		'LOCAL_API_MODE=mock',
		'BETTER_AUTH_SECRETS=1:abc',
		'',
		'MY_WEB_2026_CONSUMER_API_KEY=mk_home_xyz',
	].join('\n');
	assert.deepEqual(parseDevVarsContents(contents), {
		LOCAL_API_MODE: 'mock',
		BETTER_AUTH_SECRETS: '1:abc',
		MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_xyz',
	});
});

test('parseDevVarsContents: strips matching single and double quotes', () => {
	const contents = ['LOCAL_API_MODE="mock"', "FOO='bar baz'", 'UNQUOTED=plain'].join('\n');
	assert.deepEqual(parseDevVarsContents(contents), {
		LOCAL_API_MODE: 'mock',
		FOO: 'bar baz',
		UNQUOTED: 'plain',
	});
});

test('parseDevVarsContents: skips malformed lines (no =, =foo, bad key)', () => {
	const contents = ['=no-key', 'no-equals-sign', '1leading-digit=value', 'GOOD=value'].join('\n');
	assert.deepEqual(parseDevVarsContents(contents), { GOOD: 'value' });
});

test('parseDevVarsContents: handles CRLF line endings (Windows .dev.vars)', () => {
	const contents = 'LOCAL_API_MODE=mock\r\nBETTER_AUTH_SECRETS=1:xyz\r\n';
	assert.deepEqual(parseDevVarsContents(contents), {
		LOCAL_API_MODE: 'mock',
		BETTER_AUTH_SECRETS: '1:xyz',
	});
});

test('readDevVars: returns {} when file does not exist', () => {
	const fakeFs = { fsExistsSync: () => false, fsReadFileSync: () => '' };
	assert.deepEqual(readDevVars('/nonexistent/.dev.vars', fakeFs), {});
});

test('readDevVars: parses file when it exists', () => {
	const fakeFs = {
		fsExistsSync: () => true,
		fsReadFileSync: () => 'LOCAL_API_MODE=mock\n',
	};
	assert.deepEqual(readDevVars('/anywhere', fakeFs), { LOCAL_API_MODE: 'mock' });
});

test('buildLocalApiModeConfigOverride: returns undefined when .dev.vars has no LOCAL_API_MODE', () => {
	assert.equal(buildLocalApiModeConfigOverride({ vars: { X: 'y' } }, {}), undefined);
	assert.equal(buildLocalApiModeConfigOverride({ vars: { X: 'y' } }, null), undefined);
});

test('buildLocalApiModeConfigOverride: returns undefined when LOCAL_API_MODE is empty string', () => {
	assert.equal(buildLocalApiModeConfigOverride({ vars: {} }, { LOCAL_API_MODE: '' }), undefined);
});

test('buildLocalApiModeConfigOverride: injects LOCAL_API_MODE alongside existing vars', () => {
	const workerConfig = {
		vars: {
			MY_WEB_2026_REACTIONS_TARGET: 'home-page',
			MY_WEB_2026_COUNTER_KEY: 'home-page',
		},
	};
	const override = buildLocalApiModeConfigOverride(workerConfig, { LOCAL_API_MODE: 'mock' });
	assert.deepEqual(override, {
		vars: {
			MY_WEB_2026_REACTIONS_TARGET: 'home-page',
			MY_WEB_2026_COUNTER_KEY: 'home-page',
			LOCAL_API_MODE: 'mock',
		},
	});
});

test('buildLocalApiModeConfigOverride: tolerates missing workerConfig.vars', () => {
	const override = buildLocalApiModeConfigOverride({}, { LOCAL_API_MODE: 'mock' });
	assert.deepEqual(override, { vars: { LOCAL_API_MODE: 'mock' } });
});

test('buildLocalApiModeConfigOverride: any non-mock value passes through verbatim (gate checks === "mock")', () => {
	// The gate in src/http/hono.ts only treats the literal "mock" as
	// the activation signal; any other value falls through to the
	// production routers unchanged. The override must still inject
	// whatever .dev.vars carries so an operator who types
	// `LOCAL_API_MODE=on` (or similar) sees the same gate behavior
	// as production — not the canned mock body.
	const override = buildLocalApiModeConfigOverride({ vars: {} }, { LOCAL_API_MODE: 'on' });
	assert.deepEqual(override, { vars: { LOCAL_API_MODE: 'on' } });
});
