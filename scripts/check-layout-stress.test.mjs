import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	DECLARED_GUTTER_PROBES,
	DECLARED_OPTIONAL_TARGETS,
	DECLARED_TARGETS,
	STRESS_SECTIONS,
	STRESS_VIEWPORT,
	TOLERANCE_PX,
	VARIANTS,
	collectLayoutSnapshot,
	evaluateStressRun,
	renderStressFixture,
	requiredControlRules,
} from './layout-stress.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/* ------------------------------------------------------------------ *
 * synthetic measurements
 *
 * The browser half of the detector needs a real Chromium, which a
 * `node --test` run must not require. These factories build snapshots
 * with the exact shape `collectLayoutSnapshot` returns so every rule
 * can be proved to fire — including the classic-scrollbar rules, which
 * an overlay-scrollbar host cannot observe at all.
 * ------------------------------------------------------------------ */

const CONTENT_WIDTH = 305;

function defaultSections(overrides = {}) {
	return STRESS_SECTIONS.map((section) => ({
		id: section.id,
		left: 0,
		right: CONTENT_WIDTH,
		width: CONTENT_WIDTH,
		height: 400,
		...overrides,
	}));
}

function defaultTargets(overrides = {}) {
	return DECLARED_TARGETS.map((target) => ({
		id: target.id,
		left: 8,
		right: CONTENT_WIDTH - 8,
		width: CONTENT_WIDTH - 16,
		height: 48,
		scrollContained: target.scrollContained === true,
		scrollAnchor: target.scrollContained === true ? 'table-scroller' : null,
		...overrides,
	}));
}

function defaultProbes(width = CONTENT_WIDTH) {
	return DECLARED_GUTTER_PROBES.map((id) => ({ id, width }));
}

/**
 * @param {object} [overrides] merged into the healthy snapshot
 * @returns {object} a snapshot shaped like `collectLayoutSnapshot`
 */
function snapshot(overrides = {}) {
	const { probes, ...rest } = overrides;
	return {
		variant: 'baseline',
		viewport: { innerWidth: 320, innerHeight: STRESS_VIEWPORT.height },
		root: {
			clientWidth: CONTENT_WIDTH,
			clientHeight: STRESS_VIEWPORT.height,
			scrollWidth: CONTENT_WIDTH,
			scrollHeight: 4808,
			gutterDeclaration: 'stable',
			overflowY: 'scroll',
		},
		scrollbarWidth: 15,
		documentGutter: 15,
		sections: defaultSections(),
		targets: defaultTargets(),
		probes: defaultProbes(),
		environment: {
			userAgent: 'fixture',
			language: 'ja-JP',
			fontStatus: 'loaded',
		},
		...rest,
		...(probes === undefined ? {} : { probes }),
	};
}

/** A healthy run: classic 15px scrollbar, gutter reserved, nothing shifts. */
function healthyRun(overrides = {}) {
	return {
		withScrollbar: snapshot(overrides.withScrollbar),
		withoutScrollbar: snapshot({
			scrollbarWidth: 15,
			documentGutter: 15,
			root: { ...snapshot().root, overflowY: 'hidden' },
			...overrides.withoutScrollbar,
		}),
	};
}

const rules = (result) => result.errors.map((error) => error.rule);

/* ------------------------------------------------------------------ *
 * the healthy case
 * ------------------------------------------------------------------ */

describe('evaluateStressRun — healthy fixture', () => {
	it('passes a classic-scrollbar snapshot with the gutter reserved', () => {
		const result = evaluateStressRun(healthyRun());
		assert.deepEqual(result.errors, []);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.stats.sections, STRESS_SECTIONS.length);
		assert.equal(result.stats.gutterObservable, true);
		assert.equal(result.stats.clientWidth, CONTENT_WIDTH);
	});

	it('records the warning instead of pretending to measure on overlay scrollbars', () => {
		const result = evaluateStressRun(
			healthyRun({
				withScrollbar: { scrollbarWidth: 0, documentGutter: 0 },
				withoutScrollbar: { scrollbarWidth: 0, documentGutter: 0 },
			}),
		);
		assert.deepEqual(result.errors, []);
		assert.deepEqual(
			result.warnings.map((warning) => warning.rule),
			['gutter_not_observable'],
		);
		assert.equal(result.stats.gutterObservable, false);
	});

	it('tolerates sub-pixel rounding up to the declared tolerance', () => {
		const result = evaluateStressRun(
			healthyRun({
				withScrollbar: {
					root: { ...snapshot().root, scrollWidth: CONTENT_WIDTH + TOLERANCE_PX },
				},
			}),
		);
		assert.deepEqual(result.errors, []);
	});
});

