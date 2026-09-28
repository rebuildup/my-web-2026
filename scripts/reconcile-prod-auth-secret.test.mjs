import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SECRET_NAME,
	SOURCE_ENV,
	TARGET_ENV,
	buildInfisicalSetArgs,
	buildSecretReadUrl,
	buildYamlContent,
	interpretReadResponse,
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

// buildSecretReadUrl — pure seam for the readSecret GET request.
// Pins the URL contract that source/target reads must satisfy.
// Regression coverage for Issue #142: previously passed `type=personal`
// which silently excluded shared secrets (HTTP 404).

test('buildSecretReadUrl includes the four required query parameters', () => {
	const url = buildSecretReadUrl({
		apiUrl: 'https://secrets.rebuildup.dev',
		workspaceId: '89cda9cb-31ab-4ace-afe9-f155024850d1',
		environment: 'dev',
	});
	const parsed = new URL(url);
	const params = parsed.searchParams;
	assert.equal(params.get('workspaceId'), '89cda9cb-31ab-4ace-afe9-f155024850d1');
	assert.equal(params.get('environment'), 'dev');
	assert.equal(params.get('secretPath'), '/');
	assert.equal(params.get('viewSecretValue'), 'true');
});

test('buildSecretReadUrl hits /api/v3/secrets/raw/{SECRET_NAME}', () => {
	const url = buildSecretReadUrl({
		apiUrl: 'https://secrets.rebuildup.dev',
		workspaceId: 'ws-id',
		environment: 'prod',
	});
	const parsed = new URL(url);
	assert.equal(parsed.pathname, `/api/v3/secrets/raw/${SECRET_NAME}`);
	assert.equal(parsed.origin, 'https://secrets.rebuildup.dev');
});

test('buildSecretReadUrl trims trailing slashes from apiUrl', () => {
	const a = buildSecretReadUrl({
		apiUrl: 'https://secrets.rebuildup.dev/',
		workspaceId: 'ws',
		environment: 'dev',
	});
	const b = buildSecretReadUrl({
		apiUrl: 'https://secrets.rebuildup.dev///',
		workspaceId: 'ws',
		environment: 'dev',
	});
	const c = buildSecretReadUrl({
		apiUrl: 'https://secrets.rebuildup.dev',
		workspaceId: 'ws',
		environment: 'dev',
	});
	assert.equal(new URL(a).pathname, `/api/v3/secrets/raw/${SECRET_NAME}`);
	assert.equal(new URL(b).pathname, `/api/v3/secrets/raw/${SECRET_NAME}`);
	assert.equal(new URL(c).pathname, `/api/v3/secrets/raw/${SECRET_NAME}`);
	// All three URL bodies (path?query) must be byte-identical.
	assert.equal(a.replace(/\/$/, ''), b.replace(/\/$/, ''));
	assert.equal(a.replace(/\/$/, ''), c.replace(/\/$/, ''));
});

test('buildSecretReadUrl omits the `type` query parameter entirely', () => {
	const url = buildSecretReadUrl({
		apiUrl: 'https://secrets.rebuildup.dev',
		workspaceId: 'ws',
		environment: 'dev',
	});
	const params = new URL(url).searchParams;
	assert.equal(params.has('type'), false, '`type` must not appear in query');
	assert.equal(params.get('type'), null);
	// Also pin against accidental reintroduction with either explicit value.
	assert.equal(
		url.includes('type=personal'),
		false,
		'`type=personal` must not be reintroduced (regression guard)',
	);
	assert.equal(
		url.includes('type=shared'),
		false,
		'`type=shared` must not be introduced (Infisical API rejects it)',
	);
});

test('buildSecretReadUrl does not add or remove params across dev and prod', () => {
	const dev = new URL(
		buildSecretReadUrl({
			apiUrl: 'https://secrets.rebuildup.dev',
			workspaceId: 'ws',
			environment: 'dev',
		}),
	).searchParams;
	const prod = new URL(
		buildSecretReadUrl({
			apiUrl: 'https://secrets.rebuildup.dev',
			workspaceId: 'ws',
			environment: 'prod',
		}),
	).searchParams;
	const devKeys = [...dev.keys()].sort();
	const prodKeys = [...prod.keys()].sort();
	assert.deepEqual(prodKeys, devKeys);
	// Only the value of `environment` should differ.
	assert.equal(dev.get('environment'), 'dev');
	assert.equal(prod.get('environment'), 'prod');
});

// interpretReadResponse — pure seam for the readSecret response handler.
// Pins the existing G1 contract for how the script interprets the
// `httpsGetJson` result for source (dev) and target (prod) reads.

test('interpretReadResponse: source/dev 404 + allowMissing=false throws', () => {
	// The real `httpsGetJson` returns `null` when allowMissing is true; with
	// allowMissing=false, a 404 surfaces as an HTTP-error rejection. From
	// interpretReadResponse's standpoint the failure case is the same shape:
	// response is undefined (because the caller propagated an Error) and
	// allowMissing is false → must throw with environment context.
	assert.throws(
		() => interpretReadResponse({ response: undefined, allowMissing: false, environment: 'dev' }),
		new RegExp(`${SECRET_NAME} is missing or empty in environment=dev`),
	);
});

test('interpretReadResponse: target/prod 404 + allowMissing=true returns null', () => {
	// First-write idempotency: prod may not yet have BETTER_AUTH_SECRET
	// (no prior write). The script must treat that as "absent, OK to write".
	const result = interpretReadResponse({ response: null, allowMissing: true, environment: 'prod' });
	assert.equal(result, null);
});

test('interpretReadResponse: target/prod 404 + allowMissing=false throws', () => {
	assert.throws(
		() => interpretReadResponse({ response: null, allowMissing: false, environment: 'prod' }),
		new RegExp(`${SECRET_NAME} is missing or empty in environment=prod`),
	);
});

test('interpretReadResponse: 200 with empty secretValue throws', () => {
	assert.throws(
		() =>
			interpretReadResponse({
				response: { secretValue: '' },
				allowMissing: false,
				environment: 'dev',
			}),
		new RegExp(`${SECRET_NAME} is missing or empty in environment=dev`),
	);
});

test('interpretReadResponse: 200 with non-string secretValue throws', () => {
	assert.throws(
		() =>
			interpretReadResponse({
				response: { secretValue: 12345 },
				allowMissing: false,
				environment: 'dev',
			}),
		new RegExp(`${SECRET_NAME} is missing or empty in environment=dev`),
	);
});

test('interpretReadResponse: 200 with valid secretValue returns the value', () => {
	const value = 'placeholder-not-a-real-secret';
	const result = interpretReadResponse({
		response: { secretValue: value },
		allowMissing: false,
		environment: 'dev',
	});
	assert.equal(result, value);
});
