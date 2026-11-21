#!/usr/bin/env node

/**
 * judge-composition — pure judge over a normalized composition model
 * (ADR-0023 §2.1/§5, Issue #1132).
 *
 * Input: one `composition-model/v1` JSON document (produced by the
 * collector, Issue #1131) plus the rule data in
 * `quality/composition-contract.json`. Output: verdicts per rule —
 * `blocking` stops integration, `warning` feeds the L-C visual review,
 * `info` is observation only.
 *
 * The judge is deliberately a pure function: no DOM, no browser, no
 * clock, no content strings. `scripts/judge-composition.test.mjs`
 * feeds it the positive/negative fixtures under
 * `quality/fixtures/composition-lint/` so a gate that has only ever
 * been seen green proves nothing (same falsifiability contract as
 * `e2e/viewport/contract.ts`).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MODEL_VERSION = 'composition-model/v1';
export const CONTRACT_PATH = 'quality/composition-contract.json';

export function loadContract(root = REPO_ROOT) {
	return JSON.parse(readFileSync(resolve(root, CONTRACT_PATH), 'utf8'));
}

/** Severity ordering for verdict aggregation. */
const SEVERITY_RANK = { info: 0, warning: 1, blocking: 2 };

function ruleById(contract, id) {
	return contract.rules.find((rule) => rule.id === id);
}

function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** In-flow sections only — fixed/sticky chrome is not composition. */
function bodySections(model) {
	return (model.sections ?? []).filter((s) => s.inFlow !== false);
}

function blockArea(section, kinds) {
	return (section.blocks ?? [])
		.filter((b) => kinds.includes(b.kind))
		.reduce((sum, b) => sum + (b.area ?? 0), 0);
}

function maxBlockAreaRatio(model) {
	const content = model.metrics?.contentArea ?? model.document?.height * (model.document?.width ?? 1);
	if (!content) return 0;
	let max = 0;
	for (const s of bodySections(model)) {
		for (const b of s.blocks ?? []) {
			max = Math.max(max, (b.area ?? 0) / content);
		}
	}
	return max;
}

function fontSizes(model) {
	const sizes = [];
	for (const s of bodySections(model)) {
		for (const b of s.blocks ?? []) {
			if (typeof b.fontSize === 'number') sizes.push(b.fontSize);
		}
	}
	return sizes;
}

function toneTransitions(model) {
	const sections = bodySections(model);
	let transitions = 0;
	for (let i = 1; i < sections.length; i += 1) {
		if ((sections[i].tone ?? 'ground') !== (sections[i - 1].tone ?? 'ground')) transitions += 1;
	}
	return transitions;
}

function hasBreakoutOrOverlap(model) {
	return (model.features ?? []).some((f) => f === 'breakout' || f === 'overlap');
}

function gridsWithUniformTracks(model) {
	const grids = [];
	for (const s of bodySections(model)) {
		if (s.grid?.tracks) grids.push(s.grid);
	}
	return grids;
}

/** CL-1 — monotone section stack. */
function checkCL1(model, rule) {
	const sections = bodySections(model);
	const min = rule.detection.minSections;
	if (sections.length < min) return null;
	const tones = new Set(sections.map((s) => s.tone ?? 'ground'));
	const sigs = new Set(sections.map((s) => s.signature ?? ''));
	if (tones.size === 1 && sigs.size === 1 && !sigs.has('')) {
		return {
			rule: 'CL-1',
			severity: rule.severity,
			verdict: 'fail',
			detail: `${sections.length} sections share tone=${[...tones][0]} and one signature`,
		};
	}
	return null;
}

