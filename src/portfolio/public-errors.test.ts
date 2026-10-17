import { describe, expect, it, vi } from 'vitest';
import { PORTFOLIO_UNAVAILABLE, createReferenceId, withPublicErrorBoundary } from './public-errors';

/**
 * Unit tests for the Portfolio public error boundary (Issue #457).
 *
 * The failure payloads are the real shapes a public visitor must
 * never see: a D1 message carrying SQL and a table name, and an R2
 * message carrying the bucket name. Each is asserted absent from the
 * message that would be serialised into the `/_serverFn/*` payload
 * and into the rendered error screen.
 */
const SQL_LEAK = 'D1_ERROR: no such table: portfolio_project: SQLITE_ERROR';
const BUCKET_LEAK = 'The specified bucket does not exist. (my-web-2026-media)';

describe('withPublicErrorBoundary (Issue #457)', () => {
	it('passes a successful read through untouched', async () => {
		const value = await withPublicErrorBoundary('list', async () => ({ projects: [] }));
		expect(value).toEqual({ projects: [] });
	});

	it('rethrows a safe, reference-carrying error instead of the internal one', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const thrown = await withPublicErrorBoundary('project', async () => {
				throw new Error(SQL_LEAK);
			}).catch((err: unknown) => err as Error);
			expect(thrown).toBeInstanceOf(Error);
			expect(thrown.message).toMatch(
				new RegExp(`^${PORTFOLIO_UNAVAILABLE} \\(ref=[0-9a-f]{8}\\)$`),
			);
			expect(thrown.message).not.toContain(SQL_LEAK);
			expect(thrown.message).not.toContain('SQLITE_ERROR');
			expect(thrown.message).not.toContain('portfolio_project');
		} finally {
			spy.mockRestore();
		}
	});

	it('never echoes an R2 bucket name', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const thrown = await withPublicErrorBoundary('list', async () => {
				throw new Error(BUCKET_LEAK);
			}).catch((err: unknown) => err as Error);
			expect(thrown.message).not.toContain('my-web-2026');
			expect(thrown.message).not.toContain(BUCKET_LEAK);
		} finally {
			spy.mockRestore();
		}
	});

	it('logs the internal error with the same reference the visitor sees', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const thrown = await withPublicErrorBoundary('adjacent', async () => {
				throw new Error(SQL_LEAK);
			}).catch((err: unknown) => err as Error);
			expect(spy).toHaveBeenCalledTimes(1);
			const [label, logged] = spy.mock.calls[0] as [string, unknown];
			const reference = /\(ref=([0-9a-f]{8})\)/.exec(thrown.message)?.[1];
			expect(label).toContain(`ref=${reference}`);
			expect(label).not.toContain(SQL_LEAK);
			// The internal detail stays available to the operator.
			expect((logged as Error).message).toBe(SQL_LEAK);
		} finally {
			spy.mockRestore();
		}
	});

	it('issues a distinct reference per failure', () => {
		expect(createReferenceId()).not.toBe(createReferenceId());
		expect(createReferenceId()).toMatch(/^[0-9a-f]{8}$/);
	});
});
