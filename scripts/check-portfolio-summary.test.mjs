import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	clauseIsDerived,
	compareProject,
	normalizeClause,
	numbersIn,
	splitClauses,
} from './check-portfolio-summary.mjs';

/**
 * Tests for the summary-only check (Issue #811).
 *
 * The owner's rule is 「要約はしていいが、加筆してはならない。内容が嘘ばかりになる」.
 * The mechanical half is: every clause the migrated body carries must exist
 * in the legacy body, and every number must exist too. These tests pin the
 * half that is decidable — and, just as importantly, they pin that the check
 * DETECTS an addition, so a green run means something.
 */

describe('normalizeClause', () => {
	it('folds whitespace and punctuation variants but never a word', () => {
		assert.equal(normalizeClause('  作る。 '), '作る。');
		assert.equal(normalizeClause('作る。'), '作る。');
		assert.equal(normalizeClause('abc，def'), 'abc、def');
		assert.equal(normalizeClause('abc,def'), 'abc、def');
		// The word itself is never touched.
		assert.notEqual(normalizeClause('作った'), normalizeClause('作りたい'));
	});
});

describe('splitClauses', () => {
	it('splits on sentences and drops headings and empty lines', () => {
		const clauses = splitClauses('## 動機\n一行目。\n\n二行目！三行目？\n');
		assert.deepEqual(clauses, ['一行目。', '二行目！', '三行目？']);
	});

	it('returns nothing for an empty body', () => {
		assert.deepEqual(splitClauses(''), []);
		assert.deepEqual(splitClauses(null), []);
	});
});

describe('numbersIn', () => {
	it('lists every number a text carries', () => {
		assert.deepEqual(numbersIn('2024年に3点、12.5秒'), ['2024', '3', '12.5']);
	});
});

describe('clauseIsDerived', () => {
	const legacy = ['作った。', '公開した。'];

	it('accepts a clause that IS a legacy clause', () => {
		assert.equal(clauseIsDerived('作った。', legacy), true);
	});

	it('accepts a summary that joins consecutive legacy clauses', () => {
		assert.equal(clauseIsDerived('作った。公開した。', legacy), true);
	});

	it('accepts a summary that keeps the first and the last clause', () => {
		const three = ['作った。', '調整した。', '公開した。'];
		assert.equal(clauseIsDerived('作った。公開した。', three), true);
	});

	it('refuses a clause the legacy text never carried', () => {
		assert.equal(clauseIsDerived('受賞した。', legacy), false);
	});

	it('refuses a clause whose words were rearranged', () => {
		assert.equal(clauseIsDerived('公開した。作った。', legacy), false);
	});
});

describe('compareProject', () => {
	const legacy = {
		title: 'Border',
		summary: 'AfterEffectsで縁取りを描画するエフェクトです',
		body: '## 動機\nCpuを軽くしたかった。\n',
	};

	it('accepts a migrated body that repeats the legacy text', () => {
		const result = compareProject({
			legacy,
			migrated: {
				title: 'Border',
				summary: 'AfterEffectsで縁取りを描画するエフェクトです',
				motivation_md: 'Cpuを軽くしたかった。',
				architecture_md: null,
				constraints_md: null,
				implementation_md: null,
				evidence_md: null,
				retrospective_md: null,
			},
		});
		assert.deepEqual(result.additions, []);
		assert.deepEqual(result.newNumbers, []);
	});

	it('reports an added clause and an added number', () => {
		const result = compareProject({
			legacy,
			migrated: {
				title: 'Border',
				summary: 'AfterEffectsで縁取りを描画するエフェクトです',
				motivation_md: 'Cpuを軽くしたかった。この作品は2024年に受賞しました。',
				architecture_md: null,
				constraints_md: null,
				implementation_md: null,
				evidence_md: null,
				retrospective_md: null,
			},
		});
		assert.ok(result.additions.length > 0);
		assert.ok(result.newNumbers.includes('2024'));
	});
});
