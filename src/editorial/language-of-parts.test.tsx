import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	DOCUMENT_LANGUAGE,
	expectedLanguageAttributes,
	findLanguageDocument,
	findLanguagePart,
} from '../i18n/language-of-parts';
import { LanguageOfParts } from './language-of-parts';
import { Gallery } from './language-of-parts.stories';

/**
 * SSR markup contract for the language-of-parts surface (Issue #409).
 *
 * The renderer is `react-dom/server` — the same renderer the Worker
 * uses — so what is asserted here is what a visitor's screen reader
 * receives before a single byte of JavaScript runs. For this Issue that
 * matters twice over: a `lang` that only appears after hydration is a
 * `lang` that never existed for a crawler or a no-JS reader, and the
 * Issue's first completion condition is that the reading follows the
 * language without contradicting the document's own `lang`.
 *
 * The failures these tests exist to prevent:
 *
 *   - a `lang` written on a code identifier or a single loanword, which
 *     is the mechanical tagging WCAG 3.1.2 does not ask for and which
 *     would make the real passages invisible in the noise,
 *   - a `lang` equal to the document language, which tells a screen
 *     reader nothing,
 *   - a `lang` on a part the policy refused (unverifiable tag, empty
 *     run) — the refusal has to be visible as `data-lang-verdict`
 *     rather than silently dropped,
 *   - the same part tagged twice, or a heading id that collides between
 *     the full-width and the 320 px instance of the same document.
 */

function document_(id: string) {
	const document = findLanguageDocument(id);
	if (!document) throw new Error(`fixture document "${id}" is missing`);
	return document;
}

/** Every `lang="…"` attribute value in document order. */
function langAttributesIn(html: string): string[] {
	return [...html.matchAll(/\slang="([^"]*)"/g)].map((match) => match[1] ?? '');
}

/** The opening tag of the element carrying `data-lang-part="<id>"`. */
function partTag(html: string, id: string): string {
	const tag = html.match(new RegExp(`<[^>]*data-lang-part="${id}"[^>]*>`))?.[0];
	if (tag === undefined) throw new Error(`no element rendered for part "${id}"`);
	return tag;
}

describe('LanguageOfParts — a mixed-language body', () => {
	const html = renderToStaticMarkup(<LanguageOfParts document={document_('article')} />);

	it('carries exactly the attributes the policy decided, in order', () => {
		expect(langAttributesIn(html)).toEqual(['en', 'ko']);
		expect(langAttributesIn(html)).toEqual(
			expectedLanguageAttributes(document_('article'), DOCUMENT_LANGUAGE),
		);
	});

	it('writes no lang on the code identifier or the single loanword', () => {
		for (const id of ['code-architecture-check', 'loanword-dashboard']) {
			const tag = partTag(html, id);
			expect(tag.includes('lang=')).toBe(false);
			expect(tag.includes('data-lang-verdict="not-a-passage"')).toBe(true);
		}
		// The code identifier is still announced as code, which is what
		// distinguishes it — not a language declaration.
		expect(html).toContain('<code');
	});

	it('writes no lang equal to the document language anywhere', () => {
		for (const lang of langAttributesIn(html)) {
			expect(lang).not.toBe(DOCUMENT_LANGUAGE);
		}
	});

	it('never nests a document-language declaration of its own', () => {
		// SC 3.1.1 belongs to the document element, rendered by the
		// Worker (`<html lang="ja">`). A partial tag equal to it would
		// be exactly the redundant attribute the policy refuses.
		expect(html).not.toMatch(/<[a-z]+[^>]*\slang="ja"/);
	});

	it('marks the tagged runs with the verdict the policy returned', () => {
		for (const id of ['quote-english', 'sentence-korean']) {
			const tag = partTag(html, id);
			expect(tag.includes('data-lang-verdict="tagged"')).toBe(true);
		}
		expect(langAttributesIn(partTag(html, 'quote-english'))).toEqual(['en']);
		expect(langAttributesIn(partTag(html, 'sentence-korean'))).toEqual(['ko']);
	});
});

describe('LanguageOfParts — a body with no foreign run', () => {
	const html = renderToStaticMarkup(<LanguageOfParts document={document_('plain')} />);

	it('emits zero lang attributes — zero is the expected value', () => {
		expect(langAttributesIn(html)).toEqual([]);
		expect(html).not.toContain('data-lang-part');
	});
});

describe('LanguageOfParts — refused parts', () => {
	const html = renderToStaticMarkup(
		<LanguageOfParts document={document_('refusals')} showVerdicts />,
	);

	it('writes no attribute on any refused part, and keeps the reason visible', () => {
		const expected: Record<string, string> = {
			'rejected-iso-639-3': 'malformed-tag',
			'rejected-redundant': 'tag-redundant',
			'rejected-empty': 'empty-text',
		};
		for (const [id, verdict] of Object.entries(expected)) {
			const tag = partTag(html, id);
			expect(tag.includes('lang=')).toBe(false);
			expect(tag).toContain(`data-lang-verdict="${verdict}"`);
		}
		expect(langAttributesIn(html)).toEqual([]);
	});

	it('prints the verdict and the reason for each part under the body', () => {
		expect(html).toContain('data-language-verdicts="refusals"');
		expect(html).toContain('data-lang-verdict-of="rejected-iso-639-3">malformed-tag<');
		expect(html).toContain('lang=(none)');
		// The empty run stays as an element so the refusal is
		// observable, but it carries no text to be read aloud.
		const empty = partTag(html, 'rejected-empty');
		expect(empty).not.toContain('</span>');
		expect(findLanguagePart('rejected-empty')?.text).toBe('');
	});
});

describe('the Storybook gallery', () => {
	const html = renderToStaticMarkup((Gallery.render as unknown as () => ReactNode)());

	it('renders every state the Issue names', () => {
		expect(html).toContain('data-testid="a11y-mixed-language-gallery"');
		for (const id of ['article', 'plain', 'refusals']) {
			expect(html).toContain(`data-language-document="${id}"`);
		}
		// 04 縮小表示: the mixed-language body again, in a 320 px column.
		expect(html).toContain('data-language-compact="true"');
		expect(html.match(/data-language-compact="true"/g)).toHaveLength(1);
	});

	it('keeps every heading id unique across the gallery', () => {
		const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? '');
		expect(new Set(ids).size).toBe(ids.length);
		// The compact instance must not point its aria-labelledby at the
		// full-width instance's heading.
		expect(html).toContain('aria-labelledby="language-heading-article-compact"');
		expect(html).toContain('id="language-heading-article-compact"');
	});

	it('attributes the two passages once per rendering of the document', () => {
		// The `normal` body is rendered twice (full width + 320 px), so
		// `en` and `ko` appear twice each and nothing else appears.
		expect(langAttributesIn(html)).toEqual(['en', 'ko', 'en', 'ko']);
	});

	it('separates the machine-checked rows from the human ones on screen', () => {
		expect(html).toContain('data-wcag-checked="machine"');
		expect(html).toContain('data-wcag-checked="human"');
		expect(html).toContain('3.1.2 Language of Parts');
		expect(html).toContain('3.1.1 Language of Page');
	});
});
