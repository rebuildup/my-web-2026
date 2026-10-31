#!/usr/bin/env node

/**
 * check-a11y-video-caption — enforce the prerecorded-video contract on the
 * shipped surface (Issue #408).
 *
 * What this gate is for
 * ---------------------
 * A `<video>` a visitor can play carries four promises, and this gate
 * fixes them in the source:
 *
 *   - its spoken content is captioned (WCAG 2.2 SC 1.2.2 Captions
 *     (Prerecorded), level A);
 *   - a poster image and a text alternative exist for the frame before
 *     playback and for a reader who cannot play it (SC 1.1.1 Non-text
 *     Content, level A);
 *   - the visitor can control playback (SC 2.1.1 Keyboard, level A);
 *   - a work whose caption source is NOT verified is not presented as
 *     playable — the gate is FAIL-CLOSED: the caption source counts as
 *     verified only when the markup says so, so silence cannot be read as
 *     "confirmed".
 *
 * The Issue is explicit that no video content exists yet in the shipped
 * surface, so the gate cannot be validated against a real `<video>`. What
 * it fixes is the CONTRACT a video must satisfy when one is published:
 * the fixture reproduces every state, and the browser capture drives them.
 *
 * The rules
 * ---------
 *   video-without-caption-track
 *       A playable `<video>` has no `<track kind="captions">`. A
 *       `<track>` whose `kind` is omitted defaults to `subtitles`, which
 *       is a different track and does not satisfy SC 1.2.2.
 *   video-without-text-alternative
 *       A content `<video>` declares no `poster` or no accessible name
 *       (`aria-label` / `aria-labelledby` / `title`). (SC 1.1.1)
 *   video-without-controls
 *       A playable `<video>` has no `controls`, so a keyboard user cannot
 *       start, pause or seek it. (SC 2.1.1)
 *   video-playable-without-verified-caption
 *       A playable `<video>` carries a caption track but does not declare
 *       `data-caption-status="verified"`, so a work whose caption source
 *       is undetermined is presented as playable. (SC 1.2.2)
 *
 * What "decorative" means is defined once, in {@link isDecorativeVideo}:
 * a background video is exempt from captions and controls only when it is
 * BOTH `muted` and hidden from assistive technology (`aria-hidden="true"`
 * / `role="presentation"` / `role="none"` / `data-decorative`).
 *
 * Values the gate cannot decide (fail-closed)
 * -------------------------------------------
 * A static gate reads the markup, so a value the markup does not decide is
 * a hole. Three of them are closed here, in one place:
 *
 *   - a BOOLEAN attribute is read as its EFFECTIVE value: `controls` and
 *     `controls=""` are on, `controls={false}` is off, and a value the
 *     gate cannot read is NOT on. So `muted={false}` does not silence a
 *     video, and `controls={false}` does not give it controls;
 *   - the PLAYABILITY of a video is decided by the `src` attribute and the
 *     `<source>` children. A `src` whose value is a runtime expression may
 *     or may not point at media, so the video is judged as PLAYABLE and the
 *     caption / controls / audio-description rules apply to it;
 *   - a SPREAD (`{...props}`) can carry any attribute, so every attribute
 *     a spread may override is undecided. JSX lets a later prop win, so
 *     only the attributes written AFTER the last spread are final.
 *
 * The direction is always the safe one: an undecided value is judged as
 * the value that demands MORE of the video, never the value that excuses
 * it. A static `false` and an undecided value are DIFFERENT facts and are
 * reported differently, so a reader can tell "the author decided this" from
 * "the gate cannot read this".
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * This gate decides MARKUP. It cannot decide whether a caption is accurate
 * or complete, whether a video needs audio description (SC 1.2.3 depends
 * on visual-only information), or whether the poster represents the work.
 * Those stay human evaluation and are printed separately.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, lineAt, stripComments, toRepoPath } from './_source-scan.mjs';

/** The Issue this gate belongs to. */
export const ISSUE = '#408';

/**
 * The criteria that are requirements (A / AA).
 *
 * Levels verified against the W3C Recommendation (https://www.w3.org/TR/WCAG22/)
 * on 2026-10-23 by reading each success criterion's `conformance-level`
 * paragraph: 1.2.2 (A), 1.2.3 (A, "Audio Description or Media Alternative
 * (Prerecorded)"), 1.2.5 (AA — NOT AAA), 1.1.1 (A), 2.1.1 (A).
 */
