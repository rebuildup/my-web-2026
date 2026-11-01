import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	SNAPSHOT_PATH,
	TRACKED_PROJECT_IDS,
	WINDOW_DAYS,
	daysBetween,
	isIsoDate,
	validateSnapshot,
} from './check-home-git-facts.mjs';

/**
 * Fixture coverage for the offline home git-facts gate (Issue #316).
 *
 * The gate is only worth having if it fails closed: a snapshot that a hand
 * edit made inconsistent must be an error, not a warning, and the one
 * advisory (age) must never be able to fail the build. The last block
 * re-validates the committed file, which is the one this repository ships.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-11-01';

const COMMITTED = JSON.parse(readFileSync(join(REPO_ROOT, SNAPSHOT_PATH), 'utf8'));

function clone() {
	return structuredClone(COMMITTED);
}

function errorsOf(mutate) {
	const snapshot = clone();
	mutate(snapshot);
	return validateSnapshot(snapshot, { today: TODAY }).errors;
}

function project(snapshot) {
	return snapshot.projects[TRACKED_PROJECT_IDS[0]];
}

describe('the committed snapshot', () => {
	it('is valid', () => {
		const { errors } = validateSnapshot(clone(), { today: TODAY });
		assert.deepEqual(errors, []);
	});

	it('passes through the CLI', () => {
		const output = execFileSync('node', [join(REPO_ROOT, 'scripts/check-home-git-facts.mjs')], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		assert.match(output, /^ok: src\/home\/current\/git-facts\.json:/);
	});
});

describe('shape', () => {
	it('refuses a non-object', () => {
		assert.deepEqual(validateSnapshot([], { today: TODAY }).errors.length > 0, true);
		assert.deepEqual(validateSnapshot(null, { today: TODAY }).errors.length > 0, true);
	});

	it('refuses an unknown top-level key', () => {
		const errors = errorsOf((snapshot) => {
			snapshot.reviewedBy = 'someone';
		});
		assert.ok(errors.some((error) => error.includes('top-level keys')));
	});

	it('refuses an unknown project key', () => {
		const errors = errorsOf((snapshot) => {
			project(snapshot).stars = 12;
		});
		assert.ok(errors.some((error) => error.includes('keys are not exactly')));
	});

	it('refuses a schema version it does not know', () => {
		assert.ok(
			errorsOf((snapshot) => {
				snapshot.schemaVersion = 2;
			}).some((error) => error.includes('schemaVersion')),
		);
	});
});

describe('the publication boundary', () => {
	it('refuses a project outside the tracked allowlist', () => {
		const errors = errorsOf((snapshot) => {
			snapshot.projects.tastile = snapshot.projects[TRACKED_PROJECT_IDS[0]];
		});
		assert.ok(errors.some((error) => error.includes('allowlist')));
	});

	it('refuses a short commit id', () => {
		assert.ok(
			errorsOf((snapshot) => {
				project(snapshot).firstCommit.sha = 'abc1234';
			}).some((error) => error.includes('firstCommit.sha')),
		);
	});

	it('refuses a head that disagrees with the last commit', () => {
		assert.ok(
			errorsOf((snapshot) => {
				snapshot.headSha = 'f'.repeat(40);
			}).some((error) => error.includes('headSha')),
		);
	});

	it('refuses a window the section does not print', () => {
		assert.ok(
			errorsOf((snapshot) => {
				snapshot.windowDays = 7;
			}).some((error) => error.includes('windowDays')),
		);
	});
});

describe('the calendar', () => {
	it('refuses a day the month does not have', () => {
		assert.ok(
			errorsOf((snapshot) => {
				project(snapshot).lastCommit.date = '2026-02-30';
			}).some((error) => error.includes('lastCommit.date')),
		);
	});

	it('refuses a first commit after the last one', () => {
		assert.ok(
			errorsOf((snapshot) => {
				project(snapshot).firstCommit.date = '2030-01-01';
			}).some((error) => error.includes('firstCommit is after lastCommit')),
		);
	});

	it('refuses a commit dated after the snapshot was generated', () => {
		assert.ok(
			errorsOf((snapshot) => {
				project(snapshot).lastCommit.date = '2099-12-31';
			}).some((error) => error.includes('dated after generatedOn')),
		);
	});

	it('refuses a generatedOn in the future', () => {
		assert.ok(
			errorsOf((snapshot) => {
				snapshot.generatedOn = '2099-12-31';
			}).some((error) => error.includes('in the future')),
		);
	});
});

describe('the counts', () => {
	it('refuses a recent count above the total', () => {
		assert.ok(
			errorsOf((snapshot) => {
				project(snapshot).commits.recent = snapshot.commitsTotal + 1;
			}).some((error) => error.includes('exceeds')),
		);
	});

	it('refuses a project total that disagrees with the snapshot total', () => {
		assert.ok(
			errorsOf((snapshot) => {
				project(snapshot).commits.total = 1;
			}).some((error) => error.includes('disagrees')),
		);
	});

	it('refuses a negative count', () => {
		assert.ok(
			errorsOf((snapshot) => {
				project(snapshot).commits.recent = -1;
			}).some((error) => error.includes('non-negative')),
		);
	});
});

describe('freshness is advisory', () => {
	it('warns, without failing, when the snapshot is older than the window', () => {
		const snapshot = clone();
		const { errors, warnings } = validateSnapshot(snapshot, {
			today: '2099-12-31',
			maxAgeDays: WINDOW_DAYS,
		});
		assert.deepEqual(errors, []);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /snapshot is \d+ day\(s\) old/);
	});

	it('does not warn inside the window', () => {
		const snapshot = clone();
		const { warnings } = validateSnapshot(snapshot, {
			today: snapshot.generatedOn,
			maxAgeDays: WINDOW_DAYS,
		});
		assert.deepEqual(warnings, []);
	});
});

describe('the date helpers', () => {
	it('counts whole days and refuses a rolled-over day', () => {
		assert.equal(daysBetween('2026-09-11', '2026-11-01'), 51);
		assert.equal(isIsoDate('2026-02-30'), false);
		assert.equal(isIsoDate('2026-2-3'), false);
		assert.equal(isIsoDate('2026-10-30'), true);
	});
});
