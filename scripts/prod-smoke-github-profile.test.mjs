import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	GITHUB_PROFILE_SURFACES,
	MIN_SVG_BYTES,
	auditProfileImageSurface,
	auditSnapshotHealth,
} from './prod-smoke-github-profile.mjs';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200">${'x'.repeat(MIN_SVG_BYTES)}</svg>`;

describe('auditProfileImageSurface', () => {
	it('passes a healthy SVG observation', () => {
		assert.deepEqual(
			auditProfileImageSurface('Test', '/api/v1/github-profile/vitals', {
				status: 200,
				contentType: 'image/svg+xml; charset=utf-8',
				bodyText: SVG,
			}),
			[],
		);
	});

	it('fails on non-200, wrong content type, missing svg, and tiny body', () => {
		const problems = auditProfileImageSurface('Test', '/x', {
			status: 500,
			contentType: 'text/html',
			bodyText: 'oops',
		});
		assert.equal(problems.length, 4);
	});

	it('fails when the honest-variant floor is not met', () => {
		const problems = auditProfileImageSurface('Test', '/x', {
			status: 200,
			contentType: 'image/svg+xml',
			bodyText: '<svg></svg>',
		});
		assert.ok(problems.some((p) => p.includes('bytes')));
	});
});

describe('auditSnapshotHealth', () => {
	const fresh = {
		source: 'github-activity',
		state: 'fresh',
		smokeCritical: true,
		ageSeconds: 60,
	};
	const statsFresh = { ...fresh, source: 'github-stats' };
	const presenceAny = { source: 'discord-presence', state: 'stale', smokeCritical: false };

	it('passes when critical sources are fresh', () => {
		assert.deepEqual(
			auditSnapshotHealth({ json: { sources: [fresh, statsFresh, presenceAny] } }),
			[],
		);
	});

	it('fails a stale critical source but tolerates stale presence', () => {
		const problems = auditSnapshotHealth({
			json: {
				sources: [{ ...fresh, state: 'stale', ageSeconds: 200_000 }, statsFresh, presenceAny],
			},
		});
		assert.equal(problems.length, 1);
		assert.ok(problems[0].includes('github-activity'));
		assert.ok(problems[0].includes('stale'));
	});

	it('fails an absent critical source distinctly from stale', () => {
		const problems = auditSnapshotHealth({
			json: {
				sources: [
					{ ...fresh, state: 'absent', receivedAt: null, ageSeconds: null },
					statsFresh,
					presenceAny,
				],
			},
		});
		assert.equal(problems.length, 1);
		assert.ok(problems[0].includes('never landed'));
	});

	it('fails on missing sources and undocumented states', () => {
		const problems = auditSnapshotHealth({
			json: { sources: [{ source: 'github-activity', state: 'weird', smokeCritical: true }] },
		});
		assert.ok(problems.some((p) => p.includes('undocumented state')));
		assert.ok(problems.some((p) => p.includes('github-stats')));
		assert.ok(problems.some((p) => p.includes('discord-presence')));
	});

	it('fails when the payload is not the documented shape', () => {
		assert.equal(auditSnapshotHealth({ json: null }).length, 1);
		assert.equal(auditSnapshotHealth({ json: {} }).length, 1);
	});
});

describe('GITHUB_PROFILE_SURFACES', () => {
	it('covers every README-embedded split surface', () => {
		const paths = GITHUB_PROFILE_SURFACES.map((s) => s.path);
		for (const required of [
			'/api/v1/github-profile/identity',
			'/api/v1/github-profile/vitals',
			'/api/v1/github-profile/top-languages',
			'/api/v1/github-profile/activity-map',
			'/api/v1/github-profile/stack',
		]) {
			assert.ok(paths.includes(required), `missing ${required}`);
		}
	});
});