export const WCAG = [
	{ sc: '1.2.2', name: 'Captions (Prerecorded)', level: 'A' },
	{ sc: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A' },
	{ sc: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA' },
	{ sc: '1.1.1', name: 'Non-text Content', level: 'A' },
	{ sc: '2.1.1', name: 'Keyboard', level: 'A' },
];

/**
 * The AAA criterion kept as a reference, never enforced.
 *
 * The AAA media criteria are 1.2.6 Sign Language, 1.2.7 Extended Audio
 * Description, 1.2.8 Media Alternative and 1.2.9 Audio-only (Live).
 * 1.2.5 is AA, so a AAA reference must not be labelled `1.2.5`.
 */
export const WCAG_REFERENCE = {
	sc: '1.2.8',
	name: 'Media Alternative (Prerecorded)',
	level: 'AAA',
};

/** The rule names, in report order. */
export const RULES = [
	'video-without-caption-track',
	'video-without-text-alternative',
	'video-without-controls',
	'video-playable-without-verified-caption',
	'video-without-audio-description',
];

/** The WCAG criterion each rule answers to. */
export const WCAG_BY_RULE = {
	'video-without-caption-track': '1.2.2',
	'video-without-text-alternative': '1.1.1',
	'video-without-controls': '2.1.1',
	'video-playable-without-verified-caption': '1.2.2',
	'video-without-audio-description': '1.2.5',
};

/** The `kind` a `<track>` must declare to satisfy SC 1.2.2. */
export const CAPTION_TRACK_KIND = 'captions';

/**
 * The audio-description contract (SC 1.2.3 A / SC 1.2.5 AA).
 *
 * A playable content video must declare its audio-description disposition:
 * `provided` (a `<track kind="descriptions">` is shipped) or `not-required`
 * (a human decided the work carries no visual-only information, which is
 * the SC 1.2.3 exception). The gate is FAIL-CLOSED: an absent or unknown
 * value is not a decision, so the work is not presented as accessible.
 */
export const AD_STATUS_ATTRIBUTE = 'data-audio-description-status';
export const AD_STATUS_PROVIDED = 'provided';
export const AD_STATUS_NOT_REQUIRED = 'not-required';
export const DESCRIPTION_TRACK_KIND = 'descriptions';

/** The attribute (and its one accepted value) that verifies a caption source. */
export const CAPTION_STATUS_ATTRIBUTE = 'data-caption-status';
export const CAPTION_STATUS_VERIFIED = 'verified';

/**
 * The accessible-name attributes that give a video its text alternative.
 * `poster` is the static visual, not the name; both are required.
 */
export const NAME_ATTRIBUTES = ['aria-label', 'aria-labelledby', 'title'];

/**
 * The marks that hide a decorative video from assistive technology.
 *
 * A mark counts only when its value DECIDES it: `aria-hidden="true"`,
 * `role="presentation"` / `role="none"`, and `data-decorative` whose value
 * is `true` (or which carries no value at all). `data-decorative={false}`
 * is the author saying "this video is NOT decorative", so it must not be
 * able to turn a video into an exempt one.
 */
export const DECORATIVE_MARKS = [
	{
		id: 'aria-hidden',
		attribute: 'aria-hidden',
		describe: 'aria-hidden="true"',
		decided: (attributes) => stringState(attributes, 'aria-hidden') === 'true',
		undecided: (attributes) => stringState(attributes, 'aria-hidden') === null,
	},
	{
		id: 'role',
		attribute: 'role',
		describe: 'role="presentation"',
		decided: (attributes) => {
			const role = stringState(attributes, 'role');
			return role === 'presentation' || role === 'none';
		},
		undecided: (attributes) => stringState(attributes, 'role') === null,
	},
	{
		id: 'data-decorative',
		attribute: 'data-decorative',
		describe: 'data-decorative (value true)',
		decided: (attributes) => booleanState(attributes, 'data-decorative') === true,
		undecided: (attributes) => booleanState(attributes, 'data-decorative') === null,
	},
];

/**
 * The scan target: the shipped JSX surface.
 *
 * Only `.tsx` is scanned — a `.ts` file cannot render a `<video>`.
 */
export const SCAN_ROOT = 'src';
export const SCAN_SUFFIX = '.tsx';

/** What is deliberately OUT of scope, and why. */
export const EXCLUSIONS = [
	{
		id: 'test-files',
		describe: '*.test.tsx',
		reason:
			'a test file asserts on markup; the defect this Issue removes is in the shipped product code, not in its assertions',
	},
	{
		id: 'story-files',
		describe: '*.stories.tsx',
		reason:
			'a Storybook story is a preview harness for a component, not a surface a visitor reaches; the component it renders is scanned on its own',
	},
	{
		id: 'fixture-directories',
		describe: '**/fixtures/**',
		reason:
			'a fixture exists to hold a shape, including a shape this gate rejects; the shipped copy of the same data is scanned',
	},
	{
		id: 'design-system-route',
		describe: 'src/routes/design-system/**',
		reason:
			'the design-system route is the repository-internal component gallery, not a published surface; its demo markup is a specimen of the primitive, and the primitive itself is scanned',
	},
];

/**
 * The fixture the gate actually reads.
 *
 * The fixture is not a decoration: `pass/` must produce zero violations
 * and `fail/` must produce the named rule, or the gate reports the fixture
 * as broken.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-video-caption';

/**
 * The exact fixture roster, per directory.
 *
 * `pass` — files that must produce NO violation.
 * `fail` — files that must produce exactly the named rule.
 */
export const FIXTURE_EXPECTATIONS = {
	pass: {
		'01-captioned-video.tsx': [],
		'02-decorative-video.tsx': [],
		'03-awaiting-caption-source.tsx': [],
		'04-spread-with-explicit-contract.tsx': [],
	},
	fail: {
		'01-without-caption-track.tsx': ['video-without-caption-track'],
		'02-without-text-alternative.tsx': ['video-without-text-alternative'],
		'03-without-controls.tsx': ['video-without-controls'],
		'04-playable-without-verified-caption.tsx': ['video-playable-without-verified-caption'],
		'05-without-audio-description.tsx': ['video-without-audio-description'],
		'06-dynamic-src.tsx': ['video-without-caption-track'],
		'07-dynamic-controls.tsx': ['video-without-controls'],
		'08-controls-false.tsx': ['video-without-controls'],
		'09-muted-false-is-not-decorative.tsx': ['video-without-controls'],
		'10-dynamic-muted.tsx': ['video-without-controls'],
		'11-spread-may-carry-controls.tsx': ['video-without-controls'],
		'12-spread-overrides-earlier-attributes.tsx': [
			'video-without-text-alternative',
			'video-without-controls',
			'video-playable-without-verified-caption',
			'video-without-audio-description',
		],
	},
};

/** Things this gate deliberately does not decide. */
export const HUMAN_EVALUATION = [
	'whether a caption is accurate, complete and in the right language (SC 1.2.2 quality)',
	'whether a video needs audio description at all (SC 1.2.3 A / SC 1.2.5 AA depend on visual-only information; the gate checks that the DECISION is declared, not that it is right)',
	'whether the poster image represents the work it introduces (SC 1.1.1 quality)',
	'whether the caption source is hard enough to remain available (the `verified` marker is a claim)',
	'a real screen-reader / caption-rendering pass (VoiceOver / NVDA / the browser caption renderer)',
];

/** Whether an exclusion applies to a repo-relative path (pure). */
export function exclusionFor(relativePath) {
	if (/\.test\.tsx$/.test(relativePath)) return EXCLUSIONS[0];
	if (/\.stories\.tsx$/.test(relativePath)) return EXCLUSIONS[1];
	if (relativePath.includes('/fixtures/')) return EXCLUSIONS[2];
	if (relativePath.startsWith('src/routes/design-system/')) return EXCLUSIONS[3];
	return null;
}

/* ------------------------------------------------------------------ *
 * JSX parsing (pure)
 * ------------------------------------------------------------------ */

/**
 * The name a spread attribute (`{...props}`) is recorded under.
 *
 * It is not a real attribute name, so it can never collide with one the
 * gate looks up.
 */
export const SPREAD_ATTRIBUTE_NAME = '...spread';

/** The index of the matching `}` for the `{` at `start` (pure). */
export function matchBrace(text, start) {
	let depth = 0;
	let quote = null;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (char === '\\') {
				index += 1;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			quote = char;
			continue;
		}
		if (char === '{') depth += 1;
		if (char === '}') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/** The index of the `>` that closes the tag opened before `start` (pure). */
export function findTagEnd(code, start) {
	let depth = 0;
	let quote = null;
	for (let index = start; index < code.length; index += 1) {
		const char = code[index];
		if (quote) {
			if (char === '\\') {
				index += 1;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			quote = char;
			continue;
		}
		if (char === '{') {
			depth += 1;
			continue;
		}
		if (char === '}') {
			depth -= 1;
			continue;
		}
		if (char === '>' && depth === 0) return index;
	}
	return -1;
}

/**
 * Parse one JSX opening tag's attributes (pure).
 *
 * Values are reported as written, so the caller can tell a literal from a
 * runtime expression. A spread (`{...props}`) is recorded as its own
 * entry, because it can carry any attribute and therefore decides what the
 * attributes around it really are.
 */
export function parseAttributes(text) {
	const attributes = [];
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}
		if (char === '{') {
			const end = matchBrace(text, index);
			if (end === -1) break;
			const content = text.slice(index + 1, end);
			if (/^\s*\.\.\./.test(content)) {
				attributes.push({
					name: SPREAD_ATTRIBUTE_NAME,
					kind: 'spread',
					value: content.trim(),
				});
			}
			index = end + 1;
			continue;
		}
		let nameEnd = index;
		while (nameEnd < text.length && /[A-Za-z0-9_:.-]/.test(text[nameEnd])) nameEnd += 1;
		if (nameEnd === index) {
			index += 1;
			continue;
		}
		const name = text.slice(index, nameEnd).toLowerCase();
		index = nameEnd;
		let cursor = index;
		while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
		if (text[cursor] !== '=') {
			attributes.push({ name, kind: 'boolean', value: '' });
			continue;
		}
		cursor += 1;
		while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
		const valueChar = text[cursor];
		if (valueChar === '"' || valueChar === "'") {
			const end = text.indexOf(valueChar, cursor + 1);
			const stop = end === -1 ? text.length : end;
			attributes.push({ name, kind: 'string', value: text.slice(cursor + 1, stop) });
			index = stop + 1;
			continue;
		}
		if (valueChar === '{') {
			const end = matchBrace(text, cursor);
			const stop = end === -1 ? text.length : end;
			attributes.push({ name, kind: 'expression', value: text.slice(cursor + 1, stop) });
			index = stop + 1;
			continue;
		}
		let end = cursor;
		while (end < text.length && !/\s/.test(text[end])) end += 1;
		attributes.push({ name, kind: 'string', value: text.slice(cursor, end) });
		index = end;
	}
	return attributes;
}

/** The statically known text of an attribute, or `null` (pure). */
export function attributeValue(attribute) {
	if (!attribute) return null;
	if (attribute.kind === 'string') return attribute.value;
	if (attribute.kind === 'boolean') return 'true';
	const literal = /^(['"])([\s\S]*)\1$/.exec(attribute.value.trim());
	if (literal) return literal[2];
	// `{true}` / `{false}` are statically known booleans.
	const expression = attribute.value.trim();
	if (expression === 'true' || expression === 'false') return expression;
	return null;
}

/** The first attribute with `name`, or `undefined` (pure). */
export function attributeOf(attributes, name) {
	return attributes.find((attribute) => attribute.name === name);
}

/**
 * The index of the LAST spread in a tag, or -1 when there is none (pure).
 *
 * JSX lets a later prop override an earlier one, so only the attributes
 * written AFTER the last spread are final; everything before it may be
 * replaced by the spread.
 */
export function lastSpreadIndex(attributes) {
	for (let index = attributes.length - 1; index >= 0; index -= 1) {
		if (attributes[index].kind === 'spread') return index;
	}
	return -1;
}

/**
 * The attribute with `name`, and whether its value is final (pure).
 *
 * `final` is false when a spread written later may override it, and when
 * the attribute is absent but a spread may still carry it.
 */
export function effectiveAttribute(attributes, name) {
	const spread = lastSpreadIndex(attributes);
	const index = attributes.findIndex((attribute) => attribute.name === name);
	if (index === -1) return { attribute: undefined, final: spread === -1 };
	return { attribute: attributes[index], final: spread === -1 || index > spread };
}

/**
 * Whether an expression is one React renders as no attribute at all (pure).
 *
 * React drops `attr={undefined}` and `attr={null}`, so they are the same
 * fact as an attribute that was never written.
 */
export function isReactAbsent(attribute) {
	if (!attribute || attribute.kind !== 'expression') return false;
	const expression = attribute.value.trim();
	return expression === 'undefined' || expression === 'null';
}

/**
 * The effective boolean state of an attribute (pure).
 *
 * `true` / `false` when the markup decides it, `null` when the gate cannot
 * decide it — a runtime expression, or an attribute a later spread may
 * override. The distinction is the point: a static `false` is a decision
 * the author made, while an undecided value is no decision at all, so it
 * must never be read as "off".
 */
export function booleanState(attributes, name) {
	const { attribute, final } = effectiveAttribute(attributes, name);
	if (attribute === undefined) return final ? false : null;
	if (!final) return null;
	const value = attributeValue(attribute);
	// A boolean attribute written without a value (`controls`) and the DOM
	// form of the same thing (`controls=""`) are both "on".
	if (value === 'true' || value === '') return true;
	if (value === 'false') return false;
	if (value === null && isReactAbsent(attribute)) return false;
	return null;
}

/**
 * The effective string state of an attribute (pure).
 *
 * The statically known value, `''` when the attribute is absent or
 * statically empty, and `null` when the gate cannot decide it.
 */
export function stringState(attributes, name) {
	const { attribute, final } = effectiveAttribute(attributes, name);
	if (attribute === undefined) return final ? '' : null;
	if (!final) return null;
	const value = attributeValue(attribute);
	if (value === null) return isReactAbsent(attribute) ? '' : null;
	return value;
}

/**
 * The statically known value of an OPTIONAL attribute (pure).
 *
 * `value` is `null` when the attribute is absent or undecided, and
 * `undecidable` says which of the two it is — the difference between "the
 * author said nothing" and "the gate cannot read what the author said".
 */
export function optionalStringState(attributes, name) {
	const { attribute, final } = effectiveAttribute(attributes, name);
	if (attribute === undefined) return { value: null, undecidable: false };
	if (!final) return { value: null, undecidable: true };
	const value = attributeValue(attribute);
	if (value === null) return { value: null, undecidable: !isReactAbsent(attribute) };
	return { value, undecidable: false };
}

/**
 * Every `<video>` opening tag in a source, with its attribute text and its
 * closing position (pure).
 */
export function findVideoTags(code) {
	const tags = [];
	let cursor = 0;
	while (cursor < code.length) {
		const start = code.indexOf('<video', cursor);
		if (start === -1) break;
		const after = code[start + 6];
		if (after !== undefined && !/[\s/>]/.test(after)) {
			cursor = start + 6;
			continue;
		}
		const end = findTagEnd(code, start + 6);
		if (end === -1) break;
		const body = code.slice(start + 6, end);
		const selfClosing = /\/\s*$/.test(body);
		const closeStart = selfClosing ? end : findClosingVideo(code, end + 1);
		tags.push({
			index: start,
			line: lineAt(code, start),
			attributes: parseAttributes(body),
			children: closeStart === null ? '' : code.slice(end + 1, closeStart),
			selfClosing,
		});
		cursor = end + 1;
	}
	return tags;
}

/** The index of the `</video>` matching the tag that ended at `start` (pure). */
export function findClosingVideo(code, start) {
	let depth = 1;
	let cursor = start;
	while (cursor < code.length) {
		const open = code.indexOf('<video', cursor);
		const close = code.indexOf('</video', cursor);
		if (close === -1) return null;
		if (open !== -1 && open < close) {
			const after = code[open + 6];
			if (after === undefined || /[\s/>]/.test(after)) depth += 1;
			cursor = open + 6;
			continue;
		}
		depth -= 1;
		if (depth === 0) return close;
		cursor = close + 7;
	}
	return null;
}

/** Every `<track>` in a video's children (pure). */
export function findTrackTags(children) {
	const tracks = [];
	let cursor = 0;
	while (cursor < children.length) {
		const start = children.indexOf('<track', cursor);
		if (start === -1) break;
		const after = children[start + 6];
		if (after !== undefined && !/[\s/>]/.test(after)) {
			cursor = start + 6;
			continue;
		}
		const end = findTagEnd(children, start + 6);
		if (end === -1) break;
		tracks.push(parseAttributes(children.slice(start + 6, end)));
		cursor = end + 1;
	}
	return tracks;
}

/** Whether a video's children hold a `<source>` element (pure). */
export function hasSourceChild(children) {
	return /<source(?=[\s/>])/.test(children);
}

/* ------------------------------------------------------------------ *
 * the video contract (pure)
 * ------------------------------------------------------------------ */

/**
 * Whether a video is DECORATIVE (pure).
 *
 * A background video owes no captions and no controls, but only when it is
 * BOTH silenced (`muted`) and hidden from assistive technology. `muted`
 * alone is still a video a visitor can see; `aria-hidden` alone is still a
 * video that makes sound.
 *
 * `muted={false}` does NOT silence a video: the effective value decides,
 * not the presence of the attribute.
 */
export function isDecorativeVideo(attributes) {
	return decorativeState(attributes) === true;
}

/**
 * Whether a video is DECORATIVE, and whether that is decidable (pure).
 *
 * `true` when the video is silenced AND hidden, `false` when it is not, and
 * `null` when the gate cannot decide — a runtime `muted`, a runtime
 * `aria-hidden`, or a spread that may carry either. An undecided
 * decoration is NOT an exemption: the video is judged as content.
 */
export function decorativeState(attributes) {
	const muted = booleanState(attributes, 'muted');
	if (muted === false) return false;
	if (muted === null) return null;
	if (DECORATIVE_MARKS.some((mark) => mark.decided(attributes))) return true;
	if (DECORATIVE_MARKS.some((mark) => mark.undecided(attributes))) return null;
	return false;
}

/**
 * Whether a video is playable — and whether that is decidable (pure).
 *
 * `true` / `false` when the markup decides it, `null` when it does not: a
 * `src` whose value is a runtime expression may or may not point at media,
 * and "the gate cannot tell" must never be read as "it cannot play".
 */
export function playableState(attributes, hasSource) {
	const src = stringState(attributes, 'src');
	if (src !== null && src.trim().length > 0) return true;
	if (hasSource === true) return true;
	if (src === '') return false;
	return null;
}

/** Whether a video has a `<track kind="captions">` (pure). */
export function hasCaptionTrack(tracks) {
	return tracks.some(
		(track) =>
			(attributeValue(attributeOf(track, 'kind')) ?? '').toLowerCase() === CAPTION_TRACK_KIND,
	);
}

/**
 * Whether a video has an accessible name (pure).
 *
 * A name whose value is a runtime expression is NOT a name the gate can
 * read, so the video counts as unnamed and the static / text alternative
 * rule applies to it.
 */
export function hasTextAlternative(attributes) {
	return NAME_ATTRIBUTES.some((name) => {
		const value = stringState(attributes, name);
		return value !== null && value.trim().length > 0;
	});
}

/**
 * Whether a video declares a poster image, and whether that is decidable
 * (pure).
 */
export function posterState(attributes) {
	const poster = stringState(attributes, 'poster');
	if (poster === null) return null;
	return poster.trim().length > 0;
}

/** The facts of one video (pure). */
export function videoFacts({ attributes, tracks = [], hasSource = false }) {
	const playable = playableState(attributes, hasSource);
	const decorative = decorativeState(attributes);
	const controls = booleanState(attributes, 'controls');
	const poster = posterState(attributes);
	const muted = booleanState(attributes, 'muted');
	const caption = optionalStringState(attributes, CAPTION_STATUS_ATTRIBUTE);
	const ad = optionalStringState(attributes, AD_STATUS_ATTRIBUTE);

	// The attributes whose value the gate could NOT decide. They are
	// reported separately from a static `false`, so a reader can tell
	// "the author decided this" from "the gate cannot read this".
	const undecidable = [];
	if (playable === null) undecidable.push('src');
	if (muted === null) undecidable.push('muted');
	if (decorative === null && muted === true) {
		const mark = DECORATIVE_MARKS.find((candidate) => candidate.undecided(attributes));
		if (mark) undecidable.push(mark.attribute);
	}
	if (controls === null) undecidable.push('controls');
	if (poster === null) undecidable.push('poster');
	const nameAttribute = NAME_ATTRIBUTES.find((name) => stringState(attributes, name) === null);
	if (nameAttribute) undecidable.push(nameAttribute);
	if (caption.undecidable) undecidable.push(CAPTION_STATUS_ATTRIBUTE);
	if (ad.undecidable) undecidable.push(AD_STATUS_ATTRIBUTE);

	return {
		playable: playable !== false,
		decorative: decorative === true,
		hasControls: controls === true,
		hasPoster: poster === true,
		hasName: hasTextAlternative(attributes),
		captionTracks: tracks.filter(
			(track) =>
				(attributeValue(attributeOf(track, 'kind')) ?? '').toLowerCase() === CAPTION_TRACK_KIND,
		).length,
		captionStatus: caption.value,
		descriptionTracks: tracks.filter(
			(track) =>
				(attributeValue(attributeOf(track, 'kind')) ?? '').toLowerCase() === DESCRIPTION_TRACK_KIND,
		).length,
		adStatus: ad.value,
		undecidable,
	};
}

/**
 * What each undecided attribute means for the verdict (pure).
 *
 * Every entry names the direction the gate judged in, so the report says
 * WHY a value was read the way it was.
 */
export const UNDECIDABLE_CONSEQUENCE = {
	src: 'the video is treated as playable',
	controls: 'the video is treated as having no controls',
	muted: 'the video is treated as making sound',
	poster: 'the video is treated as having no poster',
	'aria-label': 'the video is treated as unnamed',
	'aria-labelledby': 'the video is treated as unnamed',
	title: 'the video is treated as unnamed',
	'data-caption-status': 'the caption source counts as unverified',
	'data-audio-description-status': 'the audio-description disposition counts as undecided',
};

/**
 * The note that names an attribute the gate could not decide (pure).
 *
 * `''` when the attribute was decided, so a static `false` and an
 * undecided value never read the same.
 */
export function undecidableNote(facts, name) {
	if (!facts.undecidable.includes(name)) return '';
	const consequence = UNDECIDABLE_CONSEQUENCE[name] ?? 'the gate judges the safe direction';
	return ` (the \`${name}\` value is not statically decidable, so ${consequence})`;
}

/** The note for the accessible name, whichever attribute carries it (pure). */
function nameNote(facts) {
	const name = NAME_ATTRIBUTES.find((candidate) => facts.undecidable.includes(candidate));
	return name ? undecidableNote(facts, name) : '';
}

/**
 * The violations of one `<video>` element (pure).
 *
 * A decorative video is exempt from the caption / control / playability
 * rules, but not from the requirement that it really IS decorative (the
 * helper decides), and it is never exempt from the risk that a reader
 * cannot perceive the content — that is a human judgement.
 */
export function evaluateVideo(element) {
	const { attributes, tracks = [], hasSource = false, line = null, file = null } = element;
	const facts = videoFacts({ attributes, tracks, hasSource });
	const violations = [];
	if (facts.decorative) return { facts, violations };

	if (facts.playable && facts.captionTracks === 0) {
		violations.push({
			rule: 'video-without-caption-track',
			wcag: WCAG_BY_RULE['video-without-caption-track'],
			message: `a playable <video> has no <track kind="captions">: the spoken content is not captioned (SC 1.2.2). A <track> without \`kind\` defaults to \`subtitles\`, which does not caption the speech${undecidableNote(facts, 'src')}`,
		});
	}
	if (!facts.hasPoster || !facts.hasName) {
		const missing = [
			!facts.hasPoster ? 'no poster image' : '',
			!facts.hasName ? 'no accessible name (aria-label / aria-labelledby / title)' : '',
		].filter((part) => part !== '');
		violations.push({
			rule: 'video-without-text-alternative',
			wcag: WCAG_BY_RULE['video-without-text-alternative'],
			message: `${missing.join(' and ')}: the video has no static / text alternative (SC 1.1.1)${undecidableNote(facts, 'poster')}${nameNote(facts)}`,
		});
	}
	if (facts.playable && !facts.hasControls) {
		violations.push({
			rule: 'video-without-controls',
			wcag: WCAG_BY_RULE['video-without-controls'],
			message: `a playable <video> has no \`controls\`: a keyboard user cannot start, pause or seek it (SC 2.1.1)${undecidableNote(facts, 'controls')}`,
		});
	}
	if (
		facts.playable &&
		facts.captionTracks > 0 &&
		facts.captionStatus !== CAPTION_STATUS_VERIFIED
	) {
		violations.push({
			rule: 'video-playable-without-verified-caption',
			wcag: WCAG_BY_RULE['video-playable-without-verified-caption'],
			message: `a playable <video> carries a caption track but does not declare ${CAPTION_STATUS_ATTRIBUTE}="${CAPTION_STATUS_VERIFIED}" (saw ${facts.captionStatus === null ? 'nothing' : `"${facts.captionStatus}"`}): a work whose caption source is undetermined is presented as playable (SC 1.2.2)${undecidableNote(facts, CAPTION_STATUS_ATTRIBUTE)}`,
		});
	}
	const adProvided = facts.adStatus === AD_STATUS_PROVIDED && facts.descriptionTracks > 0;
	const adNotRequired = facts.adStatus === AD_STATUS_NOT_REQUIRED;
	if (facts.playable && !adProvided && !adNotRequired) {
		violations.push({
			rule: 'video-without-audio-description',
			wcag: WCAG_BY_RULE['video-without-audio-description'],
			message: `a playable <video> does not declare its audio description: set ${AD_STATUS_ATTRIBUTE}="${AD_STATUS_PROVIDED}" with a <track kind="${DESCRIPTION_TRACK_KIND}">, or "${AD_STATUS_NOT_REQUIRED}" when the work carries no visual-only information (SC 1.2.3 A / SC 1.2.5 AA, fail-closed — saw ${facts.adStatus === null ? 'nothing' : `"${facts.adStatus}"`})${undecidableNote(facts, AD_STATUS_ATTRIBUTE)}`,
		});
	}
	return { facts, violations };
}

/**
 * The violations of one source file (pure).
 *
 * Comments are removed first, so a `<video>` named in a doc comment is
 * documentation rather than a violation.
 */
export function scanViolationsInFile({ relativePath, source }) {
	const code = stripComments(source);
	const violations = [];
	const videos = [];
	for (const tag of findVideoTags(code)) {
		const evaluation = evaluateVideo({
			attributes: tag.attributes,
			tracks: findTrackTags(tag.children),
			hasSource: hasSourceChild(tag.children),
			line: tag.line,
			file: relativePath,
		});
		videos.push({ line: tag.line, ...evaluation.facts });
		for (const violation of evaluation.violations) {
			violations.push({
				rule: violation.rule,
				file: relativePath,
				line: tag.line,
				wcag: violation.wcag,
				message: violation.message,
			});
		}
	}
	return { violations, videos };
}

/* ------------------------------------------------------------------ *
 * the fixtures (pure)
 * ------------------------------------------------------------------ */

/**
 * Audit the fixture FILES against the roster (pure), mirroring the
 * image-alt gate.
 */
export function auditFixtureFiles(entries) {
	const violations = [];
	const rows = [];
	for (const entry of entries) {
		const { directory, relativePath, expectedRules, evaluation, videoCount } = entry;
		if (directory === 'pass') {
			if (videoCount === 0) {
				violations.push({
					rule: 'fixture-pass-no-video',
					file: relativePath,
					line: null,
					wcag: null,
					message:
						'the pass fixture holds no <video> at all, so it exercises no rule; an empty pass fixture proves nothing and must not keep the gate green',
				});
			}
			if (evaluation.violations.length > 0) {
				violations.push({
					rule: 'fixture-pass-violation',
					file: relativePath,
					line: evaluation.violations[0].line ?? null,
					wcag: null,
					message: `a pass fixture reports ${evaluation.violations.map((violation) => violation.rule).join(', ')}; the pass state is no longer reproduced`,
				});
			}
			rows.push({
				file: relativePath,
				expected: [],
				found: evaluation.violations.map((violation) => violation.rule),
				videos: videoCount,
			});
			continue;
		}
		const found = evaluation.violations.map((violation) => violation.rule);
		const missing = expectedRules.filter((rule) => !found.includes(rule));
		const unexpected = found.filter((rule) => !expectedRules.includes(rule));
		if (missing.length > 0) {
			violations.push({
				rule: 'fixture-fail-not-detected',
				file: relativePath,
				line: null,
				wcag: null,
				message: `the fail fixture no longer reports ${missing.join(', ')}; the defect it reproduces is not detected any more`,
			});
		}
		if (unexpected.length > 0) {
			violations.push({
				rule: 'fixture-fail-unexpected',
				file: relativePath,
				line: null,
				wcag: null,
				message: `the fail fixture reports ${unexpected.join(', ')}, which it does not stand for`,
			});
		}
		rows.push({ file: relativePath, expected: [...expectedRules], found, videos: videoCount });
	}
	return { violations, rows };
}

/**
 * Audit the fixture (pure over the filesystem).
 *
 * The fixture is read by the gate, not only by its test: a fixture that
 * stopped reproducing its defect is reported as a violation of the gate's
 * own contract rather than silently passing.
 */
export function auditFixture(repoRoot = REPO_ROOT) {
	const violations = [];
	const entries = [];
	for (const [directory, expectations] of Object.entries(FIXTURE_EXPECTATIONS)) {
		const absolute = join(repoRoot, FIXTURE_ROOT, directory);
		const present = existsSync(absolute)
			? readdirSync(absolute).filter((name) => name.endsWith('.tsx'))
			: [];
		for (const [name, expectedRules] of Object.entries(expectations)) {
			const relativePath = `${FIXTURE_ROOT}/${directory}/${name}`;
			if (!present.includes(name)) {
				violations.push({
					rule: 'fixture-file-missing',
					file: relativePath,
					line: null,
					wcag: null,
					message:
						'the fixture file is missing; a fixture that is not there proves nothing about the rule it stands for',
				});
				continue;
			}
			const evaluation = scanViolationsInFile({
				relativePath,
				source: readFileSync(join(absolute, name), 'utf8'),
			});
			entries.push({
				directory,
				name,
				relativePath,
				expectedRules,
				evaluation,
				videoCount: evaluation.videos.length,
			});
		}
		const extra = present.filter((name) => !(name in expectations));
		for (const name of extra) {
			violations.push({
				rule: 'fixture-file-unexpected',
				file: `${FIXTURE_ROOT}/${directory}/${name}`,
				line: null,
				wcag: null,
				message:
					'the fixture directory holds a file the gate does not expect; either the roster or the file is stale',
			});
		}
	}
	const audited = auditFixtureFiles(entries);
	return { violations: [...violations, ...audited.violations], rows: audited.rows };
}

/** Every `.tsx` file under a directory (pure over the filesystem). */
function collectTsxFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTsxFiles(path));
			continue;
		}
		if (!entry.name.endsWith(SCAN_SUFFIX)) continue;
		files.push(path);
	}
	return files;
}

