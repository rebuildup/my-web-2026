import { expect, test } from '@playwright/test';

/**
 * CSP Report-Only in a real browser (Issue #447).
 *
 * The workerd suite proves the header the Worker emits. This spec proves
 * the two things only a browser can answer:
 *
 *   1. POSITIVE — a normal page load (TanStack Start document, hydration
 *      bundle, Panda CSS, Google Fonts, GA4) produces no
 *      `securitypolicyviolation` event under the shipped policy.
 *   2. NEGATIVE — a resource from an origin the policy does not list is
 *      REPORTED (`disposition: 'report'`) and is not blocked, which is
 *      what "Report-Only" has to mean in practice.
 *
 * `https://csp-probe.invalid/...` is reserved by RFC 2606 for exactly
 * this kind of local probe: it never resolves, so the run touches no
 * external service. No credential, cookie, or production origin is
 * involved; the base URL comes from `playwright.config.ts`.
 */
interface CspViolationRecord {
	readonly effectiveDirective: string;
	readonly disposition: string;
	readonly blockedURI: string;
}

type CspProbeWindow = Window & { __cspViolations?: CspViolationRecord[] };

/** Record every CSP event for the lifetime of each document. */
async function recordCspViolations(page: import('@playwright/test').Page): Promise<void> {
	await page.addInitScript(() => {
		const probeWindow = window as CspProbeWindow;
		probeWindow.__cspViolations = [];
		document.addEventListener('securitypolicyviolation', (event) => {
			probeWindow.__cspViolations?.push({
				effectiveDirective: event.effectiveDirective,
				disposition: event.disposition,
				blockedURI: event.blockedURI,
			});
		});
	});
}

test.describe('CSP Report-Only — browser observation (Issue #447)', () => {
	test('a normal page load reports no violation', async ({ page }) => {
		await recordCspViolations(page);
		const response = await page.goto('/contact');
		expect(response?.status()).toBe(200);
		await page.waitForLoadState('load');

		// Give late beacons (GA4, font swaps) a chance to emit a report
		// before the assertion. A missing network resource is not a CSP
		// violation; only the policy's own event is collected.
		await page.waitForTimeout(1_500);
		const violations = await page.evaluate(() => (window as CspProbeWindow).__cspViolations ?? []);
		expect(violations.filter((violation) => violation.disposition === 'report')).toEqual([]);

		// A same-origin image is allowed explicitly (`img-src 'self'`), so
		// the positive case also exercises an actual subresource load.
		const loaded = await page.evaluate(
			() =>
				new Promise<boolean>((resolve) => {
					const image = new Image();
					image.onload = () => resolve(true);
					image.onerror = () => resolve(false);
					image.src = '/favicon.svg';
				}),
		);
		expect(loaded).toBe(true);
		await page.waitForTimeout(200);
		const afterImage = await page.evaluate(() => (window as CspProbeWindow).__cspViolations ?? []);
		expect(afterImage.filter((violation) => violation.disposition === 'report')).toEqual([]);
	});

	test('an unlisted image origin is reported and not blocked', async ({ page }) => {
		await recordCspViolations(page);
		await page.goto('/contact');
		await page.waitForLoadState('domcontentloaded');

		const violation = await page.evaluate(
			() =>
				new Promise<CspViolationRecord | null>((resolve) => {
					const probeWindow = window as CspProbeWindow;
					const record = (event: SecurityPolicyViolationEvent) => {
						if (event.effectiveDirective !== 'img-src') return;
						document.removeEventListener('securitypolicyviolation', record);
						resolve({
							effectiveDirective: event.effectiveDirective,
							disposition: event.disposition,
							blockedURI: event.blockedURI,
						});
					};
					const existing = (probeWindow.__cspViolations ?? []).find(
						(entry) => entry.effectiveDirective === 'img-src',
					);
					if (existing) return resolve(existing);

					document.addEventListener('securitypolicyviolation', record);
					const image = new Image();
					image.src = 'https://csp-probe.invalid/pixel.png';
					setTimeout(() => {
						document.removeEventListener('securitypolicyviolation', record);
						resolve(null);
					}, 5_000);
				}),
		);

		expect(violation).not.toBeNull();
		expect(violation?.effectiveDirective).toBe('img-src');
		// Report-Only must NOT block the load; it only reports it.
		expect(violation?.disposition).toBe('report');
		expect(violation?.blockedURI).toContain('csp-probe.invalid');

		// The page is still alive after the report: no enforcement happened.
		await expect(page.locator('h1')).toHaveCount(1);
	});

	test('the response header names the measured origins and stays report-only', async ({
		request,
	}) => {
		const response = await request.get('/contact');
		const policy = response.headers()['content-security-policy-report-only'];
		expect(policy).toBeTruthy();
		expect(policy).toContain("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
		expect(policy).toContain('https://fonts.googleapis.com');
		expect(policy).toContain('https://fonts.gstatic.com');
		expect(policy).toContain("frame-src 'self'");
		expect(policy).not.toContain("'unsafe-eval'");
		expect(policy).not.toContain('https://example.invalid');
		expect(policy).not.toContain('report-uri');
	});
});