/** CL-2 — repeated section structure (run of identical signatures). */
function checkCL2(model, rule, route) {
	const sections = bodySections(model);
	if (route?.indexRoute) return null;
	const minRun = rule.detection.minRunLength;
	let run = 1;
	let best = 1;
	for (let i = 1; i <= sections.length; i += 1) {
		const same =
			i < sections.length &&
			(sections[i].signature ?? '') !== '' &&
			sections[i].signature === sections[i - 1].signature;
		if (same) {
			run += 1;
			best = Math.max(best, run);
		} else {
			run = 1;
		}
	}
	const distinct = new Set(sections.map((s) => s.signature ?? '')).size;
	if (best >= minRun && distinct < rule.detection.distinctSignaturesRequired + best - 1) {
		// require that the repeated run dominates the page's structure
		if (best >= Math.ceil(sections.length * 0.6)) {
			return {
				rule: 'CL-2',
				severity: rule.severity,
				verdict: 'fail',
				detail: `signature run of ${best} sections; only ${distinct} distinct signatures`,
			};
		}
	}
	return null;
}

/** CL-3 — missing weight hierarchy. */
function checkCL3(model, rule) {
	const sizes = fontSizes(model);
	const bodyMedian = median(sizes.filter((s) => s <= 20));
	const maxSize = sizes.length ? Math.max(...sizes) : 0;
	const dominance = maxBlockAreaRatio(model);
	const hasToneContrast = toneTransitions(model) > 0;
	const fontOk = bodyMedian !== null && maxSize >= bodyMedian * rule.detection.fontRatioMin;
	const areaOk = dominance >= rule.detection.areaDominanceMin;
	if (!fontOk && !areaOk && !hasToneContrast) {
		return {
			rule: 'CL-3',
			severity: rule.severity,
			verdict: 'fail',
			detail: `max font ${maxSize} vs body median ${bodyMedian}, dominant area ${dominance.toFixed(2)}, tone transitions ${toneTransitions(model)}`,
		};
	}
	return null;
}

/** CL-4 — unmotivated narrow column (desktop only). */
function checkCL4(model, rule, viewport) {
	if ((viewport?.width ?? 0) < rule.detection.viewportMinWidth) return null;
	const sections = bodySections(model);
	const narrow = sections.filter(
		(s) =>
			typeof s.contentWidthRatio === 'number' &&
			s.contentWidthRatio < rule.detection.contentWidthRatioMax &&
			(s.emptyAreaRatio ?? 0) > rule.detection.emptyAreaRatioMin,
	);
	if (narrow.length >= 2 && !hasBreakoutOrOverlap(model)) {
		return {
			rule: 'CL-4',
			severity: rule.severity,
			verdict: 'warn',
			detail: `${narrow.length} sections under-use the viewport width without breakout/media/second column`,
		};
	}
	return null;
}

/** CL-5 — uniform grid with no variation anywhere. */
function checkCL5(model, rule, route) {
	// Card catalogs legitimately use equal tracks — the contract's
	// own exception note. Same indexRoute exemption as CL-2/CL-8/CL-10.
	if (route?.indexRoute) return null;
	const grids = gridsWithUniformTracks(model);
	const uniform = grids.filter((g) => {
		const tracks = g.tracks ?? [];
		if (tracks.length < rule.detection.minTracks) return false;
		const ratio = g.columnRatio ?? [];
		if (ratio.length === 0) return true; // unknown ratios → treat as uniform? no: skip
		const mean = ratio.reduce((a, b) => a + b, 0) / ratio.length;
		return ratio.every((r) => Math.abs(r - mean) <= rule.detection.equalRatioTolerance * mean);
	});
	const hasVariation = grids.some(
		(g) => (g.columnRatio ?? []).length > 0 && !uniform.includes(g),
	);
	if (uniform.length > 0 && !hasVariation && !hasBreakoutOrOverlap(model)) {
		return {
			rule: 'CL-5',
			severity: rule.severity,
			verdict: 'warn',
			detail: `${uniform.length} grid(s) repeat equal tracks with no span/offset/breakout variation on the page`,
		};
	}
	return null;
}