/**
 * Scan the shipped surface (pure over `repoRoot`).
 */
export function scanShippedSource(repoRoot = REPO_ROOT) {
	const violations = [];
	const excluded = [];
	const videos = [];
	let filesScanned = 0;
	const scanRoot = join(repoRoot, SCAN_ROOT);
	if (!existsSync(scanRoot)) {
		throw new Error(`cannot scan the repository: ${SCAN_ROOT} is not a directory`);
	}
	for (const file of collectTsxFiles(scanRoot)) {
		const relativePath = toRepoPath(file, repoRoot);
		const exclusion = exclusionFor(relativePath);
		if (exclusion) {
			excluded.push({ file: relativePath, reason: exclusion.id });
			continue;
		}
		filesScanned += 1;
		const result = scanViolationsInFile({
			relativePath,
			source: readFileSync(file, 'utf8'),
		});
		violations.push(...result.violations);
		videos.push(...result.videos.map((video) => ({ file: relativePath, ...video })));
	}
	return { filesScanned, videosScanned: videos.length, videos, violations, excluded };
}

/**
 * Scan the repository (pure over `repoRoot`).
 */
export function collectEvidence(repoRoot = REPO_ROOT) {
	const shipped = scanShippedSource(repoRoot);
	const fixture = auditFixture(repoRoot);
	return {
		shipped,
		fixture,
		violations: [...shipped.violations, ...fixture.violations],
		humanEvaluation: HUMAN_EVALUATION,
		wcag: WCAG,
		wcagReference: WCAG_REFERENCE,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push(`video caption / text alternative gate — Issue ${ISSUE}`);
	lines.push(
		`scanned ${evidence.shipped.filesScanned} shipped .tsx file(s) under ${SCAN_ROOT}/, ${evidence.shipped.videosScanned} <video> element(s); fixture: ${evidence.fixture.rows.length} file(s)`,
	);
	lines.push('');
	lines.push('machine-checked:');
	for (const rule of RULES) {
		const count = evidence.shipped.violations.filter((entry) => entry.rule === rule).length;
		lines.push(
			`  ${count === 0 ? 'ok  ' : 'FAIL'} ${rule.padEnd(42)} ${count} shipped violation(s) (SC ${WCAG_BY_RULE[rule]})`,
		);
	}
	lines.push(
		`  ${evidence.fixture.violations.length === 0 ? 'ok  ' : 'FAIL'} ${'fixture'.padEnd(42)} ${evidence.fixture.rows.length} fixture file(s) reproduce the states they stand for`,
	);
	const undecidable = evidence.shipped.videos.filter((video) => video.undecidable.length > 0);
	lines.push(
		`  ${undecidable.length === 0 ? 'ok  ' : 'FAIL'} ${'undecidable-values'.padEnd(42)} ${undecidable.length} video(s) carry a value the gate cannot decide statically (judged in the safe direction)`,
	);
	if (undecidable.length > 0) {
		for (const video of undecidable) {
			lines.push(`    ${video.file}:${video.line} — ${video.undecidable.join(', ')}`);
		}
	}
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push(
		`reference only: SC ${evidence.wcagReference.sc} ${evidence.wcagReference.name} (${evidence.wcagReference.level}) is NOT enforced by this gate`,
	);
	lines.push('');
	lines.push('out of scope (excluded from the shipped scan, with the reason):');
	for (const exclusion of EXCLUSIONS) {
		const count = evidence.shipped.excluded.filter((entry) => entry.reason === exclusion.id).length;
		lines.push(`  - ${exclusion.describe} (${count} file(s)): ${exclusion.reason}`);
	}
	lines.push('');
	lines.push('fixture expectations:');
	for (const row of evidence.fixture.rows) {
		lines.push(
			`  ${row.file} — videos=${row.videos}, expected=[${row.expected.join(', ')}], found=[${row.found.join(', ')}]`,
		);
	}
	lines.push('');
	if (evidence.violations.length > 0) {
		lines.push(`violations (${evidence.violations.length}):`);
		for (const entry of evidence.violations) {
			const where = entry.line ? `${entry.file}:${entry.line}` : entry.file;
			lines.push(`  [${entry.rule}] ${where} — ${entry.message}`);
		}
	} else {
		lines.push('no violations');
	}
	return lines.join('\n');
}

function main() {
	let evidence;
	try {
		evidence = collectEvidence();
	} catch (error) {
		process.stderr.write(`cannot scan the repository: ${error.message}\n`);
		return 2;
	}
	const report = `${renderGateSummary(evidence)}\n`;
	if (evidence.violations.length > 0) process.stderr.write(report);
	else process.stdout.write(report);
	return evidence.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main());
}

export { main };
