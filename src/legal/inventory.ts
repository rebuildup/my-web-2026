/**
 * Reader for the reviewed rights record (`quality/asset-license-inventory.json`).
 *
 * Why a parser instead of a type import
 * -------------------------------------
 * Three surfaces read the same file: the gate (Node), the review screen
 * (a browser bundle) and the tests. A `satisfies` annotation would be
 * checked by the type checker in all three, but it would NOT survive a
 * hand-edited JSON file whose shape drifted in a way TypeScript could
 * not see — the record is a human decision, so it needs the same
 * fail-closed validation the rest of this repository gives its
 * committed data.
 *
 * Strict by design: an unknown key is a finding, not a shrug. A record
 * with a misspelled `attributionDeliveredAt` would otherwise read as
 * "no attribution is delivered", which is the one answer the record
 * must never give by accident.
 *
 * Shape findings are `error` severity with `J` codes: the record is
 * unusable, so the gate refuses to review rather than reviewing a
 * partial picture. Nothing here touches the filesystem, so the module
 * is pure and runnable in a browser bundle.
 *
 * Related: `src/legal/contract.ts` (the rules) and
 * `docs/verification/legal/asset-license-review.md`.
 */

import type {
	AssetEvidence,
	AssetKind,
	AssetLicenseId,
	AssetLicenseRecord,
	AssetOrigin,
	AssetPublicationState,
	AssetRedistribution,
	AssetReviewFinding,
	AssetReviewObservations,
	AssetVerificationMethod,
} from './contract.ts'; // `.ts` on purpose: `scripts/check-asset-licenses.mjs` imports this module directly, and Node's ESM resolver does not add extensions
import { REVIEWED_SPDX_IDS, isBareHostname } from './contract.ts';

/** The only schema version this reader accepts. */
export const INVENTORY_SCHEMA = 'asset-license-inventory.v1';

const KINDS: readonly AssetKind[] = ['artwork', 'font', 'image', 'document', 'config'];
const ORIGINS: readonly AssetOrigin[] = [
	'repository-authored',
	'repository-generated',
	'third-party-referenced',
	'third-party-bundled',
	'unknown-provenance',
];
const REDISTRIBUTIONS: readonly AssetRedistribution[] = ['bundled', 'referenced', 'not-applicable'];
const VERIFICATION_METHODS: readonly AssetVerificationMethod[] = [
	'repository-evidence',
	'embedded-declaration',
	'upstream-reference',
	'none',
];
const PUBLICATION_STATES: readonly AssetPublicationState[] = ['published', 'unpublished', 'hold'];

export interface AssetInventoryReadResult {
	readonly schema: string | null;
	readonly records: readonly AssetLicenseRecord[];
	readonly findings: readonly AssetReviewFinding[];
	/** `false` when any finding is shape-level: the record is unusable. */
	readonly ok: boolean;
}

/**
 * Options the reader accepts.
 *
 * `today` is "what day is it" for the record's own `reviewedAt` check.
 * It is an option rather than a hidden `new Date()` so the check is
 * deterministic: a test can say "today is 2026-10-31" and assert the
 * verdict, instead of a verdict that quietly changes when the calendar
 * does.
 */
export interface AssetInventoryReadOptions {
	/** `YYYY-MM-DD`. Defaults to the current UTC calendar day. */
	readonly today?: string;
}

function shapeFinding(subject: string, message: string, remedy: string): AssetReviewFinding {
	return { code: 'J004', severity: 'error', subject, message, remedy };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function stringOrNull(value: unknown): value is string | null {
	return value === null || (typeof value === 'string' && value.trim().length > 0);
}

/** `YYYY-MM-DD`, or `null` for "no review happened". */
function isoDayOrNull(value: unknown): value is string | null {
	if (value === null) return true;
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = Date.parse(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value);
}

/** A `YYYY-MM-DD` string that is a real calendar day. */
function isIsoDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = Date.parse(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value);
}

