import { describe, expect, it } from 'vitest';
import {
	DOCUMENT_LANGUAGE,
	LANGUAGE_DOCUMENTS,
	LANGUAGE_PARTS,
	LANGUAGE_PART_IDS,
	LANGUAGE_WCAG_MAPPING,
	type LanguagePart,
	classifyLanguagePart,
	expectedLanguageAttributes,
	findLanguageDocument,
	findLanguagePart,
	inspectLanguageTag,
	languageAttributeFor,
	languageDocumentsByCase,
	resolveLanguageRuns,
} from './language-of-parts';
import { describeUnicode } from './unicode';

/**
 * Contract tests for the language-of-parts policy (Issue #409).
 *
 * What is asserted here is the half of the Issue that does not need a
 * browser: the tag grammar, the four verdicts, and the properties a
 * pipeline must not break — the guard tokens (a quotation that loses
 * its citation is no longer the sentence the artefact claims to have
 * verified) and the absence of a redundant tag.
 *
 * The rendering half (does the shipped markup actually carry those
 * attributes) is `src/editorial/language-of-parts.test.tsx` (SSR
 * markup), and the browser half is
 * `scripts/capture-language-of-parts.mjs`; see
 * `docs/verification/a11y/mixed-language-content.md`. Splitting the
 * three is deliberate: a policy that passes its unit tests while the
 * renderer forgets the attribute is exactly the failure the SSR suite
 * exists to catch, and a capture that cannot find a run is exactly the
 * failure the gate's coverage rule exists to catch.
 */

/** A fixture part, failing loudly rather than returning undefined. */
function part(id: string): LanguagePart {
	const found = findLanguagePart(id);
	if (!found) throw new Error(`fixture part "${id}" is missing`);
	return found;
}

/** The verdict each fixture part must receive, authored here by hand. */
const EXPECTED_VERDICTS: Record<string, string> = {
	'code-architecture-check': 'not-a-passage',
	'loanword-dashboard': 'not-a-passage',
	'quote-english': 'tagged',
	'sentence-korean': 'tagged',
	'rejected-iso-639-3': 'malformed-tag',
	'rejected-redundant': 'tag-redundant',
	'rejected-empty': 'empty-text',
};

describe('inspectLanguageTag', () => {
	it('canonicalises the tags a human-language document may carry', () => {
		expect(inspectLanguageTag('en')).toEqual({ ok: true, canonical: 'en', problem: null });
		expect(inspectLanguageTag('ko')).toEqual({ ok: true, canonical: 'ko', problem: null });
		expect(inspectLanguageTag('en-US')).toEqual({
			ok: true,
			canonical: 'en-US',
			problem: null,
		});
		expect(inspectLanguageTag('zh-Hant')).toEqual({
			ok: true,
			canonical: 'zh-Hant',
			problem: null,
		});
		// A lowercase script subtag is accepted and canonicalised rather
		// than refused: authors write `zh-hant`, and the canonical form
		// is what the DOM has to carry.
		expect(inspectLanguageTag('zh-hant').canonical).toBe('zh-Hant');
		expect(inspectLanguageTag('es-419').canonical).toBe('es-419');
	});

	it('refuses a tag it cannot canonicalise, with the reason', () => {
		expect(inspectLanguageTag(null).problem).toBe('empty-tag');
		expect(inspectLanguageTag('').problem).toBe('empty-tag');
		expect(inspectLanguageTag(' en').problem).toBe('whitespace');
		expect(inspectLanguageTag('en ').problem).toBe('whitespace');
		expect(inspectLanguageTag('ja-日本語').problem).toBe('non-ascii');
		expect(inspectLanguageTag('en_US').problem).toBe('underscore');
		// ISO 639-2/3 code plus a region: never a documented HTML value.
		expect(inspectLanguageTag('eng-US').problem).toBe('iso-639-3-code');
		expect(inspectLanguageTag('jpn').problem).toBe('iso-639-3-code');
		expect(inspectLanguageTag('EN').problem).toBe('language-subtag');
		expect(inspectLanguageTag('e').problem).toBe('language-subtag');
		expect(inspectLanguageTag('zh-hAnt').problem).toBe('script-subtag');
		expect(inspectLanguageTag('en-us').problem).toBe('region-subtag');
		expect(inspectLanguageTag('en-USA').problem).toBe('variant-subtag');
	});
});

/** A fixture document, failing loudly rather than returning undefined. */
function document_(id: string) {
	const document = findLanguageDocument(id);
	if (!document) throw new Error(`fixture document "${id}" is missing`);
	return document;
}

