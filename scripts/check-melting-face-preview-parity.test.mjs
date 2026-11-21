#!/usr/bin/env node

/**
 * check-melting-face-preview-parity — the document and the preview
 * must say the same thing (Issue #522).
 *
 * What it asserts
 * ---------------
 * `docs/brand/melting-face.md` is the source of truth for the
 * "melting face" brand motif, and
 * `src/personal/melting-face/MeltingFace.preview.ts` is its
 * projection into a Storybook preview:
 *
 *   1. the document's `##` heading set equals the preview's section
 *      headings, in the same order — a heading that exists on only one
 *      side is a failure, not a warning;
 *   2. the motif section's bullet lines (`連鎖 N:` / `コピー（…）:` /
 *      `アイコン:` / `アセット状態:`) appear on both sides, generated
 *      from the data by `meltingFaceMotifBullets`;
 *   3. every section bullet appears on both sides;
 *   4. every chain label, every copy role, the icon's alt / fallback /
 *      asset strings and every explanation candidate appear in the
 *      document — the preview cannot claim a string the document does
 *      not carry;
 *   5. the explanation candidates stay UNRESOLVED: the document keeps
 *      the 「説明の候補（未決着）」 section and records that no
 *      adoption decision was made — the issue requires the 熱中 /
 *      時間を惜しみなく投資 / 無駄なこと tension to survive.
 *
 * Exit codes: node:test's own (0 = every assertion passed).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	MELTING_FACE_CHAIN,
	MELTING_FACE_COPY,
	MELTING_FACE_DOCUMENT,
	MELTING_FACE_EXPLANATIONS,
	MELTING_FACE_ICON,
	MELTING_FACE_LEGEND,
	MELTING_FACE_SECTIONS,
	meltingFaceMotifBullets,
} from '../src/personal/melting-face/MeltingFace.preview.ts';
import {
	DEFAULT_ARTEFACT_PATH,
	FALLBACK_ARTEFACT_PATH,
	PNG_BUDGET_BYTES,
	STORY_FALLBACK,
	STORY_MODULE,
	STORY_PREVIEW,
	assertPngOutputPath,
	screenshotBudgetVerdict,
} from './capture-melting-face.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The document this test keeps in step with the preview. */
const DOCUMENT_PATH = 'docs/brand/melting-face.md';

const documentText = readFileSync(join(REPO_ROOT, DOCUMENT_PATH), 'utf8');

/**
 * The document's `##` headings, in order.
 *
 * `###` sub-headings are NOT included (the character after `##` must be
 * a space), and a heading inside a fenced code block is not a heading —
 * the fence state is tracked so a fence in the document cannot invent
 * one.
 */
function documentHeadings(markdown) {
	const headings = [];
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const match = /^## (.+)$/.exec(line);
		if (match) headings.push(match[1]);
	}
	return headings;
}

/**
 * The document split into sections, keyed by heading.
 *
 * The body of a section is everything up to the next `##` heading.
 */
function documentSections(markdown) {
	const sections = new Map();
	let current = null;
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			if (current) current.body.push(line);
			continue;
		}
		if (!inFence) {
			const heading = /^## (.+)$/.exec(line);
			if (heading) {
				current = { heading: heading[1], body: [] };
				sections.set(heading[1], current);
				continue;
			}
		}
		if (current) current.body.push(line);
	}
	return sections;
}

/** The bullet lines of one section body, `- ` prefix stripped. */
function sectionBullets(body) {
	return body.filter((line) => /^- /.test(line)).map((line) => line.slice(2));
}

const sections = documentSections(documentText);
const expectedHeadings = [
	MELTING_FACE_LEGEND.heading,
	...MELTING_FACE_SECTIONS.map((section) => section.heading),
];

describe('document / preview heading parity', () => {
	it('declares the same `##` headings, in the same order', () => {
		assert.deepEqual(documentHeadings(documentText), expectedHeadings);
	});

	it('has a body for every heading the preview declares', () => {
		for (const heading of expectedHeadings) {
			assert.ok(sections.has(heading), `missing section: ${heading}`);
		}
	});
});

