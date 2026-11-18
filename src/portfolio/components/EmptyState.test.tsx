import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PortfolioEmptyState } from './EmptyState';

/**
 * PortfolioEmptyState — the progress link must point at a surface
 * that actually shows publication progress (Issue #835).
 *
 * GitHub Releases is the platform's own site-update history
 * (Issue #336), not work-publication progress, so the default
 * action must not send visitors there. The contract pinned here:
 *
 *   1. the default href is `/` — the home page's 現在地 section,
 *      which renders the public portfolio rows;
 *   2. an external override still navigates safely (new tab +
 *      `rel="noopener noreferrer"`);
 *   3. the internal default does not force a new tab.
 */
describe('PortfolioEmptyState', () => {
	it('links to the home progress surface by default, not GitHub Releases', () => {
		const html = renderToStaticMarkup(<PortfolioEmptyState />);
		expect(html).toContain('href="/"');
		expect(html).not.toContain('github.com/rebuildup/my-web-2026/releases');
		expect(html).not.toContain('target="_blank"');
	});

	it('opens an external override in a new tab with noopener', () => {
		const html = renderToStaticMarkup(
			<PortfolioEmptyState statusHref="https://example.com/status" />,
		);
		expect(html).toContain('href="https://example.com/status"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});
});
