/**
 * The Issue #408 capture's own unit tests.
 *
 * The capture is a browser-side ASSERTION, so the parts that decide
 * whether the artefact may be written have to be testable without a
 * browser: a capture that can only fail inside Chromium is a capture
 * nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	CAPTION_FILE,
	CAPTION_VTT,
	CASES,
	HARNESS_DIR,
	MISSING_CAPTION,
	assertWebpOutputPath,
	evaluateObservation,
	harnessCaptionResolver,
	harnessIndexHtml,
	resolveStaticTarget,
	screenshotBudgetVerdict,
	writeHarness,
} from './capture-a11y-video-caption.mjs';

/**
 * The caption-source resolver the synthetic observations are judged with.
 *
 * It is the REAL resolver the capture uses, pointed at a real harness
 * directory: the gate reads the caption SOURCE, so the browser half has
 * to say what the harness actually serves — a real WebVTT document for
 * the working card, and no file at all for the failing one. A hand-written
 * stub would let the capture pass while the harness served nothing.
 */
const harnessRoot = mkdtempSync(join(tmpdir(), 'a11y-video-caption-capture-'));
writeHarness(harnessRoot);
const resolveCaptionSource = harnessCaptionResolver(join(harnessRoot, HARNESS_DIR));
process.on('exit', () => rmSync(harnessRoot, { recursive: true, force: true }));

/** Judge an observation the way the capture does, with the harness resolver. */
function verdictOf(observation) {
	return evaluateObservation({ ...observation, resolveCaptionSource });
}

const attr = (name, value) => ({ name, kind: 'string', value });
/** One track as the gate sees it: a list of tracks, each a list of attributes. */
const track = (src) => [[attr('kind', 'captions'), attr('src', src)]];
/** The descriptions track as the gate sees it. */
const descriptionTrack = () => [[attr('kind', 'descriptions'), attr('src', '/descriptions.vtt')]];
const baseAttributes = (status) => [
	attr('data-case', 'x'),
	attr('controls', ''),
	attr('poster', '/poster.svg'),
	attr('aria-label', 'A work'),
	...(status === null ? [] : [attr('data-caption-status', status)]),
];
/** The attributes of a work that declares its audio description as provided. */
const describedAttributes = (status) => [
	...baseAttributes(status),
	attr('data-audio-description-status', 'provided'),
];

/** A synthetic browser observation that matches every expectation. */
function conformingObservation() {
	const wide = {
		viewportWidth: 1600,
		cases: [
			{
				id: 'captioned',
				videoWidth: 480,
				attributes: describedAttributes('verified'),
				tracks: [...track('/captions.vtt'), ...descriptionTrack()],
				hasSource: true,
				captionStatus: 'verified',
				captionReadyState: 2,
				captionError: false,
				noticeVisible: false,
			},
			{
				id: 'no-caption',
				videoWidth: 480,
				attributes: describedAttributes(null),
				tracks: [...descriptionTrack()],
				hasSource: true,
				captionStatus: null,
				captionReadyState: null,
				captionError: false,
				noticeVisible: false,
			},
			{
				id: 'no-controls',
				videoWidth: 480,
				attributes: [
					attr('data-case', 'x'),
					attr('poster', '/poster.svg'),
					attr('aria-label', 'A work'),
					attr('data-caption-status', 'verified'),
					attr('data-audio-description-status', 'provided'),
				],
				tracks: [...track('/captions.vtt'), ...descriptionTrack()],
				hasSource: true,
				captionStatus: 'verified',
				captionReadyState: 2,
				captionError: false,
				noticeVisible: false,
			},
			{
				id: 'caption-load-fails',
				videoWidth: 480,
				attributes: describedAttributes('unavailable'),
				tracks: [...track('/missing-captions.vtt'), ...descriptionTrack()],
				hasSource: true,
				captionStatus: 'unavailable',
				captionReadyState: 3,
				captionError: true,
				noticeVisible: true,
			},
			{
				id: 'no-audio-description',
				videoWidth: 480,
				attributes: baseAttributes('verified'),
				tracks: track('/captions.vtt'),
				hasSource: true,
				captionStatus: 'verified',
				captionReadyState: 2,
				captionError: false,
				noticeVisible: false,
			},
		],
	};
	const captioned = wide.cases[0];
	const narrow = { viewportWidth: 1600, cases: [{ ...captioned, videoWidth: 318 }] };
	return { wide, narrow };
}

test('a non-WebP output path is refused', () => {
	assert.throws(
		() => assertWebpOutputPath('docs/verification/a11y/video-caption-track.png'),
		/refusing to write a non-WebP/,
	);
	assert.throws(() => assertWebpOutputPath('../outside.webp'), /refusing to write outside/);
});

test('the budget verdict is computed from the byte count', () => {
	assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(1024 * 1024).withinBudget, false);
});

