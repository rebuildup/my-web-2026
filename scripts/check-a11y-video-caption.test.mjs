/**
 * The Issue #408 gate's own unit tests.
 *
 * The gate is the machine half of the Issue ("どの動画に字幕・代替・制御が要るかを
 * 機械検査で固定する"), so the rules have to be testable without a browser.
 *
 * The fixture assertions are deliberately strict: the roster is compared
 * with the directory listing and every fail fixture is matched against the
 * rule it stands for, so a deleted or neutered fixture cannot keep the gate
 * green.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	AD_STATUS_PROVIDED,
	CAPTION_TRACK_KIND,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	RULES,
	WCAG,
	WCAG_REFERENCE,
	attributeValue,
	auditFixtureFiles,
	booleanState,
	collectEvidence,
	decorativeState,
	evaluateVideo,
	findTrackTags,
	findVideoTags,
	hasCaptionTrack,
	hasSourceChild,
	hasTextAlternative,
	isDecorativeVideo,
	parseAttributes,
	playableState,
	renderGateSummary,
	scanViolationsInFile,
	videoFacts,
} from './check-a11y-video-caption.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Scan a source snippet the way the gate scans a file. */
function scan(source) {
	return scanViolationsInFile({ relativePath: 'src/portfolio/Example.tsx', source });
}

/** The rules a snippet reports. */
function rulesOf(source) {
	return scan(source).violations.map((violation) => violation.rule);
}

/** The evaluateVideo input built from a source snippet's first <video>. */
function videoInput(source) {
	const [tag] = findVideoTags(source);
	return {
		attributes: tag.attributes,
		tracks: findTrackTags(tag.children),
		hasSource: hasSourceChild(tag.children),
	};
}

/** A snippet with captions, audio description and controls (the happy path). */
const GOOD = `<video
	controls
	poster="/a.webp"
	aria-label="A work"
	data-caption-status="verified"
	data-audio-description-status="provided"
><source src="/a.mp4" /><track kind="captions" src="/c.vtt" /><track kind="descriptions" src="/d.vtt" /></video>`;

test('the attribute parser distinguishes a literal from an expression', () => {
	const attributes = parseAttributes(
		' controls poster="/a.webp" data-caption-status="verified" muted aria-label={name}',
	);
	assert.deepEqual(
		attributes.map((attribute) => [attribute.name, attribute.kind]),
		[
			['controls', 'boolean'],
			['poster', 'string'],
			['data-caption-status', 'string'],
			['muted', 'boolean'],
			['aria-label', 'expression'],
		],
	);
	assert.equal(attributeValue(attributes[0]), 'true');
	assert.equal(attributeValue(attributes[1]), '/a.webp');
	assert.equal(attributeValue(attributes[4]), null);
});

test('a video with no src and no source child is not playable', () => {
	const [tag] = findVideoTags('<video poster="/a.webp" aria-label="x" />');
	assert.equal(playableState(tag.attributes, hasSourceChild(tag.children)), false);
	const [playable] = findVideoTags('<video src="/a.mp4" />');
	assert.equal(playableState(playable.attributes, hasSourceChild(playable.children)), true);
	const [sourced] = findVideoTags('<video><source src="/a.mp4" /></video>');
	assert.equal(playableState(sourced.attributes, hasSourceChild(sourced.children)), true);
});

test('a src the gate cannot read is judged as playable, not as "cannot play"', () => {
	const [tag] = findVideoTags('<video src={clipUrl} />');
	assert.equal(playableState(tag.attributes, hasSourceChild(tag.children)), null);
	const [empty] = findVideoTags('<video src="" />');
	assert.equal(playableState(empty.attributes, hasSourceChild(empty.children)), false);
});

test('a decorative video must be both muted and hidden', () => {
	const mutedOnly = parseAttributes(' muted');
	assert.equal(isDecorativeVideo(mutedOnly), false);
	const hiddenOnly = parseAttributes(' aria-hidden="true"');
	assert.equal(isDecorativeVideo(hiddenOnly), false);
	const both = parseAttributes(' muted aria-hidden="true"');
	assert.equal(isDecorativeVideo(both), true);
});

