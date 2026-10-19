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
	analyzeRegion,
	collectEvidence,
	declarationsIn,
	declaresPreferenceProp,
	formatViolation,
	hookUsage,
	isScanned,
	isUniversalBlock,
	matchLines,
	motionHookAttributes,
	motionHooksIn,
	motionRegions,
	parseReducedMotionBlocks,
	readContractConstants,
	readPreferencePropName,
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
	// Only `*_MOTION` constants are hook names. The contract also
	// publishes the attribute, the media query and the prop name, and
	// treating those as hooks would put the strings "data-motion" and
	// "(prefers-reduced-motion: reduce)" into the stylesheet pairing.
	for (const published of [
		'MOTION_HOOK_ATTRIBUTE',
		'REDUCED_MOTION_QUERY',
		'REDUCED_MOTION_PROP',
	]) {
		assert.equal(
			constants.some((entry) => entry.constant === published),
			false,
			`${published} is not a hook name`,
		);
	}
});

test('readPreferencePropName publishes the prop a child receives the decision under', () => {
	// `CounterTile` reads the hook and hands the answer to the digit
	// strip; if the contract stopped publishing this name the gate
	// would report the shipped surface as unguarded, which is the
	// behaviour we want (fail closed rather than silently trust a
	// prop called anything else).
	assert.equal(readPreferencePropName(), 'reducedMotion');
	const tile = readFileSync(new URL('../src/home/access/tiles.tsx', import.meta.url), 'utf8');
	assert.match(tile, /function DigitStrip\(\{[\s\S]*?reducedMotion[,}]/);
});

test('isScanned exempts tests, stories and generated files, and keeps implementation files', () => {
	assert.equal(isScanned('src/home/access/tiles.tsx'), true);
	assert.equal(isScanned('src/home/access/tiles.test.tsx'), false);
	assert.equal(isScanned('src/home/access/tiles.stories.tsx'), false);
	assert.equal(isScanned('src/routeTree.gen.ts'), false);
	assert.equal(isScanned('scripts/check-reduced-motion.mjs'), false);
});

test('readsPreferenceContract requires a CALL, not an import of the module', () => {
	assert.equal(
		readsPreferenceContract(
			'src/home/access/tiles.tsx',
			"import { usePrefersReducedMotion } from '../../editorial/reduced-motion';\nexport const A = () => null;",
		),
		false,
		'an import is not a read: the component still has no answer to give',
	);
	assert.equal(
		readsPreferenceContract(
			'src/home/access/tiles.tsx',
			"import { usePrefersReducedMotion } from '../../editorial/reduced-motion';\nexport const A = () => usePrefersReducedMotion();",
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

test('declaresPreferenceProp recognises the contract prop name only', () => {
	assert.equal(declaresPreferenceProp('function S({ reducedMotion }) {}', 'reducedMotion'), true);
	assert.equal(declaresPreferenceProp('function S({ quiet }) {}', 'reducedMotion'), false);
});

test('motionRegions gives each top-level declaration its own region', () => {
	const code = [
		"import { css } from '../styled-system/css';",
		"const moduleLevel = css({ animationName: 'background' });",
		'const SLOTS = 7;',
		'export function A() {',
		"\treturn <div className={css({ animationName: 'a' })} />;",
		'}',
		'export function B() {',
		"\treturn <div className={css({ animationName: 'b' })} />;",
		'}',
	].join('\n');
	assert.deepEqual(
		motionRegions(code).map((region) => region.name),
		['<module>', 'moduleLevel', 'SLOTS', 'A', 'B'],
	);
	// The point of the split: B's animation cannot claim A's hook, and a
	// module-level animation is scoped to the module scope itself.
	const regions = motionRegions(code);
	assert.match(regions[1].text, /animationName: 'background'/);
	assert.doesNotMatch(regions[4].text, /animationName: 'background'/);
});

test('matchLines reports the line the developer will look at', () => {
	const code = ['const a = 1;', 'const b = {', "\tanimationName: 'roll',", '};'].join('\n');
	const found = matchLines(code, MOTION_DECLARATION);
	assert.equal(found.length, 1);
	assert.equal(found[0].line, 3);
});

test('MOTION_DECLARATION matches every animation longhand, the shorthand, not a transition', () => {
	assert.equal(matchLines("\tanimationDuration: '320ms',", MOTION_DECLARATION).length, 1);
	// Panda accepts the shorthand in the same object literal, so a gate
	// that only knew the longhands would pass a surface that animates.
	assert.equal(matchLines("\tanimation: 'spin 1s linear infinite',", MOTION_DECLARATION).length, 1);
	assert.equal(matchLines("\ttransition: 'color 120ms ease',", MOTION_DECLARATION).length, 0);
	assert.equal(matchLines("\tanimations: 'spin',", MOTION_DECLARATION).length, 0);
	assert.equal(matchLines("\tscrollBehavior: 'smooth',", SMOOTH_SCROLL_DECLARATION).length, 1);
	assert.equal(matchLines('<video autoPlay src="/a.mp4" />', AUTOPLAY_MEDIA).length, 1);
	assert.equal(matchLines('<video src="/a.mp4" controls />', AUTOPLAY_MEDIA).length, 0);
});

test('motionHookAttributes resolves a contract constant, a literal and a computed value', () => {
	const constants = readContractConstants();
	const code = [
		'export function A() {',
		'\treturn <div data-motion={COUNTER_ROLL_MOTION} />;',
		'}',
		'export function B() {',
		'\treturn <div data-motion="spinner" />;',
		'}',
		'export function C({ name }) {',
		'\treturn <div data-motion={name} />;',
		'}',
	].join('\n');
	const hooks = motionRegions(code)
		.flatMap((region) => motionHookAttributes(code, region, constants))
		.map((hook) => [hook.source, hook.name]);
	assert.deepEqual(hooks, [
		['constant', 'counter-roll'],
		['literal', 'spinner'],
		['dynamic', null],
	]);
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
	// The pairing is per component, and the digit strip is the
	// component that emits the declarations.
	assert.equal(counter.region, 'DigitStrip');
	assert.equal(counter.hooks[0].name, 'counter-roll');
	assert.equal(counter.renderTimeOptOut, true);
	assert.match(counter.stylesheetOptOut, new RegExp(`^${SHIPPED_STYLESHEET}:\\d+$`));
});

/** Rules the gate reports for a fixture file. */
function rulesFor(code, overrides = {}) {
	const constants = overrides.constants ?? readContractConstants();
	const preferenceProp = overrides.preferenceProp ?? readPreferencePropName();
	const stylesheet = overrides.stylesheet ?? {
		file: SHIPPED_STYLESHEET,
		optedOutHooks: new Map([['counter-roll', 271]]),
	};
	const rules = [];
	for (const region of motionRegions(code)) {
		const analysis = analyzeRegion({
			scanPath: 'src/home/fixture.tsx',
			code,
			region,
			constants,
			preferenceProp,
			stylesheet,
		});
		rules.push(...analysis.violations.map((entry) => entry.rule));
	}
	return rules;
}

test('a fully paired component is clean, including the animation shorthand', () => {
	const rules = rulesFor(
		[
			"import { usePrefersReducedMotion } from '../../editorial/reduced-motion';",
			'export function Good() {',
			'\tconst reduced = usePrefersReducedMotion();',
			'\treturn <div data-motion={COUNTER_ROLL_MOTION} className={css({',
			"\t\tanimation: reduced ? 'none' : 'spin 1s linear infinite',",
			'\t})} />;',
			'}',
		].join('\n'),
	);
	assert.deepEqual(rules, []);
});

test('a component that animates without a hook is a violation', () => {
	// The detector half of the contract, asserted on a fixture rather
	// than on the shipped tree (which is clean): an `animationName` in a
	// component with no `data-motion` and no contract read must fail both
	// pairing rules, or a future animation ships unguarded.
	const rules = rulesFor(
		[
			"import { css } from '../styled-system/css';",
			'export const Bar = () => <div className={css({',
			"\tanimationName: 'spin',",
			"'})}} />;",
		].join('\n'),
	);
	assert.deepEqual(rules, ['motion-without-hook', 'motion-without-preference-check']);
});

test('importing the contract without reading the preference is a violation', () => {
	// The `data-motion` constant comes from the same module the hook
	// comes from, so an import satisfies a file-level "reads the
	// contract" test while the component animates identically in both
	// preference modes.
	const rules = rulesFor(
		[
			"import { COUNTER_ROLL_MOTION } from '../../editorial/reduced-motion';",
			'export const Bar = () => <div data-motion={COUNTER_ROLL_MOTION} className={css({',
			"\tanimationName: 'spin',",
			"'})}} />;",
		].join('\n'),
	);
	assert.deepEqual(rules, ['motion-without-preference-check']);
});

test('a protected sibling component does not launder an unguarded one', () => {
	const rules = rulesFor(
		[
			"import { usePrefersReducedMotion } from '../../editorial/reduced-motion';",
			'export function Protected() {',
			'\tconst reduced = usePrefersReducedMotion();',
			'\treturn <div data-motion={COUNTER_ROLL_MOTION} className={css({',
			"\t\tanimationName: 'ok',",
			'\t})} />;',
			'}',
			'export function Unprotected() {',
			'\treturn <div className={css({',
			"\t\tanimationName: 'spin',",
			'\t})} />;',
			'}',
		].join('\n'),
	);
	assert.deepEqual(rules, ['motion-without-hook', 'motion-without-preference-check']);
});

test('a data-motion value the contract cannot resolve is a violation', () => {
	const literal = rulesFor(
		[
			'export function Spinner({ reducedMotion }) {',
			'\treturn <div data-motion="spinner" className={css({ animationName: \'spin\' })} />;',
			'}',
		].join('\n'),
	);
	assert.deepEqual(literal, ['motion-without-contract-hook', 'motion-without-stylesheet-opt-out']);

	const dynamic = rulesFor(
		[
			'export function Spinner({ reducedMotion, hook }) {',
			"\treturn <div data-motion={hook} className={css({ animationName: 'spin' })} />;",
			'}',
		].join('\n'),
	);
	assert.deepEqual(dynamic, ['motion-without-hook', 'motion-without-contract-hook']);
});

test('a contract hook with no reduced-motion selector is a dead opt-out', () => {
	const rules = rulesFor(
		[
			'export function Spinner({ reducedMotion }) {',
			"\treturn <div data-motion={SPINNER_MOTION} className={css({ animationName: 'spin' })} />;",
			'}',
		].join('\n'),
		{ constants: [{ constant: 'SPINNER_MOTION', name: 'spinner' }] },
	);
	assert.deepEqual(rules, ['motion-without-stylesheet-opt-out']);
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
