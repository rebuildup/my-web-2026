/**
 * The keyboard-layout publication path, driven by a fixture upstream
 * (Issue #719).
 *
 * What this suite proves
 * -----------------------
 * The whole path Issue #620 promised, end to end, with NO network and
 * NO live pull request:
 *
 *   upstream input change → snapshot diff → publish plan (branch, base,
 *   changed files) → a pushed branch → the site's rendering contract.
 *
 * It also pins the two negative controls that make the promise
 * honest:
 *
 *   - an upstream that did NOT change produces NO diff, NO commit and
 *     NO pull request;
 *   - an upstream that cannot be read (404) or cannot be parsed
 *     produces `unavailable` / `error`, leaves the committed snapshot
 *     byte-identical, and therefore never presents the old bytes as
 *     current.
 *
 * The fixture upstream is a `fetch` implementation, not a mock of the
 * sync: the real allowlist, the real parsers, the real diff and the
 * real publish plan run against it.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { layerLabel } from '../src/keyboard/format.ts';
import { parseKanata } from '../src/keyboard/parse-kanata.ts';
import { parseOnishiJson } from '../src/keyboard/parse-onishi.ts';
import {
	KEYBOARD_SYNC_BRANCH,
	KeyboardPublishError,
	normalizeChangedFiles,
	planKeyboardPublish,
	publishKeyboardBranch,
} from './_keyboard-sync-publish.mjs';
import {
	FAILURE_KINDS,
	checkCommittedSnapshot,
	freshnessOf,
	syncKeyboardLayout,
} from './sync-keyboard-layout.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED_SOURCES = join(ROOT, 'src/keyboard/sources');
const COMMITTED_MANIFEST = JSON.parse(
	readFileSync(join(COMMITTED_SOURCES, 'manifest.json'), 'utf8'),
);

/** The refs the committed snapshot records. */
const MAC_REF = COMMITTED_MANIFEST.sources.find((s) => s.id === 'mac-kanata').ref;
const PC_HEAD = '1111111111111111111111111111111111111111';
const WIN_HEAD = '2222222222222222222222222222222222222222';

const roots = [];

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway copy of the committed snapshot. */
function snapshotFixture() {
	const root = mkdtempSync(join(tmpdir(), 'keyboard-sync-'));
	roots.push(root);
	const sourcesRoot = join(root, 'sources');
	cpSync(COMMITTED_SOURCES, sourcesRoot, { recursive: true });
	return sourcesRoot;
}

function readBytes(sourcesRoot, relativePath) {
	return readFileSync(join(sourcesRoot, relativePath));
}

/** The installer the fixture upstream publishes: it pins the mac ref. */
function installerFixture(macRef = MAC_REF) {
	return [
		'#!/usr/bin/env bash',
		'set -euo pipefail',
		`config_ref="${macRef}"`,
		'config_url="https://raw.githubusercontent.com/rebuildup/key-map-kanata/$config_ref/mac/kanata-us.kbd"',
		'',
	].join('\n');
}

/**
 * The fixture upstream.
 *
 * `overrides` names a URL that must answer differently (404, a broken
 * body, a transport failure). Everything else is the committed content
 * at a moved head, except the Onishi mapping, which the fixture
 * changes on purpose.
 */
function fixtureFetch({ macBytes, winBytes, onishiBytes, installer = installerFixture() } = {}) {
	const mac = macBytes ?? readBytes(COMMITTED_SOURCES, 'key-map-kanata/mac/kanata-us.kbd');
	const win = winBytes ?? readBytes(COMMITTED_SOURCES, 'key-map-kanata/win/kay-map-win.kbd');
	const onishi =
		onishiBytes ??
		Buffer.from(
			readBytes(COMMITTED_SOURCES, 'pc-setup/platforms/macos/keyboard/onishi.json')
				.toString('utf8')
				.replace(
					'"HIDKeyboardModifierMappingDst": 30064771128',
					'"HIDKeyboardModifierMappingDst": 30064771089',
				),
			'utf8',
		);

	const routes = new Map([
		[
			'https://api.github.com/repos/rebuildup/pc-setup/commits?per_page=1',
			() => jsonResponse([{ sha: PC_HEAD }]),
		],
		[
			'https://api.github.com/repos/rebuildup/key-map-kanata/commits?per_page=1',
			() => jsonResponse([{ sha: WIN_HEAD }]),
		],
		[
			`https://raw.githubusercontent.com/rebuildup/pc-setup/${PC_HEAD}/platforms/macos/kanata/install-kanata.sh`,
			() => bytesResponse(Buffer.from(installer, 'utf8')),
		],
		[
			`https://raw.githubusercontent.com/rebuildup/key-map-kanata/${MAC_REF}/mac/kanata-us.kbd`,
			() => bytesResponse(mac),
		],
		[
			`https://raw.githubusercontent.com/rebuildup/key-map-kanata/${WIN_HEAD}/win/kay-map-win.kbd`,
			() => bytesResponse(win),
		],
		[
			`https://raw.githubusercontent.com/rebuildup/pc-setup/${PC_HEAD}/platforms/macos/keyboard/onishi.json`,
			() => bytesResponse(onishi),
		],
	]);

	return async function fixtureFetchImpl(url) {
		const route = routes.get(url);
		if (route === undefined) {
			return new Response('not found', { status: 404 });
		}
		return route();
	};
}

