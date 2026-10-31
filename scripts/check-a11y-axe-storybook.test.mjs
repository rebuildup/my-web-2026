/**
 * The Issue #392 gate's own unit tests.
 *
 * The gate is the machine half of the Issue's completion condition
 * ("違反 fixture が赤、正常 fixture が緑になる"), so the rules
 * themselves have to be testable without a browser: a rule that can
 * only fail inside a rendering engine is a rule nobody re-runs when it
 * breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AUDITED_STORIES,
	AUDITED_STORY_FILES,
	PENDING_STORIES,
} from '../e2e/a11y/axe-storybook-manifest.ts';
import {
	DECLARABLE_VERDICTS,
	reportedRuleIds,
	resolveStoryEntry,
	storyKey,
	storyNameFromExport,
	verdictFor,
} from '../e2e/a11y/axe-storybook-verdict.ts';
import {
	BASELINE_PATH,
	EXPECTED_FAIL_FIXTURES,
	EXPECTED_PASS_FIXTURES,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	ISSUE,
	RULES,
	auditBaseline,
	auditFixtureSets,
	auditFixtureVerdicts,
	auditManifest,
	auditPending,
	collectEvidence,
	collectUnregisteredStories,
	findStoryExports,
	globToRegExp,
	main,
	renderGateSummary,
} from './check-a11y-axe-storybook.mjs';

/** A story file whose exports the scanner reads. */
const STORY_FILE = 'src/editorial/primitives/Badge.stories.tsx';

/** One audited file entry, for the rules that take an explicit manifest. */
const FILE_ENTRY = {
	file: STORY_FILE,
	title: 'Editorial/Badge',
	exports: ['Neutral'],
	expect: 'pass',
	note: 'x',
};

test('the rules the gate reports are the ones the Issue names', () => {
	assert.equal(ISSUE, '#392');
	assert.deepEqual(RULES, [
		'manifest-story-missing',
		'manifest-duplicate-story',
		'manifest-invalid-verdict',
		'manifest-missing-note',
		'manifest-empty-file',
		'manifest-title-mismatch',
		'pending-story-missing',
		'pending-missing-reason',
		'baseline-story-not-audited',
		'baseline-record-without-reason',
		'baseline-record-for-pass-story',
		'baseline-missing-record',
		'fixture-expectation-mismatch',
	]);
});

test('a declarable verdict is pass or baseline — never fail', () => {
	assert.deepEqual([...DECLARABLE_VERDICTS], ['pass', 'baseline']);
	assert.equal(DECLARABLE_VERDICTS.includes('fail'), false);
});

test('every registered story declares a declarable verdict and a note', () => {
	for (const entry of AUDITED_STORIES) {
		assert.ok(
			DECLARABLE_VERDICTS.includes(entry.expect),
			`${entry.file}#${entry.export} declares "${entry.expect}"`,
		);
		assert.ok(entry.note.trim().length > 0, `${entry.file}#${entry.export} has no note`);
		assert.ok(entry.title.trim().length > 0, `${entry.file}#${entry.export} has no title`);
	}
});

test('every audited file names at least one story', () => {
	for (const entry of AUDITED_STORY_FILES) {
		assert.ok(entry.exports.length > 0, `${entry.file} names no story`);
	}
});

test('every deferred story states a reason', () => {
	for (const entry of PENDING_STORIES) {
		assert.ok(entry.reason.trim().length > 0, `${entry.file}#${entry.export} has no reason`);
	}
});

test('the registered stories are unique', () => {
	const keys = AUDITED_STORIES.map((entry) => storyKey(entry.file, entry.export));
	assert.equal(new Set(keys).size, keys.length);
});

test('the story scanner reads the exported story names', () => {
	const source = [
		"import type { Meta, StoryObj } from '@storybook/react';",
		'const meta = { title: "Editorial/Badge" } satisfies Meta<typeof Badge>;',
		'export default meta;',
		'export const Neutral: Story = { args: {} };',
		'export const Accent: Story = { args: {} };',
		'export function Gallery() { return null; }',
	].join('\n');
	assert.deepEqual(findStoryExports(source, 'story.tsx'), ['Neutral', 'Accent', 'Gallery']);
});

test('the story scanner ignores a story name that only appears in prose', () => {
	const source = [
		'// export const NotAStory = { args: {} };',
		'/* export const AlsoNotAStory = { args: {} }; */',
		'export const Real = {};',
	].join('\n');
	assert.deepEqual(findStoryExports(source, 'story.tsx'), ['Real']);
});

test('the story scanner is not fooled by a path-like string', () => {
	const source = [
		"const meta = { title: 'Editorial/Badge', description: 'Public REST endpoints at /api/v1/*.' };",
		'export const Real = {};',
	].join('\n');
	assert.deepEqual(findStoryExports(source, 'story.tsx'), ['Real']);
});

