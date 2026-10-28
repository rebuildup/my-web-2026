#!/usr/bin/env node

/**
 * check-brand-name-meanings-preview-parity — the document and the
 * preview must say the same thing (Issue #521).
 *
 * What it asserts
 * ---------------
 * `docs/brand/361do-name-meanings.md` is the source of truth for the
 * "361do" brand naming note, and
 * `src/personal/brand-naming/BrandNameMeanings.preview.ts` is its
 * projection into a Storybook preview. Three properties are checked:
 *
 *   1. **Heading parity.** Every `##` heading of the document is
 *      declared, and the preview's card headings are the same set.
 *      The document declares each section's disposition with a
 *      `<!-- preview: public -->` / `<!-- preview: held -->`
 *      marker; the public sections are the ones the preview renders.
 *      A heading that exists on only one side fails.
 *   2. **Bullet parity.** The bullet lines of every public section are
 *      the preview card's `points`, in the same order. The preview
 *      therefore cannot say anything the document does not say.
 *   3. **No internal leakage.** The held sections (the internal
 *      deliberation and the verification notes) must not appear in the
 *      preview data module nor in the story file. A held section's
 *      wording in the preview would publish an undecided position.
 *
 * Why the disposition is declared in the document
 * ----------------------------------------------
 * The document and the preview are not the same set of sections: the
 * note deliberately keeps internal deliberation out of the public
 * preview. A parity rule that demanded an exact set match would
 * therefore force the internal text into the preview, which is the
 * opposite of what the note is for. Declaring the disposition per
 * section keeps the difference explicit and machine-checkable: the
 * held headings are a RECORDED difference, not a silent one, and the
 * test fails if a held section ever shows up on the preview side.
 *
 * Usage:
 *   node --experimental-strip-types --test scripts/check-brand-name-meanings-preview-parity.test.mjs
 *
 * Why the capture module is imported here
 * ---------------------------------------
 * `scripts/capture-brand-name-meanings.mjs` is the script that writes
 * this Issue's verification image. The ticket forbids registering it as
 * an npm script (a shared `package.json` line is a merge-conflict
 * magnet for concurrent tickets), and an unwired script is an unused
 * file as far as `knip` is concerned. Importing it from the test that
 * belongs to the same Issue keeps it reachable without touching a
 * shared file, and the import is not a formality: the block below
 * asserts the capture's WebP-only policy, so the artefact this Issue
 * ships cannot silently become a PNG.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	BRAND_NAME_CARDS,
	BRAND_NAME_PROPOSALS,
} from '../src/personal/brand-naming/BrandNameMeanings.preview.ts';
import {
	READY_SELECTOR,
	STORY_EXPORT,
	STORY_MODULE,
	assertWebpOutputPath,
	screenshotBudgetVerdict,
} from './capture-brand-name-meanings.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The document the preview projects. */
const DOCUMENT_PATH = 'docs/brand/361do-name-meanings.md';

/** The data module the preview renders. */
const PREVIEW_PATH = 'src/personal/brand-naming/BrandNameMeanings.preview.ts';

/** The story that renders the data module. */
const STORY_PATH = 'src/personal/brand-naming/BrandNameMeanings.stories.tsx';

/**
 * One `##` section of the document.
 *
 * @typedef {object} DocumentSection
 * @property {string} heading
 * @property {'public' | 'held' | null} disposition
 * @property {string[]} points
 * @property {string[]} prose
 */

/**
 * Parse the `##` sections of the note.
 *
 * The section body ends at the next `##` heading, so a held section's
 * prose and bullets are read together — the leak check needs both.
 * The disposition marker is an HTML comment on the line after the
 * heading; a section without one is reported as `null` and fails the
 * parity test, because an undeclared section is an unrecorded
 * difference.
 *
 * @param {string} markdown
 * @returns {DocumentSection[]}
 */
function parseDocumentSections(markdown) {
	/** @type {DocumentSection[]} */
	const sections = [];
	const lines = markdown.split('\n');
	/** @type {DocumentSection | null} */
	let current = null;
	for (const line of lines) {
		const heading = /^##\s+(.*\S)\s*$/.exec(line);
		if (heading) {
			if (current) sections.push(current);
			current = { heading: heading[1], disposition: null, points: [], prose: [] };
			continue;
		}
		if (!current) continue;
		const disposition = /^<!--\s*preview:\s*(public|held)\s*-->\s*$/.exec(line);
		if (disposition) {
			current.disposition = /** @type {'public' | 'held'} */ (disposition[1]);
			continue;
		}
		const bullet = /^-\s+(.*\S)\s*$/.exec(line);
		if (bullet) {
			current.points.push(bullet[1]);
			continue;
		}
		if (line.trim().length > 0) current.prose.push(line.trim());
	}
	if (current) sections.push(current);
	return sections;
}

/**
 * The sections the preview renders (the declared public ones).
 *
 * @param {DocumentSection[]} sections
 */
function publicSections(sections) {
	return sections.filter((section) => section.disposition === 'public');
}

/**
 * The sections the preview must NOT render (the declared held ones).
 *
 * @param {DocumentSection[]} sections
 */
function heldSections(sections) {
	return sections.filter((section) => section.disposition === 'held');
}