function bytesResponse(bytes) {
	return new Response(bytes, {
		status: 200,
		headers: { 'content-length': String(bytes.byteLength) },
	});
}

function jsonResponse(payload) {
	const body = Buffer.from(JSON.stringify(payload), 'utf8');
	return new Response(body, {
		status: 200,
		headers: { 'content-length': String(body.byteLength) },
	});
}

describe('the fixture upstream', () => {
	it('changes one source and moves the two heads', async () => {
		const sourcesRoot = snapshotFixture();
		const before = readBytes(sourcesRoot, 'manifest.json');

		const result = await syncKeyboardLayout({
			fetchImpl: fixtureFetch(),
			sourcesRoot,
			now: new Date('2026-11-01T00:00:00.000Z'),
		});

		assert.equal(result.outcome, 'updated');
		assert.equal(result.written, true);
		// The macOS source is unchanged upstream, so its file is not
		// rewritten; the Onishi mapping changed, and the manifest records
		// the moved heads.
		assert.deepEqual(result.changedFiles, [
			'pc-setup/platforms/macos/keyboard/onishi.json',
			'manifest.json',
		]);
		assert.notDeepEqual(readBytes(sourcesRoot, 'manifest.json'), before);

		// The bytes the page reads really changed.
		const onishi = readBytes(sourcesRoot, 'pc-setup/platforms/macos/keyboard/onishi.json').toString(
			'utf8',
		);
		assert.notEqual(
			onishi,
			readBytes(COMMITTED_SOURCES, 'pc-setup/platforms/macos/keyboard/onishi.json').toString(
				'utf8',
			),
		);
	});

	it('produces a publication plan a reviewer can act on', async () => {
		const sourcesRoot = snapshotFixture();
		const result = await syncKeyboardLayout({
			fetchImpl: fixtureFetch(),
			sourcesRoot,
			now: new Date('2026-11-01T00:00:00.000Z'),
		});

		const plan = planKeyboardPublish({
			changedFiles: result.changedFiles,
			baseRef: 'release-0-8-0',
		});

		assert.equal(plan.status, 'publish');
		assert.equal(plan.branch, KEYBOARD_SYNC_BRANCH);
		assert.equal(plan.base, 'release-0-8-0');
		assert.deepEqual(plan.changedFiles, [
			'src/keyboard/sources/manifest.json',
			'src/keyboard/sources/pc-setup/platforms/macos/keyboard/onishi.json',
		]);
		assert.match(plan.title, /キーボード配列/);
		assert.match(plan.body, /merge \/ tag \/ deploy を行いません/);
	});

	it('refuses to plan without a base branch', async () => {
		assert.throws(
			() => planKeyboardPublish({ changedFiles: ['manifest.json'], baseRef: '' }),
			KeyboardPublishError,
		);
	});

	it('normalises both path forms to repository-relative paths', () => {
		assert.deepEqual(
			normalizeChangedFiles(['manifest.json', 'src/keyboard/sources/manifest.json']),
			['src/keyboard/sources/manifest.json'],
		);
	});
});

