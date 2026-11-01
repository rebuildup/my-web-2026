#!/usr/bin/env node

/**
 * Keyboard layout snapshot sync (Issue #620, Issue #719).
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
 * Failure vocabulary (Issue #719)
 * -------------------------------
 * A failed sync has to say WHICH kind of failure it was, because the
 * two demand different responses and neither may be reported as "the
 * upstream is unchanged":
 *
 *   - `unavailable` — a SOURCE STATE. The upstream no longer serves
 *     the allowlisted content (404, a repository that is gone, an
 *     installer that no longer declares the adopted `config_ref`).
 *     The committed snapshot stays exactly as it was; nothing is
 *     written, so its `syncedAt` does not advance and the page ages
 *     into its own explicit `stale` state.
 *   - `error` — a TRANSPORT or VALIDATION failure (timeout, 5xx,
 *     rate limit, a body that no longer parses, a key count that no
 *     longer matches the geometry). Nothing is written either.
 *
 * Neither state is ever reported as `unchanged`, and neither advances
 * the committed snapshot's freshness clock, so a failed run can never
 * make an old snapshot read as current.
 *
 * Output is status-only: counts, source ids and reason codes. The
 * fetched text is never printed.
 *
 * Test seam (Issue #719)
 * ----------------------
 * `syncKeyboardLayout()` takes its `fetch` implementation, its
 * snapshot root and its clock as arguments, so the whole path
 * (upstream input → snapshot diff → publish plan) can be driven by a
 * fixture without opening a socket. The CLI below is the same
 * function with the repository's own paths and the system clock.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKanata } from '../src/keyboard/parse-kanata.ts';
import { parseOnishiJson } from '../src/keyboard/parse-onishi.ts';
import { KEYBOARD_STALE_AFTER_DAYS } from '../src/keyboard/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCES_ROOT = join(root, 'src/keyboard/sources');

export const SOURCES = Object.freeze({
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

/** The two outcomes a successful run can have. */
export const SYNC_OUTCOMES = Object.freeze({
	UPDATED: 'updated',
	UNCHANGED: 'unchanged',
});

/** The two kinds of failure, kept distinguishable (Issue #719). */
export const FAILURE_KINDS = Object.freeze({
	UNAVAILABLE: 'unavailable',
	ERROR: 'error',
});

/** A SOURCE STATE that makes the upstream content unusable. */
export class KeyboardSourceUnavailable extends Error {
	constructor(code) {
		super(code);
		this.name = 'KeyboardSourceUnavailable';
		this.code = code;
		this.kind = FAILURE_KINDS.UNAVAILABLE;
	}
}

/** A TRANSPORT or VALIDATION failure. Nothing is written either. */
export class KeyboardSyncError extends Error {
	constructor(code) {
		super(code);
		this.name = 'KeyboardSyncError';
		this.code = code;
		this.kind = FAILURE_KINDS.ERROR;
	}
}

function assert(condition, code) {
	if (!condition) throw new KeyboardSyncError(code);
}

function rawUrl(source, ref) {
	return `${RAW_ROOT}/${source.repository}/${ref}/${source.path}`;
}

async function fetchBytes(fetchImpl, url, limit, code) {
	let response;
	try {
		response = await fetchImpl(url, {
			headers: {
				accept: 'application/octet-stream',
				'user-agent': USER_AGENT,
			},
			redirect: 'error',
			signal: AbortSignal.timeout(20_000),
		});
	} catch {
		throw new KeyboardSyncError(`${code}-unreachable`);
	}
	// A 404 is a SOURCE STATE: the allowlisted path is no longer
	// served. 401 / 403 / 429 are an authentication or rate-limit
	// boundary and stay transport failures, so a transient 403 can
	// never publish "the upstream is gone".
	if (response.status === 404) throw new KeyboardSourceUnavailable(`${code}-not-found`);
	assert(response.status === 200, `${code}-status`);
	const declared = Number(response.headers.get('content-length') ?? '0');
	if (Number.isFinite(declared) && declared > limit)
		throw new KeyboardSyncError(`${code}-too-large`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.byteLength > limit) throw new KeyboardSyncError(`${code}-too-large`);
	return bytes;
}