/**
 * The lines of a held section that no public section repeats.
 *
 * A line the public side also carries is not a leak — it is the same
 * sentence in two places. Only a line that exists ONLY inside a held
 * section can betray internal text.
 *
 * @param {DocumentSection[]} sections
 */
function heldOnlyLines(sections) {
	const publicLines = new Set(publicSections(sections).flatMap((section) => section.points));
	return heldSections(sections)
		.flatMap((section) => [...section.points, ...section.prose])
		.filter((line) => !publicLines.has(line));
}

/**
 * The headings the preview cards carry.
 *
 * @param {{ heading: string }[]} cards
 */
function cardHeadings(cards) {
	return cards.map((card) => card.heading);
}

/** Read the document. */
function readDocument(path = DOCUMENT_PATH) {
	return readFileSync(resolve(repoRoot, path), 'utf8');
}

/**
 * Read a repository file.
 *
 * @param {string} path
 */
function readRepoFile(path) {
	return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('brand naming note / preview parity (Issue #521)', () => {
	const document = readDocument();
	const sections = parseDocumentSections(document);

	it('declares a disposition for every section', () => {
		const undeclared = sections.filter((section) => section.disposition === null);
		assert.deepEqual(
			undeclared.map((section) => section.heading),
			[],
			'every ## section must declare `<!-- preview: public -->` or `<!-- preview: held -->`',
		);
	});

	it('has the same heading set on both sides', () => {
		const documentHeadings = publicSections(sections).map((section) => section.heading);
		const previewHeadings = cardHeadings(BRAND_NAME_CARDS);
		assert.deepEqual(
			[...documentHeadings].sort(),
			[...previewHeadings].sort(),
			'the preview cards and the public sections of the document must be the same set',
		);
	});

	it('keeps the heading order', () => {
		assert.deepEqual(
			publicSections(sections).map((section) => section.heading),
			cardHeadings(BRAND_NAME_CARDS),
			'the preview cards must follow the document order',
		);
	});

	it('carries the same bullet lines, in the same order, per section', () => {
		for (const card of BRAND_NAME_CARDS) {
			const section = sections.find((entry) => entry.heading === card.heading);
			assert.ok(section, `no document section for the card "${card.heading}"`);
			assert.deepEqual(
				[...section.points],
				[...card.points],
				`the bullet lines of "${card.heading}" differ between the document and the preview`,
			);
		}
	});

	it('carries all five proposal phrases on both sides', () => {
		for (const proposal of BRAND_NAME_PROPOSALS) {
			const heading = publicSections(sections)
				.map((section) => section.heading)
				.filter((value) => value.includes(proposal));
			assert.equal(heading.length, 1, `expected exactly one section for "${proposal}"`);
			const card = BRAND_NAME_CARDS.find((entry) => entry.heading === heading[0]);
			assert.ok(card, `no preview card for "${proposal}"`);
			assert.ok(
				card.points.some((point) => point.includes(proposal)),
				`the preview card for "${proposal}" does not carry the phrase itself`,
			);
		}
	});

	it('keeps the held sections out of the preview', () => {
		const previewHeadings = new Set(cardHeadings(BRAND_NAME_CARDS));
		for (const section of heldSections(sections)) {
			assert.ok(
				!previewHeadings.has(section.heading),
				`the held section "${section.heading}" must not be a preview card`,
			);
		}
	});

	it('keeps the held wording out of the preview sources', () => {
		const previewSource = readRepoFile(PREVIEW_PATH);
		const storySource = readRepoFile(STORY_PATH);
		for (const line of heldOnlyLines(sections)) {
			assert.ok(!previewSource.includes(line), `a held line leaked into ${PREVIEW_PATH}: ${line}`);
			assert.ok(!storySource.includes(line), `a held line leaked into ${STORY_PATH}: ${line}`);
		}
	});

	it('declares no interpretation as adopted', () => {
		for (const card of BRAND_NAME_CARDS) {
			if (!card.heading.startsWith('解釈 ')) continue;
			const status = card.points.find((point) => point.startsWith('採否:'));
			assert.ok(status, `the card "${card.heading}" declares no adoption state`);
			assert.match(status, /保留/, `the card "${card.heading}" must stay held`);
		}
	});
});

describe('brand naming preview capture policy (Issue #521)', () => {
	it('writes a WebP and refuses any other artefact format', () => {
		assert.equal(
			assertWebpOutputPath('docs/verification/brand/361do-name-meanings.webp'),
			'docs/verification/brand/361do-name-meanings.webp',
		);
		assert.throws(
			() => assertWebpOutputPath('docs/verification/brand/361do-name-meanings.png'),
			/non-WebP/,
			'the Issue names a .png path; the repository ships WebP, and the capture must refuse the PNG',
		);
	});

	it('refuses to write outside the repository', () => {
		assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	});

	it('keeps the committed artefact inside the verification budget', () => {
		const verdict = screenshotBudgetVerdict(300 * 1024);
		assert.equal(verdict.withinBudget, true);
		assert.equal(screenshotBudgetVerdict(300 * 1024 + 1).withinBudget, false);
	});

	it('captures the shipped story, not a copy of it', () => {
		assert.equal(STORY_MODULE, 'src/personal/brand-naming/BrandNameMeanings.stories.tsx');
		assert.equal(STORY_EXPORT, 'Standard');
		assert.equal(READY_SELECTOR, '[data-brand-name-meanings-preview]');
	});
});
