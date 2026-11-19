import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * `check-public-internal-identifiers.mjs` unit tests (Issue #837).
 *
 * Pinned contracts:
 *   1. Detection: repo paths, internal field names, Issue/PR refs and
 *      release refs inside visitor-facing text (string literals and
 *      JSX text) are findings; comments and code are not.
 *   2. Negative control: a finding that is neither excepted (confirmed
 *      owner exception) nor baselined is a VIOLATION.
 *   3. Exception control: only `ownerConfirmation: "confirmed"` +
 *      reason + ownerReference suppresses; unconfirmed entries never do.
 *   4. Baseline: file+rule+match membership suppresses as
 *      pending-review (not approval); stale entries are reported.
 */
import {
	evaluateFindings,
	findIdentifiers,
	loadExceptions,
	scanContent,
	stripJsComments,
	textCandidates,
	toBaselineEntries,
} from './check-public-internal-identifiers.mjs';

describe('textCandidates', () => {
	it('extracts string literals and JSX text, skips comments', () => {
		assert.deepEqual(textCandidates('const a = "hello";'), ['hello']);
		assert.deepEqual(textCandidates('// "not copy"'), []);
		assert.deepEqual(textCandidates('<p>表示テキスト</p>'), ['表示テキスト']);
	});
});

describe('findIdentifiers', () => {
	it('detects each rule family', () => {
		assert.deepEqual(findIdentifiers('see src/contact/channels.json'), [
			{ rule: 'repo-path', match: 'src/contact/channels.json' },
		]);
		assert.deepEqual(findIdentifiers('field verified_at here'), [
			{ rule: 'field-name', match: 'verified_at' },
		]);
		assert.deepEqual(findIdentifiers('tracked in Issue #832'), [
			{ rule: 'issue-ref', match: 'Issue #832' },
		]);
		assert.deepEqual(findIdentifiers('ships on release-0-10-0'), [
			{ rule: 'release-ref', match: 'release-0-10-0' },
		]);
	});

	it('returns nothing for ordinary copy', () => {
		assert.deepEqual(findIdentifiers('お問い合わせは GitHub まで。'), []);
	});

	it('ignores repo-path-shaped segments inside URLs', () => {
		assert.deepEqual(
			findIdentifiers(
				'https://developers.google.com/search/docs/appearance/structured-data/search-gallery',
			),
			[],
		);
		// A real repo path next to a URL is still a finding.
		assert.deepEqual(findIdentifiers('see https://example.com and src/contact/channels.json'), [
			{ rule: 'repo-path', match: 'src/contact/channels.json' },
		]);
	});
});

describe('stripJsComments', () => {
	it('drops a trailing line comment but keeps the code', () => {
		const state = { block: false, template: false };
		assert.equal(
			stripJsComments("import x from './y.ts'; // scripts/check-i18n-policy.mjs loads this", state),
			"import x from './y.ts'; ",
		);
	});

	it('keeps // inside strings and after a colon (URLs)', () => {
		const state = { block: false, template: false };
		assert.equal(
			stripJsComments('const u = "https://example.com"; // real comment', state),
			'const u = "https://example.com"; ',
		);
	});

	it('drops JSX brace-wrapped block comments', () => {
		const state = { block: false, template: false };
		assert.equal(
			stripJsComments('<p>{/* see src/editorial/semantic-tokens.ts */}text</p>', state),
			'<p>{}text</p>',
		);
	});

	it('tracks block comments and template literals across lines', () => {
		const state = { block: false, template: false };
		assert.equal(stripJsComments('/**', state), '');
		assert.equal(stripJsComments(' * src/tools/manifest.json note', state), '');
		assert.equal(stripJsComments('continued note line', state), '');
		assert.equal(stripJsComments(' */ const a = 1;', state), ' const a = 1;');
		assert.equal(stripJsComments('const t = `line one', state), 'const t = `line one');
		assert.equal(
			stripJsComments('// not a comment inside template', state),
			'// not a comment inside template',
		);
		assert.equal(stripJsComments('line two`;', state), 'line two`;');
		assert.equal(
			stripJsComments('const s = "still code"; // trailing', state),
			'const s = "still code"; ',
		);
	});
});

describe('scanContent comment precision', () => {
	it('does not report identifiers that only appear in comments', () => {
		const findings = scanContent(
			'src/x/page.tsx',
			[
				'const ok = 1; // see scripts/check-i18n-policy.mjs',
				'/**',
				' * mentions quality/tool-artifact-inventory.json',
				' */',
				'<p>{/* src/editorial/semantic-tokens.ts */}ok</p>',
			].join('\n'),
		);
		assert.equal(findings.length, 0);
	});

	it('still reports identifiers inside real string literals next to comments', () => {
		const findings = scanContent(
			'src/x/page.tsx',
			'const s = "編集は src/contact/channels.json で"; // note',
		);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].match, 'src/contact/channels.json');
	});

	it('does not strip comments in JSON files', () => {
		const findings = scanContent(
			'src/x/data.json',
			'{ "note": "path src/contact/channels.json // tail" }',
		);
		assert.equal(findings.length, 1);
	});
});

