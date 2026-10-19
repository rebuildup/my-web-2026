/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * CSP Report-Only on real Worker responses (Issue #447).
 *
 * The unit suite pins the policy value; this suite proves the header
 * actually reaches the responses clients receive through the same
 * single choke point as the other security headers. It intentionally
 * checks BOTH sides:
 *
 *   - positive: the shipped surfaces carry the header (SSR documents,
 *     the Tool shell, the Admin document, the external boundary);
 *   - negative: the policy does not carry an origin nothing in this
 *     repository uses, and it is Report-Only rather than an unannounced
 *     enforcing policy.
 *
 * No production origin is touched. Every request runs in the local
 * workerd pool with the test bindings from `vitest.config.ts`.
 */
const REPORT_ONLY = 'content-security-policy-report-only';
const ENFORCING = 'content-security-policy';
const SELF_FRAME = "frame-ancestors 'self'";
const NONE_FRAME = "frame-ancestors 'none'";

async function headersOf(path: string) {
	const res = await SELF.fetch(`https://rebuildup.dev${path}`, { redirect: 'manual' });
	return { status: res.status, headers: res.headers };
}

describe('CSP Report-Only — presence (Issue #447)', () => {
	it('emits the Report-Only policy on a public SSR document', async () => {
		const { status, headers } = await headersOf('/contact');
		expect(status).toBe(200);

		const policy = headers.get(REPORT_ONLY);
		expect(policy).not.toBeNull();
		expect(policy).toContain("default-src 'self'");
		expect(policy).toContain('https://www.googletagmanager.com');
		expect(policy).toContain('https://fonts.googleapis.com');
		expect(policy).toContain('https://fonts.gstatic.com');
		expect(policy).toContain("frame-src 'self'");
		// The enforcing policy remains the separate #448 header.
		expect(headers.get(ENFORCING)).toBe(SELF_FRAME);
	});

	it('keeps the same-origin Tool iframe loadable from the shell', async () => {
		const { status, headers } = await headersOf('/tools/prototype');
		expect(status).toBe(200);
		expect(headers.get(REPORT_ONLY)).toContain("frame-src 'self'");
		expect(headers.get(ENFORCING)).toBe(SELF_FRAME);
	});

	it('covers the Admin surface without changing its frame denial', async () => {
		const { status, headers } = await headersOf('/admin/login');
		expect(status).toBe(200);
		expect(headers.get(REPORT_ONLY)).toContain("default-src 'self'");
		expect(headers.get(ENFORCING)).toBe(NONE_FRAME);
	});

	it('reaches the external boundary too (single choke point)', async () => {
		const { status, headers } = await headersOf('/api/v1/health');
		expect(status).toBe(200);
		expect(headers.get(REPORT_ONLY)).not.toBeNull();
	});
});

describe('CSP Report-Only — the negative direction (Issue #447)', () => {
	it('does not claim an origin nothing in the repository uses', async () => {
		const { headers } = await headersOf('/contact');
		const policy = headers.get(REPORT_ONLY) ?? '';
		expect(policy).not.toContain('https://example.invalid');
		expect(policy).not.toContain("'unsafe-eval'");
		expect(policy).not.toMatch(/(?:^|[\s;])[*](?:[\s;]|$)/);
	});

	it('is Report-Only, not an enforcing policy', async () => {
		const { headers } = await headersOf('/contact');
		// The only enforcing directive this site ships is #448's
		// frame-ancestors. Script/style enforcement is exactly what the
		// observation window is measuring.
		expect(headers.get(ENFORCING)).toBe(SELF_FRAME);
		expect(headers.get(REPORT_ONLY)).not.toContain('frame-ancestors');
	});
});

describe('CSP Report-Only measurements for the PR report (Issue #447)', () => {
	it('prints the measured matrix for the verification report', async () => {
		const paths = ['/contact', '/tools/prototype', '/admin/login', '/api/v1/health'];
		const rows: Array<Record<string, string>> = [];
		for (const path of paths) {
			const { status, headers } = await headersOf(path);
			rows.push({
				path,
				status: String(status),
				'report-only': headers.get(REPORT_ONLY) ?? '(absent)',
				enforcing: headers.get(ENFORCING) ?? '(absent)',
			});
		}
		console.log(`CSP_REPORT_ONLY_MEASUREMENT ${JSON.stringify(rows)}`);
		expect(rows).toHaveLength(paths.length);
		expect(rows.every((row) => row['report-only'] !== '(absent)')).toBe(true);
	});
});