/** CL-6 — media neglect on mediaExpected routes. */
function checkCL6(model, rule, route) {
	if (!route?.mediaExpected) return null;
	const content = model.metrics?.contentArea ?? 0;
	const media = model.media?.totalArea ?? 0;
	const ratio = content > 0 ? media / content : 0;
	if (ratio < rule.detection.mediaAreaRatioMin) {
		return {
			rule: 'CL-6',
			severity: rule.severity,
			verdict: 'fail',
			detail: `mediaExpected route renders media area ratio ${ratio.toFixed(3)} (< ${rule.detection.mediaAreaRatioMin})`,
		};
	}
	// #1134 — hero media floor: a route that declares
	// heroMediaMinRatio must dedicate that fraction of the hero
	// section's area to media. Catches a media-bearing item rendered
	// text-only even when the page-level ratio passes.
	if (typeof route?.heroMediaMinRatio === 'number') {
		const hero = bodySections(model).find((s) => (s.rhythm ?? 'body') === 'hero');
		if (hero) {
			const sectionArea = (hero.rect?.w ?? 0) * (hero.rect?.h ?? 0);
			const heroRatio = sectionArea > 0 ? (hero.mediaArea ?? 0) / sectionArea : 0;
			if (heroRatio < route.heroMediaMinRatio) {
				return {
					rule: 'CL-6',
					severity: rule.severity,
					verdict: 'fail',
					detail: `hero section media ratio ${heroRatio.toFixed(3)} (< ${route.heroMediaMinRatio}) — media-bearing content rendered without its asset`,
				};
			}
		}
	}
	return null;
}

/** CL-7 — mobile naive stack (needs the desktop/mobile pair). */
export function checkCL7(desktopModel, mobileModel, rule, route) {
	// Index/catalog routes legitimately stack cards in reading order
	// on mobile — uniform stacking IS the correct transform there.
	if (route?.indexRoute) return null;
	const dSections = bodySections(desktopModel);
	const mSections = bodySections(mobileModel);
	const multiColDesktop = dSections.filter((s) => (s.grid?.tracks?.length ?? 0) >= rule.detection.minDesktopColumns);
	if (multiColDesktop.length === 0) return null;
	const heightRatio =
		mobileModel.document?.height && desktopModel.document?.height
			? mobileModel.document.height / desktopModel.document.height
			: null;
	// Recomposition evidence, strongest first: declared features, then
	// a measurable reorder of the (tone, rhythm) section sequence —
	// signatures themselves differ across breakpoints by design.
	const orderKey = (s) => `${s.tone ?? 'ground'}|${s.rhythm ?? 'body'}`;
	const dOrder = dSections.map(orderKey);
	const mOrder = mSections.map(orderKey);
	const sameLen = dOrder.length === mOrder.length && dOrder.length > 0;
	const orderDiff = sameLen
		? dOrder.filter((k, i) => k !== mOrder[i]).length / dOrder.length
		: 0;
	// Block-level order check: pair sections by index and compare
	// their block-kind sequences. A naive stack preserves every
	// sequence verbatim; real recomposition reorders at least one.
	let orderPreserved = true;
	const pairs = Math.min(dSections.length, mSections.length);
	for (let i = 0; i < pairs; i += 1) {
		const dSeq = (dSections[i].blockOrder ?? []).join(',');
		const mSeq = (mSections[i].blockOrder ?? []).join(',');
		if (dSeq && mSeq && dSeq !== mSeq) {
			orderPreserved = false;
			break;
		}
	}
	const recomposed =
		(mobileModel.features ?? []).some((f) => f === 'reorder' || f === 'disclosure') ||
		(mobileModel.metrics?.recompositionScore ?? 0) > 0 ||
		orderDiff > 0.3 ||
		!orderPreserved;
	if (
		!recomposed &&
		heightRatio !== null &&
		heightRatio > rule.detection.heightGrowthMax
	) {
		return {
			rule: 'CL-7',
			severity: rule.severity,
			verdict: 'warn',
			detail: `desktop multi-column sections stack on mobile with height growth ${heightRatio.toFixed(2)}x, section and block order preserved, no recomposition signal`,
		};
	}
	return null;
}

