import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CurrentProjectRecord, ProjectFact } from '../../home/current/types';
import type { PortfolioMedia } from '../../portfolio/schema';
import type { NowFocusItem } from './focus';
import { NowFocus } from './NowFocus';

/**
 * The `/now` focus band (Issue #1316).
 *
 * `renderToStaticMarkup` is the shipped SSR path, so these assertions
 * pin what a browser receives: a mapped case study renders its cover
 * as a link to `/portfolio/<slug>`, and a record without evidence
 * renders the typographic plate — never a borrowed or broken image.
 */

const TODAY = '2026-11-28';

function fact<T>(value: T): ProjectFact<T> {
	return { value, source: 'handwritten', observedOn: TODAY };
}

const RECORD: CurrentProjectRecord = {
	id: 'my-web-2026',
	name: 'my-web-2026',
	statusJa: '個人 Web Platform を再構築中。',
	startedOn: fact('2026-09-11'),
	updatedOn: fact('2026-11-20'),
	weight: { level: fact('primary') },
	link: { label: 'GitHub', href: 'https://github.com/rebuildup/my-web-2026' },
};

const COVER: PortfolioMedia = {
	id: 'm1',
	r2Key: 'portfolio/notion/cover.png',
	contentType: 'image/png',
	width: 1600,
	height: 900,
	alt: 'my-web-2026 の表紙',
	caption: null,
	isCover: true,
	displayOrder: 0,
	url: 'https://rebuildup.dev/media/portfolio/notion/cover.png',
};

function item(cover: NowFocusItem['cover']): NowFocusItem {
	return { record: RECORD, cover };
}

describe('NowFocus', () => {
	it('renders nothing for an empty selection', () => {
		expect(renderToStaticMarkup(<NowFocus items={[]} today={TODAY} />)).toBe('');
	});

	it('renders the cover as a link to the case study when evidence exists', () => {
		const html = renderToStaticMarkup(
			<NowFocus
				items={[item({ slug: 'my-web-2026', title: 'my-web-2026', media: COVER })]}
				today={TODAY}
			/>,
		);
		expect(html).toContain('now-focus-item');
		expect(html).toContain('href="/portfolio/my-web-2026"');
		expect(html).toContain(COVER.url);
		expect(html).toContain('case study を読む');
		expect(html).not.toContain('now-focus-plate');
	});

	it('renders the typographic plate when the record has no cover', () => {
		const html = renderToStaticMarkup(<NowFocus items={[item(null)]} today={TODAY} />);
		expect(html).toContain('now-focus-plate');
		expect(html).toContain('No cover published');
		expect(html).not.toContain('<img');
	});

	it('renders the measured facts with their sources', () => {
		const html = renderToStaticMarkup(<NowFocus items={[item(null)]} today={TODAY} />);
		expect(html).toContain('now-focus-facts');
		expect(html).toContain('手書き');
		expect(html).toContain('主軸');
	});
});