describe('scanContent', () => {
	it('reports file, line, rule, match and excerpt', () => {
		const findings = scanContent(
			'src/x/page.tsx',
			['const ok = 1;', 'const s = "編集は src/contact/channels.json で";'].join('\n'),
		);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].file, 'src/x/page.tsx');
		assert.equal(findings[0].line, 2);
		assert.equal(findings[0].rule, 'repo-path');
		assert.equal(findings[0].match, 'src/contact/channels.json');
	});
});

describe('loadExceptions', () => {
	const valid = {
		exceptions: [
			{
				id: 'e1',
				file: 'src/a.ts',
				rule: 'repo-path',
				match: 'src/a.ts',
				reason: 'intentional citation reviewed by owner',
				ownerConfirmation: 'confirmed',
				ownerReference: 'https://example.com/approval',
			},
		],
	};

	it('accepts a well-formed ledger', () => {
		const { exceptions, errors } = loadExceptions(valid);
		assert.equal(errors.length, 0);
		assert.equal(exceptions.length, 1);
	});

	it('rejects missing fields, bad enums and short reasons', () => {
		const { errors } = loadExceptions({
			exceptions: [
				{ id: 'x', ownerConfirmation: 'confirmed' },
				{
					id: 'y',
					file: 'f',
					rule: 'repo-path',
					match: 'm',
					reason: 'short',
					ownerConfirmation: 'confirmed',
				},
				{
					id: 'z',
					file: 'f',
					rule: 'repo-path',
					match: 'm',
					reason: 'a reason long enough to review properly',
					ownerConfirmation: 'confirmed',
				},
			],
		});
		assert.ok(errors.some((e) => e.includes('exceptions[0]')));
		assert.ok(errors.some((e) => e.includes('too short')));
		assert.ok(errors.some((e) => e.includes('ownerReference')));
	});
});

describe('evaluateFindings', () => {
	const finding = {
		file: 'src/contact/page.tsx',
		line: 9,
		rule: 'field-name',
		match: 'verified_at',
		excerpt: '検証日不明 / verified_at unparseable',
	};

	it('negative control: an unmatched finding is a violation', () => {
		const { violations } = evaluateFindings([finding], [], []);
		assert.equal(violations.length, 1);
	});

	it('exception control: confirmed exception suppresses', () => {
		const exceptions = [
			{
				id: 'ok',
				file: finding.file,
				rule: finding.rule,
				match: 'verified_at',
				reason: 'deliberate technical citation',
				ownerConfirmation: 'confirmed',
				ownerReference: 'ref',
			},
		];
		const { violations, suppressed } = evaluateFindings([finding], exceptions, []);
		assert.equal(violations.length, 0);
		assert.equal(suppressed.length, 1);
		assert.equal(suppressed[0].exceptionId, 'ok');
	});

	it('unconfirmed exception never suppresses', () => {
		const exceptions = [
			{
				id: 'pending',
				file: finding.file,
				rule: finding.rule,
				match: 'verified_at',
				reason: 'deliberate technical citation awaiting owner',
				ownerConfirmation: 'unconfirmed',
			},
		];
		const { violations } = evaluateFindings([finding], exceptions, []);
		assert.equal(violations.length, 1);
	});

	it('exception for a different file or rule does not suppress', () => {
		const exceptions = [
			{
				id: 'wrong-file',
				file: 'src/other.ts',
				rule: finding.rule,
				match: 'verified_at',
				reason: 'deliberate technical citation',
				ownerConfirmation: 'confirmed',
				ownerReference: 'ref',
			},
			{
				id: 'wrong-rule',
				file: finding.file,
				rule: 'repo-path',
				match: 'verified_at',
				reason: 'deliberate technical citation',
				ownerConfirmation: 'confirmed',
				ownerReference: 'ref',
			},
		];
		const { violations } = evaluateFindings([finding], exceptions, []);
		assert.equal(violations.length, 1);
	});

	it('baseline suppresses as pending-review, not as exception', () => {
		const baseline = [{ file: finding.file, rule: finding.rule, match: 'verified_at' }];
		const { violations, baselined, suppressed } = evaluateFindings([finding], [], baseline);
		assert.equal(violations.length, 0);
		assert.equal(baselined.length, 1);
		assert.equal(suppressed.length, 0);
	});

	it('baseline key ignores line numbers', () => {
		const moved = { ...finding, line: 999 };
		const baseline = [{ file: finding.file, rule: finding.rule, match: 'verified_at' }];
		const { violations } = evaluateFindings([moved], [], baseline);
		assert.equal(violations.length, 0);
	});

	it('stale baseline entries are reported', () => {
		const baseline = [{ file: 'src/gone.ts', rule: 'repo-path', match: 'src/gone.ts' }];
		const { staleBaseline } = evaluateFindings([], [], baseline);
		assert.equal(staleBaseline.length, 1);
	});
});

describe('toBaselineEntries', () => {
	it('deduplicates on file+rule+match and sorts', () => {
		const findings = [
			{ file: 'b.ts', line: 1, rule: 'repo-path', match: 'src/x', excerpt: '' },
			{ file: 'b.ts', line: 2, rule: 'repo-path', match: 'src/x', excerpt: '' },
			{ file: 'a.ts', line: 1, rule: 'issue-ref', match: 'Issue #1', excerpt: '' },
		];
		const entries = toBaselineEntries(findings);
		assert.equal(entries.length, 2);
		assert.equal(entries[0].file, 'a.ts');
		assert.equal(entries[1].match, 'src/x');
	});
});
