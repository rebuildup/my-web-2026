/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Icon family on the rendered document (Issue #504).
 *
 * The unit gate (`scripts/check-app-icons.mjs`) proves the *declared*
 * contract is coherent; these tests prove the *shipped* document actually
 * carries it. Only `SELF.fetch` sees the final HTML, so a link that a
 * head-merge rule drops, a meta a dedupe collapses, or a route that
 * shadows the root head would survive every static check and still ship
 * an icon-less page.
 *
 * Attribute order is not asserted: `HeadContent` renders whatever React
 * emits, and the contract is "these attributes exist on these tags", not
 * the order they appear in.
 */

interface HeadTag {
	tag: 'link' | 'meta';
	attrs: Record<string, string>;
}

/** Every `<link>` / `<meta>` the SSR document emitted, as attribute maps. */
function headTags(html: string): HeadTag[] {
	return [...html.matchAll(/<(link|meta)\b([^>]*)>/g)].map(([, tag, rawAttrs]) => {
		const attrs: Record<string, string> = {};
		for (const [, name, value] of rawAttrs.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
			attrs[name.toLowerCase()] = value;
		}
		return { tag: tag as HeadTag['tag'], attrs };
	});
}

async function fetchContactHtml(): Promise<string> {
	// `/contact` rather than `/`: its loader reads repo-controlled JSON,
	// not D1, so this file needs no schema bootstrap (the same reason
	// `html-cache-policy.test.ts` uses it).
	const res = await SELF.fetch('https://example.com/contact');
	expect(res.status).toBe(200);
	return res.text();
}

describe('Web App Manifest + icon links (Issue #504)', () => {
	it('keeps the Issue #285 SVG favicon and adds the PNG raster fallback', async () => {
		const links = headTags(await fetchContactHtml())
			.map((tag) => tag.attrs)
			.filter((attrs) => attrs.rel === 'icon');

		expect(links).toContainEqual(
			expect.objectContaining({ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }),
		);
		// Raster fallback for embedders that do not read SVG icons.
		for (const size of ['16x16', '32x32']) {
			expect(links).toContainEqual(
				expect.objectContaining({ rel: 'icon', type: 'image/png', sizes: size }),
			);
		}
	});

	it('declares every Apple Touch Icon size iOS asks for', async () => {
		const links = headTags(await fetchContactHtml())
			.map((tag) => tag.attrs)
			.filter((attrs) => attrs.rel === 'apple-touch-icon');

		// 180 iPhone, 167 / 152 iPad, 120 legacy iOS + Spotlight.
		expect(links.map((attrs) => attrs.sizes).sort()).toEqual([
			'120x120',
			'152x152',
			'167x167',
			'180x180',
		]);
		for (const attrs of links) {
			expect(attrs.href).toMatch(/^\/icons\/apple-touch-icon-\d+x\d+\.png$/);
			expect(attrs.type).toBe('image/png');
		}
	});

	it('links the manifest exactly once', async () => {
		const links = headTags(await fetchContactHtml())
			.map((tag) => tag.attrs)
			.filter((attrs) => attrs.rel === 'manifest');

		expect(links).toEqual([{ rel: 'manifest', href: '/site.webmanifest' }]);
	});

	it('declares one theme-color meta per appearance, both token values', async () => {
		const metas = headTags(await fetchContactHtml())
			.filter((tag) => tag.attrs.name === 'theme-color')
			.map((tag) => tag.attrs);

		// The site ships two appearances (Issue #290), so an unconditioned
		// single value would be wrong for half of the visitors. The
		// values are `bg.canvas` light / dark from
		// `src/editorial/semantic-tokens.ts`.
		expect(metas).toEqual([
			{
				name: 'theme-color',
				media: '(prefers-color-scheme: light)',
				content: '#ffffff',
			},
			{
				name: 'theme-color',
				media: '(prefers-color-scheme: dark)',
				content: '#0a0b0e',
			},
		]);
	});

	it('renders the icon family on a public page that declares its own head()', async () => {
		// `/contact` declares its own `head()` (title / description /
		// canonical / OGP). TanStack Router merges it over the root head,
		// so this is where a merge rule that drops the inherited icon
		// block would show up.
		const html = await fetchContactHtml();
		const hrefs = headTags(html)
			.map((tag) => tag.attrs)
			.filter((attrs) => attrs.rel === 'icon' || attrs.rel === 'apple-touch-icon')
			.map((attrs) => attrs.href);

		expect(hrefs).toContain('/favicon.svg');
		expect(hrefs.filter((href) => href?.startsWith('/icons/apple-touch-icon-'))).toHaveLength(4);
	});

	it('declares no offline affordance: no service-worker registration, no manifest offline member', async () => {
		const html = await fetchContactHtml();
		// The Worker serves the document; nothing in the SSR output may
		// advertise an offline contract this platform does not have.
		expect(html).not.toMatch(/serviceWorker\s*\.\s*register/);
		expect(html).not.toMatch(/rel=["']manifest["'][^>]*offline/i);
	});
});
