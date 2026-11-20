#!/usr/bin/env node
/**
 * Unit tests for the pure verdict half of the Issue #390 capture.
 * The browser half is exercised by running the script itself.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	ARTEFACT,
	EMPTY_HEADING,
	STORY_EXPORT,
	STORY_MODULE,
	evaluateObservation,
} from './capture-links-empty.mjs';

function observation(overrides = {}) {
	return {
		scrollWidth: 1440,
		clientWidth: 1440,
		h1Text: 'リンク集 / Links',
		emptyHeadingPresent: true,
		groupSectionCount: 0,
		linkCount: 0,
		contactHrefPresent: true,
		...overrides,
	};
}

describe('capture-links-empty (Issue #390)', () => {
	it('captures the Issue-named PNG from the shipped Empty story', () => {
		assert.equal(ARTEFACT, 'docs/verification/identity/links-empty.png');
		assert.equal(STORY_MODULE, 'src/about/components/LinksPage.stories.tsx');
		assert.equal(STORY_EXPORT, 'Empty');
		assert.equal(EMPTY_HEADING, '公開しているリンクはまだありません');
	});

	it('accepts a complete empty-state observation', () => {
		const verdict = evaluateObservation(observation());
		assert.equal(verdict.ok, true);
		assert.deepEqual(verdict.failures, []);
	});

	it('fails when the empty heading is missing', () => {
		const verdict = evaluateObservation(observation({ emptyHeadingPresent: false }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /empty heading/);
	});

	it('fails when a link group section renders under an empty fixture', () => {
		const verdict = evaluateObservation(observation({ groupSectionCount: 2 }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /link group section/);
	});

	it('fails when an external link renders under an empty fixture', () => {
		const verdict = evaluateObservation(observation({ linkCount: 1 }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /external link/);
	});

	it('fails when the /contact pointer is missing', () => {
		const verdict = evaluateObservation(observation({ contactHrefPresent: false }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /\/contact/);
	});

	it('fails on horizontal scroll', () => {
		const verdict = evaluateObservation(observation({ scrollWidth: 1500, clientWidth: 1440 }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /horizontal scroll/);
	});

	it('fails when nothing rendered', () => {
		const verdict = evaluateObservation(null);
		assert.equal(verdict.ok, false);
		assert.deepEqual(verdict.failures, ['nothing rendered']);
	});
});