test('every case is on the screen', () => {
	const html = harnessIndexHtml();

	for (const entry of CASES) {
		assert.ok(html.includes(`data-case="${entry.id}"`), `${entry.id} must be rendered`);
	}
	assert.ok(html.includes('controls'));
	assert.ok(html.includes(`/${CAPTION_FILE}`));
	assert.ok(html.includes(`/${MISSING_CAPTION}`));
});

test('the served caption file is a valid WebVTT document', () => {
	assert.match(CAPTION_VTT, /^WEBVTT\n/);
	assert.match(CAPTION_VTT, /-->/);
});

test('the harness resolver VERIFIES the caption file the harness serves', () => {
	const verdict = resolveCaptionSource(`/${CAPTION_FILE}`);

	assert.equal(verdict.state, 'verified');
	assert.match(verdict.detail, /WebVTT document with a caption cue/);
});

test('the harness resolver does NOT verify a caption file the harness does not serve', () => {
	const verdict = resolveCaptionSource(`/${MISSING_CAPTION}`);

	assert.notEqual(verdict.state, 'verified');
	assert.equal(verdict.state, 'missing');
});

test('the capture judges the caption SOURCE of every card, not only the declaration', () => {
	const failing = CASES.find((entry) => entry.id === 'caption-load-fails');

	assert.ok(failing, 'the caption-load-fails card is one of the cases');
	assert.ok(
		failing.expectRules.includes('video-caption-source-unverified'),
		'a card whose caption source is missing must resolve the SOURCE rule, not only the declaration rule',
	);
});

test('a work that claims an audio description without the track is a failure', () => {
	const observation = conformingObservation();
	const noCaption = observation.wide.cases.find((entry) => entry.id === 'no-caption');
	noCaption.tracks = [];

	const verdict = verdictOf(observation);

	assert.equal(verdict.ok, false);
	assert.ok(
		verdict.failures.some((failure) => /no-caption/.test(failure)),
		'the claim is fail-closed: without the descriptions track the work resolves a second rule',
	);
});

test('the harness ships the descriptions track every claimed work needs', () => {
	const html = harnessIndexHtml();
	const start = html.indexOf('data-case="no-caption"');
	assert.notEqual(start, -1, 'the no-caption card is rendered');
	const card = html.slice(start, html.indexOf('</video>', start));
	assert.match(
		card,
		/<track kind="descriptions"/,
		'a card that declares data-audio-description-status="provided" must ship the descriptions track',
	);
});

test('the conforming run satisfies the observations', () => {
	const verdict = verdictOf(conformingObservation());

	assert.equal(verdict.ok, true, verdict.failures.join('; '));
	assert.ok(verdict.rows.length >= CASES.length);
});

test('a case that resolves to a different rule is a failure', () => {
	const observation = conformingObservation();
	const noCaption = observation.wide.cases.find((entry) => entry.id === 'no-caption');
	noCaption.tracks = track('/captions.vtt');
	noCaption.captionStatus = 'verified';
	noCaption.attributes = baseAttributes('verified');

	const verdict = verdictOf(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /no-caption/.test(failure)));
});

test('a working caption track that is not LOADED is a failure', () => {
	const observation = conformingObservation();
	observation.wide.cases.find((entry) => entry.id === 'captioned').captionReadyState = 0;

	const verdict = verdictOf(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /not LOADED/.test(failure)));
});

test('a missing caption resource that is not an error is a failure', () => {
	const observation = conformingObservation();
	const failing = observation.wide.cases.find((entry) => entry.id === 'caption-load-fails');
	failing.captionReadyState = 2;
	failing.captionError = false;

	const verdict = verdictOf(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /not reported as an error/.test(failure)));
});

test('a failed caption source that still claims verified is a failure', () => {
	const observation = conformingObservation();
	const failing = observation.wide.cases.find((entry) => entry.id === 'caption-load-fails');
	failing.captionStatus = 'verified';
	failing.attributes = baseAttributes('verified');

	const verdict = verdictOf(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /still claims/.test(failure)));
});

test('a missing unavailable notice is a failure', () => {
	const observation = conformingObservation();
	observation.wide.cases.find((entry) => entry.id === 'caption-load-fails').noticeVisible = false;

	const verdict = verdictOf(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /no visible notice/.test(failure)));
});

test('a narrow layout that changes the video facts is a failure', () => {
	const observation = conformingObservation();
	observation.narrow.cases[0].captionStatus = 'unavailable';

	const verdict = verdictOf(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /320 px layout changed/.test(failure)));
});

test('a narrow layout that does not shrink the video is a failure', () => {
	const observation = conformingObservation();
	observation.narrow.cases[0].videoWidth = 480;

	const verdict = verdictOf(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /kept the video at 480/.test(failure)));
});

test('a case that was not rendered is a failure', () => {
	const verdict = verdictOf({ wide: { cases: [] }, narrow: { cases: [] } });

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /was not rendered/.test(failure)));
});

test('the static server refuses to escape its root', () => {
	assert.notEqual(resolveStaticTarget('/tmp', '/../../etc/passwd').status, 200);
});
