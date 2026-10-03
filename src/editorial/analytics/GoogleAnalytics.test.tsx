import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	GoogleAnalytics,
	__resetCapturedMeasurementIdForTests,
	captureMeasurementId,
} from './GoogleAnalytics';

/**
 * GoogleAnalytics component contract (Issue #171).
 *
 *   - When `measurementId` is the empty string or `undefined`,
 *     the component renders nothing (`null`).
 *   - When `measurementId` is a non-empty `G-XXXXXXX` string,
 *     the component renders the GA4 `<script async src=...>` tag
 *     and the inline `gtag('config', ...)` init script.
 *   - The captured SSR measurement ID is write-once: a falsy
 *     client-side stub never overwrites the captured SSR value.
 *
 * The component has zero router / DOM dependencies, so this test
 * runs in the workerd pool with no shims. The same component is
 * also exercised in `pnpm run test:client` (see
 * `vitest.client.config.ts`) for the happy-dom render path when
 * real `<script>` tag execution is required.
 */

describe('GoogleAnalytics — captureMeasurementId', () => {
	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
	});

	it('captures the first non-empty value', () => {
		expect(captureMeasurementId(undefined)).toBeUndefined();
		expect(captureMeasurementId('G-ABCDEFG')).toBe('G-ABCDEFG');
	});

	it('returns the captured value on subsequent calls', () => {
		captureMeasurementId('G-ABCDEFG');
		expect(captureMeasurementId('G-ZZZZZZZ')).toBe('G-ABCDEFG');
	});

	it('does not capture the empty string', () => {
		expect(captureMeasurementId('')).toBeUndefined();
		expect(captureMeasurementId('G-LATER')).toBe('G-LATER');
	});

	it('does not overwrite an existing capture with undefined', () => {
		captureMeasurementId('G-ABCDEFG');
		expect(captureMeasurementId(undefined)).toBe('G-ABCDEFG');
	});

	it('treats whitespace-only strings as falsy', () => {
		// Whitespace-only is not a valid GA ID; do not capture.
		expect(captureMeasurementId('   ')).toBeUndefined();
		expect(captureMeasurementId('G-VALID')).toBe('G-VALID');
	});
});

describe('GoogleAnalytics — render output', () => {
	beforeEach(() => {
		__resetCapturedMeasurementIdForTests();
	});

	afterEach(() => {
		__resetCapturedMeasurementIdForTests();
	});

	it('renders nothing when measurementId is undefined', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics />);
		expect(html).toBe('');
	});

	it('renders nothing when measurementId is the empty string', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="" />);
		expect(html).toBe('');
	});

	it('renders the bootstrap script and the init script when measurementId is set', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="G-ABCDEFG" />);
		expect(html).toContain('async=""');
		expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEFG"');
		expect(html).toContain('window.dataLayer = window.dataLayer || [];');
		expect(html).toContain('function gtag(){dataLayer.push(arguments);}');
		expect(html).toContain("gtag('js', new Date());");
		expect(html).toContain("gtag('config', 'G-ABCDEFG');");
	});

	it('preserves the SSR-captured value across re-renders with no measurementId', () => {
		// Simulates SSR capture, then a subsequent client-side
		// navigation where the loader returns undefined (the
		// `cloudflare:workers` stub).
		renderToStaticMarkup(<GoogleAnalytics measurementId="G-FIRST" />);
		const html = renderToStaticMarkup(<GoogleAnalytics />);
		expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-FIRST"');
		expect(html).toContain("gtag('config', 'G-FIRST');");
	});

	it('encodes the measurement ID into the bootstrap URL', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="G-A B/C" />);
		// Spaces and slashes must be percent-encoded in the URL.
		expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-A%20B%2FC"');
	});

	it('escapes a single-quote character in the inline config call', () => {
		const html = renderToStaticMarkup(<GoogleAnalytics measurementId="G-ABC'DEF" />);
		// The single quote must be escaped to avoid breaking the
		// `gtag('config', '...')` literal in the init script.
		expect(html).not.toContain("gtag('config', 'G-ABC'DEF');");
		expect(html).toContain("gtag('config', 'G-ABC\\'DEF');");
	});
});
