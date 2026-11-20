import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MY_WEB_2026_PROJECT_HISTORY } from '../fixtures/project-history';
import { PortfolioProjectHistory } from './PortfolioProjectHistory';

/**
 * PortfolioProjectHistory contract tests (Issue #518).
 *
 * The pinned properties are the ones the issue names: one work shows
 * its 制作開始 / 改版 / 公開 events with sources, the epistemic axis
 * (記録 / 記憶) stays distinguishable from the chronology axis, a
 * recollection is never restated as a fact, month-precision dates are
 * not padded into fake days, and the element renders text-only when
 * no image exists — empty input renders nothing.
 */

function render(props: Parameters<typeof PortfolioProjectHistory>[0]) {
	return renderToStaticMarkup(<PortfolioProjectHistory {...props} />);
}

const fixtureProps = {
	title: MY_WEB_2026_PROJECT_HISTORY.title,
	periodLabel: MY_WEB_2026_PROJECT_HISTORY.periodLabel,
	summary: MY_WEB_2026_PROJECT_HISTORY.summary,
	events: MY_WEB_2026_PROJECT_HISTORY.events,
};

describe('PortfolioProjectHistory (Issue #518)', () => {
	it('renders every fixture event with its kind, basis and sources', () => {
		const html = render(fixtureProps);
		for (const event of MY_WEB_2026_PROJECT_HISTORY.events) {
			expect(html).toContain(`data-history-event="${event.id}"`);
			expect(html).toContain(`data-history-kind="${event.kind}"`);
			expect(html).toContain(`data-history-basis="${event.basis}"`);
			expect(html).toContain(event.title);
			expect(html).toContain(event.dateLabel);
			for (const source of event.sources) {
				expect(html).toContain(source.label);
			}
		}
	});

	it('covers the three required event kinds on the real fixture', () => {
		const kinds = new Set(MY_WEB_2026_PROJECT_HISTORY.events.map((e) => e.kind));
		for (const kind of ['start', 'revision', 'publication']) {
			expect(kinds.has(kind as never)).toBe(true);
		}
	});

	it('keeps recollection labelled as recollection, never as fact', () => {
		const html = render(fixtureProps);
		expect(html).toContain('記憶');
		expect(html).toContain('記録');
		// The recollection event carries the ring mark, not the disc.
		expect(html).toContain('data-history-basis-mark="recollection"');
		expect(html).toContain('data-history-basis-mark="record"');
	});

	it('marks month-precision dates instead of padding them into days', () => {
		const html = render(fixtureProps);
		const monthEvents = MY_WEB_2026_PROJECT_HISTORY.events.filter((e) => e.precision === 'month');
		// One marker per month-precision event; day-precision events get none.
		expect(html.split('（月まで）').length - 1).toBe(monthEvents.length);
		// No fabricated day was appended to a month-precision label.
		expect(html).not.toContain('2025-09-01');
		expect(html).not.toContain('2026-11-01');
	});

	it('renders text-only when no event carries an image', () => {
		const html = render(fixtureProps);
		expect(html).not.toContain('<img');
		expect(html).toContain('data-portfolio-project-history');
	});

	it('renders an approved image only when one is supplied', () => {
		const html = render({
			title: 't',
			events: [
				{
					id: 'e1',
					kind: 'revision',
					dateLabel: '2026-01-01',
					precision: 'day',
					basis: 'record',
					title: 'with image',
					sources: [{ label: 'docs/release.md' }],
					image: { src: '/media/example.webp', alt: 'example' },
				},
			],
		});
		expect(html).toContain('<img');
		expect(html).toContain('src="/media/example.webp"');
		expect(html).toContain('alt="example"');
	});

	it('omits nothing silently: every event must carry at least one source', () => {
		for (const event of MY_WEB_2026_PROJECT_HISTORY.events) {
			expect(event.sources.length).toBeGreaterThan(0);
		}
	});

	it('renders the legend that defines the two bases', () => {
		const html = render({
			title: 't',
			events: [
				{
					id: 'e1',
					kind: 'start',
					dateLabel: '2026-01-01',
					precision: 'day',
					basis: 'record',
					title: 'a',
					sources: [{ label: 'x' }],
				},
			],
		});
		expect(html).toContain('読み方 / How to read');
		expect(html).toContain('Record');
		expect(html).toContain('Recollection');
	});

	it('renders nothing when there are no events', () => {
		expect(render({ title: 't', events: [] })).toBe('');
	});

	it('keeps event text byte-exact (no markup interpretation)', () => {
		const text = 'a <b>not markup</b> & "quotes"';
		const html = render({
			title: 't',
			events: [
				{
					id: 'e1',
					kind: 'note',
					dateLabel: '2026-01',
					precision: 'month',
					basis: 'recollection',
					title: 't',
					detail: text,
					sources: [{ label: 'x' }],
				},
			],
		});
		expect(html).toContain('a &lt;b&gt;not markup&lt;/b&gt; &amp; &quot;quotes&quot;');
		expect(html).not.toContain('<b>not markup</b>');
	});
});