/* ------------------------------------------------------------------ *
 * every rule has to be able to fail
 * ------------------------------------------------------------------ */

describe('evaluateStressRun — fail-closed rules', () => {
	it('fails when the probe returned nothing usable', () => {
		assert.deepEqual(rules(evaluateStressRun({ withScrollbar: null, withoutScrollbar: null })), [
			'snapshot_incomplete',
		]);
		const partial = evaluateStressRun({ withScrollbar: {}, withoutScrollbar: snapshot() });
		assert.deepEqual(rules(partial), ['snapshot_incomplete']);
	});

	it('fails when the fixture never scrolled, so no scrollbar was in play', () => {
		const short = snapshot();
		const result = evaluateStressRun(
			healthyRun({
				withScrollbar: {
					root: { ...short.root, clientHeight: 4808, scrollHeight: 4808 },
				},
			}),
		);
		assert.ok(rules(result).includes('scroll_scenario_unreproduced'));
	});

	it('fails when a declared section is absent or rendered with zero area', () => {
		const absent = evaluateStressRun(
			healthyRun({ withScrollbar: { sections: defaultSections().slice(1) } }),
		);
		assert.ok(rules(absent).includes('fixture_section_missing'));

		const collapsed = evaluateStressRun(
			healthyRun({ withScrollbar: { sections: defaultSections({ height: 0 }) } }),
		);
		assert.ok(rules(collapsed).includes('fixture_section_missing'));
	});

	it('fails when a section is rendered but not declared', () => {
		const result = evaluateStressRun(
			healthyRun({
				withScrollbar: {
					sections: [...defaultSections(), { id: 'undeclared', width: 100, height: 100 }],
				},
			}),
		);
		assert.ok(rules(result).includes('fixture_section_undeclared'));
	});

	it('fails when a declared target was not measured or is undeclared', () => {
		const missing = evaluateStressRun(
			healthyRun({ withScrollbar: { targets: defaultTargets().slice(1) } }),
		);
		assert.ok(rules(missing).includes('stress_target_missing'));

		const undeclared = evaluateStressRun(
			healthyRun({
				withScrollbar: {
					targets: [
						...defaultTargets(),
						{ id: 'rogue', left: 0, right: 10, width: 10, height: 10 },
					],
				},
			}),
		);
		assert.ok(rules(undeclared).includes('stress_target_undeclared'));
	});

	it('does not require the control-only target in the healthy fixture', () => {
		const result = evaluateStressRun(healthyRun());
		assert.equal(DECLARED_OPTIONAL_TARGETS.length, 1);
		assert.deepEqual(result.errors, []);
	});

	it('fails on horizontal document overflow and on a target leaving the content box', () => {
		const overflow = evaluateStressRun(
			healthyRun({
				withScrollbar: {
					root: { ...snapshot().root, scrollWidth: 1200 },
					targets: [
						...defaultTargets(),
						{
							id: DECLARED_OPTIONAL_TARGETS[0].id,
							left: 0,
							right: 1200,
							width: 1200,
							height: 8,
							scrollContained: false,
							scrollAnchor: null,
						},
					],
				},
			}),
		);
		assert.ok(rules(overflow).includes('viewport_overflow'));
		assert.ok(rules(overflow).includes('target_overflow'));
	});

	it('fails when a target is marked scroll-contained without a scroll container', () => {
		const result = evaluateStressRun(
			healthyRun({
				withScrollbar: {
					targets: defaultTargets().map((target) =>
						target.id === 'table' ? { ...target, scrollAnchor: null } : target,
					),
				},
			}),
		);
		assert.ok(rules(result).includes('scroll_anchor_missing'));
	});

	it('fails when the gutter declaration is not applied', () => {
		const result = evaluateStressRun(
			healthyRun({
				withScrollbar: {
					root: { ...snapshot().root, gutterDeclaration: 'auto' },
					documentGutter: 0,
				},
			}),
		);
		assert.ok(rules(result).includes('gutter_policy_missing'));
	});

	it('fails when scrollbar-gutter: stable reserves nothing on a classic-scrollbar host', () => {
		const result = evaluateStressRun(healthyRun({ withScrollbar: { documentGutter: 0 } }));
		assert.ok(rules(result).includes('gutter_not_reserved'));
	});

	it('fails when a full-width probe changes width with the scrollbar', () => {
		const result = evaluateStressRun({
			withScrollbar: snapshot(),
			withoutScrollbar: snapshot({
				scrollbarWidth: 15,
				documentGutter: 0,
				probes: defaultProbes(CONTENT_WIDTH + 15),
			}),
		});
		const shiftErrors = result.errors.filter((error) => error.rule === 'content_shift');
		assert.equal(shiftErrors.length, DECLARED_GUTTER_PROBES.length);
		assert.match(shiftErrors[0].message, /changes width by 15\.00px/);
	});

	it('fails when a gutter probe was not measured in both runs', () => {
		const result = evaluateStressRun({
			withScrollbar: snapshot({ probes: defaultProbes().slice(1) }),
			withoutScrollbar: snapshot(),
		});
		assert.ok(rules(result).includes('gutter_probe_missing'));
	});
});