test('the glob matcher understands the Storybook glob subset', () => {
	const pattern = globToRegExp('src/**/*.stories.@(ts|tsx)');
	assert.equal(pattern.test('src/home/hero.stories.tsx'), true);
	assert.equal(pattern.test('src/home/hero.stories.ts'), true);
	assert.equal(pattern.test('src/home/hero.tsx'), false);
	assert.equal(pattern.test('src/home/hero.stories.js'), false);
});

test('a registered story that the source does not declare is a violation', () => {
	const violations = auditManifest(
		[{ file: STORY_FILE, exports: ['Accent'] }],
		[{ ...FILE_ENTRY, exports: ['Neutral'] }],
	);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'manifest-story-missing');
	assert.match(violations[0].message, /Neutral/);
});

test('a registered story file that does not exist is a violation', () => {
	const violations = auditManifest([], AUDITED_STORY_FILES);
	assert.equal(violations.length, AUDITED_STORY_FILES.length);
	assert.ok(violations.every((entry) => entry.rule === 'manifest-story-missing'));
});

test('a duplicate registration is a violation', () => {
	const violations = auditManifest(
		[{ file: STORY_FILE, exports: ['Neutral'] }],
		[FILE_ENTRY, FILE_ENTRY],
	);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'manifest-duplicate-story');
});

test('an invalid verdict is a violation', () => {
	const violations = auditManifest(
		[{ file: STORY_FILE, exports: ['Neutral'] }],
		[{ ...FILE_ENTRY, expect: 'fail' }],
	);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'manifest-invalid-verdict');
});

test('a registration without a note is a violation', () => {
	const violations = auditManifest(
		[{ file: STORY_FILE, exports: ['Neutral'] }],
		[{ ...FILE_ENTRY, note: '  ' }],
	);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'manifest-missing-note');
});

test('a registration that names no story is a violation', () => {
	const violations = auditManifest(
		[{ file: STORY_FILE, exports: ['Neutral'] }],
		[{ ...FILE_ENTRY, exports: [] }],
	);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'manifest-empty-file');
});

test('a registered title that the file does not declare is a violation', () => {
	const violations = auditManifest(
		[{ file: STORY_FILE, exports: ['Neutral'], title: 'Editorial/Badge' }],
		[{ ...FILE_ENTRY, title: 'editorial/Badge' }],
	);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'manifest-title-mismatch');
});

test('a deferred story that does not exist is a violation', () => {
	const violations = auditPending([], PENDING_STORIES);
	assert.equal(violations.length, PENDING_STORIES.length);
	assert.ok(violations.every((entry) => entry.rule === 'pending-story-missing'));
});

test('a deferral without a reason is a violation', () => {
	const violations = auditPending(
		[{ file: STORY_FILE, exports: ['Neutral'] }],
		[{ file: STORY_FILE, export: 'Neutral', reason: '' }],
	);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'pending-missing-reason');
});

test('a ledger record for a story the manifest does not register is a violation', () => {
	const violations = auditBaseline(
		{
			records: [
				{
					story: 'src/not/registered.stories.tsx#Default',
					ruleId: 'color-contrast',
					nodes: ['#storybook-root > p'],
					reason: 'because',
					recordedAt: '2026-10-23',
				},
			],
		},
		[],
	);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'baseline-story-not-audited');
});

test('a ledger record without a reason is a violation', () => {
	const key = storyKey(STORY_FILE, 'Neutral');
	const violations = auditBaseline(
		{
			records: [
				{
					story: key,
					ruleId: 'color-contrast',
					nodes: ['#storybook-root > p'],
					reason: '',
					recordedAt: '2026-10-23',
				},
			],
		},
		[{ ...FILE_ENTRY, expect: 'baseline' }],
	);
	assert.ok(violations.some((entry) => entry.rule === 'baseline-record-without-reason'));
});

test('a file declared pass may not carry a ledger record', () => {
	const key = storyKey(STORY_FILE, 'Neutral');
	const violations = auditBaseline(
		{
			records: [
				{
					story: key,
					ruleId: 'color-contrast',
					nodes: ['#storybook-root > p'],
					reason: 'because',
					recordedAt: '2026-10-23',
				},
			],
		},
		[FILE_ENTRY],
	);
	assert.ok(violations.some((entry) => entry.rule === 'baseline-record-for-pass-story'));
});

test('a file declared baseline must carry a ledger record', () => {
	const violations = auditBaseline({ records: [] }, [{ ...FILE_ENTRY, expect: 'baseline' }]);
	assert.ok(violations.some((entry) => entry.rule === 'baseline-missing-record'));
});

test('the decision reads a recorded measurement', () => {
	const records = [
		{
			story: 'story#One',
			ruleId: 'color-contrast',
			nodes: ['#storybook-root > p'],
			reason: 'because',
			recordedAt: '2026-10-23',
		},
	];
	const violation = {
		ruleId: 'color-contrast',
		tags: ['wcag2aa'],
		nodes: [{ target: '#storybook-root > p' }],
	};
	assert.equal(verdictFor([], 'story#One', records), 'pass');
	assert.equal(verdictFor([violation], 'story#One', records), 'baseline');
	assert.equal(verdictFor([violation], 'story#Two', records), 'fail');
	assert.deepEqual(reportedRuleIds([violation]), ['color-contrast']);
});

