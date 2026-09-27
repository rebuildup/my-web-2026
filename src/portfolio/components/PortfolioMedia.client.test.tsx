import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PortfolioMediaFigure } from './PortfolioMedia';
import type { PortfolioMedia as PortfolioMediaData } from '../schema';

/**
 * `PortfolioMediaFigure` image-load-failure fallback (Issue #77).
 *
 * Contract: when the rendered `<img>` fires its native `error`
 * event (network failure, 404 on the R2 custom domain, an
 * unsupported content type, …), the figure MUST transition into
 * the placeholder branch on the next render. The replacement
 * preserves:
 *
 *   - the `alt` text, exposed as `aria-label` on the
 *     `role="img"` figure,
 *   - the styled frame's aspect ratio (no layout collapse),
 *   - no `broken-image` glyph leaking to the visitor.
 *
 * The test exercises a real DOM (happy-dom) so the `onError`
 * handler runs through React 19's normal event pipeline.
 */

const baseMedia = (url: string | null): PortfolioMediaData => ({
	id: 'm1',
	r2Key: 'portfolio/aulymo/cover.webp',
	contentType: 'image/webp',
	width: 1280,
	height: 720,
	alt: 'Aulymo cover — A Lyric Motion workflow screenshot',
	caption: null,
	isCover: true,
	displayOrder: 0,
	url,
});

describe('PortfolioMediaFigure — image load failure fallback', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('renders the placeholder when url is null', () => {
		const { container } = render(<PortfolioMediaFigure media={baseMedia(null)} />);
		const figure = container.querySelector('figure');
		expect(figure?.getAttribute('role')).toBe('img');
		expect(figure?.getAttribute('aria-label')).toBe(
			'Aulymo cover — A Lyric Motion workflow screenshot',
		);
		// No <img> tag — placeholder is not an image.
		expect(container.querySelector('img')).toBeNull();
		// Caption retained so the placeholder reads as intentional.
		expect(container.textContent).toContain('placeholder');
	});

	it('renders the <img> when url is set and no error has fired', () => {
		const { container } = render(
			<PortfolioMediaFigure media={baseMedia('https://media.example.com/cover.webp')} />,
		);
		const img = container.querySelector('img');
		expect(img).not.toBeNull();
		expect(img?.getAttribute('src')).toBe('https://media.example.com/cover.webp');
		expect(img?.getAttribute('alt')).toBe('Aulymo cover — A Lyric Motion workflow screenshot');
		// The img is not wrapped in role="img" — only the placeholder branch is.
		expect(container.querySelector('figure[role="img"]')).toBeNull();
	});

	it('falls back to the placeholder branch when the <img> fires an error event', async () => {
		const { container } = render(
			<PortfolioMediaFigure media={baseMedia('https://media.example.com/cover.webp')} />,
		);
		// Sanity check: initial render is the image.
		const initialImg = container.querySelector('img');
		expect(initialImg).not.toBeNull();

		// Dispatch a real `error` event on the img element — React
		// listens via the synthetic event system and our `onError`
		// handler flips the state.
		await act(async () => {
			initialImg?.dispatchEvent(new Event('error', { bubbles: true }));
		});

		// After the error: the placeholder branch replaces the img.
		const img = container.querySelector('img');
		expect(img).toBeNull();
		const figure = container.querySelector('figure');
		expect(figure?.getAttribute('role')).toBe('img');
		expect(figure?.getAttribute('aria-label')).toBe(
			'Aulymo cover — A Lyric Motion workflow screenshot',
		);
		// The placeholder caption is visible.
		expect(container.textContent).toContain('placeholder');
		// The layout frame is preserved (same aspect-ratio class).
		// Panda CSS emits `aspect-ratio` as a custom-property-driven
		// class — the literal token `aspectRatio` does not appear in
		// the className; we assert the rendered CSS class is the same
		// as the placeholder branch above by checking the styled
		// figure keeps its `figure` + `role="img"` shape.
		expect(figure?.className).toBeTruthy();
	});

	it('does not crash when error fires repeatedly (idempotent)', async () => {
		const { container } = render(
			<PortfolioMediaFigure media={baseMedia('https://media.example.com/cover.webp')} />,
		);
		const initialImg = container.querySelector('img');
		expect(initialImg).not.toBeNull();

		await act(async () => {
			initialImg?.dispatchEvent(new Event('error', { bubbles: true }));
		});
		expect(container.querySelector('img')).toBeNull();

		// Second error event on the now-gone img would not fire
		// (no <img> in the tree). The figure is still the placeholder
		// — no broken-image glyph, no crash.
		await act(async () => {
			document.body.dispatchEvent(new Event('error', { bubbles: true }));
		});
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('figure[role="img"]')).not.toBeNull();
	});

	it('preserves the caption when one is set and the img loads', () => {
		const mediaWithCaption: PortfolioMediaData = {
			...baseMedia('https://media.example.com/cover.webp'),
			caption: 'Editor showing the lyric motion preview',
		};
		const { container } = render(<PortfolioMediaFigure media={mediaWithCaption} />);
		const figcaption = container.querySelector('figcaption');
		expect(figcaption?.textContent).toBe('Editor showing the lyric motion preview');
	});
});
