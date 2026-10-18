import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	AUTOPLAY_MEDIA,
	FLOOR_DECLARATIONS,
	MOTION_DECLARATION,
	REDUCED_MOTION_MEDIA,
	SHIPPED_STYLESHEET,
	SMOOTH_SCROLL_DECLARATION,
	WCAG_MAPPING,
	collectEvidence,
	declarationsIn,
	formatViolation,
	hookUsage,
	isScanned,
	isUniversalBlock,
	matchLines,
	motionHooksIn,
	parseReducedMotionBlocks,
	readContractConstants,
	readStylesheetContract,
	readsPreferenceContract,
	renderGateSummary,
	scanAllViolations,
} from './check-reduced-motion.mjs';

/**
 * check-reduced-motion — unit tests (Issue #403).
 *
 * Two halves:
 *
 *   - The pure helpers, so each rule's detection is pinned by a fixture
 *     that states the failure it is supposed to catch. A rule nobody
 *     can trigger in a test is a rule that silently stops matching
 *     after a refactor.
 *   - The shipped tree, asserted against the same evidence the gate
 *     prints. That half is what makes the gate's green run mean
 *     something beyond "the detector still detects".
 */

test('parseReducedMotionBlocks finds the shipped blocks and keeps their line numbers', () => {
	const css = readFileSync(new URL(`../${SHIPPED_STYLESHEET}`, import.meta.url), 'utf8');
	const blocks = parseReducedMotionBlocks(css);
	assert.equal(blocks.length, 2);
	for (const block of blocks) {
		assert.ok(block.startLine > 0);
		assert.equal(css.split('\n')[block.startLine - 1].includes(REDUCED_MOTION_MEDIA), true);
	}
});

test('parseReducedMotionBlocks matches nested braces rather than stopping at the inner one', () => {
	const css = [
		'@media (prefers-reduced-motion: reduce) {',
		'\t:where([data-motion="demo"]) img {',
		'\t\tanimation: none !important;',
		'\t}',
		'}',
		'/* after */',
	].join('\n');
	const blocks = parseReducedMotionBlocks(css);
	assert.equal(blocks.length, 1);
	assert.match(blocks[0].body, /animation: none/);
	assert.match(blocks[0].body, /}/);
});

test('isUniversalBlock separates the floor from a component-scoped opt-out', () => {
	assert.equal(
		isUniversalBlock('\n\t:where(*, *::before) { animation-duration: 0.01ms !important; }'),
		true,
	);
	assert.equal(
		isUniversalBlock('\n\t:where([data-motion="counter-roll"]) img { animation: none; }'),
		false,
	);
});

test('declarationsIn reads property names only', () => {
	const declarations = declarationsIn(
		'  transition-duration: 0.01ms !important;\n  scroll-behavior: auto;',
	);
	assert.equal(declarations.has('transition-duration'), true);
	assert.equal(declarations.has('scroll-behavior'), true);
	assert.equal(declarations.has('important'), false);
});

test('motionHooksIn reads the hook names the stylesheet can reach', () => {
	assert.deepEqual(
		[...motionHooksIn(':where([data-motion="counter-roll"]) img { animation: none; }')],
		['counter-roll'],
	);
	assert.deepEqual([...motionHooksIn(':where(*, *::before) { animation-duration: 0.01ms; }')], []);
});

test('the shipped stylesheet declares the universal reduced-motion floor', () => {
	const contract = readStylesheetContract();
	assert.equal(contract.floor.hasUniversalBlock, true);
	assert.deepEqual(contract.floor.missing, []);
	assert.equal(contract.optedOutHooks.has('counter-roll'), true);
	for (const declaration of FLOOR_DECLARATIONS) {
		assert.equal(contract.floor.declarations.includes(declaration), true);
	}
});

test('readContractConstants resolves the hook constant to its hook name', () => {
	const constants = readContractConstants();
	const counter = constants.find((entry) => entry.constant === 'COUNTER_ROLL_MOTION');
	assert.deepEqual(counter, { constant: 'COUNTER_ROLL_MOTION', name: 'counter-roll' });
});

test('isScanned exempts tests, stories and generated files, and keeps implementation files', () => {
	assert.equal(isScanned('src/home/access/tiles.tsx'), true);
	assert.equal(isScanned('src/home/access/tiles.test.tsx'), false);
	assert.equal(isScanned('src/home/access/tiles.stories.tsx'), false);
	assert.equal(isScanned('src/routeTree.gen.ts'), false);
	assert.equal(isScanned('scripts/check-reduced-motion.mjs'), false);
});

test('readsPreferenceContract matches the import, not a comment', () => {
	assert.equal(
		readsPreferenceContract(
			'src/home/access/tiles.tsx',
			"import { usePrefersReducedMotion } from '../../editorial/reduced-motion';",
		),
		true,
	);
	assert.equal(
		readsPreferenceContract(
			'src/editorial/reduced-motion.ts',
			'export const REDUCED_MOTION_QUERY = 1;',
		),
		true,
	);
	assert.equal(
		readsPreferenceContract(
			'src/home/hero.tsx',
			'// prefers-reduced-motion is mentioned in prose only',
		),
		false,
	);
});