/** The current UTC calendar day, as `YYYY-MM-DD`. */
function currentUtcDay(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * The day the reader judges "is this in the future?" against.
 *
 * A caller-supplied `today` that is not a calendar day is a programming
 * error, not a record error, so it throws instead of quietly falling
 * back to the real clock — a fallback would make the verdict depend on
 * the machine rather than on the input.
 */
function resolveToday(options: AssetInventoryReadOptions | undefined): string {
	if (options?.today === undefined) return currentUtcDay();
	if (!isIsoDay(options.today)) {
		throw new RangeError(`today must be YYYY-MM-DD, received "${options.today}"`);
	}
	return options.today;
}

function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readEvidence(value: unknown): AssetEvidence | null {
	if (!isPlainObject(value)) return null;
	if (value.kind === 'repository-file') {
		if (!nonEmptyString(value.path)) return null;
		if (value.path.startsWith('/') || value.path.includes('..')) return null;
		if (
			value.sha256 !== undefined &&
			(typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256))
		)
			return null;
		return value.sha256 === undefined
			? { kind: 'repository-file', path: value.path }
			: { kind: 'repository-file', path: value.path, sha256: value.sha256 };
	}
	if (value.kind === 'external-reference') {
		if (!nonEmptyString(value.url)) return null;
		return { kind: 'external-reference', url: value.url };
	}
	return null;
}

/** Unknown keys are refused so a typo cannot read as an absent field. */
function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
	return Object.keys(value).filter((key) => !allowed.includes(key));
}

function readRecord(
	value: unknown,
	index: number,
): { record: AssetLicenseRecord | null; problems: string[] } {
	const problems: string[] = [];
	const at = (field: string) => `assets[${index}].${field}`;
	if (!isPlainObject(value)) return { record: null, problems: ['asset is not an object'] };

	for (const key of unknownKeys(value, [
		'id',
		'kind',
		'title',
		'summary',
		'covers',
		'excludes',
		'publicPaths',
		'origin',
		'rightsHolder',
		'license',
		'verification',
		'evidence',
		'publication',
		'externalHosts',
		'delegatedTo',
	])) {
		problems.push(`unknown key ${key}`);
	}

	if (!nonEmptyString(value.id) || !/^[a-z0-9][a-z0-9-]*$/.test(value.id)) {
		problems.push('id must be a lowercase kebab-case identifier');
	}
	if (!KINDS.includes(value.kind as AssetKind)) problems.push(`${at('kind')} is not a known kind`);
	if (!nonEmptyString(value.title)) problems.push(`${at('title')} must be a non-empty string`);
	if (!nonEmptyString(value.summary)) problems.push(`${at('summary')} must be a non-empty string`);
	if (!stringArray(value.covers)) problems.push(`${at('covers')} must be an array of glob strings`);
	if (value.excludes !== undefined && !stringArray(value.excludes)) {
		problems.push(`${at('excludes')} must be an array of glob strings`);
	}
	if (value.publicPaths !== undefined && !stringArray(value.publicPaths)) {
		problems.push(`${at('publicPaths')} must be an array of strings`);
	}
	if (!ORIGINS.includes(value.origin as AssetOrigin))
		problems.push(`${at('origin')} is not a known origin`);
	if (!stringOrNull(value.rightsHolder))
		problems.push(`${at('rightsHolder')} must be a string or null`);

	const license = isPlainObject(value.license) ? value.license : null;
	if (license === null) {
		problems.push(`${at('license')} must be an object`);
	} else {
		for (const key of unknownKeys(license, [
			'spdx',
			'redistribution',
			'attributionRequired',
			'attributionText',
			'attributionDeliveredAt',
			'conditions',
		])) {
			problems.push(`unknown key license.${key}`);
		}
		if (!(REVIEWED_SPDX_IDS as readonly unknown[]).includes(license.spdx)) {
			problems.push(`${at('license.spdx')} is not a reviewed SPDX identifier`);
		}
		if (!REDISTRIBUTIONS.includes(license.redistribution as AssetRedistribution)) {
			problems.push(`${at('license.redistribution')} is not a known redistribution mode`);
		}
		if (typeof license.attributionRequired !== 'boolean') {
			problems.push(`${at('license.attributionRequired')} must be a boolean`);
		}
		if (!stringOrNull(license.attributionText)) {
			problems.push(`${at('license.attributionText')} must be a string or null`);
		}
		if (!stringOrNull(license.attributionDeliveredAt)) {
			problems.push(`${at('license.attributionDeliveredAt')} must be a string or null`);
		}
		if (!stringArray(license.conditions)) {
			problems.push(`${at('license.conditions')} must be an array of strings`);
		}
	}

	const verification = isPlainObject(value.verification) ? value.verification : null;
	if (verification === null) {
		problems.push(`${at('verification')} must be an object`);
	} else {
		for (const key of unknownKeys(verification, ['method', 'checkedOn', 'note'])) {
			problems.push(`unknown key verification.${key}`);
		}
		if (!VERIFICATION_METHODS.includes(verification.method as AssetVerificationMethod)) {
			problems.push(`${at('verification.method')} is not a known verification method`);
		}
		if (!isoDayOrNull(verification.checkedOn)) {
			problems.push(`${at('verification.checkedOn')} must be YYYY-MM-DD or null`);
		}
		if (!nonEmptyString(verification.note)) {
			problems.push(`${at('verification.note')} must be a non-empty string`);
		}
	}

	if (!Array.isArray(value.evidence)) {
		problems.push(`${at('evidence')} must be an array`);
	} else if (!value.evidence.every((item) => readEvidence(item) !== null)) {
		problems.push(`${at('evidence')} has an entry that is not a usable evidence reference`);
	}

	if (!PUBLICATION_STATES.includes(value.publication as AssetPublicationState)) {
		problems.push(`${at('publication')} is not a known publication state`);
	}
	if (
		value.externalHosts !== undefined &&
		!(stringArray(value.externalHosts) && value.externalHosts.every(isBareHostname))
	) {
		problems.push(`${at('externalHosts')} must be an array of bare hostnames`);
	}
	if (value.delegatedTo !== undefined && !nonEmptyString(value.delegatedTo)) {
		problems.push(`${at('delegatedTo')} must be a non-empty string`);
	}

	if (problems.length > 0 || !nonEmptyString(value.id)) return { record: null, problems };
	const licenseObject = license as Record<string, unknown>;
	const verificationObject = verification as Record<string, unknown>;
	return {
		problems,
		record: {
			// Every field below passed the checks above; the casts state
			// that once instead of re-narrowing `unknown` at each site.
			id: value.id as string,
			kind: value.kind as AssetKind,
			title: value.title as string,
			summary: value.summary as string,
			covers: value.covers as string[],
			...(value.excludes === undefined ? {} : { excludes: value.excludes as string[] }),
			...(value.publicPaths === undefined ? {} : { publicPaths: value.publicPaths as string[] }),
			origin: value.origin as AssetOrigin,
			rightsHolder: value.rightsHolder as string | null,
			license: {
				spdx: licenseObject.spdx as AssetLicenseId,
				redistribution: licenseObject.redistribution as AssetRedistribution,
				attributionRequired: licenseObject.attributionRequired as boolean,
				attributionText: licenseObject.attributionText as string | null,
				attributionDeliveredAt: licenseObject.attributionDeliveredAt as string | null,
				conditions: licenseObject.conditions as string[],
			},
			verification: {
				method: verificationObject.method as AssetVerificationMethod,
				checkedOn: verificationObject.checkedOn as string | null,
				note: verificationObject.note as string,
			},
			evidence: (value.evidence as unknown[]).map((item) => readEvidence(item) as AssetEvidence),
			publication: value.publication as AssetPublicationState,
			...(value.externalHosts === undefined
				? {}
				: { externalHosts: value.externalHosts as string[] }),
			...(value.delegatedTo === undefined ? {} : { delegatedTo: value.delegatedTo as string }),
		},
	};
}