describe('the negative control: an upstream that did not change', () => {
	it('produces no diff, no commit and no pull request', async () => {
		const sourcesRoot = snapshotFixture();
		const fetchImpl = fixtureFetch();

		const first = await syncKeyboardLayout({
			fetchImpl,
			sourcesRoot,
			now: new Date('2026-11-01T00:00:00.000Z'),
		});
		assert.equal(first.outcome, 'updated');

		const afterFirst = {
			manifest: readBytes(sourcesRoot, 'manifest.json'),
			onishi: readBytes(sourcesRoot, 'pc-setup/platforms/macos/keyboard/onishi.json'),
			mac: readBytes(sourcesRoot, 'key-map-kanata/mac/kanata-us.kbd'),
		};

		const second = await syncKeyboardLayout({
			fetchImpl,
			sourcesRoot,
			now: new Date('2026-11-02T00:00:00.000Z'),
		});

		assert.equal(second.outcome, 'unchanged');
		assert.deepEqual(second.changedFiles, []);
		assert.equal(second.written, false);

		// Nothing on disk moved, so there is nothing to commit.
		assert.deepEqual(readBytes(sourcesRoot, 'manifest.json'), afterFirst.manifest);
		assert.deepEqual(
			readBytes(sourcesRoot, 'pc-setup/platforms/macos/keyboard/onishi.json'),
			afterFirst.onishi,
		);
		assert.deepEqual(readBytes(sourcesRoot, 'key-map-kanata/mac/kanata-us.kbd'), afterFirst.mac);

		// And there is no pull request either.
		const plan = planKeyboardPublish({
			changedFiles: second.changedFiles,
			baseRef: 'release-0-8-0',
		});
		assert.equal(plan.status, 'no-change');
		assert.deepEqual(plan.changedFiles, []);
	});
});

describe('the negative controls: an upstream that cannot be read', () => {
	it('reports `unavailable` and leaves the committed snapshot alone', async () => {
		const sourcesRoot = snapshotFixture();
		const before = readBytes(sourcesRoot, 'manifest.json');

		const fetchImpl = async (url) => {
			if (url.includes('/mac/kanata-us.kbd')) {
				return new Response('not found', { status: 404 });
			}
			return fixtureFetch()(url);
		};

		await assert.rejects(
			syncKeyboardLayout({
				fetchImpl,
				sourcesRoot,
				now: new Date('2026-11-01T00:00:00.000Z'),
			}),
			(error) => {
				assert.equal(error.kind, FAILURE_KINDS.UNAVAILABLE);
				assert.match(error.code, /not-found/);
				return true;
			},
		);

		// The committed snapshot is byte-identical: its `syncedAt` did not
		// advance, so the page cannot read it as a fresh snapshot.
		assert.deepEqual(readBytes(sourcesRoot, 'manifest.json'), before);
		const manifest = JSON.parse(readBytes(sourcesRoot, 'manifest.json').toString('utf8'));
		assert.equal(manifest.syncedAt, COMMITTED_MANIFEST.syncedAt);
	});

	it('reports `error` when the upstream bytes no longer parse', async () => {
		const sourcesRoot = snapshotFixture();
		const before = readBytes(sourcesRoot, 'manifest.json');

		await assert.rejects(
			syncKeyboardLayout({
				fetchImpl: fixtureFetch({ macBytes: Buffer.from('not a kanata file\n') }),
				sourcesRoot,
				now: new Date('2026-11-01T00:00:00.000Z'),
			}),
			(error) => {
				assert.equal(error.kind, FAILURE_KINDS.ERROR);
				assert.match(error.code, /kanata-parse-failed/);
				return true;
			},
		);
		assert.deepEqual(readBytes(sourcesRoot, 'manifest.json'), before);
	});

	it('reports `error` when the transport fails', async () => {
		const sourcesRoot = snapshotFixture();
		await assert.rejects(
			syncKeyboardLayout({
				fetchImpl: async () => {
					throw new Error('network down');
				},
				sourcesRoot,
				now: new Date('2026-11-01T00:00:00.000Z'),
			}),
			(error) => {
				assert.equal(error.kind, FAILURE_KINDS.ERROR);
				assert.match(error.code, /github-api-unreachable/);
				return true;
			},
		);
	});

	it('keeps `unavailable`, `error` and `unchanged` distinguishable', () => {
		assert.notEqual(FAILURE_KINDS.UNAVAILABLE, FAILURE_KINDS.ERROR);
		assert.notEqual(FAILURE_KINDS.UNAVAILABLE, 'unchanged');
		assert.notEqual(FAILURE_KINDS.ERROR, 'unchanged');
	});

	it('ages the untouched snapshot into `stale` instead of current', () => {
		const sixtyDaysLater = new Date(
			Date.parse(COMMITTED_MANIFEST.syncedAt) + 60 * 24 * 60 * 60 * 1000,
		);
		const { freshness, ageDays } = freshnessOf(COMMITTED_MANIFEST.syncedAt, sixtyDaysLater);
		assert.equal(freshness, 'stale');
		assert.equal(ageDays, 60);
	});
});