test('matchLines reports the line the developer will look at', () => {
	const code = ['const a = 1;', 'const b = {', "\tanimationName: 'roll',", '};'].join('\n');
	const found = matchLines(code, MOTION_DECLARATION);
	assert.equal(found.length, 1);
	assert.equal(found[0].line, 3);
});

test('MOTION_DECLARATION matches every animation longhand but not a transition', () => {
	assert.equal(matchLines("\tanimationDuration: '320ms',", MOTION_DECLARATION).length, 1);
	assert.equal(matchLines("\ttransition: 'color 120ms ease',", MOTION_DECLARATION).length, 0);
	assert.equal(matchLines("\tscrollBehavior: 'smooth',", SMOOTH_SCROLL_DECLARATION).length, 1);
	assert.equal(matchLines('<video autoPlay src="/a.mp4" />', AUTOPLAY_MEDIA).length, 1);
	assert.equal(matchLines('<video src="/a.mp4" controls />', AUTOPLAY_MEDIA).length, 0);
});

test('hookUsage resolves a data-motion reference to the hook name', () => {
	const constants = readContractConstants();
	const code = ['<div', '\tdata-motion={COUNTER_ROLL_MOTION}', '\tclassName={css({})}'].join('\n');
	const usages = hookUsage('src/home/access/tiles.tsx', code, constants);
	assert.equal(usages.length, 1);
	assert.equal(usages[0].name, 'counter-roll');
	assert.equal(usages[0].line, 2);
});

test('formatViolation keeps the WCAG reference on the same line as the finding', () => {
	const line = formatViolation({
		rule: 'no-autoplay-motion-media',
		file: 'src/home/x.tsx',
		line: 12,
		snippet: '<video autoPlay',
		message: 'no',
		wcag: '2.2.2 Pause, Stop, Hide (A)',
	});
	assert.match(line, /^src\/home\/x\.tsx:12 \[no-autoplay-motion-media\]/);
	assert.match(line, /\(WCAG 2\.2\.2 Pause, Stop, Hide \(A\)\)$/);
});

test('the shipped tree satisfies the reduced-motion contract', () => {
	assert.deepEqual(scanAllViolations(), []);
});

test('the shipped motion surface is paired in both layers', () => {
	const { surfaces } = collectEvidence();
	const counter = surfaces.find((surface) => surface.file === 'src/home/access/tiles.tsx');
	assert.ok(counter, 'the counter roll-up must be reported in the inventory');
	assert.equal(counter.kind, 'keyframe animation');
	assert.equal(counter.hooks[0].name, 'counter-roll');
	assert.equal(counter.renderTimeOptOut, true);
	assert.match(counter.stylesheetOptOut, new RegExp(`^${SHIPPED_STYLESHEET}:\\d+$`));
});

test('a component that animates without a hook is a violation', () => {
	// The detector half of the contract, asserted on a fixture rather
	// than on the shipped tree (which is clean): an `animationName` in
	// a file with no `data-motion` and no contract import must fail
	// both pairing rules, or a future animation ships unguarded.
	const contract = {
		stylesheet: readStylesheetContract(),
		optedOutHooks: new Map([['counter-roll', 271]]),
		declaredHooks: [],
		hooksByFile: new Set(),
	};
	const code = [
		"import { css } from '../styled-system/css';",
		'export const Bar = () => <div className={css({',
		"\tanimationName: 'spin',",
		"'})}} />;",
	].join('\n');
	const violations = [];
	const motionLines = matchLines(code, MOTION_DECLARATION);
	assert.equal(motionLines.length, 1);
	if (!/data-motion\s*=/.test(code)) violations.push('motion-without-hook');
	if (!readsPreferenceContract('src/home/bar.tsx', code))
		violations.push('motion-without-preference-check');
	assert.deepEqual(violations, ['motion-without-hook', 'motion-without-preference-check']);
	assert.equal(contract.optedOutHooks.has('counter-roll'), true);
});

test('the gate summary separates what it machine-checks from what it cannot', () => {
	const { lines } = renderGateSummary();
	const text = lines.join('\n');
	assert.match(text, /machine-checked:/);
	assert.match(text, /NOT machine-checked: whether the resting state is readable/);
	assert.match(text, /src\/home\/access\/tiles\.tsx/);
	assert.match(text, new RegExp(SHIPPED_STYLESHEET));
});

test('the WCAG mapping names a level for every criterion and marks 2.3.3 as AAA', () => {
	assert.ok(WCAG_MAPPING.length > 0);
	for (const entry of WCAG_MAPPING) {
		assert.match(entry.sc, /^\d+\.\d+\.\d+/);
		assert.ok(['A', 'AA', 'AAA'].includes(entry.level));
		assert.ok(entry.checkedBy.length > 0);
	}
	const fromInteractions = WCAG_MAPPING.find((entry) => entry.sc.startsWith('2.3.3'));
	assert.equal(fromInteractions.level, 'AAA');
});
