#!/usr/bin/env node

/**
 * Keyboard layout snapshot sync (Issue #620).
 *
 * This is the ONLY outbound step for `/keyboard`. It is deliberately
 * outside the Worker: the page imports the committed snapshot, parses
 * it at module load and never calls a third party at request time.
 *
 * Allowlist
 * ---------
 * Exactly two public repositories and four paths are reachable:
 *
 *   rebuildup/key-map-kanata   win/kay-map-win.kbd        (latest head)
 *                              mac/kanata-us.kbd          (pc-setup pin)
 *   rebuildup/pc-setup         platforms/macos/kanata/install-kanata.sh
 *                              platforms/macos/keyboard/onishi.json
 *
 * No environment variable can widen that set. No token is read: the
 * GitHub API is called unauthenticated, which is enough for two
 * repositories at a daily-or-slower cadence. `redirect: 'error'` keeps
 * a redirect from moving the request outside the allowlist.
 *
 * Parse before write
 * ------------------
 * Every fetched byte is parsed in memory first. A Kanata file must
 * parse and must still produce the key count the diagram geometry
 * expects (72 macOS / 74 Windows); the hidutil JSON must pass the
 * bounded mapping parser; the installer must contain exactly the
 * expected `config_ref` SHA and `config_url`. If any check fails,
 * nothing is written and the process exits non-zero.
 *
 * "Latest" and "adopted"
 * ----------------------
 * `mac/kanata-us.kbd` is not taken from the key-map-kanata default
 * branch. It is taken from the ref that pc-setup's installer pins in
 * `config_ref`, so the page shows the configuration the machine
 * actually installs. The manifest records both roles separately and
 * the page labels them.
 *
 * Output is status-only: counts, source ids and reason codes. The
 * fetched text is never printed.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKanata } from '../src/keyboard/parse-kanata.ts';
import { parseOnishiJson } from '../src/keyboard/parse-onishi.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesRoot = join(root, 'src/keyboard/sources');
const manifestPath = join(sourcesRoot, 'manifest.json');

const SOURCES = Object.freeze({
	macKanata: {
		id: 'mac-kanata',
		repository: 'rebuildup/key-map-kanata',
		path: 'mac/kanata-us.kbd',
		role: 'pc-setup-adopted',
		platform: 'macos',
		localPath: 'key-map-kanata/mac/kanata-us.kbd',
		note: 'pc-setup の install-kanata.sh が config_ref として固定する ref。key-map-kanata の main には mac/kanata-us.kbd が存在しない。',
	},
	winKanata: {
		id: 'win-kanata',
		repository: 'rebuildup/key-map-kanata',
		path: 'win/kay-map-win.kbd',
		role: 'repository-latest',
		platform: 'windows',
		localPath: 'key-map-kanata/win/kay-map-win.kbd',
		note: '取得時点の key-map-kanata デフォルトブランチ head。',
	},
	onishiJson: {
		id: 'onishi-json',
		repository: 'rebuildup/pc-setup',
		path: 'platforms/macos/keyboard/onishi.json',
		role: 'repository-latest',
		platform: 'macos',
		localPath: 'pc-setup/platforms/macos/keyboard/onishi.json',
		note: '取得時点の pc-setup デフォルトブランチ head。',
	},
	installer: {
		id: 'pc-setup-install',
		repository: 'rebuildup/pc-setup',
		path: 'platforms/macos/kanata/install-kanata.sh',
		role: 'repository-latest',
		localPath: null,
		usedFor: 'adoption-ref',
		note: 'macOS の Kanata 設定が採用する config_ref を宣言する installer。バイト列は保存せず、ref と hash だけを記録する。',
	},
});

const ADOPTION_NOTE =
	'macOS の Kanata 設定は key-map-kanata の最新 head ではなく、pc-setup installer が pin する config_ref を採用する。installer が更新されるまで自動追随しない。';

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 128 * 1024;
const API_ROOT = 'https://api.github.com';
const RAW_ROOT = 'https://raw.githubusercontent.com';
const USER_AGENT = 'my-web-2026-keyboard-sync';

class SyncError extends Error {
	constructor(code) {
		super(code);
		this.code = code;
	}
}

function assert(condition, code) {
	if (!condition) throw new SyncError(code);
}

function rawUrl(source, ref) {
	return `${RAW_ROOT}/${source.repository}/${ref}/${source.path}`;
}

async function fetchBytes(url, limit, code) {
	let response;
	try {
		response = await fetch(url, {
			headers: {
				accept: 'application/octet-stream',
				'user-agent': USER_AGENT,
			},
			redirect: 'error',
			signal: AbortSignal.timeout(20_000),
		});
	} catch {
		throw new SyncError(`${code}-unreachable`);
	}
	assert(response.status === 200, `${code}-status`);
	const declared = Number(response.headers.get('content-length') ?? '0');
	if (Number.isFinite(declared) && declared > limit) throw new SyncError(`${code}-too-large`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.byteLength > limit) throw new SyncError(`${code}-too-large`);
	return bytes;
}

async function latestCommit(repository) {
	let response;
	try {
		response = await fetch(`${API_ROOT}/repos/${repository}/commits?per_page=1`, {
			headers: {
				accept: 'application/vnd.github+json',
				'x-github-api-version': '2022-11-28',
				'user-agent': USER_AGENT,
			},
			redirect: 'error',
			signal: AbortSignal.timeout(20_000),
		});
	} catch {
		throw new SyncError('github-api-unreachable');
	}
	assert(response.status === 200, 'github-api-status');
	let payload;
	try {
		payload = await response.json();
	} catch {
		throw new SyncError('github-api-invalid-json');
	}
	const sha = Array.isArray(payload) ? payload[0]?.sha : undefined;
	assert(typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha), 'github-api-invalid-sha');
	return sha;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function parseInstaller(bytes) {
	const text = bytes.toString('utf8');
	const ref = text.match(/^config_ref="([0-9a-f]{40})"$/m)?.[1];
	const url = text.match(/^config_url="([^"]+)"$/m)?.[1];
	assert(ref !== undefined, 'installer-missing-config-ref');
	// The installer writes the shell variable literally
	// (`.../$config_ref/mac/kanata-us.kbd`); accept that exact template,
	// or an already-expanded form pointing at the same allowlisted file.
	const template =
		'https://raw.githubusercontent.com/rebuildup/key-map-kanata/$config_ref/mac/kanata-us.kbd';
	assert(
		url === template || url === rawUrl(SOURCES.macKanata, ref),
		'installer-config-url-mismatch',
	);
	return ref;
}

function validateKanata(bytes, platform, expectedKeys) {
	let parsed;
	try {
		parsed = parseKanata(bytes.toString('utf8'));
	} catch {
		throw new SyncError(`${platform}-kanata-parse-failed`);
	}
	assert(parsed.defsrc.length === expectedKeys, `${platform}-kanata-key-count`);
	return parsed;
}

async function readPreviousManifest() {
	try {
		return JSON.parse(await readFile(manifestPath, 'utf8'));
	} catch {
		return null;
	}
}

function previousSource(previous, id) {
	return Array.isArray(previous?.sources)
		? previous.sources.find((source) => source?.id === id)
		: undefined;
}

function recordFor(source, ref, bytes, previous, now) {
	const digest = sha256(bytes);
	const before = previousSource(previous, source.id);
	const unchanged = before?.ref === ref && before?.sha256 === digest;
	return {
		id: source.id,
		repository: source.repository,
		ref,
		path: source.path,
		role: source.role,
		url: rawUrl(source, ref),
		sha256: digest,
		bytes: bytes.byteLength,
		fetchedAt: unchanged ? before.fetchedAt : now,
		...(source.platform ? { platform: source.platform } : {}),
		...(source.usedFor ? { usedFor: source.usedFor } : {}),
		note: source.note,
	};
}

async function writeAtomic(path, bytes) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}`;
	await writeFile(temporary, bytes);
	await rename(temporary, path);
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	const now = new Date().toISOString();

	const pcSetupRef = await latestCommit(SOURCES.installer.repository);
	const installerBytes = await fetchBytes(
		rawUrl(SOURCES.installer, pcSetupRef),
		MAX_INSTALLER_BYTES,
		'installer',
	);
	const adoptedRef = parseInstaller(installerBytes);

	const winRef = await latestCommit(SOURCES.winKanata.repository);
	const [macBytes, winBytes, onishiBytes] = await Promise.all([
		fetchBytes(rawUrl(SOURCES.macKanata, adoptedRef), MAX_SOURCE_BYTES, 'mac-kanata'),
		fetchBytes(rawUrl(SOURCES.winKanata, winRef), MAX_SOURCE_BYTES, 'win-kanata'),
		fetchBytes(rawUrl(SOURCES.onishiJson, pcSetupRef), MAX_SOURCE_BYTES, 'onishi-json'),
	]);

	validateKanata(macBytes, 'macos', 72);
	validateKanata(winBytes, 'windows', 74);
	try {
		parseOnishiJson(onishiBytes.toString('utf8'));
	} catch {
		throw new SyncError('onishi-json-parse-failed');
	}

	const previous = await readPreviousManifest();
	const sources = [
		recordFor(SOURCES.macKanata, adoptedRef, macBytes, previous, now),
		recordFor(SOURCES.winKanata, winRef, winBytes, previous, now),
		recordFor(SOURCES.onishiJson, pcSetupRef, onishiBytes, previous, now),
		recordFor(SOURCES.installer, pcSetupRef, installerBytes, previous, now),
	];

	const manifest = {
		schemaVersion: 1,
		syncedAt: previous?.syncedAt ?? now,
		sources,
		adoption: {
			sourceId: SOURCES.macKanata.id,
			declaredBySourceId: SOURCES.installer.id,
			declaredRef: adoptedRef,
			note: ADOPTION_NOTE,
		},
	};
	const previousComparable = JSON.stringify(previous);
	const manifestChanged = previousComparable !== JSON.stringify(manifest);
	const macDiffers = await bytesDiffer(join(sourcesRoot, SOURCES.macKanata.localPath), macBytes);
	const winDiffers = await bytesDiffer(join(sourcesRoot, SOURCES.winKanata.localPath), winBytes);
	const onishiDiffers = await bytesDiffer(
		join(sourcesRoot, SOURCES.onishiJson.localPath),
		onishiBytes,
	);
	const changed = manifestChanged || macDiffers || winDiffers || onishiDiffers;

	if (!changed) {
		process.stdout.write('keyboard-sync: unchanged (4 sources checked)\n');
		return;
	}
	if (dryRun) {
		process.stdout.write('keyboard-sync: would update (dry run, nothing written)\n');
		return;
	}

	manifest.syncedAt = now;
	await writeAtomic(join(sourcesRoot, SOURCES.macKanata.localPath), macBytes);
	await writeAtomic(join(sourcesRoot, SOURCES.winKanata.localPath), winBytes);
	await writeAtomic(join(sourcesRoot, SOURCES.onishiJson.localPath), onishiBytes);
	await writeAtomic(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
	process.stdout.write('keyboard-sync: updated (3 source files, 1 manifest)\n');
}

async function bytesDiffer(path, expected) {
	try {
		return !(await readFile(path)).equals(expected);
	} catch {
		return true;
	}
}

main().catch((error) => {
	const code = error instanceof SyncError ? error.code : 'unexpected';
	process.stderr.write(`keyboard-sync: failed (${code})\n`);
	if (process.env.KEYBOARD_SYNC_DEBUG === '1' && error instanceof Error) {
		process.stderr.write(`${error.stack ?? error.message}\n`);
	}
	process.exitCode = 1;
});