async function latestCommit(fetchImpl, repository) {
	let response;
	try {
		response = await fetchImpl(`${API_ROOT}/repos/${repository}/commits?per_page=1`, {
			headers: {
				accept: 'application/vnd.github+json',
				'x-github-api-version': '2022-11-28',
				'user-agent': USER_AGENT,
			},
			redirect: 'error',
			signal: AbortSignal.timeout(20_000),
		});
	} catch {
		throw new KeyboardSyncError('github-api-unreachable');
	}
	if (response.status === 404) throw new KeyboardSourceUnavailable('github-api-not-found');
	assert(response.status === 200, 'github-api-status');
	let payload;
	try {
		payload = await response.json();
	} catch {
		throw new KeyboardSyncError('github-api-invalid-json');
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
	// The upstream no longer declares the adopted configuration in the
	// expected form: the adopted ref is UNAVAILABLE, not broken.
	if (ref === undefined) throw new KeyboardSourceUnavailable('installer-missing-config-ref');
	// The installer writes the shell variable literally
	// (`.../$config_ref/mac/kanata-us.kbd`); accept that exact template,
	// or an already-expanded form pointing at the same allowlisted file.
	const template =
		'https://raw.githubusercontent.com/rebuildup/key-map-kanata/$config_ref/mac/kanata-us.kbd';
	if (url !== template && url !== rawUrl(SOURCES.macKanata, ref)) {
		throw new KeyboardSourceUnavailable('installer-config-url-mismatch');
	}
	return ref;
}

function validateKanata(bytes, platform, expectedKeys) {
	let parsed;
	try {
		parsed = parseKanata(bytes.toString('utf8'));
	} catch {
		throw new KeyboardSyncError(`${platform}-kanata-parse-failed`);
	}
	assert(parsed.defsrc.length === expectedKeys, `${platform}-kanata-key-count`);
	return parsed;
}

async function readPreviousManifest(sourcesRoot) {
	try {
		return JSON.parse(await readFile(join(sourcesRoot, 'manifest.json'), 'utf8'));
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

async function bytesDiffer(path, expected) {
	try {
		return !(await readFile(path)).equals(expected);
	} catch {
		return true;
	}
}

/**
 * How old a committed snapshot is, in the page's own vocabulary.
 *
 * The rule is the one `src/keyboard/load.ts` applies: a snapshot older
 * than `KEYBOARD_STALE_AFTER_DAYS` renders as `stale`. The sync
 * reports the same value so an operator can see, without opening the
 * page, whether the committed bytes are still presented as current.
 */
export function freshnessOf(syncedAt, now) {
	const then = Date.parse(syncedAt);
	const at = now instanceof Date ? now.getTime() : Date.parse(now);
	if (!Number.isFinite(then) || !Number.isFinite(at)) {
		return { freshness: 'unknown', ageDays: null };
	}
	const ageDays = Math.max(0, Math.floor((at - then) / (24 * 60 * 60 * 1_000)));
	return { freshness: ageDays > KEYBOARD_STALE_AFTER_DAYS ? 'stale' : 'fresh', ageDays };
}

/**
 * Refresh the committed snapshot from the allowlisted upstream.
 *
 * The function is the whole sync: fetch → parse → diff → write. The
 * arguments are the only seams, so a fixture can drive the real path
 * without a socket and without touching the repository's own snapshot.
 *
 * @param {{fetchImpl?: Function, sourcesRoot?: string, now?: Date, dryRun?: boolean}} options
 * @returns {Promise<{
 *   outcome: 'updated' | 'unchanged',
 *   written: boolean,
 *   changedFiles: string[],
 *   manifest: object,
 *   freshness: 'fresh' | 'stale' | 'unknown',
 *   ageDays: number | null,
 * }>}
 * @throws {KeyboardSourceUnavailable} when the upstream no longer serves the content
 * @throws {KeyboardSyncError} when the transport or a validation fails
 */
export async function syncKeyboardLayout({
	fetchImpl = globalThis.fetch,
	sourcesRoot = DEFAULT_SOURCES_ROOT,
	now = new Date(),
	dryRun = false,
} = {}) {
	if (typeof fetchImpl !== 'function') {
		throw new KeyboardSyncError('no-fetch-implementation');
	}
	const nowIso = new Date(now).toISOString();

	const pcSetupRef = await latestCommit(fetchImpl, SOURCES.installer.repository);
	const installerBytes = await fetchBytes(
		fetchImpl,
		rawUrl(SOURCES.installer, pcSetupRef),
		MAX_INSTALLER_BYTES,
		'installer',
	);
	const adoptedRef = parseInstaller(installerBytes);

	const winRef = await latestCommit(fetchImpl, SOURCES.winKanata.repository);
	const [macBytes, winBytes, onishiBytes] = await Promise.all([
		fetchBytes(fetchImpl, rawUrl(SOURCES.macKanata, adoptedRef), MAX_SOURCE_BYTES, 'mac-kanata'),
		fetchBytes(fetchImpl, rawUrl(SOURCES.winKanata, winRef), MAX_SOURCE_BYTES, 'win-kanata'),
		fetchBytes(fetchImpl, rawUrl(SOURCES.onishiJson, pcSetupRef), MAX_SOURCE_BYTES, 'onishi-json'),
	]);

	validateKanata(macBytes, 'macos', 72);
	validateKanata(winBytes, 'windows', 74);
	try {
		parseOnishiJson(onishiBytes.toString('utf8'));
	} catch {
		throw new KeyboardSyncError('onishi-json-parse-failed');
	}

	const previous = await readPreviousManifest(sourcesRoot);
	const sources = [
		recordFor(SOURCES.macKanata, adoptedRef, macBytes, previous, nowIso),
		recordFor(SOURCES.winKanata, winRef, winBytes, previous, nowIso),
		recordFor(SOURCES.onishiJson, pcSetupRef, onishiBytes, previous, nowIso),
		recordFor(SOURCES.installer, pcSetupRef, installerBytes, previous, nowIso),
	];

	const manifest = {
		schemaVersion: 1,
		syncedAt: previous?.syncedAt ?? nowIso,
		sources,
		adoption: {
			sourceId: SOURCES.macKanata.id,
			declaredBySourceId: SOURCES.installer.id,
			declaredRef: adoptedRef,
			note: ADOPTION_NOTE,
		},
	};
	const manifestChanged = JSON.stringify(previous) !== JSON.stringify(manifest);

	// Only the files whose BYTES differ are rewritten. A source whose
	// content is unchanged keeps its file, so the diff a reviewer sees
	// names exactly what changed upstream.
	const changedFiles = [];
	const macDiffers = await bytesDiffer(join(sourcesRoot, SOURCES.macKanata.localPath), macBytes);
	const winDiffers = await bytesDiffer(join(sourcesRoot, SOURCES.winKanata.localPath), winBytes);
	const onishiDiffers = await bytesDiffer(
		join(sourcesRoot, SOURCES.onishiJson.localPath),
		onishiBytes,
	);
	if (macDiffers) changedFiles.push(SOURCES.macKanata.localPath);
	if (winDiffers) changedFiles.push(SOURCES.winKanata.localPath);
	if (onishiDiffers) changedFiles.push(SOURCES.onishiJson.localPath);
	if (manifestChanged) changedFiles.push('manifest.json');

	if (changedFiles.length === 0) {
		const { freshness, ageDays } = freshnessOf(previous?.syncedAt ?? nowIso, now);
		return {
			outcome: SYNC_OUTCOMES.UNCHANGED,
			written: false,
			changedFiles: [],
			manifest: previous,
			freshness,
			ageDays,
		};
	}

	const effective = { ...manifest, syncedAt: nowIso };
	if (dryRun) {
		const { freshness, ageDays } = freshnessOf(nowIso, now);
		return {
			outcome: SYNC_OUTCOMES.UPDATED,
			written: false,
			changedFiles,
			manifest: effective,
			freshness,
			ageDays,
		};
	}

	// Only the files whose bytes actually differ are rewritten, so a
	// refresh never touches a file the upstream did not change.
	if (macDiffers) {
		await writeAtomic(join(sourcesRoot, SOURCES.macKanata.localPath), macBytes);
	}
	if (winDiffers) {
		await writeAtomic(join(sourcesRoot, SOURCES.winKanata.localPath), winBytes);
	}
	if (onishiDiffers) {
		await writeAtomic(join(sourcesRoot, SOURCES.onishiJson.localPath), onishiBytes);
	}
	await writeAtomic(
		join(sourcesRoot, 'manifest.json'),
		Buffer.from(`${JSON.stringify(effective, null, 2)}\n`),
	);
	return {
		outcome: SYNC_OUTCOMES.UPDATED,
		written: true,
		changedFiles,
		manifest: effective,
		freshness: 'fresh',
		ageDays: 0,
	};
}

/**
 * Validate the COMMITTED snapshot offline (no network, no clock).
 *
 * This is the `keyboard:check` gate: it proves that the bytes the
 * page renders still match the provenance the manifest records, that
 * the recorded adoption ref is the one the macOS source is fetched at,
 * and that the three saved sources still parse through the bounded
 * parsers the page uses.
 *
 * @param {{sourcesRoot?: string}} options
 * @returns {Promise<{ok: boolean, codes: string[], sources: number}>}
 */
export async function checkCommittedSnapshot({ sourcesRoot = DEFAULT_SOURCES_ROOT } = {}) {
	const codes = [];
	const manifest = await readPreviousManifest(sourcesRoot);
	if (manifest === null) {
		return { ok: false, codes: ['manifest-missing'], sources: 0 };
	}
	const byId = new Map((manifest.sources ?? []).map((source) => [source?.id, source]));

	if (manifest.schemaVersion !== 1) codes.push('manifest-schema-version');
	if (!Number.isFinite(Date.parse(manifest.syncedAt ?? ''))) codes.push('manifest-synced-at');
	if (manifest.adoption?.note === undefined || manifest.adoption.note.length === 0) {
		codes.push('adoption-note');
	}

	for (const source of Object.values(SOURCES)) {
		const record = byId.get(source.id);
		if (record === undefined) {
			codes.push(`source-missing:${source.id}`);
			continue;
		}
		if (record.repository !== source.repository) codes.push(`source-repository:${source.id}`);
		if (record.path !== source.path) codes.push(`source-path:${source.id}`);
		if (record.role !== source.role) codes.push(`source-role:${source.id}`);
		if (!/^[0-9a-f]{40}$/.test(String(record.ref))) codes.push(`source-ref:${source.id}`);
		if (!/^[0-9a-f]{64}$/.test(String(record.sha256))) codes.push(`source-sha256:${source.id}`);
		if (source.localPath === null) continue;
		let bytes;
		try {
			bytes = await readFile(join(sourcesRoot, source.localPath));
		} catch {
			codes.push(`file-missing:${source.id}`);
			continue;
		}
		if (sha256(bytes) !== record.sha256) codes.push(`digest-mismatch:${source.id}`);
		if (bytes.byteLength !== record.bytes) codes.push(`bytes-mismatch:${source.id}`);
	}

	const mac = byId.get(SOURCES.macKanata.id);
	const installer = byId.get(SOURCES.installer.id);
	if (manifest.adoption?.declaredRef !== mac?.ref) codes.push('adoption-ref');
	if (manifest.adoption?.declaredBySourceId !== SOURCES.installer.id)
		codes.push('adoption-declared-by');
	if (manifest.adoption?.sourceId !== SOURCES.macKanata.id) codes.push('adoption-source');
	if (installer?.usedFor !== SOURCES.installer.usedFor) codes.push('installer-shape');

	for (const [platform, source, expectedKeys] of [
		['macos', SOURCES.macKanata, 72],
		['windows', SOURCES.winKanata, 74],
	]) {
		try {
			const bytes = await readFile(join(sourcesRoot, source.localPath));
			const parsed = parseKanata(bytes.toString('utf8'));
			if (parsed.defsrc.length !== expectedKeys) codes.push(`key-count:${platform}`);
		} catch {
			codes.push(`parse-failed:${platform}`);
		}
	}
	try {
		const bytes = await readFile(join(sourcesRoot, SOURCES.onishiJson.localPath));
		parseOnishiJson(bytes.toString('utf8'));
	} catch {
		codes.push('parse-failed:onishi-json');
	}

	return { ok: codes.length === 0, codes, sources: manifest.sources?.length ?? 0 };
}

function describe(result) {
	const files = result.changedFiles.length;
	const sources = files - (result.changedFiles.includes('manifest.json') ? 1 : 0);
	return `${sources} source file(s), ${result.changedFiles.includes('manifest.json') ? 1 : 0} manifest`;
}

async function main(argv) {
	if (argv.includes('--check')) {
		const result = await checkCommittedSnapshot();
		if (!result.ok) {
			process.stderr.write(`keyboard-check: failed (${result.codes.join(', ')})\n`);
			return 1;
		}
		process.stdout.write(`keyboard-check: ok (${result.sources} sources verified)\n`);
		return 0;
	}

	const dryRun = argv.includes('--dry-run');
	try {
		const result = await syncKeyboardLayout({ dryRun });
		if (result.outcome === SYNC_OUTCOMES.UNCHANGED) {
			process.stdout.write('keyboard-sync: unchanged (4 sources checked)\n');
			return 0;
		}
		if (dryRun) {
			process.stdout.write(
				`keyboard-sync: would update (dry run, nothing written; ${describe(result)})\n`,
			);
			return 0;
		}
		process.stdout.write(`keyboard-sync: updated (${describe(result)})\n`);
		return 0;
	} catch (error) {
		const kind = error?.kind === FAILURE_KINDS.UNAVAILABLE ? 'unavailable' : 'failed';
		const code = error?.code ?? 'unexpected';
		process.stderr.write(`keyboard-sync: ${kind} (${code})\n`);
		if (process.env.KEYBOARD_SYNC_DEBUG === '1' && error instanceof Error) {
			process.stderr.write(`${error.stack ?? error.message}\n`);
		}
		return 1;
	}
}

const invokedDirectly =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	process.exitCode = await main(process.argv.slice(2));
}