test('the effective boolean reads the VALUE, not the presence of the attribute', () => {
	assert.equal(booleanState(parseAttributes(' muted'), 'muted'), true);
	assert.equal(booleanState(parseAttributes(' muted="true"'), 'muted'), true);
	assert.equal(booleanState(parseAttributes(' muted={true}'), 'muted'), true);
	assert.equal(booleanState(parseAttributes(' muted={false}'), 'muted'), false);
	assert.equal(booleanState(parseAttributes(' muted="false"'), 'muted'), false);
	assert.equal(booleanState(parseAttributes(' muted={undefined}'), 'muted'), false);
	assert.equal(booleanState(parseAttributes(' muted={null}'), 'muted'), false);
	// A value the gate cannot read is not "off" — it is undecided.
	assert.equal(booleanState(parseAttributes(' muted={isMuted}'), 'muted'), null);
	// The DOM form of a boolean attribute carries no value.
	assert.equal(booleanState(parseAttributes(' controls=""'), 'controls'), true);
});

test('muted={false} does not silence a video', () => {
	const attributes = parseAttributes(' muted={false} aria-hidden="true"');
	assert.equal(decorativeState(attributes), false);
});

test('a muted value the gate cannot read is not read as silence', () => {
	assert.equal(decorativeState(parseAttributes(' muted={isMuted} aria-hidden="true"')), null);
});

test('a spread makes every attribute it may carry undecided', () => {
	const leading = parseAttributes(' {...props} controls poster="/a.webp"');
	// Written after the spread: JSX lets a later prop win, so it is final.
	assert.equal(booleanState(leading, 'controls'), true);
	// Absent: the spread may still carry it.
	assert.equal(booleanState(leading, 'muted'), null);
	const trailing = parseAttributes(' controls {...props}');
	// Written before the spread: the spread may override it.
	assert.equal(booleanState(trailing, 'controls'), null);
});

test('a static false and an undecided value are different facts', () => {
	const off = videoFacts(videoInput('<video controls={false} poster="/a.webp" aria-label="x" />'));
	const undecided = videoFacts(
		videoInput('<video controls={isPlaying} poster="/a.webp" aria-label="x" />'),
	);

	assert.equal(off.hasControls, false);
	assert.deepEqual(off.undecidable, []);
	assert.equal(undecided.hasControls, false);
	assert.deepEqual(undecided.undecidable, ['controls']);
});

test('only an explicit kind="captions" track captions the speech', () => {
	assert.equal(hasCaptionTrack(findTrackTags('<track kind="captions" src="/c.vtt" />')), true);
	assert.equal(hasCaptionTrack(findTrackTags('<track src="/c.vtt" />')), false);
	assert.equal(hasCaptionTrack(findTrackTags('<track kind="subtitles" src="/c.vtt" />')), false);
	assert.equal(CAPTION_TRACK_KIND, 'captions');
});

test('the text alternative needs an accessible name', () => {
	assert.equal(hasTextAlternative(parseAttributes(' aria-label="A demo"')), true);
	assert.equal(hasTextAlternative(parseAttributes(' aria-labelledby="title"')), true);
	assert.equal(hasTextAlternative(parseAttributes(' title="A demo"')), true);
	assert.equal(hasTextAlternative(parseAttributes(' poster="/a.webp"')), false);
});

test('a playable video with no caption track is a violation', () => {
	const source = `<video controls poster="/a.webp" aria-label="x" data-audio-description-status="provided"><source src="/a.mp4" /><track kind="descriptions" src="/d.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));
	assert.equal(facts.captionTracks, 0);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-caption-track'],
	);
});

test('a video with no static / text alternative is a violation', () => {
	const source = `<video controls data-caption-status="verified" data-audio-description-status="provided"><source src="/a.mp4" /><track kind="captions" src="/c.vtt" /><track kind="descriptions" src="/d.vtt" /></video>`;
	const { violations } = evaluateVideo(videoInput(source));
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-text-alternative'],
	);
});

test('a playable video with no controls is a violation', () => {
	const source = `<video poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="provided"><source src="/a.mp4" /><track kind="captions" src="/c.vtt" /><track kind="descriptions" src="/d.vtt" /></video>`;
	const { violations } = evaluateVideo(videoInput(source));
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-controls'],
	);
});

test('a playable video whose caption source is unverified is a violation', () => {
	const source = `<video controls poster="/a.webp" aria-label="x" data-audio-description-status="provided"><source src="/a.mp4" /><track kind="captions" src="/c.vtt" /><track kind="descriptions" src="/d.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));
	assert.equal(facts.captionStatus, null);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-playable-without-verified-caption'],
	);
});