describe("the site's rendering contract", () => {
	it('accepts the refreshed snapshot the page reads', async () => {
		const sourcesRoot = snapshotFixture();
		await syncKeyboardLayout({
			fetchImpl: fixtureFetch(),
			sourcesRoot,
			now: new Date('2026-11-01T00:00:00.000Z'),
		});

		// The same bounded parsers the page uses still accept the bytes.
		const mac = parseKanata(
			readBytes(sourcesRoot, 'key-map-kanata/mac/kanata-us.kbd').toString('utf8'),
		);
		assert.equal(mac.defsrc.length, 72);
		for (const layer of mac.layers) {
			assert.ok(layerLabel(layer.id).length > 0);
		}
		const onishi = parseOnishiJson(
			readBytes(sourcesRoot, 'pc-setup/platforms/macos/keyboard/onishi.json').toString('utf8'),
		);
		assert.ok(onishi.length > 0);

		// The provenance the page's source table renders agrees with the
		// bytes that were written.
		const manifest = JSON.parse(readBytes(sourcesRoot, 'manifest.json').toString('utf8'));
		const macRecord = manifest.sources.find((source) => source.id === 'mac-kanata');
		assert.equal(macRecord.ref, MAC_REF);
		assert.equal(macRecord.role, 'pc-setup-adopted');
		assert.equal(
			macRecord.url,
			`https://raw.githubusercontent.com/rebuildup/key-map-kanata/${MAC_REF}/mac/kanata-us.kbd`,
		);
		assert.equal(manifest.adoption.declaredRef, macRecord.ref);
		assert.equal(manifest.adoption.sourceId, 'mac-kanata');
		assert.equal(manifest.adoption.declaredBySourceId, 'pc-setup-install');
		for (const source of manifest.sources) {
			assert.match(source.ref, /^[0-9a-f]{40}$/);
			assert.match(source.sha256, /^[0-9a-f]{64}$/);
			assert.ok(source.bytes > 0);
		}
	});

	it('passes the offline snapshot gate on the committed snapshot', async () => {
		const result = await checkCommittedSnapshot();
		assert.deepEqual(result.codes, []);
		assert.equal(result.ok, true);
	});
});

describe('the push that carries the review pull request', () => {
	function git(args, cwd) {
		const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
		return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
	}

	function gitFixture() {
		const root = mkdtempSync(join(tmpdir(), 'keyboard-publish-'));
		roots.push(root);
		const remote = join(root, 'remote.git');
		const work = join(root, 'work');
		git(['init', '-q', '--bare', remote], root);
		git(['init', '-q', work], root);
		git(['config', 'user.email', 'tester@example.invalid'], work);
		git(['config', 'user.name', 'tester'], work);
		git(['checkout', '-q', '-b', KEYBOARD_SYNC_BRANCH], work);
		writeFileSync(join(work, 'snapshot.json'), '{"version":1}\n');
		git(['add', 'snapshot.json'], work);
		git(['commit', '-qm', 'initial'], work);
		git(['remote', 'add', 'origin', remote], work);
		return { root, remote, work };
	}

	it('creates the automation branch on the remote', () => {
		const fixture = gitFixture();
		const outcome = publishKeyboardBranch({
			remote: fixture.remote,
			branch: KEYBOARD_SYNC_BRANCH,
			cwd: fixture.work,
		});
		assert.equal(outcome.published, true);
		const listed = git(
			['ls-remote', fixture.remote, `refs/heads/${KEYBOARD_SYNC_BRANCH}`],
			fixture.root,
		);
		assert.match(listed.stdout, /[0-9a-f]{40}/);
	});

	it('refuses to overwrite a remote that moved under it', () => {
		const fixture = gitFixture();
		// The branch is published once.
		const first = publishKeyboardBranch({
			remote: fixture.remote,
			branch: KEYBOARD_SYNC_BRANCH,
			cwd: fixture.work,
		});
		assert.equal(first.published, true);

		// A new local commit exists, and the remote moved on: the lease
		// expects a sha that is no longer the remote's, so the push must
		// be refused instead of overwriting the other run's snapshot.
		writeFileSync(join(fixture.work, 'snapshot.json'), '{"version":2}\n');
		git(['commit', '-qam', 'second'], fixture.work);

		const stale = publishKeyboardBranch({
			remote: fixture.remote,
			branch: KEYBOARD_SYNC_BRANCH,
			cwd: fixture.work,
			run: (args, options) => {
				if (args[0] === 'ls-remote') {
					return {
						status: 0,
						stdout: `${'a'.repeat(40)}\trefs/heads/${KEYBOARD_SYNC_BRANCH}\n`,
						stderr: '',
					};
				}
				return git(args, options.cwd);
			},
		});
		assert.equal(stale.published, false);

		// The remote still holds the first publication.
		const published = git(
			['--git-dir', fixture.remote, 'show', `refs/heads/${KEYBOARD_SYNC_BRANCH}:snapshot.json`],
			fixture.root,
		);
		assert.match(published.stdout, /"version":1/);
	});
});
