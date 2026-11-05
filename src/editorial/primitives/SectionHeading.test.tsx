import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SectionHeading } from './SectionHeading';

/**
 * Issue #792 — a bilingual section title is two blocks, not one string.
 *
 * The defect this file guards is typographic, so the assertion has to
 * look at the DOM the browser receives rather than at a prop:
 *
 *   - a single string (`'できごと / What's here'`) is laid out by the
 *     ordinary line breaker, which at 320px and in the `spread` 4/12
 *     column broke it as `できごと /` + `What's here`, leaving the
 *     separator stranded at the end of the first line;
 *   - a `title` + `titleEn` pair renders the Japanese half and the
 *     English half as separate elements, so no width can put them on
 *     one line or split the slash from its left neighbour.
 *
 * The accessible name is asserted too: the two halves are one heading,
 * so the space between them must survive — otherwise a screen reader
 * announces `できごとWhat's here` as one word.
 */
describe('SectionHeading — bilingual title (Issue #792)', () => {
	it('renders the JA and EN halves as separate elements', () => {
		const html = renderToStaticMarkup(
			<SectionHeading title="できごと" titleEn="What&apos;s here" />,
		);

		// Two spans, the EN one carrying `lang="en"`.
		expect(html).toContain('<span');
		expect(html).toMatch(/<span[^>]*>できごと<\/span>/);
		expect(html).toMatch(/<span[^>]*lang="en"[^>]*>[^<]*What/s);
	});

	it('keeps a space between the halves in the accessible name', () => {
		const html = renderToStaticMarkup(<SectionHeading title="できごと" titleEn="What's here" />);
		// The space text node is what makes the heading read as two
		// words rather than one.
		expect(html).toContain('</span> <span');
	});

	it('renders a single-language title without a wrapper, as before', () => {
		const html = renderToStaticMarkup(<SectionHeading title="タイトルだけのパターン" />);
		expect(html).toContain('>タイトルだけのパターン</h2>');
		expect(html).not.toContain('<span');
	});
});
