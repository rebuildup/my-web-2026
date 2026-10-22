import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	ARTEFACT_ENCODE_OPTIONS,
	CAPTURE_VIEWPORT,
	MAX_ARTEFACT_BYTES,
	OUTPUT,
	failureMessage,
	overBudgetMessage,
} from './capture-anomaly-monitor-fixture.mjs';

/**
 * Capture-command unit tests (Issue #481).
 *
 * The capture itself needs a browser, so it is verified by running
 * `pnpm run verify:anomaly-monitor-screenshot` and inspecting the
 * committed artefact. What is worth asserting in a unit test is the
 * policy the capture would otherwise only express in prose: the
 * committed path, the size ceiling, the encode width, and the two
 * refusal messages — both of which must report a COUNT and never the
 * content they are refusing.
 */
describe('capture contract', () => {
	it('commits to the WebP path the Issue names, not a PNG', () => {
		assert.equal(OUTPUT, 'docs/verification/security/anomaly-monitor-fixture.webp');
		assert.ok(OUTPUT.endsWith('.webp'), 'a committed PNG would bloat the repository');
	});

	it('encodes at its own capture width and never upscales', () => {
		assert.equal(ARTEFACT_ENCODE_OPTIONS.width, CAPTURE_VIEWPORT.width);
		assert.ok(ARTEFACT_ENCODE_OPTIONS.quality <= 85);
		assert.ok(MAX_ARTEFACT_BYTES <= 300 * 1024, 'the Issue budget is ~300KB');
	});

	it('reports a failing proof by exit code only', () => {
		const message = failureMessage(1);
		assert.ok(message.includes('exited with code 1'));
		assert.ok(
			message.includes('request-anomaly-monitor-fixture.mjs'),
			'the operator is told how to re-run',
		);
	});

	it('reports an over-budget encode by size, and leaves the old artefact alone', () => {
		const message = overBudgetMessage(MAX_ARTEFACT_BYTES + 1);
		assert.ok(message.includes(String(MAX_ARTEFACT_BYTES + 1)));
		assert.ok(message.includes(OUTPUT));
	});
});
