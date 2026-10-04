import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyseFailure, redactLine } from './cf-build-status.mjs';

/**
 * `cf-build-status.mjs` unit tests (Issue #247).
 *
 * The helper is the replacement for dashboard-driven production
 * diagnosis, so the two properties that matter are:
 *
 *   1. it correctly locates the stage and first error of a failed
 *      build from raw `[ts, message]` lines, and
 *   2. it can never emit a credential, because redaction runs on
 *      every line before anything is returned or printed.
 */

const T = (n) => n * 1000;

describe('redactLine (Issue #247)', () => {
	it('redacts KEY=value style credentials', () => {
		assert.equal(redactLine('INFISICAL_TOKEN=abcdef123456'), 'INFISICAL_TOKEN=<redacted>');
		assert.equal(
			redactLine('BETTER_AUTH_SECRETS: 1:supersecretvalue'),
			'BETTER_AUTH_SECRETS: <redacted>',
		);
		assert.equal(
			redactLine('MY_WEB_2026_CONSUMER_API_KEY=abc123def456'),
			'MY_WEB_2026_CONSUMER_API_KEY=<redacted>',
		);
	});

	it('redacts bearer tokens and authorization headers', () => {
		assert.equal(
			redactLine('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'),
			'Authorization: Bearer <redacted>',
		);
		assert.match(redactLine('using Bearer abcdefghijklmnopqrstuvwx'), /Bearer <redacted>/);
	});

	it('redacts cookies', () => {
		const out = redactLine('Set-Cookie: __Secure-better-auth.session_token=abc; Path=/');
		assert.ok(!out.includes('abc'), 'cookie value must not survive');
		assert.ok(out.includes('<redacted>'));
	});

	it('leaves ordinary log lines untouched', () => {
		const line = '[+63.3s] bun install v1.2.15 (df017990)';
		assert.equal(redactLine(line), line);
		assert.equal(
			redactLine('[OK] Cloudflare Worker (live) final contract'),
			'[OK] Cloudflare Worker (live) final contract',
		);
	});
});

describe('analyseFailure (Issue #247)', () => {
	const buildStage = [
		[T(0), 'Initializing build environment...'],
		[T(1), 'Installing project dependencies: pnpm install --frozen-lockfile'],
		[T(2), 'Detected the following tools: nodejs@22.23.3, pnpm@12.3.4'],
	];

	it('reports no failure for a clean build', () => {
		const r = analyseFailure([...buildStage, [T(60), '✨ Success! Build completed.']]);
		assert.equal(r.failed, false);
		assert.equal(r.stage, null);
		assert.equal(r.firstError, null);
	});

	it('locates a build-command failure and its stage', () => {
		const lines = [
			...buildStage,
			[T(63), 'error: Unknown lockfile version  at bun.lock:2:22'],
			[T(63), 'Failed: error occurred while running build command'],
		];
		const r = analyseFailure(lines);
		assert.equal(r.failed, true);
		assert.equal(r.stage, 'build');
		assert.match(r.firstError, /Unknown lockfile version|bun\.lock/);
		assert.ok(r.context.length > 0, 'must include surrounding context');
	});

	it('locates a deploy-command failure and its stage', () => {
		const lines = [
			...buildStage,
			[T(65), '[deploy-with-secrets] mode=execute'],
			[T(67), '[FAIL] Cloudflare Worker (live) transition contract'],
			[
				T(67),
				'deploy-with-secrets failed: Production secret preflight failed (exit=1); deploy aborted',
			],
		];
		const r = analyseFailure(lines);
		assert.equal(r.failed, true);
		assert.equal(r.stage, 'deploy');
		assert.ok(r.context.some((c) => c.line.includes('deploy-with-secrets failed')));
	});

	it('extracts an exit code when the line carries one', () => {
		const r = analyseFailure([...buildStage, [T(70), 'Command failed with exit code 3']]);
		assert.equal(r.failed, true);
		assert.equal(r.exitCode, 3);
	});

	it('is safe on an empty log', () => {
		const r = analyseFailure([]);
		assert.equal(r.failed, false);
		assert.equal(r.stage, null);
	});

	it('redacts credentials inside the reported context', () => {
		const r = analyseFailure([
			...buildStage,
			[T(70), 'deploy failed: INFISICAL_TOKEN=leakedvalue123'],
			[T(70), 'Failed: error occurred while running deploy command'],
		]);
		const blob = JSON.stringify(r);
		assert.ok(!blob.includes('leakedvalue123'), 'credential must not reach the report');
		assert.ok(blob.includes('<redacted>'));
	});
});
