import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MY_WEB_2026_CASE_STUDY } from '../fixtures/case-study';
import { PortfolioCaseStudy } from './PortfolioCaseStudy';

/**
 * PortfolioCaseStudy contract tests (Issue #519).
 *
 * The pinned properties are the ones the issue names: one work shows
 * 目的 / 選択肢 / 決定 / 検証結果, the three claim classes stay
 * distinguishable (確定事実 / 当時の推測 / 現在の評価), and the
 * element never invents content — empty input renders nothing.
 */

function render(props: Parameters<typeof PortfolioCaseStudy>[0]) {
	return renderToStaticMarkup(<PortfolioCaseStudy {...props} />);
}

describe('PortfolioCaseStudy (Issue #519)', () => {
	it('renders the four case-study sections of the fixture', () => {
		const html = render({
			title: MY_WEB_2026_CASE_STUDY.title,
			periodLabel: MY_WEB_2026_CASE_STUDY.periodLabel,
			summary: MY_WEB_2026_CASE_STUDY.summary,
			sections: MY_WEB_2026_CASE_STUDY.sections,
		});
		for (const heading of [
			'目的 / Goal',
			'選択肢 / Options',
			'決定 / Decision',
			'検証結果 / Verification',
		]) {
			expect(html).toContain(heading);
		}
	});

	it('labels every entry with one of the three claim classes', () => {
		const html = render({
			title: 't',
			sections: [
				{
					id: 's',
					heading: 'h',
					entries: [
						{ claimClass: 'confirmed', text: 'a' },
						{ claimClass: 'period-estimate', text: 'b' },
						{ claimClass: 'current-evaluation', text: 'c' },
					],
				},
			],
		});
		for (const cls of ['confirmed', 'period-estimate', 'current-evaluation']) {
			expect(html).toContain(`data-claim-class="${cls}"`);
			expect(html).toContain(`data-claim-class-mark="${cls}"`);
		}
		// The word is the non-colour channel: each class prints its label.
		expect(html).toContain('確定事実');
		expect(html).toContain('当時の推測');
		expect(html).toContain('現在の評価');
	});

	it('renders the legend that defines the three classes', () => {
		const html = render({
			title: 't',
			sections: [
				{
					id: 's',
					heading: 'h',
					entries: [{ claimClass: 'confirmed', text: 'a' }],
				},
			],
		});
		expect(html).toContain('読み方 / How to read');
		expect(html).toContain('Confirmed');
		expect(html).toContain('Period estimate');
		expect(html).toContain('Current evaluation');
	});

	it('omits sections with no entries and renders nothing when all are empty', () => {
		const html = render({
			title: 't',
			sections: [
				{ id: 'empty', heading: 'empty / Empty', entries: [] },
				{
					id: 'full',
					heading: 'full / Full',
					entries: [{ claimClass: 'confirmed', text: 'a' }],
				},
			],
		});
		expect(html).not.toContain('empty / Empty');
		expect(html).toContain('full / Full');
		expect(render({ title: 't', sections: [] })).toBe('');
	});

	it('keeps entry text byte-exact (no markup interpretation)', () => {
		const text = 'a <b>not markup</b> & "quotes"';
		const html = render({
			title: 't',
			sections: [
				{
					id: 's',
					heading: 'h',
					entries: [{ claimClass: 'confirmed', text }],
				},
			],
		});
		expect(html).toContain('a &lt;b&gt;not markup&lt;/b&gt; &amp; &quot;quotes&quot;');
		expect(html).not.toContain('<b>not markup</b>');
	});
});