/**
 * Validate an already-parsed record (the form a bundler imports).
 *
 * Shape problems are findings rather than a thrown error so the review
 * screen can render what is broken instead of failing to mount.
 */
export function parseAssetInventoryValue(
	value: unknown,
	options?: AssetInventoryReadOptions,
): AssetInventoryReadResult {
	if (!isPlainObject(value)) {
		return {
			schema: null,
			records: [],
			findings: [
				{
					code: 'J001',
					severity: 'error',
					subject: INVENTORY_SCHEMA,
					message: 'asset-license-inventory の値がオブジェクトではありません。',
					remedy: 'JSON オブジェクトとして保存する。',
				},
			],
			ok: false,
		};
	}
	const findings: AssetReviewFinding[] = [];
	for (const key of unknownKeys(value, ['schema', 'issue', 'reviewedAt', 'scope', 'assets'])) {
		findings.push(
			shapeFinding(
				'quality/asset-license-inventory.json',
				`未知のキー "${key}" があります。`,
				'レビュー対象のキーを追加するか、記録から削除する。',
			),
		);
	}
	const schema = typeof value.schema === 'string' ? value.schema : null;
	if (schema !== INVENTORY_SCHEMA) {
		findings.push({
			code: 'J002',
			severity: 'error',
			subject: 'quality/asset-license-inventory.json',
			message: `schema "${String(value.schema)}" はこのリーダーが読めません（期待: ${INVENTORY_SCHEMA}）。`,
			remedy: 'schema を対応版に更新するか、リーダーを更新する。',
		});
	}
	if (!Array.isArray(value.assets)) {
		findings.push({
			code: 'J003',
			severity: 'error',
			subject: 'quality/asset-license-inventory.json',
			message: 'assets が配列ではありません。',
			remedy: '資産記録の配列にする。',
		});
		return { schema, records: [], findings, ok: false };
	}

	// The record's own review date (Issue #728). `reviewedAt` is a claim
	// about the PAST — "the owner read this on that day". A date in the
	// future is a claim that cannot be true, so the record is refused
	// rather than read. Without this check the sibling ledger
	// (`quality/stale-content-review.json`, whose reader already refuses
	// a future review date) and this one disagreed about the same
	// question.
	const today = resolveToday(options);
	if (typeof value.reviewedAt !== 'string' || !isIsoDay(value.reviewedAt)) {
		findings.push(
			shapeFinding(
				'quality/asset-license-inventory.json#reviewedAt',
				`reviewedAt "${String(value.reviewedAt)}" は YYYY-MM-DD の日付ではありません。`,
				'レビューした日を YYYY-MM-DD で記録する。',
			),
		);
	} else if (value.reviewedAt > today) {
		findings.push({
			code: 'J006',
			severity: 'error',
			subject: 'quality/asset-license-inventory.json#reviewedAt',
			message: `reviewedAt "${value.reviewedAt}" は今日 (${today}) より未来です。`,
			remedy: '実際にレビューした日を記録する。未来の日付は「読んだ日」を表せません。',
		});
	}

	const records: AssetLicenseRecord[] = [];
	(value.assets as unknown[]).forEach((asset, index) => {
		const { record, problems } = readRecord(asset, index);
		if (record === null) {
			for (const problem of problems) {
				findings.push(
					shapeFinding(
						`quality/asset-license-inventory.json#assets[${index}]`,
						problem,
						'該当フィールドをこのリポジトリが意味しうる値に直す。',
					),
				);
			}
			return;
		}
		records.push(record);
	});

	return { schema, records, findings, ok: findings.length === 0 };
}

