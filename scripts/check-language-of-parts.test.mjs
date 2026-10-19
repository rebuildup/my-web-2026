import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CAPTURE_SCRIPT,
	DOCUMENT_ROOT,
	RULES,
	STORY_EXPORT,
	STORY_MODULE,
	STORY_TEST_ID,
	auditCaptureDrift,
	auditLanguageFixture,
	readDocumentLanguage,
	readExportedString,
} from './check-language-of-parts.mjs';

/**
 * Gate invariants for the Issue #409 language-of-parts contract.
 *
 * Two halves are checked here:
 *
 *   1. the rules fire on the fixture shapes they exist for, using the
 *      SHIPPED policy module (imported directly, the same way the gate
 *      loads it) so a fixture that satisfies the gate is the fixture the
 *      Worker-side code classifies;
 *   2. the gate's drift rules still describe the repository — the
 *      document element, the story and the capture.
 *
 * The fixture passed to `auditLanguageFixture` is a small synthetic
 * table rather than the real one for the negative cases: a fixture that
 * violates a rule must not be committed just to prove the rule fires.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const policy = await import('../src/i18n/language-of-parts.ts');

/** A one-part policy-shaped fixture with the named part and document. */
function fixtureWith(part, { documentCase = 'normal', rendered = true } = {}) {
	return {
		DOCUMENT_LANGUAGE: 'ja',
		LANGUAGE_WCAG_MAPPING: policy.LANGUAGE_WCAG_MAPPING,
		LANGUAGE_PARTS: [part],
		LANGUAGE_DOCUMENTS: [
			{
				id: 'doc',
				case: documentCase,
				title: 't',
				note: 'n',
				runs: rendered ? [{ text: part.text, part: part.id }] : [{ text: 'prose' }],
			},
		],
		inspectLanguageTag: policy.inspectLanguageTag,
		classifyLanguagePart: policy.classifyLanguagePart,
		languageAttributeFor: policy.languageAttributeFor,
	};
}

describe('readDocumentLanguage', () => {
	it('reads the language the shipped route root declares', () => {
		assert.equal(readDocumentLanguage('<html lang="ja">'), 'ja');
		assert.equal(readDocumentLanguage('<html lang="ja" className={x}>'), 'ja');
		// A document that declares none is reported as `null`, so the gate
		// can say "declares none" rather than silently comparing against ''.
		assert.equal(readDocumentLanguage('<html>'), null);
	});
});

describe('readExportedString', () => {
	it('reads a declared constant and reports a missing one as null', () => {
		assert.equal(readExportedString("export const A = 'x';", 'A'), 'x');
		assert.equal(readExportedString('export const A = "x";', 'A'), null);
		assert.equal(readExportedString('export const A = 1;', 'A'), null);
		assert.equal(readExportedString('', 'A'), null);
	});
});

describe('auditLanguageFixture — the shipped fixture is clean', () => {
	const audit = auditLanguageFixture(policy, 'ja');

	it('reports no error for the committed fixture', () => {
		assert.deepEqual(audit.errors, []);
	});

	it('describes one row per part, with the attribute it renders', () => {
		assert.equal(audit.rows.length, policy.LANGUAGE_PARTS.length);
		const tagged = audit.rows.filter((row) => row.verdict === 'tagged');
		assert.deepEqual(tagged.map((row) => row.lang).sort(), ['en', 'ko']);
		for (const row of audit.rows) {
			if (row.verdict !== 'tagged') {
				assert.equal(row.lang, null, `${row.id} must render no attribute`);
			}
		}
	});

	it('carries the WCAG mapping so the report can print machine vs. human', () => {
		assert.ok(audit.wcag.some((row) => row.criterion.startsWith('3.1.2')));
		assert.ok(audit.wcag.some((row) => row.checked === 'human'));
	});
});