test('the story name Storybook publishes is derived from the export name', () => {
	assert.equal(storyNameFromExport('OneLive'), 'One Live');
	assert.equal(storyNameFromExport('LocaleKo'), 'Locale Ko');
	assert.equal(storyNameFromExport('WithIdForAria'), 'With Id For Aria');
	assert.equal(storyNameFromExport('Neutral'), 'Neutral');
});

test('a registered story resolves to exactly one Storybook entry', () => {
	const index = {
		entries: {
			'badge--neutral': {
				type: 'story',
				id: 'editorial-badge--neutral',
				name: 'Neutral',
				title: 'Editorial/Badge',
				importPath: './src/editorial/primitives/Badge.stories.tsx',
			},
			'badge--accent': {
				type: 'story',
				id: 'editorial-badge--accent',
				name: 'Accent',
				title: 'Editorial/Badge',
				importPath: './src/editorial/primitives/Badge.stories.tsx',
			},
		},
	};
	const entry = resolveStoryEntry(index, 'src/editorial/primitives/Badge.stories.tsx', 'Accent');
	assert.equal(entry.id, 'editorial-badge--accent');
	assert.throws(
		() => resolveStoryEntry(index, 'src/editorial/primitives/Badge.stories.tsx', 'Missing'),
		/does not resolve to exactly one Storybook entry/,
	);
});

test('a story that is neither registered nor deferred is an open item, not a violation', () => {
	const unregistered = collectUnregisteredStories([
		{ file: 'src/editorial/primitives/New.stories.tsx', exports: ['Brand'] },
	]);
	assert.deepEqual(
		unregistered.map((entry) => entry.key),
		['src/editorial/primitives/New.stories.tsx#Brand'],
	);
});

test('the fixture sets are exactly the ones the gate names', () => {
	const mismatches = auditFixtureSets({
		pass: EXPECTED_PASS_FIXTURES.map((name) => ({ file: `${FIXTURE_ROOT}/pass/${name}` })),
		fail: EXPECTED_FAIL_FIXTURES.map((name) => ({ file: `${FIXTURE_ROOT}/fail/${name}` })),
	});
	assert.deepEqual(
		mismatches.map((entry) => entry.message),
		[],
	);
});

test('a missing fixture is a violation', () => {
	const mismatches = auditFixtureSets({ pass: [], fail: [] });
	assert.equal(mismatches.length, EXPECTED_PASS_FIXTURES.length + EXPECTED_FAIL_FIXTURES.length);
	assert.ok(mismatches.every((entry) => entry.rule === 'fixture-expectation-mismatch'));
});

test('a fixture whose declared verdict does not reproduce is a violation', () => {
	const mismatches = auditFixtureVerdicts({
		pass: [
			{
				file: `${FIXTURE_ROOT}/pass/clean-story.json`,
				fixture: {
					story: 'story#One',
					expect: { verdict: 'baseline', ruleIds: [] },
					baseline: [],
					axe: { violations: [] },
				},
			},
		],
		fail: [],
	});
	assert.equal(mismatches.length, 1);
	assert.equal(mismatches[0].rule, 'fixture-expectation-mismatch');
});

test('a fail fixture that stops reporting its rule is a violation', () => {
	const mismatches = auditFixtureVerdicts({
		pass: [],
		fail: [
			{
				file: `${FIXTURE_ROOT}/fail/unknown-violation.json`,
				fixture: {
					story: 'story#One',
					expect: { verdict: 'fail', ruleIds: ['image-alt'] },
					baseline: [],
					axe: {
						violations: [
							{
								ruleId: 'color-contrast',
								tags: ['wcag2aa'],
								nodes: [{ target: '#storybook-root > p' }],
							},
						],
					},
				},
			},
		],
	});
	assert.equal(mismatches.length, 1);
	assert.match(mismatches[0].message, /image-alt/);
});

test('the repository state is clean', () => {
	const evidence = collectEvidence();
	assert.deepEqual(
		evidence.violations.map((entry) => `${entry.rule}: ${entry.file}`),
		[],
	);
	assert.ok(evidence.storyFiles > 0, 'the repository declares story files');
	assert.ok(evidence.audited > 0, 'the manifest registers stories');
});

test('the report separates the machine result from the human evaluation', () => {
	const evidence = collectEvidence();
	const report = renderGateSummary(evidence);
	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.match(report, /open items \(not registered yet/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});

test('the gate exits 0 on a clean repository', () => {
	assert.equal(main(), 0);
});

test('the ledger path is the one the browser audit reads', () => {
	assert.equal(BASELINE_PATH, 'e2e/a11y/axe-storybook-baseline.json');
});