/* ------------------------------------------------------------------ *
 * controls
 * ------------------------------------------------------------------ */

describe('requiredControlRules', () => {
	it('requires the shift on classic scrollbars and the declaration otherwise', () => {
		assert.deepEqual(requiredControlRules('control-gutter', { gutterObservable: true }), [
			'content_shift',
		]);
		assert.deepEqual(requiredControlRules('control-gutter', { gutterObservable: false }), [
			'gutter_policy_missing',
		]);
		assert.deepEqual(requiredControlRules('control-overflow'), [
			'viewport_overflow',
			'target_overflow',
		]);
	});

	it('rejects an unknown control instead of defaulting to "nothing to prove"', () => {
		assert.throws(() => requiredControlRules('control-nope'), /unknown control variant/);
	});

	it('proves both controls are catchable by the same evaluator', () => {
		// control-overflow: the injected fixed-width block.
		const overflow = evaluateStressRun({
			withScrollbar: snapshot({
				root: { ...snapshot().root, scrollWidth: 1200 },
				targets: [
					...defaultTargets(),
					{
						id: DECLARED_OPTIONAL_TARGETS[0].id,
						left: 0,
						right: 1200,
						width: 1200,
						height: 8,
					},
				],
			}),
			withoutScrollbar: snapshot(),
		});
		for (const rule of requiredControlRules('control-overflow'))
			assert.ok(rules(overflow).includes(rule));

		// control-gutter: the released reservation, observed on classic
		// scrollbars (the branch an overlay-scrollbar host cannot reach).
		const released = evaluateStressRun({
			withScrollbar: snapshot({
				root: { ...snapshot().root, gutterDeclaration: 'auto' },
				documentGutter: 0,
			}),
			withoutScrollbar: snapshot({ documentGutter: 0, probes: defaultProbes(CONTENT_WIDTH + 15) }),
		});
		for (const rule of requiredControlRules('control-gutter', { gutterObservable: true })) {
			assert.ok(rules(released).includes(rule));
		}
	});
});

/* ------------------------------------------------------------------ *
 * the fixture itself
 * ------------------------------------------------------------------ */