/** CL-10 — monotonous intra-section repetition across the page. */
function checkCL10(model, rule, route) {
	if (route?.indexRoute) return null;
	const minUnits = rule.detection.minRepeatUnits;
	const sections = bodySections(model);
	const repeaters = sections.filter((s) => (s.repeatUnits ?? 0) >= minUnits);
	if (repeaters.length < rule.detection.minRepeaterSections) return null;
	// The defect is repetition DOMINATING the page, not the mere
	// presence of lists — two catalog sections on a six-section page
	// are legitimate parallel structure.
	// Repetition only counts as ONE defect when the repeated units are
	// the same kind of thing: a card grid, a record list and a widget
	// wall all render <li> runs but are different compositions. Group
	// repeaters by their measured unit profile (tag + geometry bucket)
	// and require the largest same-profile group to dominate.
	const byProfile = new Map();
	for (const s of repeaters) {
		const key = s.repeatProfile ?? s.repeatKind ?? 'unknown';
		byProfile.set(key, (byProfile.get(key) ?? 0) + 1);
	}
	const [topProfile, topCount] = [...byProfile.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
	const dominance = topCount / Math.max(1, sections.length);
	if (topCount >= rule.detection.minRepeaterSections && dominance >= (rule.detection.repeaterDominanceMin ?? 0.5)) {
		return {
			rule: 'CL-10',
			severity: rule.severity,
			verdict: rule.severity === 'blocking' ? 'fail' : 'warn',
			detail: `${topCount}/${sections.length} sections repeat the same unit profile (${topProfile}) >=${minUnits}x — repetition dominates the composition`,
		};
	}
	return null;
}

/** CL-8 — zero tone variation. */
function checkCL8(model, rule, route) {
	if (route?.indexRoute) return null;
	const sections = bodySections(model).filter((s) => (s.rhythm ?? 'body') !== 'hero');
	if (sections.length < rule.detection.minBodySections) return null;
	const nonGround = sections.filter((s) => (s.tone ?? 'ground') !== 'ground');
	if (nonGround.length === 0) {
		return {
			rule: 'CL-8',
			severity: rule.severity,
			verdict: 'warn',
			detail: `${sections.length} body sections, zero non-ground tones`,
		};
	}
	return null;
}

/** CL-9 — no focal point. */
function checkCL9(model, rule) {
	const sizes = fontSizes(model);
	const bodyMedian = median(sizes.filter((s) => s <= 20));
	const maxSize = sizes.length ? Math.max(...sizes) : 0;
	const dominance = maxBlockAreaRatio(model);
	const hasToneContrast = toneTransitions(model) > 0;
	const hasDisplay =
		bodyMedian !== null && maxSize >= bodyMedian * rule.detection.displayFontRatioMin;
	const hasMediaAnchor = (model.media?.totalArea ?? 0) > 0 && dominance >= rule.detection.dominantAreaMin;
	if (dominance < rule.detection.dominantAreaMin && !hasDisplay && !hasToneContrast && !hasMediaAnchor) {
		return {
			rule: 'CL-9',
			severity: rule.severity,
			verdict: 'warn',
			detail: `no dominant block (${dominance.toFixed(2)}), no display type, no tone transition`,
		};
	}
	return null;
}


/** CL-11 — page-level stack monotony.
 *
 * CL-1/CL-2 compare section signatures; CL-10 compares repeat
 * profiles. This rule compares the composition itself: a run of
 * consecutive single-column, media-free sections that share the same
 * content left edge and a similar density band is a vertical stack
 * regardless of which components produced it. Intentional editorial
 * single-column flow is preserved by requiring the RUN to dominate
 * the page and by exempting index routes.
 */
function checkCL11(model, rule, route, viewport) {
	if (route?.indexRoute) return null;
	// Content-shaped pages (markdown case studies) legitimately stack
	// prose sections; their composition lives in the hero/media
	// sections which other rules still judge. Declared per-route
	// with a recorded reason — see contract notes.
	if (route?.proseStackAllowed) return null;
	// Single-column is the REQUIRED mobile transform; stack
	// monotony is a desktop-composition defect.
	if ((viewport?.width ?? 0) < (rule.detection.viewportMinWidth ?? 1024)) return null;
	const d = rule.detection;
	const sections = bodySections(model);
	const alignTol = d.alignTolerancePx ?? 16;
	const densityTol = d.densityTolerance ?? 0.15;

	const isStackUnit = (s) =>
		(s.columnCount ?? (s.grid ? s.grid.columnCount : 1)) <= 1 &&
		(s.mediaArea ?? 0) < (d.mediaAreaMax ?? 20000) &&
		typeof s.contentLeft === 'number' &&
		typeof s.density === 'number';

	// Longest run of consecutive stack units sharing left edge ±tol
	// and density within ±tol of the run's first member.
	let bestRun = [];
	let cur = [];
	const flush = () => {
		if (cur.length > bestRun.length) bestRun = cur;
		cur = [];
	};
	for (const s of sections) {
		if (!isStackUnit(s)) {
			flush();
			continue;
		}
		const anchor = cur[0];
		if (
			anchor &&
			(Math.abs(s.contentLeft - anchor.contentLeft) > alignTol ||
				Math.abs(s.density - anchor.density) > densityTol)
		) {
			flush();
		}
		cur.push(s);
	}
	flush();

	const minRun = d.minRunLength ?? 3;
	const dominance = bestRun.length / Math.max(1, sections.length);
	if (bestRun.length >= minRun && dominance >= (d.runDominanceMin ?? 0.5)) {
		return {
			rule: 'CL-11',
			severity: rule.severity,
			verdict: rule.severity === 'blocking' ? 'fail' : 'warn',
			detail: `${bestRun.length}/${sections.length} consecutive sections form a single-column left-aligned stack (same axis, no media, uniform density) — composition reduces to vertical stacking`,
		};
	}
	return null;
}

/**
 * Judge one viewport's model. Returns an array of verdict objects;
 * empty array means no rule fired (pass for that cell).
 */
export function judgeCompositionModel(model, contract, route, viewport) {
	if (!model || model.version !== MODEL_VERSION) {
		return [
			{
				rule: 'MODEL',
				severity: 'blocking',
				verdict: 'fail',
				detail: `expected ${MODEL_VERSION}, got ${model?.version ?? 'missing'}`,
			},
		];
	}
	const verdicts = [];
	const push = (v) => {
		if (v) verdicts.push(v);
	};
	push(checkCL1(model, ruleById(contract, 'CL-1')));
	push(checkCL2(model, ruleById(contract, 'CL-2'), route));
	push(checkCL3(model, ruleById(contract, 'CL-3')));
	push(checkCL4(model, ruleById(contract, 'CL-4'), viewport));
	push(checkCL5(model, ruleById(contract, 'CL-5'), route));
	push(checkCL6(model, ruleById(contract, 'CL-6'), route));
	push(checkCL8(model, ruleById(contract, 'CL-8'), route));
	push(checkCL9(model, ruleById(contract, 'CL-9')));
	push(checkCL10(model, ruleById(contract, 'CL-10'), route));
	push(checkCL11(model, ruleById(contract, 'CL-11'), route, viewport));
	return verdicts;
}

/** Judge a route across its viewport set (CL-7 needs the pair). */
export function judgeRoute(modelsByViewport, contract, route) {
	const verdicts = [];
	for (const [key, model] of Object.entries(modelsByViewport)) {
		const viewport = contract.viewports.find((v) => v.stem === key || `${v.width}` === key);
		verdicts.push(...judgeCompositionModel(model, contract, route, viewport));
	}
	const desktopKey = contract.viewports.find((v) => v.label === 'desktop')?.stem;
	const mobileKey = contract.viewports.find((v) => v.label === 'mobile')?.stem;
	if (desktopKey && mobileKey && modelsByViewport[desktopKey] && modelsByViewport[mobileKey]) {
		const v = checkCL7(
			modelsByViewport[desktopKey],
			modelsByViewport[mobileKey],
			ruleById(contract, 'CL-7'),
			route,
		);
		if (v) verdicts.push(v);
	}
	return verdicts;
}

/** Aggregate verdicts into a cell verdict. */
export function aggregateVerdict(verdicts) {
	if (verdicts.length === 0) return 'pass';
	return verdicts.some((v) => v.verdict === 'fail' && v.severity === 'blocking')
		? 'fail'
		: 'warn';
}

export { SEVERITY_RANK };