describe('classifyLanguagePart', () => {
	it('gives every fixture part the verdict the contract promises', () => {
		for (const part of LANGUAGE_PARTS) {
			expect(`${part.id}:${classifyLanguagePart(part)}`).toBe(
				`${part.id}:${EXPECTED_VERDICTS[part.id]}`,
			);
		}
	});

	it('writes an attribute only for the two taggable kinds', () => {
		for (const part of LANGUAGE_PARTS) {
			const lang = languageAttributeFor(part);
			if (part.kind === 'sentence' || part.kind === 'phrase') {
				if (classifyLanguagePart(part) === 'tagged') {
					expect(lang).toBe(inspectLanguageTag(part.tag).canonical);
					continue;
				}
			}
			expect(lang).toBeNull();
		}
	});

	it('refuses a tag that only differs from the document language by case', () => {
		const quoted = { ...part('quote-english'), tag: 'EN' };
		expect(classifyLanguagePart(quoted)).toBe('malformed-tag');
	});

	it('refuses a redundant tag even when the part could be tagged', () => {
		// A Japanese quotation inside a Japanese document: the kind
		// permits a tag, the language does not need one.
		const quoted = { ...part('quote-english'), tag: DOCUMENT_LANGUAGE.toUpperCase() };
		expect(classifyLanguagePart(quoted)).toBe('malformed-tag');
		const japanese = { ...part('quote-english'), tag: DOCUMENT_LANGUAGE };
		expect(classifyLanguagePart(japanese)).toBe('tag-redundant');
		expect(languageAttributeFor(japanese)).toBeNull();
	});
});

describe('the mixed-language fixture', () => {
	it('keeps every guard token byte-exact inside its part', () => {
		for (const part of LANGUAGE_PARTS) {
			if (part.guard === '') {
				// The only part allowed to be empty is the empty-run
				// refusal, and that is what makes it a refusal.
				expect(part.id).toBe('rejected-empty');
				continue;
			}
			expect(part.text.includes(part.guard)).toBe(true);
			// The fixture claims the author's own characters: a string
			// that is neither NFC nor NFD would mean the artefact and
			// the source had drifted into an unreviewable state.
			expect(describeUnicode(part.text).form).toBe('NFC');
		}
	});

	it('declares exactly one body per state the gallery renders', () => {
		expect(languageDocumentsByCase('normal').map((document) => document.id)).toEqual(['article']);
		expect(languageDocumentsByCase('empty').map((document) => document.id)).toEqual(['plain']);
		expect(languageDocumentsByCase('failure').map((document) => document.id)).toEqual(['refusals']);
	});

	it('resolves every run reference, and references every part', () => {
		const referenced = new Set<string>();
		for (const document of LANGUAGE_DOCUMENTS) {
			for (const run of document.runs) {
				if (run.part === undefined) continue;
				referenced.add(run.part);
				expect(findLanguagePart(run.part)).toBeDefined();
				expect(run.text).toBe(findLanguagePart(run.part)?.text);
			}
		}
		// An orphan part is dead policy: it would pass every assertion
		// above while documenting a case no document renders.
		expect([...referenced].sort()).toEqual([...LANGUAGE_PART_IDS].sort());
	});

	it('emits no lang equal to the document language, in any body', () => {
		for (const document of LANGUAGE_DOCUMENTS) {
			for (const lang of expectedLanguageAttributes(document)) {
				expect(lang).not.toBe(DOCUMENT_LANGUAGE);
			}
		}
	});

	it('emits exactly the two attributes a mixed-language body must carry', () => {
		expect(expectedLanguageAttributes(document_('article'))).toEqual(['en', 'ko']);
	});

	it('emits nothing at all for a document-language-only body', () => {
		const plain = document_('plain');
		expect(expectedLanguageAttributes(plain)).toEqual([]);
		expect(resolveLanguageRuns(plain).every((run) => run.part === null)).toBe(true);
	});

	it('emits nothing at all for a body of refused parts', () => {
		const refusals = document_('refusals');
		expect(expectedLanguageAttributes(refusals)).toEqual([]);
		expect(resolveLanguageRuns(refusals).filter((run) => run.lang !== null)).toEqual([]);
	});
});

describe('the WCAG mapping', () => {
	it('names 3.1.2 at level A and separates machine from human', () => {
		const languages = LANGUAGE_WCAG_MAPPING.filter((row) => row.criterion.startsWith('3.1.2'));
		expect(languages.length).toBeGreaterThan(0);
		for (const row of languages) {
			expect(['A', 'AA']).toContain(row.level);
			expect(row.how.length).toBeGreaterThan(0);
		}
		// The mapping is the Issue's "機械検査と人間の評価を区別" half: a
		// table with no human row would claim the whole criterion was
		// decided by a gate, which is false.
		expect(LANGUAGE_WCAG_MAPPING.some((row) => row.checked === 'human')).toBe(true);
		expect(LANGUAGE_WCAG_MAPPING.some((row) => row.checked === 'machine')).toBe(true);
		expect(
			LANGUAGE_WCAG_MAPPING.filter((row) => row.checked === 'human').every(
				(row) => row.how.includes('NOT checked') || row.how.includes('NOT a conformance'),
			),
		).toBe(true);
	});
});