test('a playable video without an audio-description disposition is a violation (SC 1.2.3 A / SC 1.2.5 AA)', () => {
	const source = `<video controls poster="/a.webp" aria-label="x" data-caption-status="verified"><source src="/a.mp4" /><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));
	assert.equal(facts.adStatus, null);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-audio-description'],
	);
});

test('a claimed audio description needs the descriptions track (fail-closed)', () => {
	const source = `<video controls poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="provided"><source src="/a.mp4" /><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));
	assert.equal(facts.descriptionTracks, 0);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-audio-description'],
	);
});

test('not-required is an accepted audio-description disposition', () => {
	const source = `<video controls poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="not-required"><source src="/a.mp4" /><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));
	assert.equal(facts.adStatus, 'not-required');
	assert.deepEqual(violations, []);
});

test('an unknown audio-description disposition is not a decision', () => {
	const source = `<video controls poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="maybe"><source src="/a.mp4" /><track kind="captions" src="/c.vtt" /></video>`;
	assert.deepEqual(rulesOf(source), ['video-without-audio-description']);
});

test('a fully captioned, described video passes', () => {
	assert.deepEqual(rulesOf(GOOD), []);
});

test('a decorative video is exempt from captions, description and controls', () => {
	const source = '<video muted aria-hidden="true" autoPlay loop><source src="/bg.mp4" /></video>';
	const { facts, violations } = evaluateVideo(videoInput(source));
	assert.equal(facts.decorative, true);
	assert.deepEqual(violations, []);
});

test('a video named in a comment is documentation, not a violation', () => {
	const source = [
		'/**',
		' * A `<video>` without a track loses the captions.',
		' */',
		'export const A = () => <div />;',
	].join('\n');
	assert.deepEqual(scan(source).violations, []);
});

test('the facts of a video are the whole contract', () => {
	const facts = videoFacts(videoInput(GOOD));
	assert.deepEqual(facts, {
		playable: true,
		decorative: false,
		hasControls: true,
		hasPoster: true,
		hasName: true,
		captionTracks: 1,
		captionStatus: 'verified',
		descriptionTracks: 1,
		adStatus: AD_STATUS_PROVIDED,
		undecidable: [],
	});
});

test('a dynamic src does not skip the caption / controls / audio-description rules', () => {
	const source = `<video controls poster="/a.webp" aria-label="x" data-audio-description-status="not-required" src={clipUrl} />`;
	const { facts, violations } = evaluateVideo(videoInput(source));

	assert.equal(facts.playable, true, 'a src the gate cannot read is judged as playable');
	assert.deepEqual(facts.undecidable, ['src']);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-caption-track'],
	);
	assert.match(violations[0].message, /not statically decidable/);
});

test('a video that is not silenced is checked even when it is hidden from AT', () => {
	const source = `<video muted={false} aria-hidden="true" poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="not-required" src="/a.mp4"><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));

	assert.equal(facts.decorative, false, 'muted={false} does not make the video decorative');
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-controls'],
	);
});

test('a muted value the gate cannot read is not read as silence', () => {
	const source = `<video muted={isMuted} aria-hidden="true" poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="not-required" src="/a.mp4"><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));

	assert.equal(facts.decorative, false);
	assert.deepEqual(facts.undecidable, ['muted']);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-controls'],
	);
});

test('controls={false} is not a control', () => {
	const source = `<video controls={false} poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="not-required" src="/a.mp4"><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));

	assert.equal(facts.hasControls, false);
	assert.deepEqual(facts.undecidable, []);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-controls'],
	);
});

test('a controls value the gate cannot read does not pass either', () => {
	const source = `<video controls={isPlaying} poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="not-required" src="/a.mp4"><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));

	assert.equal(facts.hasControls, false);
	assert.deepEqual(facts.undecidable, ['controls']);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-controls'],
	);
	assert.match(violations[0].message, /not statically decidable/);
});

test('a spread may carry any attribute, so the video is judged in the safe direction', () => {
	const source = `<video {...props} poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="not-required" src="/a.mp4"><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));

	assert.equal(facts.hasControls, false, 'the spread may carry `controls`');
	assert.ok(facts.undecidable.includes('controls'));
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['video-without-controls'],
	);
});

