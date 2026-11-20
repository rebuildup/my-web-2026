#!/usr/bin/env node
/**
 * check-engagement-preview-parity — Issue #517.
 *
 * What this proves
 * ----------------
 * The verification document
 * `docs/verification/experience/engagement.md` and the preview data
 * (`src/personal/engagement/Engagement.preview.ts`) still agree, and
 * every record the preview cites still exists:
 *
 *   1. every work's title, period label, role, fact and every
 *      technology entry, every variant label and fact, every
 *      comparison-axis label and question, every source path, every
 *      published link and every colophon note appears VERBATIM in the
 *      document — a string that exists on only one side is a failure;
 *   2. every `path` a source declares exists in the repository — a
 *      citation to a record that was moved or deleted fails here;
 *   3. every `sourceId` a work references resolves to a declared
 *      source — a work pointing at nothing is an invented citation;
 *   4. the two variants stay TWO presentations of ONE information
 *      set: exactly the `static` / `interactive` pair, six works, and
 *      the four Issue-named comparison axes.
 *
 * Exit codes: node:test's own (0 = every assertion passed).
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	ENGAGEMENT_CRITERIA,
	ENGAGEMENT_DOCUMENT,
	ENGAGEMENT_LINKS,
	ENGAGEMENT_NOTES,
	ENGAGEMENT_SOURCES,
	ENGAGEMENT_VARIANTS,
	ENGAGEMENT_WORKS,
} from '../src/personal/engagement/Engagement.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The verification document this test keeps in step with the preview. */
const DOCUMENT_PATH = 'docs/verification/experience/engagement.md';

function documentText() {
	return readFileSync(join(REPO_ROOT, DOCUMENT_PATH), 'utf8');
}

function collapse(value) {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

describe('engagement preview parity (Issue #517)', () => {
	it('the verification document exists', () => {
		assert.ok(existsSync(join(REPO_ROOT, DOCUMENT_PATH)), DOCUMENT_PATH);
	});

	it('every declared source path exists in the repository', () => {
		for (const source of ENGAGEMENT_SOURCES) {
			assert.ok(
				existsSync(join(REPO_ROOT, source.path)),
				`source "${source.id}" cites ${source.path}, which does not exist`,
			);
		}
	});

	it('every work sourceId resolves to a declared source', () => {
		const ids = new Set(ENGAGEMENT_SOURCES.map((source) => source.id));
		for (const work of ENGAGEMENT_WORKS) {
			for (const sourceId of work.sourceIds) {
				assert.ok(ids.has(sourceId), `work "${work.id}" cites undeclared source "${sourceId}"`);
			}
			assert.ok(work.sourceIds.length > 0, `work "${work.id}" has no source`);
		}
	});

	it('keeps exactly the static / interactive pair and the four axes', () => {
		assert.deepEqual(
			ENGAGEMENT_VARIANTS.map((variant) => variant.id),
			['static', 'interactive'],
			'Issue #517 compares exactly two presentations of the same information',
		);
		assert.equal(ENGAGEMENT_WORKS.length, 6, 'the information set is the six seed works');
		assert.deepEqual(
			ENGAGEMENT_CRITERIA.map((criterion) => criterion.id),
			['legibility', 'operability', 'loading-cost', 'reduced-motion'],
			'Issue #517 names four comparison axes',
		);
	});

	it('every published link is an https URL', () => {
		for (const link of ENGAGEMENT_LINKS) {
			assert.match(link.url, /^https:\/\//, `link "${link.label}" is not https`);
		}
	});

	it('the document carries every work fact, variant, axis, source, link and note verbatim', () => {
		const doc = collapse(documentText());
		const expected = [
			ENGAGEMENT_DOCUMENT.title,
			...ENGAGEMENT_WORKS.flatMap((work) => [
				work.title,
				work.periodLabel,
				work.role,
				work.fact,
				...work.technologies,
			]),
			...ENGAGEMENT_VARIANTS.flatMap((variant) => [variant.label, ...variant.facts]),
			...ENGAGEMENT_CRITERIA.flatMap((criterion) => [criterion.label, criterion.question]),
			...ENGAGEMENT_SOURCES.map((source) => source.path),
			...ENGAGEMENT_LINKS.map((link) => link.url),
			...ENGAGEMENT_NOTES,
		];
		for (const value of expected) {
			assert.ok(
				doc.includes(collapse(value)),
				`the verification document is missing: ${collapse(value).slice(0, 80)}`,
			);
		}
	});

	it('the document names both PNG artefacts the Issue requires', () => {
		const doc = documentText();
		assert.ok(doc.includes('engagement-static.png'), 'static artefact not named');
		assert.ok(doc.includes('engagement-interactive.png'), 'interactive artefact not named');
	});
});