/** Validate the record file's text (the gate's entry point). */
export function parseAssetInventory(
	text: string,
	options?: AssetInventoryReadOptions,
): AssetInventoryReadResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return {
			schema: null,
			records: [],
			findings: [
				{
					code: 'J005',
					severity: 'error',
					subject: 'quality/asset-license-inventory.json',
					message: 'JSON として読めません。',
					remedy: '構文を直す。',
				},
			],
			ok: false,
		};
	}
	return parseAssetInventoryValue(value, options);
}

/**
 * Face-value observations for a reader that has no filesystem.
 *
 * A browser cannot `stat()` a repository file, so the only honest
 * observation it can make is the record's own: "this path is claimed, and
 * this is the digest it claims". That answers the coherence question
 * (`does the record describe itself consistently?`) and never the gate's
 * question (`do those bytes still hash to that?`), which stays
 * `pnpm run assets:license:check`'s alone.
 *
 * Lives here rather than in a story because it is a property of the READ
 * record, not of any one surface that renders it.
 */
export function faceValueObservations(
	records: readonly AssetLicenseRecord[],
): AssetReviewObservations {
	const declared = new Map<string, string | undefined>();
	for (const record of records) {
		for (const item of record.evidence) {
			if (item.kind !== 'repository-file') continue;
			// A digest claim, once made, is not erased by a later record
			// that mentions the same file without one. The digest is a
			// property of the FILE, and the last writer must not decide
			// whether an earlier record's pin still holds: the guide's
			// page is evidence for four records, and only two of them
			// pin its bytes.
			if (item.sha256 === undefined) {
				if (!declared.has(item.path)) declared.set(item.path, undefined);
				continue;
			}
			if (declared.get(item.path) === undefined) declared.set(item.path, item.sha256);
		}
	}
	return {
		evidenceExists: (path) => declared.has(path),
		sha256Of: (path) => declared.get(path) ?? null,
	};
}