describe('renderStressFixture', () => {
	const html = renderStressFixture();

	it('renders every declared section and target exactly once', () => {
		for (const section of STRESS_SECTIONS) {
			assert.equal(
				html.split(`data-stress-section="${section.id}"`).length - 1,
				1,
				`section ${section.id}`,
			);
			for (const target of section.targets) {
				assert.equal(
					html.split(`data-stress-target="${target.id}"`).length - 1,
					1,
					`target ${target.id}`,
				);
			}
		}
	});

	it('declares the scrollbar policy and the shipped line-breaking base rules', () => {
		assert.match(html, /scrollbar-gutter:\s*stable/);
		assert.match(html, /word-break:\s*normal/);
		assert.match(html, /word-break:\s*auto-phrase/);
		assert.match(html, /text-wrap:\s*pretty/);
		assert.match(html, /text-wrap:\s*balance/);
	});

	it('keeps only the wide table scroll-contained', () => {
		const contained = html.match(/data-stress-scroll-contained/g) ?? [];
		assert.equal(contained.length, 1);
		const declared = DECLARED_TARGETS.filter((target) => target.scrollContained === true);
		assert.deepEqual(
			declared.map((target) => target.id),
			['table'],
		);
	});

	it('injects exactly one defect per control and none in the baseline', () => {
		const renderedControls = (markup) => markup.match(/<[a-z]+[^>]*\sdata-stress-control=/g) ?? [];
		assert.deepEqual(renderedControls(html), []);
		assert.ok(!html.includes(DECLARED_OPTIONAL_TARGETS[0].id));
		const overflowControl = renderStressFixture({ variant: 'control-overflow' });
		assert.equal(renderedControls(overflowControl).length, 1);
		assert.ok(overflowControl.includes(DECLARED_OPTIONAL_TARGETS[0].id));
		assert.match(overflowControl, /html\[data-stress-variant='control-gutter'\]/);
		assert.ok(!overflowControl.includes("data-stress-variant='control-gutter'] html"));
		const gutterControl = renderStressFixture({ variant: 'control-gutter' });
		assert.match(gutterControl, /scrollbar-gutter: auto/);
		assert.deepEqual(renderedControls(gutterControl), []);
		assert.ok(!gutterControl.includes(DECLARED_OPTIONAL_TARGETS[0].id));
	});

	it('is a static document: no script, no external request, no version literal', () => {
		assert.ok(!html.includes('<script'));
		assert.ok(!html.includes('http-equiv="refresh"'));
		assert.ok(!/src=["']https?:/.test(html));
		assert.ok(!html.includes(PROJECT_VERSION), 'fixture must not embed the release version');
		for (const variant of Object.keys(VARIANTS)) {
			assert.match(renderStressFixture({ variant }), /<!doctype html>/);
		}
		assert.throws(() => renderStressFixture({ variant: 'control-nope' }), /unknown stress fixture/);
	});

	it('keeps every section honest about what it stresses', () => {
		for (const section of STRESS_SECTIONS) {
			assert.ok(section.title.length > 0, section.id);
			assert.ok(section.purpose.length > 20, section.id);
			assert.ok(section.targets.length > 0, section.id);
			assert.ok(
				section.targets.every((target) => target.label.length > 0),
				section.id,
			);
		}
		assert.equal(new Set(STRESS_SECTIONS.map((s) => s.id)).size, STRESS_SECTIONS.length);
		assert.equal(new Set(DECLARED_TARGETS.map((t) => t.id)).size, DECLARED_TARGETS.length);
	});
});

/* ------------------------------------------------------------------ *
 * the browser half has to survive Playwright serialization
 * ------------------------------------------------------------------ */

describe('collectLayoutSnapshot', () => {
	it('is self-contained: Playwright ships the function source, not this module', () => {
		const source = collectLayoutSnapshot.toString();
		for (const moduleScope of [
			'STRESS_',
			'TOLERANCE_PX',
			'VARIANTS',
			'DECLARED_',
			'FIXTURE_CSS',
			'escapeHtml',
			'STRESS_SECTIONS',
		]) {
			assert.ok(!source.includes(moduleScope), `must not reference ${moduleScope}`);
		}
	});

	it('restores the overflow-y it applied, and measures both states', () => {
		const source = collectLayoutSnapshot.toString();
		assert.ok(source.includes('previousOverflowY'));
		assert.ok(source.includes("overflowY: 'scroll'") || source.includes('overflowY'));
		assert.ok(source.includes('data-stress-section'));
		assert.ok(source.includes('data-stress-target'));
		assert.ok(source.includes('data-gutter-probe'));
	});
});
