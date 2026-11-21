import { describe, expect, it } from 'vitest';
import { parseProfileStack } from './profile-stack';

/**
 * `parseProfileStack` — the `quality/profile.yaml` `stack:` reader
 * (Issue #381). The page renders whatever this parser returns, so
 * the block boundary and the quoting rules are pinned here.
 */
describe('parseProfileStack', () => {
	it('reads every key of the real profile stack block', () => {
		const yaml = [
			'# comment',
			'schema_version: 1',
			'',
			'stack:',
			'  runtime: cloudflare-workers@2026-09-07',
			'  framework: tanstack-start@1.168.x',
			"  worker_test: '@cloudflare/vitest-plugin@1.1.x'",
			'  package_manager: pnpm@12.3.4',
			'',
			'gates:',
			'  fast:',
			'    command: pnpm run validate:fast',
		].join('\n');

		expect(parseProfileStack(yaml)).toEqual({
			runtime: 'cloudflare-workers@2026-09-07',
			framework: 'tanstack-start@1.168.x',
			worker_test: '@cloudflare/vitest-plugin@1.1.x',
			package_manager: 'pnpm@12.3.4',
		});
	});

	it('stops at the first non-pair line so later blocks cannot leak in', () => {
		const yaml = ['stack:', '  runtime: workers@1', 'other_key: value', '  late: nope'].join('\n');
		expect(parseProfileStack(yaml)).toEqual({ runtime: 'workers@1' });
	});

	it('returns an empty map when the block is absent', () => {
		expect(parseProfileStack('schema_version: 1\ngates:\n  fast: {}\n')).toEqual({});
	});

	it('returns an empty map for an empty stack block', () => {
		expect(parseProfileStack('stack:\ngates:\n')).toEqual({});
	});
});
