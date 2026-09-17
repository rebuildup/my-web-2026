import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemServiceStatus } from './model';
import { d1RowToStatus, safeProbe } from './probes';

/**
 * Unit tests for the safe D1 probe transform (Issue #19).
 *
 * These tests verify that:
 * - Every failure path (exception, empty result, unexpected value)
 *   collapses to `health: 'unreachable'`.
 * - The returned status never carries raw error messages, the
 *   binding identifier, or row internals — only the documented
 *   fields `id`, `health`, and (when successful) a stable `detail`.
 *
 * The probe runs in isolation from the real D1 binding; the
 * integration test in `test/integration/d1.test.ts` covers the
 * canonical SELECT 1 → 1 path through the live Worker.
 *
 * `console.error` is silenced inside the safeProbe failure tests
 * so the workerd test runner does not flood its output with the
 * intentionally-thrown probe failures.
 */

const SILENCE_PATTERN = /\[home\] .* probe failed/;

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
	consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	consoleErrorSpy?.mockRestore();
});

function findLoggedLabels(): string[] {
	const calls = consoleErrorSpy?.mock.calls ?? [];
	return calls
		.map((args: unknown[]) => args.map((a: unknown) => (typeof a === 'string' ? a : '')).join(' '))
		.filter((line: string) => SILENCE_PATTERN.test(line));
}

describe('d1RowToStatus', () => {
	it('maps the canonical { one: 1 } row to reachable', () => {
		expect(d1RowToStatus({ one: 1 })).toEqual({
			id: 'd1',
			health: 'ok',
			detail: 'SELECT 1 returned 1',
		});
	});

	it('maps an empty / null result to unreachable', () => {
		expect(d1RowToStatus(undefined)).toEqual({ id: 'd1', health: 'unreachable' });
		expect(d1RowToStatus(null)).toEqual({ id: 'd1', health: 'unreachable' });
	});

	it('maps an unexpected numeric value to unreachable', () => {
		expect(d1RowToStatus({ one: 2 })).toEqual({ id: 'd1', health: 'unreachable' });
		expect(d1RowToStatus({ one: 0 })).toEqual({ id: 'd1', health: 'unreachable' });
		expect(d1RowToStatus({ one: -1 })).toEqual({ id: 'd1', health: 'unreachable' });
	});

	it('maps a missing `one` field to unreachable', () => {
		expect(d1RowToStatus({})).toEqual({ id: 'd1', health: 'unreachable' });
		expect(d1RowToStatus({ two: 1 })).toEqual({ id: 'd1', health: 'unreachable' });
	});

	it('maps a non-object value to unreachable without throwing', () => {
		expect(d1RowToStatus('garbage')).toEqual({ id: 'd1', health: 'unreachable' });
		expect(d1RowToStatus(42)).toEqual({ id: 'd1', health: 'unreachable' });
		expect(d1RowToStatus(true)).toEqual({ id: 'd1', health: 'unreachable' });
		expect(d1RowToStatus([1])).toEqual({ id: 'd1', health: 'unreachable' });
	});

	it('never includes the row payload in the returned status', () => {
		const status: SystemServiceStatus = d1RowToStatus({
			one: 1,
			secret: 'leak-me',
			other: { nested: 'value' },
		});
		const serialized = JSON.stringify(status);
		expect(serialized).not.toContain('leak-me');
		expect(serialized).not.toContain('nested');
		expect(serialized).not.toContain('value');
		expect(serialized).not.toMatch(/binding|database|db|d1prepare/i);
	});
});

describe('safeProbe', () => {
	it('returns the mapped value when the probe resolves', async () => {
		const status = await safeProbe('d1', async () => ({ one: 1 }), d1RowToStatus, 'd1');
		expect(status).toEqual({
			id: 'd1',
			health: 'ok',
			detail: 'SELECT 1 returned 1',
		});
		expect(findLoggedLabels()).toHaveLength(0);
	});

	it('returns unreachable when the probe rejects with an Error', async () => {
		const status = await safeProbe(
			'd1',
			async () => {
				throw new Error('D1 is down');
			},
			d1RowToStatus,
			'd1',
		);
		expect(status).toEqual({ id: 'd1', health: 'unreachable' });
	});

	it('returns unreachable when the probe rejects with a non-Error value', async () => {
		const status = await safeProbe(
			'd1',
			async () => {
				// Simulate `throw "string"` — neither Error nor typed.
				throw 'string error';
			},
			d1RowToStatus,
			'd1',
		);
		expect(status).toEqual({ id: 'd1', health: 'unreachable' });
	});

	it('never leaks a binding-shaped error message to the returned status', async () => {
		const status = await safeProbe(
			'd1',
			async () => {
				throw new Error('D1_ERROR: connection refused to my-web-2026 database_id=secret');
			},
			d1RowToStatus,
			'd1',
		);
		expect(status).toEqual({ id: 'd1', health: 'unreachable' });
		const serialized = JSON.stringify(status);
		expect(serialized).not.toContain('D1_ERROR');
		expect(serialized).not.toContain('connection refused');
		expect(serialized).not.toContain('my-web-2026');
		expect(serialized).not.toContain('database_id');
		// The error message must reach the operator log instead so the
		// failure is debuggable in production.
		const labels = findLoggedLabels();
		expect(labels).toHaveLength(1);
		expect(labels[0]).toMatch(/d1/);
	});
});

describe('safeProbe composed with d1RowToStatus (full D1 path)', () => {
	function stubProbe(result: unknown): () => Promise<unknown> {
		return async () => result;
	}

	it('canonical happy path produces reachable', async () => {
		const status = await safeProbe('d1', stubProbe({ one: 1 }), d1RowToStatus, 'd1');
		expect(status).toEqual({
			id: 'd1',
			health: 'ok',
			detail: 'SELECT 1 returned 1',
		});
	});

	it('null result collapses to unreachable', async () => {
		const status = await safeProbe('d1', stubProbe(null), d1RowToStatus, 'd1');
		expect(status).toEqual({ id: 'd1', health: 'unreachable' });
	});

	it('rejection collapses to unreachable without leaking the message', async () => {
		const status = await safeProbe(
			'd1',
			async () => {
				throw new Error(
					'sensitive internal error: connection refused to 192.0.2.1 D1Database prepare() failed',
				);
			},
			d1RowToStatus,
			'd1',
		);
		expect(status).toEqual({ id: 'd1', health: 'unreachable' });
		const serialized = JSON.stringify(status);
		expect(serialized).not.toContain('sensitive');
		expect(serialized).not.toContain('192.0.2.1');
		expect(serialized).not.toContain('connection refused');
		expect(serialized).not.toContain('D1Database');
		expect(serialized).not.toContain('prepare');
	});
});
