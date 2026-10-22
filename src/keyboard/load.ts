/**
 * Page-level safe-state resolver for `/keyboard`.
 *
 * The page is a read of COMMITTED sources, so "fetch failure" is not
 * a request-time concern here. The two states it must still make
 * impossible are:
 *
 *   1. presenting a manifest whose provenance does not add up
 *      (wrong repository, a branch instead of a commit, a URL that
 *      does not match the recorded ref), and
 *   2. presenting old bytes as current.
 *
 * State 1 returns `unavailable`; state 2 returns `ready` with
 * `freshness: 'stale'`, because the last known good diagram is more
 * useful than an empty page as long as its age is stated.
 *
 * Manifest validation is a closed allowlist, not a shape check: the
 * four source ids, their repositories, paths and roles are fixed
 * here. A new source is a code change, which is the point.
 */

import { buildKeyboardCatalog, type KeyboardSourceBundle } from './catalog';
import {
	KEYBOARD_STALE_AFTER_DAYS,
	type KeyboardManifest,
	type KeyboardPageData,
	type KeyboardSourceRecord,
} from './types';

interface SourceRule {
	readonly repository: string;
	readonly path: string;
	readonly role: KeyboardSourceRecord['role'];
	readonly platform?: KeyboardSourceRecord['platform'];
	readonly usedFor?: KeyboardSourceRecord['usedFor'];
}

const SOURCE_RULES: Readonly<Record<string, SourceRule>> = {
	'mac-kanata': {
		repository: 'rebuildup/key-map-kanata',
		path: 'mac/kanata-us.kbd',
		role: 'pc-setup-adopted',
		platform: 'macos',
	},
	'win-kanata': {
		repository: 'rebuildup/key-map-kanata',
		path: 'win/kay-map-win.kbd',
		role: 'repository-latest',
		platform: 'windows',
	},
	'onishi-json': {
		repository: 'rebuildup/pc-setup',
		path: 'platforms/macos/keyboard/onishi.json',
		role: 'repository-latest',
		platform: 'macos',
	},
	'pc-setup-install': {
		repository: 'rebuildup/pc-setup',
		path: 'platforms/macos/kanata/install-kanata.sh',
		role: 'repository-latest',
		usedFor: 'adoption-ref',
	},
};

const REQUIRED_SOURCES = ['mac-kanata', 'win-kanata', 'onishi-json', 'pc-setup-install'] as const;

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHA_256 = /^[0-9a-f]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
}

export interface ManifestValidation {
	readonly ok: boolean;
	readonly codes: readonly string[];
}

/**
 * Validate the committed manifest against the closed source allowlist.
 *
 * Detail codes are stable identifiers (`source-url`, `adoption-ref`),
 * never manifest content, so a malformed manifest cannot inject text
 * into the page.
 */
export function validateManifest(manifest: unknown): ManifestValidation {
	const codes = new Set<string>();
	if (!isRecord(manifest)) return { ok: false, codes: ['manifest-shape'] };
	if (manifest.schemaVersion !== 1) codes.add('schema-version');
	if (parseTimestamp(manifest.syncedAt) === null) codes.add('synced-at');

	const sources = manifest.sources;
	if (!Array.isArray(sources) || sources.length === 0) {
		codes.add('sources');
		return { ok: false, codes: [...codes] };
	}

	const seen = new Set<string>();
	for (const source of sources) {
		if (!isRecord(source)) {
			codes.add('source-shape');
			continue;
		}
		const id = source.id;
		if (typeof id !== 'string') {
			codes.add('source-id');
			continue;
		}
		const rule = SOURCE_RULES[id];
		if (rule === undefined) {
			codes.add('unknown-source');
			continue;
		}
		if (seen.has(id)) codes.add('duplicate-source');
		seen.add(id);

		if (source.repository !== rule.repository) codes.add('source-repository');
		if (source.path !== rule.path) codes.add('source-path');
		if (source.role !== rule.role) codes.add('source-role');
		if (source.platform !== rule.platform) codes.add('source-platform');
		if (source.usedFor !== rule.usedFor) codes.add('source-used-for');
		if (typeof source.ref !== 'string' || !FULL_SHA.test(source.ref)) {
			codes.add('source-ref');
		}
		if (typeof source.sha256 !== 'string' || !SHA_256.test(source.sha256)) {
			codes.add('source-sha256');
		}
		if (
			typeof source.bytes !== 'number' ||
			!Number.isSafeInteger(source.bytes) ||
			source.bytes <= 0
		) {
			codes.add('source-bytes');
		}
		if (parseTimestamp(source.fetchedAt) === null) codes.add('source-fetched-at');

		if (typeof source.ref === 'string' && typeof id === 'string') {
			const expectedUrl = `https://raw.githubusercontent.com/${rule.repository}/${source.ref}/${rule.path}`;
			if (source.url !== expectedUrl) codes.add('source-url');
		}
	}

	for (const id of REQUIRED_SOURCES) {
		if (!seen.has(id)) codes.add('missing-source');
	}

	const adoption = manifest.adoption;
	if (!isRecord(adoption)) {
		codes.add('adoption-shape');
	} else {
		if (adoption.sourceId !== 'mac-kanata') codes.add('adoption-source');
		if (adoption.declaredBySourceId !== 'pc-setup-install') codes.add('adoption-declared-by');
		const mac = sources.find(
			(source): source is Record<string, unknown> => isRecord(source) && source.id === 'mac-kanata',
		);
		if (mac !== undefined && adoption.declaredRef !== mac.ref) codes.add('adoption-ref');
		if (typeof adoption.note !== 'string' || adoption.note.length === 0) {
			codes.add('adoption-note');
		}
	}

	return { ok: codes.size === 0, codes: [...codes].sort() };
}

/**
 * Resolve the page state.
 *
 * `now` is injected so tests (and the route loader) can pin the
 * freshness clock. The caller must not call this during render on
 * both server and client with different clocks: pass the loader's
 * result through, as `/keyboard` does.
 */
export function loadKeyboardPage(bundle: KeyboardSourceBundle, now: number): KeyboardPageData {
	const validation = validateManifest(bundle.manifest);
	if (!validation.ok) {
		return {
			status: 'unavailable',
			reason: 'invalid-manifest',
			message:
				'同期マニフェストの来歴を検証できませんでした。ページは古い内容を現在のものとして表示しません。',
			detailCodes: validation.codes,
		};
	}

	const catalog = buildKeyboardCatalog(bundle);
	if (catalog.platforms.length === 0) {
		return {
			status: 'unavailable',
			reason: 'no-sources',
			message: '表示できるキーボード設定がありません。',
			detailCodes: ['no-platforms'],
		};
	}

	const syncedAtMs = parseTimestamp(bundle.manifest.syncedAt) ?? now;
	const ageMs = Math.max(0, now - syncedAtMs);
	const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1_000));
	const freshness = ageDays > KEYBOARD_STALE_AFTER_DAYS ? 'stale' : 'fresh';

	return {
		status: 'ready',
		catalog,
		manifest: bundle.manifest,
		syncedAt: bundle.manifest.syncedAt,
		ageDays,
		freshness,
		staleAfterDays: KEYBOARD_STALE_AFTER_DAYS,
	};
}