describe('auditLanguageFixture — the rules fire', () => {
	const quote = policy.findLanguagePart('quote-english');

	it('document-language-mismatch', () => {
		const errors = auditLanguageFixture(fixtureWith(quote), 'en').errors;
		assert.deepEqual(
			errors.map((error) => error.rule),
			['document-language-mismatch'],
		);
	});

	it('orphan-part', () => {
		const errors = auditLanguageFixture(fixtureWith(quote, { rendered: false })).errors;
		assert.ok(errors.some((error) => error.rule === 'orphan-part'));
	});

	it('dangling-part-reference', () => {
		const broken = {
			...fixtureWith(quote),
			LANGUAGE_PARTS: [quote],
			LANGUAGE_DOCUMENTS: [
				{
					id: 'doc',
					case: 'normal',
					title: 't',
					note: 'n',
					runs: [{ text: 'x', part: 'no-such-part' }],
				},
			],
		};
		// The fixture is built from the real registry, so the dangling id
		// cannot resolve; that is the regression this rule names.
		const errors = auditLanguageFixture(broken, 'ja').errors;
		assert.ok(errors.some((error) => error.rule === 'dangling-part-reference'));
	});

	it('language-tag-required', () => {
		const untagged = { ...quote, id: 'untagged-quote', tag: null };
		const errors = auditLanguageFixture(fixtureWith(untagged), 'ja').errors;
		assert.ok(errors.some((error) => error.rule === 'language-tag-required'));
	});

	it('language-tag-malformed, in a non-failure body', () => {
		const malformed = { ...quote, id: 'malformed-quote', tag: 'eng-US' };
		const errors = auditLanguageFixture(fixtureWith(malformed), 'ja').errors;
		assert.ok(
			errors.some(
				(error) => error.rule === 'language-tag-malformed' && /failure body/.test(error.message),
			),
			`expected a malformed-tag error, got ${JSON.stringify(errors)}`,
		);
	});

	it('language-tag-on-non-language', () => {
		// A classifier that tags every Latin-script run is the exact
		// "全英単語に機械追加" regression the Issue forbids. It cannot be
		// built from the shipped classifier (which refuses the tag), so
		// the stub below stands in for the future change the rule exists
		// to catch.
		const taggedCode = { ...policy.findLanguagePart('code-architecture-check'), tag: 'en' };
		const errors = auditLanguageFixture(
			{
				...fixtureWith(taggedCode),
				classifyLanguagePart: () => 'tagged',
				languageAttributeFor: (part) => part.tag,
			},
			'ja',
		).errors;
		assert.ok(
			errors.some((error) => error.rule === 'language-tag-on-non-language'),
			`expected a non-language tag error, got ${JSON.stringify(errors)}`,
		);
	});

	it('language-tag-redundant', () => {
		const redundant = { ...quote, id: 'ja-quote', tag: 'ja' };
		// A classifier that forgot the redundancy check is the future
		// change this rule guards, so it is stubbed rather than derived
		// from the shipped classifier (which correctly refuses).
		const errors = auditLanguageFixture(
			{
				...fixtureWith(redundant),
				classifyLanguagePart: () => 'tag-redundant',
				languageAttributeFor: () => 'ja',
			},
			'ja',
		).errors;
		assert.ok(
			errors.some((error) => error.rule === 'language-tag-redundant'),
			`expected a redundant-tag error, got ${JSON.stringify(errors)}`,
		);
	});

	it('guard-not-preserved', () => {
		const stripped = { ...quote, id: 'stripped-quote', text: 'The technique WCAG describes.' };
		const errors = auditLanguageFixture(fixtureWith(stripped), 'ja').errors;
		assert.ok(
			errors.some((error) => error.rule === 'guard-not-preserved'),
			`expected a guard error, got ${JSON.stringify(errors)}`,
		);
	});

	it('unobserved-verdict — a refusal nobody renders', () => {
		const redundant = { ...quote, id: 'ja-quote', tag: 'ja' };
		const errors = auditLanguageFixture(
			fixtureWith(redundant, { documentCase: 'normal' }),
			'ja',
		).errors;
		assert.ok(errors.some((error) => error.rule === 'unobserved-verdict'));
	});
});

describe('auditCaptureDrift', () => {
	const storySource = readFileSync(join(REPO_ROOT, STORY_MODULE), 'utf8');
	const captureSource = readFileSync(join(REPO_ROOT, CAPTURE_SCRIPT), 'utf8');

	it('passes on the repository as it stands', () => {
		assert.deepEqual(auditCaptureDrift({ storySource, captureSource }), []);
	});

	it('fails when the story stops exporting the gallery', () => {
		const errors = auditCaptureDrift({
			storySource: storySource.replace(`export function ${STORY_EXPORT}`, 'function Gallery'),
			captureSource,
		});
		assert.ok(errors.some((error) => /does not export Gallery/.test(error.message)));
	});

	it('fails when the readiness marker disappears', () => {
		const errors = auditCaptureDrift({
			storySource: storySource.replace(`data-testid="${STORY_TEST_ID}"`, 'data-testid="other"'),
			captureSource,
		});
		assert.ok(errors.some((error) => /readiness marker/.test(error.message)));
	});

	it('fails when the capture stops rendering the story', () => {
		const errors = auditCaptureDrift({
			storySource,
			captureSource: captureSource.replace(
				`export const STORY_MODULE = '${STORY_MODULE}';`,
				"export const STORY_MODULE = 'src/editorial/other.stories.tsx';",
			),
		});
		assert.ok(errors.some((error) => /artefact would go stale/.test(error.message)));
	});
});

describe('the rule list', () => {
	it('names every rule the module documents, once', () => {
		const source = readFileSync(join(REPO_ROOT, 'scripts/check-language-of-parts.mjs'), 'utf8');
		for (const rule of RULES) {
			assert.match(source, new RegExp(`\\b${rule}\\b`), `${rule} is undocumented`);
		}
		assert.equal(new Set(RULES).size, RULES.length);
	});

	it('reads the shipped document element and the shipped story', () => {
		assert.equal(DOCUMENT_ROOT, 'src/routes/__root.tsx');
		const declared = readDocumentLanguage(readFileSync(join(REPO_ROOT, DOCUMENT_ROOT), 'utf8'));
		assert.equal(declared, policy.DOCUMENT_LANGUAGE);
	});
});
