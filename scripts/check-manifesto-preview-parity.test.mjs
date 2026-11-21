#!/usr/bin/env node
/**
 * check-manifesto-preview-parity — Issue #535.
 *
 * What this proves
 * ----------------
 * The verification document
 * `docs/verification/vision/manifesto-preview.md` and the preview
 * data (`src/personal/manifesto/Manifesto.preview.ts`) still agree,
 * and every record the preview cites still exists:
 *
 *   1. every question heading, every Miro axis citation, every
 *      material label, every source path, every published link and
 *      every colophon note appears VERBATIM in the document — a
 *      string that exists on only one side is a failure;
 *   2. every `path` a source declares exists in the repository — a
 *      citation to a record that was moved or deleted fails here;
 *   3. every `sourceId` an evidence item or material references
 *      resolves to a declared source — an evidence item pointing at
 *      nothing is an invented citation;
 *   4. the two Miro values remain INDEPENDENT questions: at least
 *      two questions, each with a distinct `miroAxis`, each keeping
 *      its own evidence and its own 未確認 list.
 *
 * Exit codes: node:test's own (0 = every assertion passed).
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	MANIFESTO_DOCUMENT,
	MANIFESTO_LINKS,
	MANIFESTO_MATERIALS,
	MANIFESTO_NOTES,
	MANIFESTO_QUESTIONS,
	MANIFESTO_SOURCES,
} from '../src/personal/manifesto/Manifesto.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The verification document this test keeps in step with the preview. */
const DOCUMENT_PATH = 'docs/verification/vision/manifesto-preview.md';

function documentText() {
	return readFileSync(join(REPO_ROOT, DOCUMENT_PATH), 'utf8');
}

function collapse(value) {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

describe('manifesto preview parity (Issue #535)', () => {
	it('the verification document exists', () => {
		assert.ok(existsSync(join(REPO_ROOT, DOCUMENT_PATH)), DOCUMENT_PATH);
	});

	it('every declared source path exists in the repository', () => {
		for (const source of MANIFESTO_SOURCES) {
			assert.ok(
				existsSync(join(REPO_ROOT, source.path)),
				`source "${source.id}" cites ${source.path}, which does not exist`,
			);
		}
	});

	it('every evidence sourceId and material sourceId resolves to a declared source', () => {
		const ids = new Set(MANIFESTO_SOURCES.map((source) => source.id));
		for (const question of MANIFESTO_QUESTIONS) {
			for (const item of question.evidence) {
				assert.ok(
					ids.has(item.sourceId),
					`question "${question.id}" cites undeclared source "${item.sourceId}"`,
				);
			}
		}
		for (const material of MANIFESTO_MATERIALS) {
			for (const sourceId of material.sourceIds) {
				assert.ok(
					ids.has(sourceId),
					`material "${material.id}" cites undeclared source "${sourceId}"`,
				);
			}
			assert.ok(material.sourceIds.length > 0, `material "${material.id}" has no source`);
		}
	});

	it('keeps at least two Miro values as independent questions', () => {
		assert.ok(
			MANIFESTO_QUESTIONS.length >= 2,
			'Issue #535 requires at least two Miro values kept as independent questions',
		);
		const axes = MANIFESTO_QUESTIONS.map((q) => q.miroAxis);
		assert.equal(
			new Set(axes).size,
			axes.length,
			'two questions citing the same Miro axis are one question, not two',
		);
		for (const question of MANIFESTO_QUESTIONS) {
			assert.ok(question.evidence.length > 0, `${question.id} has no evidence`);
			assert.ok(question.open.length > 0, `${question.id} has no 未確認 list`);
			assert.ok(question.miroAxis.includes('哲学 >'), `${question.id} does not quote a Miro axis`);
		}
	});

	it('every published link is an https URL', () => {
		for (const link of MANIFESTO_LINKS) {
			assert.match(link.url, /^https:\/\//, `link "${link.label}" is not https`);
		}
	});

	it('the document carries every question, source, material, link and note verbatim', () => {
		const doc = collapse(documentText());
		const expected = [
			MANIFESTO_DOCUMENT.title,
			...MANIFESTO_QUESTIONS.flatMap((q) => [q.heading, q.question, q.miroAxis]),
			...MANIFESTO_SOURCES.map((s) => s.path),
			...MANIFESTO_MATERIALS.map((m) => m.label),
			...MANIFESTO_LINKS.map((l) => l.url),
			...MANIFESTO_NOTES,
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
		assert.ok(doc.includes('manifesto-article.png'), 'article artefact not named');
		assert.ok(doc.includes('manifesto-landing.png'), 'landing artefact not named');
	});
});
