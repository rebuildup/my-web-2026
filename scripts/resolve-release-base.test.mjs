import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseReleaseBranches, pickReleaseBase } from './resolve-release-base.mjs';

/**
 * Fixture coverage for the durable release-base resolver (Issue #719).
 *
 * The resolver exists because a hand-maintained `vars.*_BASE_REF`
 * rotted twice: once unset, once pointing at a deleted release
 * branch. The contract pinned here: highest semver wins, non-release
 * refs are ignored, and no release branch means no guess.
 */

const LINES = [
	'aaaa1111\trefs/heads/release-0-9-0',
	'bbbb2222\trefs/heads/release-0-10-0',
	'cccc3333\trefs/heads/release-0-8-2',
	'dddd4444\trefs/heads/main',
	'eeee5555\trefs/heads/719-sync-durable',
	'ffff6666\trefs/heads/release-0-10-0-rc1',
	'99990000\trefs/heads/release-1-0-0',
];

describe('parseReleaseBranches', () => {
	it('keeps only strict release-x-y-z heads, sorted descending', () => {
		const branches = parseReleaseBranches(LINES);
		assert.deepEqual(
			branches.map((b) => b.ref),
			['release-1-0-0', 'release-0-10-0', 'release-0-9-0', 'release-0-8-2'],
		);
	});
});

describe('pickReleaseBase', () => {
	it('picks the highest semver release branch', () => {
		assert.equal(pickReleaseBase(LINES), 'release-1-0-0');
	});

	it('returns null when no release branch exists — never guesses main', () => {
		assert.equal(pickReleaseBase(['aaaa\trefs/heads/main', 'bbbb\trefs/heads/feature-x']), null);
	});
});
