import { expect, test } from '@playwright/test';

/**
 * Icon family in a real browser (Issue #504).
 *
 * The static gate proves the declared contract is coherent and the
 * workerd integration test proves the SSR document carries it. Neither
 * proves the last hop: that a browser actually resolves each `<link>`,
 * decodes the PNG (a wrong `sizes`, a 404 or a truncated file all render
 * as a 0×0 image), and fetches the manifest as JSON.
 *
 * Runs against the local `pnpm preview` server (see
 * playwright.config.ts#webServer) and against any deployed URL, so the
 * same spec is the local check and a production smoke check.
 *
 * No secrets are involved: the manifest and the icon files are public
 * static assets, and this spec reads nothing but `document.head`.
 */

const APPLE_TOUCH_SIZES = ['120x120', '152x152', '167x167', '180x180'];

/** `<link>` attributes the live document exposes, keyed by `rel`. */
async function iconLinks(page: import('@playwright/test').Page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('head link')]
			.map((element) => ({
				rel: element.getAttribute('rel') ?? '',
				type: element.getAttribute('type'),
				sizes: element.getAttribute('sizes'),
				href: element.getAttribute('href'),
			}))
			.filter(
				(link) => link.rel === 'icon' || link.rel === 'apple-touch-icon' || link.rel === 'manifest',
			),
	);
}

test.describe('app icons', () => {
	test('the document declares the favicon, PNG fallbacks, Apple Touch Icons and the manifest', async ({
		page,
	}) => {
		await page.goto('/contact');
		const links = await iconLinks(page);

		expect(links).toContainEqual(
			expect.objectContaining({ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }),
		);
		expect(links.filter((link) => link.rel === 'manifest')).toHaveLength(1);
		expect(links.find((link) => link.rel === 'manifest')?.href).toBe('/site.webmanifest');

		for (const size of ['16x16', '32x32']) {
			expect(links).toContainEqual(
				expect.objectContaining({ rel: 'icon', type: 'image/png', sizes: size }),
			);
		}
		expect(
			links
				.filter((link) => link.rel === 'apple-touch-icon')
				.map((l) => l.sizes)
				.sort(),
		).toEqual(APPLE_TOUCH_SIZES);
	});

	test('every declared icon resolves to a decodable image at its declared size', async ({
		page,
		request,
	}) => {
		await page.goto('/contact');
		const links = await iconLinks(page);
		const rasters = links.filter(
			(link) =>
				link.rel !== 'manifest' && link.href?.startsWith('/icons/') && link.type === 'image/png',
		);
		expect(rasters.length).toBeGreaterThan(0);

		for (const link of rasters) {
			const response = await request.get(link.href as string);
			expect(response.status(), `${link.href} should be served`).toBe(200);
			expect(response.headers()['content-type']).toContain('image/png');
		}

		// Decode them the way the browser does, so a truncated or
		// mis-sized file fails here instead of silently in a launcher.
		for (const link of rasters) {
			const size = await page.evaluate(
				async (href) =>
					await new Promise<{ width: number; height: number } | null>((resolve) => {
						const image = new Image();
						image.onload = () => resolve({ width: image.width, height: image.height });
						image.onerror = () => resolve(null);
						image.src = href;
					}),
				link.href as string,
			);
			expect(size, `${link.href} should decode`).not.toBeNull();
			const [declared] = (link.sizes as string).split('x');
			expect(size?.width, `${link.href} should be ${link.sizes}`).toBe(Number(declared));
		}
	});

	test('the SVG favicon still resolves (Issue #285 regression)', async ({ request }) => {
		const response = await request.get('/favicon.svg');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('image/svg+xml');
	});

	test('the manifest is served as JSON and names only shipped icons', async ({ page, request }) => {
		await page.goto('/contact');
		const response = await request.get('/site.webmanifest');
		expect(response.status()).toBe(200);
		const manifest = JSON.parse(await response.text());

		expect(manifest.name).toBe('my-web-2026');
		expect(manifest.start_url).toBe('/');
		expect(manifest.display).toBe('standalone');
		expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes).sort()).toEqual([
			'192x192',
			'512x512',
			'512x512',
		]);
		// The member SET, not only the member values: an affordance a
		// value assertion cannot see (`share_target`, `shortcuts`,
		// `display_override`, `related_applications`, …) would ship an
		// obligation this ticket never decided. Asserted on the served
		// bytes, so a stale build output cannot pass it.
		expect(Object.keys(manifest).sort()).toEqual([
			'background_color',
			'dir',
			'display',
			'icons',
			'id',
			'lang',
			'name',
			'scope',
			'short_name',
			'start_url',
			'theme_color',
		]);
		// No offline affordance is claimed or installed. Chromium exposes
		// `navigator.serviceWorker` on every secure context (localhost
		// included), so the API existing proves nothing — the assertion is
		// that nothing is registered and nothing controls the page.
		const registrations = await page.evaluate(
			async () => (await navigator.serviceWorker.getRegistrations()).length,
		);
		expect(registrations).toBe(0);
		expect(await page.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);

		for (const icon of manifest.icons) {
			const iconResponse = await request.get(icon.src);
			expect(iconResponse.status(), `${icon.src} should be served`).toBe(200);
		}
	});

	test('the browser-chrome tint is appearance-conditioned', async ({ page }) => {
		await page.goto('/contact');
		const themeColors = await page.evaluate(() =>
			[...document.querySelectorAll('meta[name="theme-color"]')].map((element) => ({
				media: element.getAttribute('media'),
				content: element.getAttribute('content'),
			})),
		);
		expect(themeColors.map((meta) => meta.media).sort()).toEqual([
			'(prefers-color-scheme: dark)',
			'(prefers-color-scheme: light)',
		]);
	});
});
