import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PortfolioMedia as PortfolioMediaData } from '../schema';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * Loading-mode contract for portfolio media (Issue #487).
 *
 * `PortfolioMediaFigure` is the only `<img>` renderer outside the
 * home surface, so it carries the second half of the same contract
 * `test/integration/lazy-media-contract.test.ts` proves for `/`:
 * every image states its own loading mode instead of relying on the
 * implicit `eager` UA default.
 *
 *   - cards on `/portfolio` are a lazy list — the caller keeps the
 *     default;
 *   - the single cover on `/portfolio/<slug>` is the page's hero
 *     media and must be `eager`;
 *   - the placeholder branch (`url === null`, or an `<img>` that has
 *     already fired `error`) renders no `<img>` at all, so a broken
 *     media entry cannot start a download.
 *
 * Pure SSR markup rendering — no DOM, so it runs in the workerd pool
 * that `pnpm run test` already uses.
 */
const BASE_MEDIA: PortfolioMediaData = {
	id: 'media-1',
	url: 'https://media.example.com/cover.webp',
	alt: 'aulymo cover',
	r2Key: 'portfolio/aulymo/cover.webp',
	contentType: 'image/webp',
	width: 1600,
	height: 900,
	caption: null,
	isCover: true,
	displayOrder: 0,
};

describe('PortfolioMediaFigure loading mode', () => {
	it('defaults to loading="lazy" with async decoding', () => {
		const html = renderToStaticMarkup(<PortfolioMediaFigure media={BASE_MEDIA} />);
		expect(html).toContain('loading="lazy"');
		expect(html).toContain('decoding="async"');
	});

	it('honours an explicit loading="eager" (portfolio detail hero)', () => {
		const html = renderToStaticMarkup(<PortfolioMediaFigure media={BASE_MEDIA} loading="eager" />);
		expect(html).toContain('loading="eager"');
		expect(html).not.toContain('loading="lazy"');
	});

	it('renders no <img> when the media has no URL', () => {
		const html = renderToStaticMarkup(
			<PortfolioMediaFigure media={{ ...BASE_MEDIA, url: null }} />,
		);
		expect(html).not.toContain('<img');
		expect(html).toContain('role="img"');
	});
});
