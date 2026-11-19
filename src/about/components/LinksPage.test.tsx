import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ABOUT_LINKS, ABOUT_LINK_GROUPS } from '../links';
import { LinksPage } from './LinksPage';

/**
 * `/links` page composition contract (Issue #390).
 *
 * Rendered through `renderToStaticMarkup` — the same SSR path the
 * Worker uses — so the assertions read the document a visitor
 * receives, not the component tree.
 */

describe('LinksPage', () => {
	const html = renderToStaticMarkup(<LinksPage />);

	it('renders one h1 and the canonical heading', () => {
		expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
		expect(html).toContain('リンク集 / Links');
	});

	it('renders every declared group with its links', () => {
		for (const group of ABOUT_LINK_GROUPS) {
			expect(html).toContain(`links-group-${group.id}`);
			for (const link of group.links) {
				expect(html).toContain(`href="${link.url}"`);
			}
		}
	});

	it('marks external links with target=_blank and a safe rel', () => {
		for (const link of ABOUT_LINKS.filter((l) => l.external)) {
			const anchor = new RegExp(`<a[^>]*href="${escapeRegExp(link.url)}"[^>]*>`);
			const tag = html.match(anchor)?.[0] ?? '';
			expect(tag, link.id).toContain('target="_blank"');
			expect(tag, link.id).toContain('rel="noopener noreferrer"');
		}
	});

	it('does not mark internal links as external', () => {
		for (const link of ABOUT_LINKS.filter((l) => !l.external)) {
			const anchor = new RegExp(`<a[^>]*href="${escapeRegExp(link.url)}"[^>]*>`);
			const tag = html.match(anchor)?.[0] ?? '';
			expect(tag, link.id).not.toContain('target=');
		}
	});

	it('routes contact-shaped requests to /contact and publishes no address', () => {
		expect(html).toContain('href="/contact"');
		expect(html).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
		expect(html).not.toContain('<form');
	});
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
