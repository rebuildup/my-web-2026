import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	DECLARED_GUTTER_PROBES,
	DECLARED_OPTIONAL_TARGETS,
	DECLARED_TARGETS,
	FIXTURE_CSS,
	STRESS_SECTIONS,
	STRESS_STORY_IDS,
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
		clippingAnchor: null,
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

	/*
	 * `overflow-x: hidden` / `clip` used to count as a scroll anchor,
	 * which made the marker a way to *hide* a real break: the 480px
	 * table would be cut off with no scrollbar for the user, the
	 * content-box check would be skipped, and because nothing spilled
	 * out of the document there would be no `viewport_overflow` either —
	 * a green baseline for a table nobody can scroll to.
	 */
	it('fails when a scroll-contained target sits behind a clipping ancestor', () => {
		for (const clippingAnchor of ['story', 'clip-box']) {
			const result = evaluateStressRun(
				healthyRun({
					withScrollbar: {
						targets: defaultTargets().map((target) =>
							target.id === 'table' ? { ...target, scrollAnchor: null, clippingAnchor } : target,
						),
					},
				}),
			);
			const clipped = result.errors.filter((error) => error.rule === 'scroll_anchor_clipped');
			assert.equal(clipped.length, 1, clippingAnchor);
			assert.match(clipped[0].message, /clips instead of scrolling/);
			assert.deepEqual(clipped[0].detail, { clippingAnchor });
			assert.ok(
				!rules(result).includes('target_overflow'),
				'the unreachable table is one defect, not a content-box error as well',
			);
		}
	});

	it('accepts a real scroll container and never one that only clips', () => {
		const result = evaluateStressRun(healthyRun());
		const table = result.errors.filter((error) => error.rule.startsWith('scroll_anchor'));
		assert.deepEqual(table, []);
		const source = collectLayoutSnapshot.toString();
		// The browser half is the only place that can tell the two apart,
		// so the split has to be visible there and nowhere else.
		assert.match(source, /scrollAnchor = name/);
		assert.match(source, /clippingAnchor = name/);
		assert.match(source, /overflowX === 'hidden' \|\| overflowX === 'clip'/);
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
		assert.deepEqual(requiredControlRules('control-clip'), ['scroll_anchor_clipped']);
	});

	it('rejects an unknown control instead of defaulting to "nothing to prove"', () => {
		assert.throws(() => requiredControlRules('control-nope'), /unknown control variant/);
		assert.equal(
			Object.keys(VARIANTS).filter((id) => VARIANTS[id].mustPass === false).length,
			Object.keys(VARIANTS).length - 1,
			'every variant but the baseline is a control, so none can escape its required rule',
		);
		for (const id of Object.keys(VARIANTS)) {
			if (VARIANTS[id].mustPass) continue;
			assert.doesNotThrow(() => requiredControlRules(id), id);
			assert.ok(requiredControlRules(id).length > 0, `${id} must name the rule it exists for`);
		}
	});

	it('declares the clip control as the only variant that removes the scroll', () => {
		// The browser half is what proved `hidden` was accepted as an
		// anchor, so the control that breaks it has to live in the CSS
		// the browser loads — a synthetic snapshot cannot see this.
		assert.match(
			FIXTURE_CSS,
			/html\[data-stress-variant='control-clip'\] \.scroll-x \{ overflow-x: hidden; \}/,
		);
		const baseline = renderStressFixture({ variant: 'baseline' });
		const clip = renderStressFixture({ variant: 'control-clip' });
		assert.match(baseline, /<html lang="ja" data-stress-variant="baseline">/);
		assert.match(clip, /<html lang="ja" data-stress-variant="control-clip">/);
		// The defect is CSS, not markup: the same table, the same
		// scroll-container element, only what the ancestor does to it.
		for (const html of [baseline, clip]) {
			assert.match(html, /class="scroll-x" data-stress-target="table-scroller"/);
		}
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
 * a claim about a language is only allowed where the language is
 *
 * The `purpose` string is rendered into the fixture document and
 * screenshotted into the committed evidence, so "Thai is covered"
 * written in prose while the fixture contains no Thai character is a
 * false statement in an image, not a stale comment: the report would
 * claim a measurement nobody made. Thai is also the strongest case at
 * 320px — it has no inter-word spaces, so the line may only break
 * where the browser's dictionary says — which makes it exactly the
 * coverage an over-claim hides. Every language the multilingual
 * story names is therefore matched against a script range the story
 * has to actually render.
 * ------------------------------------------------------------------ */

/**
 * The scripts the `multilingual` story declares, in the spelling its
 * `purpose` uses. Adding a language to the claim without adding a
 * matching entry here would go unchecked, so a claim word with no
 * probe fails the test below instead of silently going unverified.
 */
const DECLARED_LANGUAGE_SCRIPTS = [
	{ claim: '日本語', script: 'japanese', pattern: /[\u3040-\u30ff]/ },
	{ claim: '英語', script: 'latin', pattern: /[A-Za-z]/ },
	{ claim: 'ドイツ語', script: 'latin', pattern: /[A-Za-z]/ },
	{ claim: 'フランス語', script: 'latin', pattern: /[A-Za-zÀ-ɏ]/ },
	{ claim: 'ロシア語', script: 'cyrillic', pattern: /[\u0400-\u04ff]/ },
	{ claim: '韓国語', script: 'hangul', pattern: /[\uac00-\ud7af]/ },
	{ claim: 'アラビア語', script: 'arabic', pattern: /[\u0600-\u06ff]/ },
	{ claim: 'タイ語', script: 'thai', pattern: /[\u0e00-\u0e7f]/ },
	{ claim: '絵文字', script: 'emoji', pattern: /\p{Extended_Pictographic}/u },
];

describe('the multilingual story declares only the scripts it renders', () => {
	const story = STRESS_SECTIONS.find((section) => section.id === 'multilingual');
	const rendered = (() => {
		const html = renderStressFixture();
		const start = html.indexOf('data-stress-section="multilingual"');
		const end = html.indexOf('</section>', start);
		assert.ok(start > 0 && end > start, 'the multilingual story must render');
		return html.slice(start, end);
	})();

	it('renders every script its purpose names', () => {
		for (const { claim, script, pattern } of DECLARED_LANGUAGE_SCRIPTS) {
			if (!story.purpose.includes(claim)) continue;
			assert.match(
				rendered,
				pattern,
				`the purpose claims ${claim} (${script}) but the story renders no such characters`,
			);
		}
	});

	it('renders Thai, which has no inter-word spaces to break on', () => {
		const runs = rendered.match(/[\u0e00-\u0e7f]+/g) ?? [];
		assert.ok(runs.length > 0, 'the story must contain Thai characters');
		assert.ok(
			runs.reduce((total, run) => total + run.length, 0) >= 8,
			'the Thai run must be a sentence, not a stray glyph',
		);
	});

	it('keeps the RTL paragraph right-to-left and declared as such', () => {
		assert.match(rendered, /data-stress-target="multilingual-rtl"[^>]*dir="rtl"/);
		assert.match(rendered, /lang="ar"/);
	});

	it('never lets a claim word exist without a probe', () => {
		const claimed = [...story.purpose.matchAll(/[ァ-ヶ一-龠]{2,5}語|絵文字/g)].map(
			(match) => match[0],
		);
		assert.ok(claimed.length > 0, 'the story must still claim languages');
		for (const word of new Set(claimed)) {
			assert.ok(
				DECLARED_LANGUAGE_SCRIPTS.some((entry) => entry.claim === word),
				`"${word}" is claimed by the story but has no script probe`,
			);
		}
	});
});

/* ------------------------------------------------------------------ *
 * the fixture copies the shipped visual language, so the copy has to
 * be checked against it
 *
 * `FIXTURE_CSS` is a hand copy of the values it claims to mirror, and
 * nothing used to notice when the shipped token moved: a green gate on
 * a fixture that no longer resembles the product is the failure mode
 * this block exists to close. The parsed sources are the ones named
 * in the provenance comment above `FIXTURE_CSS`.
 * ------------------------------------------------------------------ */

describe('the fixture still mirrors the shipped tokens', () => {
	const tokenSource = readFileSync(join(ROOT, 'src/editorial/tokens.ts'), 'utf8');
	const containerSource = readFileSync(
		join(ROOT, 'src/editorial/primitives/Container.tsx'),
		'utf8',
	);
	/**
	 * The literal source block for a token section. Slicing to the
	 * matching brace is what keeps one section's numbers out of the
	 * next one's — a plain `slice(indexOf(...))` happily reads the
	 * shadow scale as if it were the spacing scale.
	 */
	const block = (name) => {
		const start = tokenSource.indexOf(`${name}: {`);
		assert.ok(start > 0, `tokens.ts must declare ${name}`);
		let depth = 0;
		for (let index = tokenSource.indexOf('{', start); index < tokenSource.length; index += 1) {
			if (tokenSource[index] === '{') depth += 1;
			else if (tokenSource[index] === '}' && --depth === 0) {
				return tokenSource.slice(start, index + 1);
			}
		}
		throw new Error(`unbalanced token block: ${name}`);
	};
	/** `{ key: value }` or `{ key: { value } }` — both token shapes. */
	const entries = (section) =>
		new Map(
			[...block(section).matchAll(/([\w-]+):\s*(?:\{ value:\s*)?'([^']+)'/g)].map((match) => [
				match[1],
				match[2].toLowerCase(),
			]),
		);
	const palette = new Set(
		[...tokenSource.matchAll(/value:\s*'(#[0-9a-fA-F]{6})'/g)].map((match) =>
			match[1].toLowerCase(),
		),
	);
	const fixtureHexes = [...new Set(FIXTURE_CSS.match(/#[0-9a-fA-F]{3,8}/g) ?? [])].map((hex) =>
		hex.toLowerCase(),
	);

	it('uses no colour the shipped palette does not declare', () => {
		for (const hex of fixtureHexes) {
			assert.ok(palette.has(hex), `${hex} is painted by the fixture but is not a shipped token`);
		}
		assert.ok(fixtureHexes.length > 0);
	});

	it('still paints the five neutral roles its provenance comment names', () => {
		const neutral = entries('neutral');
		assert.match(FIXTURE_CSS, new RegExp(`background:\\s*${neutral.get('0')}\\b`));
		assert.match(FIXTURE_CSS, new RegExp(`color:\\s*${neutral.get('900')}\\b`));
		for (const step of ['0', '50', '100', '500', '900']) {
			assert.ok(fixtureHexes.includes(neutral.get(step)), `neutral.${step}`);
		}
	});

	it('still breaks at the shipped breakpoints', () => {
		const breakpoints = entries('breakpoints');
		for (const step of ['md', 'lg']) {
			const width = breakpoints.get(step);
			assert.ok(width, `breakpoint ${step}`);
			assert.ok(
				FIXTURE_CSS.includes(`@media (min-width: ${width})`),
				`the fixture must carry the ${step} (${width}) breakpoint`,
			);
		}
	});

	it('still mirrors the Container width and its page margins', () => {
		const spacing = entries('spacing');
		/*
		 * Panda resolves a numeric spacing key against the scale when
		 * the scale declares it, and otherwise against its 4px base —
		 * which is why `paddingInline: '8'` is 32px and not a missing
		 * token. The scale's own `4 → 16px` entry pins that base, so a
		 * base change fails here instead of silently re-scaling the
		 * fixture.
		 */
		assert.equal(spacing.get('4'), '16px', 'the spacing base is 4px');
		const base = Number.parseInt(spacing.get('4'), 10) / 4;
		const spacingPx = (step) => spacing.get(step) ?? `${Number(step) * base}px`;
		const maxWidth = containerSource.match(/maxWidth:\s*'(\d+px)'/)?.[1];
		assert.ok(maxWidth, 'Container must declare a maxWidth');
		assert.ok(FIXTURE_CSS.includes(`max-width: ${maxWidth}`));
		const margins = containerSource.match(
			/paddingInline:\s*\{\s*base:\s*'(\d+)',\s*md:\s*'(\d+)',\s*lg:\s*'(\d+)'\s*\}/,
		);
		assert.ok(margins, 'Container must declare responsive paddingInline');
		for (const step of margins.slice(1)) {
			const pixels = spacingPx(step);
			assert.ok(
				FIXTURE_CSS.includes(`padding-inline: ${pixels}`),
				`the fixture must paint the Container ${step} margin (${pixels})`,
			);
		}
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

/* ------------------------------------------------------------------ *
 * the verification report must not fall behind the fixture spec
 * ------------------------------------------------------------------ */

describe('verification report capture list', () => {
	const reportSource = () =>
		readFileSync(join(ROOT, 'scripts/make-layout-stress-report.mjs'), 'utf8');

	it('captures every declared story, in declaration order', () => {
		assert.deepEqual(
			STRESS_STORY_IDS,
			STRESS_SECTIONS.map((section) => section.id),
		);
		assert.equal(STRESS_STORY_IDS.length, 10);
	});

	it('derives its captures from the spec instead of a hand-written subset', () => {
		const source = reportSource();
		assert.ok(source.includes('STRESS_STORY_IDS'), 'take the story list from layout-stress.mjs');
		assert.ok(
			!/const CAPTURED_STORIES = \[/.test(source),
			'the report must not re-declare the story list it captures',
		);
	});

	it('frames the injected defect and checks it reached the pixels', () => {
		const source = reportSource();
		assert.ok(
			source.includes('data-stress-control'),
			'the control capture must frame the injected block',
		);
		assert.ok(
			source.includes('MIN_CONTROL_DEFECT_PIXELS'),
			'a caption claims what the image shows, so the defect colour must be counted',
		);
	});

	it("states the gutter policy is the fixture's own, read from the shipped CSS", () => {
		const source = reportSource();
		assert.ok(
			source.includes("readFileSync(join(ROOT, 'src/styles.css')"),
			'the report must read whether the shipped CSS reserves the gutter',
		);
		assert.ok(
			source.includes('scrollbar-gutter'),
			'the report must name the policy a baseline PASS is about',
		);
		const gutterStory = STRESS_SECTIONS.find((section) => section.id === 'gutter');
		assert.ok(
			gutterStory.purpose.includes('fixture 固有'),
			'the fixture says out loud that the policy is its own — it is screenshotted',
		);
	});
});