describe('motif parity', () => {
	it('carries the motif bullets generated from the data', () => {
		const body = sections.get(MELTING_FACE_LEGEND.heading)?.body ?? [];
		assert.deepEqual(sectionBullets(body), [...meltingFaceMotifBullets()]);
	});

	it('carries the legend lead paragraph', () => {
		const body = (sections.get(MELTING_FACE_LEGEND.heading)?.body ?? []).join('\n');
		assert.ok(body.includes(MELTING_FACE_LEGEND.lead), 'missing legend lead');
	});

	it('carries every chain label, in the issue order', () => {
		const bullets = meltingFaceMotifBullets();
		MELTING_FACE_CHAIN.forEach((step, index) => {
			assert.ok(
				bullets.includes(`連鎖 ${index + 1}: ${step.label}`),
				`missing chain step ${index + 1}: ${step.label}`,
			);
		});
	});
});

describe('section parity', () => {
	for (const section of MELTING_FACE_SECTIONS) {
		it(`carries every bullet of "${section.heading}"`, () => {
			const body = sections.get(section.heading)?.body ?? [];
			const bullets = sectionBullets(body);
			assert.deepEqual(bullets, [...section.bullets]);
		});
	}
});

describe('the strings come from the document', () => {
	it('every copy role appears in the document', () => {
		for (const value of [
			MELTING_FACE_COPY.short,
			MELTING_FACE_COPY.long,
			MELTING_FACE_COPY.english,
		]) {
			assert.ok(documentText.includes(value), `missing copy string: ${value}`);
		}
	});

	it('every icon string appears in the document', () => {
		for (const value of [
			MELTING_FACE_ICON.label,
			MELTING_FACE_ICON.alt,
			MELTING_FACE_ICON.fallbackText,
			MELTING_FACE_ICON.assetNote,
		]) {
			assert.ok(documentText.includes(value), `missing icon string: ${value}`);
		}
	});

	it('every explanation candidate appears in the document', () => {
		for (const explanation of MELTING_FACE_EXPLANATIONS) {
			assert.ok(
				documentText.includes(explanation.label),
				`missing explanation candidate: ${explanation.label}`,
			);
		}
	});
});

describe('the explanation tension stays unresolved', () => {
	it('keeps the unresolved-candidates section', () => {
		const section = sections.get('説明の候補（未決着）');
		assert.ok(section, 'the document must keep the 説明の候補（未決着） section');
		const body = section.body.join('\n');
		assert.ok(body.includes('矛盾を消さず'), 'the section must say the contradiction is kept');
		assert.ok(
			body.includes('決定も行っていない'),
			'the section must record that nothing was decided',
		);
	});

	it('marks every candidate as unresolved in the preview data', () => {
		const unresolved = MELTING_FACE_SECTIONS.find(
			(section) => section.heading === '説明の候補（未決着）',
		);
		assert.ok(unresolved, 'the preview data must carry the unresolved-candidates section');
		assert.ok(
			unresolved.bullets.some((bullet) => bullet.includes('未決')),
			'the candidates section must mark the candidates as undecided',
		);
	});
});

describe('document metadata', () => {
	it('carries the preview paths the data declares', () => {
		assert.ok(documentText.includes(MELTING_FACE_DOCUMENT.preview));
		assert.ok(documentText.includes(MELTING_FACE_DOCUMENT.verification));
	});
});

describe('capture policy (Issue #522)', () => {
	it('writes PNGs and refuses any other artefact format', () => {
		assert.equal(
			assertPngOutputPath(DEFAULT_ARTEFACT_PATH, REPO_ROOT),
			join(REPO_ROOT, DEFAULT_ARTEFACT_PATH),
		);
		assert.equal(
			assertPngOutputPath(FALLBACK_ARTEFACT_PATH, REPO_ROOT),
			join(REPO_ROOT, FALLBACK_ARTEFACT_PATH),
		);
		assert.throws(
			() => assertPngOutputPath('docs/verification/brand/melting-face-preview.webp', REPO_ROOT),
			/non-PNG/,
		);
	});

	it('refuses to write outside the repository', () => {
		assert.throws(() => assertPngOutputPath('../outside.png', REPO_ROOT), /outside the repository/);
	});

	it('keeps the committed artefacts inside the verification budget', () => {
		assert.equal(screenshotBudgetVerdict(PNG_BUDGET_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(PNG_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('captures the shipped stories, not copies of them', () => {
		assert.equal(STORY_MODULE, 'src/personal/melting-face/MeltingFace.stories.tsx');
		assert.equal(STORY_PREVIEW, 'Default');
		assert.equal(STORY_FALLBACK, 'Fallback');
	});
});