test('attributes written after a spread are final', () => {
	const source = `<video {...props} controls poster="/a.webp" aria-label="x" data-caption-status="verified" data-audio-description-status="not-required" src="/a.mp4"><track kind="captions" src="/c.vtt" /></video>`;
	const { facts, violations } = evaluateVideo(videoInput(source));

	assert.equal(facts.hasControls, true);
	assert.deepEqual(violations, []);
});

test('every rule the Issue names is a rule the gate knows', () => {
	for (const rule of [
		'video-without-caption-track',
		'video-without-text-alternative',
		'video-without-controls',
		'video-playable-without-verified-caption',
		'video-without-audio-description',
	]) {
		assert.ok(RULES.includes(rule), `${rule} must be a known rule`);
	}
});

test('SC 1.2.5 is AA, and the AAA reference is 1.2.8', () => {
	const aa = WCAG.find((criterion) => criterion.sc === '1.2.5');
	assert.equal(aa?.level, 'AA');
	const ad = WCAG.find((criterion) => criterion.sc === '1.2.3');
	assert.equal(ad?.level, 'A');
	assert.equal(ad?.name, 'Audio Description or Media Alternative (Prerecorded)');
	assert.equal(WCAG_REFERENCE.sc, '1.2.8');
	assert.equal(WCAG_REFERENCE.level, 'AAA');
});

test('the fixture roster matches the fixture directory exactly', () => {
	for (const [directory, expectations] of Object.entries(FIXTURE_EXPECTATIONS)) {
		const absolute = join(REPO_ROOT, FIXTURE_ROOT, directory);
		const present = readdirSync(absolute)
			.filter((name) => name.endsWith('.tsx'))
			.sort();
		const expected = Object.keys(expectations).sort();

		assert.deepEqual(present, expected, `the ${directory} fixture roster drifted`);
		assert.ok(present.length >= 2, `the ${directory} fixture needs at least two files`);
	}
});

test('every pass fixture produces no violation and holds a video', () => {
	for (const [name] of Object.entries(FIXTURE_EXPECTATIONS.pass)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'pass', name);
		const result = scanViolationsInFile({
			relativePath: `${FIXTURE_ROOT}/pass/${name}`,
			source: readFileSync(file, 'utf8'),
		});

		assert.deepEqual(
			result.violations.map((violation) => violation.rule),
			[],
			`${name} must stay a pass fixture`,
		);
		assert.ok(result.videos.length > 0, `${name} must hold a <video>`);
	}
});

test('every fail fixture reproduces exactly the rule it stands for', () => {
	for (const [name, expectedRules] of Object.entries(FIXTURE_EXPECTATIONS.fail)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'fail', name);
		const result = scanViolationsInFile({
			relativePath: `${FIXTURE_ROOT}/fail/${name}`,
			source: readFileSync(file, 'utf8'),
		});

		assert.deepEqual(
			result.violations.map((violation) => violation.rule),
			expectedRules,
			`${name} must reproduce ${expectedRules.join(', ')}`,
		);
	}
});

test('an emptied pass fixture is reported instead of passing silently', () => {
	const audited = auditFixtureFiles([
		{
			directory: 'pass',
			name: 'empty.tsx',
			relativePath: `${FIXTURE_ROOT}/pass/empty.tsx`,
			expectedRules: [],
			evaluation: { violations: [], videos: [] },
			videoCount: 0,
		},
	]);

	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, 'fixture-pass-no-video');
});

test('the shipped repository passes the gate, with no video published yet', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.ok(evidence.shipped.filesScanned > 0);
	assert.equal(evidence.shipped.videosScanned, 0);
	assert.equal(evidence.fixture.violations.length, 0);
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /SC 1\.2\.5/);
	assert.ok(report.includes(WCAG_REFERENCE.sc));
	assert.match(report, /NOT enforced/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});

test('the report states what was left out of scope, and why', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /out of scope \(excluded from the shipped scan, with the reason\):/);
	assert.match(report, /design-system/);
});
