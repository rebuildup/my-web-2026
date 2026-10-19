import { describe, expect, it } from 'vitest';
import {
	CSP_REPORT_ONLY_HEADER,
	applyContentSecurityPolicyReportOnly,
	contentSecurityPolicyValue,
	mediaOriginFrom,
} from './content-security-policy';

/**
 * CSP Report-Only policy contract (Issue #447).
 *
 * The policy is an OBSERVATION contract: it must name exactly the
 * origins the shipped surfaces use, and nothing else. These tests pin
 * both directions because the failure modes are asymmetric:
 *
 *   - a missing origin creates noise (a real resource reported as a
 *     violation) and hides the resources that actually need attention;
 *   - an extra origin silently widens the policy before it is ever
 *     enforced, which is the thing Report-Only exists to avoid.
 *
 * The workerd suite (`test/integration/csp-report-only.test.ts`) proves
 * the header reaches real responses; this file pins the value itself.
 */
describe('contentSecurityPolicyValue', () => {
	const value = contentSecurityPolicyValue();

	it('keeps the base policy on self', () => {
		expect(value).toContain("default-src 'self'");
		expect(value).toContain("frame-src 'self'");
		expect(value).toContain("base-uri 'self'");
		expect(value).toContain("form-action 'self'");
		expect(value).toContain("object-src 'none'");
	});

	it('allows the measured TanStack UI, font and analytics origins', () => {
		expect(value).toContain("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
		expect(value).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
		expect(value).toContain("font-src 'self' https://fonts.gstatic.com");
		expect(value).toContain('https://*.google-analytics.com');
		expect(value).toContain('https://*.analytics.google.com');
		expect(value).toContain('https://*.googletagmanager.com');
	});

	it('does not pre-allow an unobserved origin or a blanket wildcard', () => {
		expect(value).not.toContain('https://example.invalid');
		expect(value).not.toContain("'unsafe-eval'");
		expect(value).not.toMatch(/(?:^|[\s;])[*](?:[\s;]|$)/);
	});

	it('does not invent a report collector', () => {
		// No endpoint exists, so a report-uri / report-to would send
		// visitor data to an ownerless destination.
		expect(value).not.toContain('report-uri');
		expect(value).not.toContain('report-to');
	});

	it('adds only the origin of a configured media base URL', () => {
		const withMedia = contentSecurityPolicyValue({
			mediaBaseUrl: 'https://media.rebuildup.dev/portfolio/',
		});
		expect(withMedia).toContain('img-src ');
		expect(withMedia).toContain('https://media.rebuildup.dev');
		expect(withMedia).not.toContain('/portfolio/');
	});

	it('produces a stable directive order', () => {
		expect(value.split('; ')).toEqual([
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
			"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
			"img-src 'self' https://*.google-analytics.com https://*.googletagmanager.com",
			"font-src 'self' https://fonts.gstatic.com",
			"connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
			"frame-src 'self'",
			"object-src 'none'",
			"base-uri 'self'",
			"form-action 'self'",
		]);
	});
});

describe('mediaOriginFrom', () => {
	it('normalises a configured media URL to its origin', () => {
		expect(mediaOriginFrom('https://media.example.com/path?q=1')).toBe('https://media.example.com');
	});

	it('returns null for absent or malformed values', () => {
		expect(mediaOriginFrom(undefined)).toBeNull();
		expect(mediaOriginFrom('')).toBeNull();
		expect(mediaOriginFrom('not a url')).toBeNull();
		expect(mediaOriginFrom('data:text/plain,hello')).toBeNull();
	});
});

describe('applyContentSecurityPolicyReportOnly', () => {
	it('sets the Report-Only header, never the enforcing one', () => {
		const response = new Response('hello', { headers: { 'content-type': 'text/html' } });
		const applied = applyContentSecurityPolicyReportOnly(response, {
			mediaBaseUrl: 'https://media.example.com',
		});
		expect(applied.headers.get(CSP_REPORT_ONLY_HEADER)).toBe(
			contentSecurityPolicyValue({ mediaBaseUrl: 'https://media.example.com' }),
		);
		expect(applied.headers.has('content-security-policy')).toBe(false);
	});

	it('leaves an existing Report-Only policy untouched', () => {
		const response = new Response('hello', {
			headers: { [CSP_REPORT_ONLY_HEADER]: "default-src 'none'" },
		});
		const applied = applyContentSecurityPolicyReportOnly(response);
		expect(applied.headers.get(CSP_REPORT_ONLY_HEADER)).toBe("default-src 'none'");
	});

	it('does not disturb the enforcing frame-ancestors policy', () => {
		const response = new Response('hello', {
			headers: { 'content-security-policy': "frame-ancestors 'none'" },
		});
		const applied = applyContentSecurityPolicyReportOnly(response);
		expect(applied.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
		expect(applied.headers.get(CSP_REPORT_ONLY_HEADER)).toBeTruthy();
	});
});
