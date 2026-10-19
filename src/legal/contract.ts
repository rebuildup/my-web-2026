/**
 * The publication-rights review contract (Issue #497).
 *
 * What this obligation is
 * -----------------------
 * `my-web-2026` publishes bytes it does not own: self-hosted web fonts,
 * a conference guide's images and PDFs, a Tool document that fetches a
 * provider font. "We did not write it" is not a licence, and an
 * unreviewed asset that is already reachable is the failure this
 * contract exists to make visible.
 *
 * So the rules are here, in ONE pure module, and three surfaces read
 * them: the gate (`scripts/check-asset-licenses.mjs`), the review
 * component (`src/legal/AssetLicenseReview.tsx`) and their tests. A
 * rule cannot hold in the gate and be contradicted on screen, because
 * there is only one definition of `publishable` and one of `hold`.
 *
 * The vocabulary, and why each word is a decision
 * ------------------------------------------------
 *   origin       WHERE THE BYTES CAME FROM. `repository-authored` and
 *                `repository-generated` are claims this repository can
 *                prove (a file, or a script that derives the file).
 *                `third-party-referenced` means the VISITOR fetches the
 *                asset from a provider and we ship no copy of it.
 *                `third-party-bundled` and `unknown-provenance` mean
 *                third-party bytes are inside what we publish — and
 *                `unknown-provenance` is the honest state for bytes
 *                this repository simply has no rights record for.
 *   license.spdx SPDX identifier, or `NOASSERTION` when no terms are
 *                recorded. The list is a small allow-list of the
 *                identifiers this repository can actually mean; it is
 *                NOT a copy of the SPDX list, because a longer list
 *                would make "we typed an id" look like "we checked it".
 *   verification.method WHAT WAS LOOKED AT. `none` is a first-class
 *                value, not a failure: it is how an unverified asset is
 *                recorded honestly instead of being dropped from the
 *                inventory.
 *   publication  WHAT THE REPOSITORY DECLARES today. It is an input, so
 *                that "we hold this asset" and "this asset is still
 *                reachable" can disagree in public — see L010.
 *   covers /     WHICH FILES the record owns. `covers` are glob patterns
 *   excludes     over the audited scope; `excludes` carve files out of
 *                that claim, so one directory can ship bytes under two
 *                licences without either record claiming the other's
 *                bytes.
 *
 * The decision is DERIVED, never declared
 * --------------------------------------
 * A record may claim `publication: 'published'`; it may not claim that
 * it is cleared. `evaluateAssetLicense` computes the decision from the
 * evidence, and the UI renders the computed value. That is the whole
 * point of the obligation: an asset whose rights were never recorded
 * cannot be published *as reviewed*, whatever the record says about it.
 *
 * Deliberate non-goals
 * --------------------
 *   - No legal advice, and no "this is fine" judgement about a licence
 *     this repository cannot read. `NOASSERTION` is a first-class
 *     answer; the gate's job is to make it impossible to mistake for
 *     clearance.
 *   - No network. Every rule is decidable from repository bytes, so the
 *     gate stays inside `validate:fast`'s offline contract and cannot
 *     be blocked by a third-party outage.
 *   - No file access. Evidence existence and digests are observed by
 *     the caller through injected predicates, which keeps this module
 *     pure (and therefore assertable against fixtures in a test).
 *
 * Related: `docs/verification/legal/asset-license-review.md`.
 */

/** Severity of one finding. Mirrors the tool inventory vocabulary. */
export type AssetReviewSeverity = 'error' | 'warn' | 'info';

/** Overall verdict: the worst severity present, or `PASS` when clean. */
export type AssetReviewVerdict = 'FAIL' | 'WARN' | 'PASS' | 'INFO';

/** What the asset IS. `artwork` is a finished work, `config` is not art. */
export type AssetKind = 'artwork' | 'font' | 'image' | 'document' | 'config';

/** Where the bytes came from. The load-bearing distinction is the last three. */
export type AssetOrigin =
	| 'repository-authored'
	| 'repository-generated'
	| 'third-party-referenced'
	| 'third-party-bundled'
	| 'unknown-provenance';

/** Whether this repository ships a copy of the asset's bytes. */
export type AssetRedistribution = 'bundled' | 'referenced' | 'not-applicable';

/** What the reviewer actually looked at. `none` is an honest answer. */
export type AssetVerificationMethod =
	| 'repository-evidence'
	| 'embedded-declaration'
	| 'upstream-reference'
	| 'none';

/** What the repository declares about publication today (an INPUT). */
export type AssetPublicationState = 'published' | 'unpublished' | 'hold';

/**
 * The computed publication decision.
 *
 * `provider-terms` is neither clearance nor prohibition: the asset is
 * fetched by the visitor from the provider, this repository ships no
 * copy, and the terms live in an account or a page this repository
 * cannot read offline. Reporting it as `publishable` would assert
 * something unverifiable; reporting it as `hold` would assert a
 * violation. It is its own state so neither has to be faked.
 */
export type AssetPublicationDecision = 'publishable' | 'hold' | 'provider-terms';

/** Evidence read from this repository. A declared digest pins the bytes. */
export interface AssetEvidenceFile {
	readonly kind: 'repository-file';
	/** Repository-relative path, POSIX separators, no leading `./`. */
	readonly path: string;
	/** Optional sha256 of the file's bytes; a change forces a re-review. */
	readonly sha256?: string;
}

/**
 * Evidence held by a provider rather than by this repository.
 *
 * Never fetched. `validate:fast` is offline by contract, so the gate
 * prints the hostname and keeps the rest of the URL out of its output.
 */
export interface AssetEvidenceReference {
	readonly kind: 'external-reference';
	readonly url: string;
}

export type AssetEvidence = AssetEvidenceFile | AssetEvidenceReference;

/** One reviewed asset: a whole file group, not one file at a time. */
export interface AssetLicenseRecord {
	readonly id: string;
	readonly kind: AssetKind;
	/** What the asset is, in words a reviewer can check. */
	readonly title: string;
	/** One factual line about provenance or purpose. */
	readonly summary: string;
	/**
	 * Repository-relative glob patterns for the audited files this
	 * record claims. Empty for an asset with no file in the audited
	 * scope (a runtime-referenced font), which is why it is not
	 * "required to be non-empty".
	 */
	readonly covers: readonly string[];
	/**
	 * Patterns that carve files OUT of this record's claim.
	 *
	 * One record carries one licence, but one directory can ship bytes
	 * under two: the guide's `assets/fonts/` holds 49 Noto Sans JP files
	 * (OFL-1.1) and one Material Symbols file (Apache-2.0). The record
	 * that owns the directory therefore hands that one file over to the
	 * record that owns it, instead of enumerating the other 49 by hand
	 * (which would put a 49-line path list in a record a human reads).
	 *
	 * Fail-closed: a file every record excludes is claimed by nobody,
	 * and the coverage rule (L001) says exactly that.
	 */
	readonly excludes?: readonly string[];
	/** Public URL paths the asset is delivered at, when it has any. */
	readonly publicPaths?: readonly string[];
	readonly origin: AssetOrigin;
	/** The rights holder as the repository can state it, or `null`. */
	readonly rightsHolder: string | null;
	readonly license: {
		readonly spdx: AssetLicenseId;
		/**
		 * Whether this repository ships a copy of the asset's bytes.
		 * `bundled` with no recorded licence is what makes an asset a
		 * hold, so it lives next to the licence rather than beside the
		 * origin: the obligation is stated by the licence, not by taste.
		 */
		readonly redistribution: AssetRedistribution;
		readonly attributionRequired: boolean;
		/** The attribution text a licence demands, verbatim, or `null`. */
		readonly attributionText: string | null;
		/** Where that text is shown to a visitor, or `null`. */
		readonly attributionDeliveredAt: string | null;
		/** Redistribution conditions, stated as conditions. */
		readonly conditions: readonly string[];
	};
	readonly verification: {
		readonly method: AssetVerificationMethod;
		/** ISO `YYYY-MM-DD` of the review, or `null` when none happened. */
		readonly checkedOn: string | null;
		readonly note: string;
	};
	readonly evidence: readonly AssetEvidence[];
	readonly publication: AssetPublicationState;
	/** Hostnames a visitor's browser fetches for this asset. */
	readonly externalHosts?: readonly string[];
	/** Another gate that already owns these bytes, named for the reader. */
	readonly delegatedTo?: string;
}

/** SPDX identifiers this repository can mean when it writes one. */
export type AssetLicenseId =
	| 'MIT'
	| 'CC0-1.0'
	| 'CC-BY-4.0'
	| 'OFL-1.1'
	| 'Apache-2.0'
	| 'NOASSERTION';

/**
 * The identifiers a record may name.
 *
 * `NOASSERTION` is the absence of a licence, not a licence, and is
 * always permitted precisely so it stays visible.
 */
export const REVIEWED_SPDX_IDS: readonly AssetLicenseId[] = [
	'MIT',
	'CC0-1.0',
	'CC-BY-4.0',
	'OFL-1.1',
	'Apache-2.0',
	'NOASSERTION',
];

export const KIND_LABEL: Readonly<Record<AssetKind, string>> = {
	artwork: '作品 / artwork',
	font: 'フォント / font',
	image: '画像 / image',
	document: '文書 / document',
	config: '設定 / config',
};

export const ORIGIN_LABEL: Readonly<Record<AssetOrigin, string>> = {
	'repository-authored': 'このリポジトリで執筆',
	'repository-generated': 'このリポジトリのスクリプトで生成',
	'third-party-referenced': '第三者を参照（訪問者が取得）',
	'third-party-bundled': '第三者を同梱して配布',
	'unknown-provenance': '由来が記録されていない',
};

export const REDISTRIBUTION_LABEL: Readonly<Record<AssetRedistribution, string>> = {
	bundled: '同梱して配布',
	referenced: '参照のみ（コピーを配布しない）',
	'not-applicable': '該当なし',
};

export const VERIFICATION_LABEL: Readonly<Record<AssetVerificationMethod, string>> = {
	'repository-evidence': 'リポジトリ内の証拠',
	'embedded-declaration': '配布物自身が宣言',
	'upstream-reference': '提供側の条件',
	none: '未検証',
};

export const PUBLICATION_LABEL: Readonly<Record<AssetPublicationState, string>> = {
	published: '公開中',
	unpublished: '非公開',
	hold: '保留',
};

export const DECISION_LABEL: Readonly<Record<AssetPublicationDecision, string>> = {
	publishable: '公開可 / publishable',
	hold: '保留 / hold',
	'provider-terms': '提供者条件 / provider-terms',
};

/** What each decision means, in the words the gate justifies it with. */
export const DECISION_MEANING: Readonly<Record<AssetPublicationDecision, string>> = {
	publishable:
		'このリポジトリのファイルが権利・出典・ライセンスを示している。根拠ファイルの存在と一致は gate が確認する。',
	hold: '権利記録がリポジトリに無いため、レビュー済みとしては公開できない。',
	'provider-terms': 'コピーを配布しておらず、条件は提供側にある。',
};

/** One finding. `remedy` says what a reviewer has to do, never a verdict. */
export interface AssetReviewFinding {
	readonly code: string;
	readonly severity: AssetReviewSeverity;
	/** The record id, file path or pattern the finding is about. */
	readonly subject: string;
	readonly message: string;
	readonly remedy: string;
}

/** Per-record evaluation result. */
export interface AssetReview {
	readonly id: string;
	readonly kind: AssetKind;
	readonly origin: AssetOrigin;
	/** The identifier the record declares, `NOASSERTION` when none is. */
	readonly spdx: AssetLicenseId;
	readonly publication: AssetPublicationState;
	readonly decision: AssetPublicationDecision;
	/** Audited files this record claims (empty for a referenced asset). */
	readonly files: readonly string[];
	readonly findings: readonly AssetReviewFinding[];
}

/** Observation callbacks: the caller's filesystem, injected. */
export interface AssetReviewObservations {
	/** `(repositoryRelativePath) => boolean` */
	readonly evidenceExists: (path: string) => boolean;
	/** `(repositoryRelativePath) => string | null` lowercase hex sha256. */
	readonly sha256Of: (path: string) => string | null;
}

export interface AssetInventoryInput {
	readonly records: readonly AssetLicenseRecord[];
	/** Every file inside the audited scope, repository-relative. */
	readonly auditedFiles: readonly string[];
	readonly observations: AssetReviewObservations;
}

export interface AssetReviewSummary {
	readonly verdict: AssetReviewVerdict;
	readonly records: number;
	readonly auditedFiles: number;
	readonly claimedFiles: number;
	readonly uncoveredFiles: number;
	readonly publishable: number;
	readonly hold: number;
	readonly providerTerms: number;
	readonly findings: number;
	readonly errors: number;
	readonly warnings: number;
	readonly infos: number;
}

export interface AssetInventoryResult {
	readonly reviews: readonly AssetReview[];
	readonly findings: readonly AssetReviewFinding[];
	readonly summary: AssetReviewSummary;
	readonly verdict: AssetReviewVerdict;
}

function finding(
	code: string,
	severity: AssetReviewSeverity,
	subject: string,
	message: string,
	remedy: string,
): AssetReviewFinding {
	return { code, severity, subject, message, remedy };
}

/** Whether `id` is an identifier this repository can mean. */
export function isKnownAssetLicenseId(id: unknown): id is AssetLicenseId {
	return typeof id === 'string' && (REVIEWED_SPDX_IDS as readonly string[]).includes(id);
}

/** A bare hostname: no scheme, no path, no credentials, no port. */
export function isBareHostname(value: string): boolean {
	if (value.length === 0 || value.length > 253) return false;
	if (value !== value.toLowerCase()) return false;
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value))
		return false;
	return !value.includes('..');
}

function escapeRegExpChar(char: string): string {
	return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/**
 * Compile one `covers` pattern into an anchored RegExp (pure).
 *
 * `*` stays inside a path segment, `**` crosses segments, and `**\/`
 * also matches ZERO directories — so `public/share/**\/*.png` claims
 * the images directly inside `assets/` as well as the ones nested in
 * `assets/fonts/`. An unanchored pattern would let `public/icons/*`
 * claim `public/share/icons/x.png`.
 */
export function coverPatternToRegExp(pattern: string): RegExp {
	let source = '';
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === '*') {
			if (pattern[index + 1] === '*') {
				if (pattern[index + 2] === '/') {
					source += '(?:.*/)?';
					index += 2;
				} else {
					source += '.*';
					index += 1;
				}
			} else {
				source += '[^/]*';
			}
			continue;
		}
		if (char === '?') {
			source += '[^/]';
			continue;
		}
		source += escapeRegExpChar(char);
	}
	return new RegExp(`^${source}$`);
}

/**
 * Every audited file a record's patterns claim (pure).
 *
 * `excludes` are applied after `covers`: a file is claimed when a cover
 * matches it and no exclude does. The two lists are separate on
 * purpose — `covers` says what the record owns, `excludes` says which
 * part of that it hands to another record.
 */
export function filesClaimedBy(
	covers: readonly string[],
	auditedFiles: readonly string[],
	excludes: readonly string[] = [],
): string[] {
	return auditedFiles.filter(
		(file) =>
			covers.some((pattern) => coverPatternToRegExp(pattern).test(file)) &&
			!excludes.some((pattern) => coverPatternToRegExp(pattern).test(file)),
	);
}

/**
 * A provider reference is usable only if it is an https URL that
 * carries no credentials.
 *
 * A path or a port is accepted: the reference is a place to read the
 * upstream terms from, and the report only ever prints the hostname.
 */
export function isUsableProviderReference(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:') return false;
	if (parsed.username !== '' || parsed.password !== '') return false;
	return isBareHostname(parsed.hostname);
}

/** Origin values that mean "this repository can prove where it came from". */
export function isRepositoryOrigin(origin: AssetOrigin): boolean {
	return origin === 'repository-authored' || origin === 'repository-generated';
}

/**
 * Decide one record, from its evidence only.
 *
 * The decision is the conjunction of everything below, so a record
 * cannot be cleared by omitting a field: `hold` wins over every other
 * outcome, and an error-severity finding forces it.
 */
export function evaluateAssetLicense(
	record: AssetLicenseRecord,
	observations: AssetReviewObservations,
): AssetReview {
	const findings: AssetReviewFinding[] = [];
	let hold = false;

	if (!isKnownAssetLicenseId(record.license.spdx)) {
		hold = true;
		findings.push(
			finding(
				'L003',
				'error',
				record.id,
				`ライセンス識別子 "${String(record.license.spdx)}" はこのリポジトリが意味しうる一覧にありません。`,
				'SPDX 識別子、または条件が未記録であることを表す NOASSERTION を記録する。',
			),
		);
	}

	for (const item of record.evidence) {
		if (item.kind === 'repository-file') {
			if (!observations.evidenceExists(item.path)) {
				hold = true;
				findings.push(
					finding(
						'L004',
						'error',
						record.id,
						`根拠として宣言したファイル "${item.path}" がリポジトリに存在しません。`,
						'パスを修正するか、根拠として宣言し直す。',
					),
				);
				continue;
			}
			if (item.sha256 === undefined) continue;
			const actual = observations.sha256Of(item.path);
			if (actual !== item.sha256.toLowerCase()) {
				hold = true;
				findings.push(
					finding(
						'L005',
						'error',
						record.id,
						`"${item.path}" の内容が記録した sha256 と一致しません（レビュー後に変更された）。`,
						'変更内容を確認してレビューし直し、記録を更新する。',
					),
				);
			}
			continue;
		}
		if (!isUsableProviderReference(item.url)) {
			hold = true;
			findings.push(
				finding(
					'L016',
					'error',
					record.id,
					'提供者側の根拠 URL が https ではない、または資格情報（ユーザー名とパスワード）を含みます。',
					'資格情報を含まない https URL のみを記録する。',
				),
			);
		}
	}

	if (!isRepositoryOrigin(record.origin) && record.evidence.length === 0) {
		hold = true;
		findings.push(
			finding(
				'L006',
				'error',
				record.id,
				'このリポジトリで管理されていない資産に、根拠が 1 件も宣言されていません。',
				'確認したファイル（ライセンス表記・生成スクリプト・配信元など）を根拠として宣言する。',
			),
		);
	}

	if (record.verification.method === 'none') {
		hold = true;
		findings.push(
			finding(
				'L017',
				'info',
				record.id,
				'検証方法が未検証です。権利・出典・ライセンスの証拠はこのリポジトリにありません。',
				'証拠が揃うまで公開を保留するか、非公開にする。',
			),
		);
	} else if (record.verification.checkedOn === null) {
		findings.push(
			finding(
				'L013',
				'warn',
				record.id,
				'検証方法が記録されていますが、確認日がありません。',
				'レビュー日 (YYYY-MM-DD) を記録する。',
			),
		);
	}

	if (
		!isRepositoryOrigin(record.origin) &&
		record.license.spdx === 'NOASSERTION' &&
		record.license.redistribution === 'bundled'
	) {
		hold = true;
		findings.push(
			finding(
				'L018',
				'info',
				record.id,
				'第三者を同梱しているのにライセンスが記録されていません（NOASSERTION）。',
				'ライセンス表記を同梱するか、公開を保留する。',
			),
		);
	}

	if (record.license.attributionRequired && record.license.attributionText === null) {
		hold = true;
		findings.push(
			finding(
				'L007',
				'error',
				record.id,
				'ライセンスが表示義務を課しているのに、表示文言が記録されていません。',
				'表示文言をそのまま記録する（要約しない）。',
			),
		);
	} else if (record.license.attributionRequired && record.license.attributionDeliveredAt === null) {
		findings.push(
			finding(
				'L008',
				'warn',
				record.id,
				'表示義務のあるライセンスですが、表示している場所が記録されていません。',
				'表示している公開パスを記録する。',
			),
		);
	}

	if (record.origin === 'third-party-referenced' && (record.externalHosts ?? []).length === 0) {
		findings.push(
			finding(
				'L012',
				'warn',
				record.id,
				'参照資産ですが、ブラウザが取得するホストが記録されていません。',
				'externalHosts にホスト名だけを記録する（スキーム・パス・資格情報は書かない）。',
			),
		);
	}

	const decision: AssetPublicationDecision = hold
		? 'hold'
		: record.origin === 'third-party-referenced'
			? 'provider-terms'
			: 'publishable';

	if (decision === 'hold' && record.publication === 'published') {
		findings.push(
			finding(
				'L010',
				'warn',
				record.id,
				'証拠が不足している（保留）にもかかわらず、このリポジトリでは公開中と宣言されています。',
				'公開の継続は owner の公開判断としてレビューする。取り下げ・ライセンス同梱のどちらかを記録する。',
			),
		);
	}

	if (decision === 'provider-terms') {
		findings.push(
			finding(
				'L011',
				'info',
				record.id,
				'コピーを配布していないため、このリポジトリ側では公開を妨げる条件は確認されていません。',
				'提供側の条件変更時に、この記録をレビューし直す。',
			),
		);
	}

	return {
		id: record.id,
		kind: record.kind,
		origin: record.origin,
		spdx: record.license.spdx,
		publication: record.publication,
		decision,
		files: [],
		findings,
	};
}

const SEVERITY_ORDER: Record<AssetReviewSeverity, number> = { error: 0, warn: 1, info: 2 };

/** The verdict is the worst severity present; a clean inventory is PASS. */
export function verdictFor(findings: readonly AssetReviewFinding[]): AssetReviewVerdict {
	let worst: AssetReviewSeverity | null = null;
	for (const item of findings) {
		if (worst === null || SEVERITY_ORDER[item.severity] < SEVERITY_ORDER[worst]) {
			worst = item.severity;
		}
	}
	if (worst === 'error') return 'FAIL';
	if (worst === 'warn') return 'WARN';
	if (worst === 'info') return 'INFO';
	return 'PASS';
}

/**
 * Evaluate the whole inventory, including coverage.
 *
 * Coverage is the part that cannot be recorded by hand: an audited file
 * that no record claims is an asset nobody reviewed, so it is an
 * error rather than a note.
 */
export function evaluateAssetInventory(input: AssetInventoryInput): AssetInventoryResult {
	const findings: AssetReviewFinding[] = [];
	const claimedBy = new Map<string, string[]>();
	const seenIds = new Set<string>();

	for (const record of input.records) {
		if (seenIds.has(record.id)) {
			findings.push(
				finding(
					'L014',
					'error',
					record.id,
					'同じ id の資産記録が重複しています。',
					'1 つの資産に 1 つの id を割り当てる。',
				),
			);
			continue;
		}
		seenIds.add(record.id);
		for (const file of filesClaimedBy(record.covers, input.auditedFiles, record.excludes)) {
			const owners = claimedBy.get(file) ?? [];
			owners.push(record.id);
			claimedBy.set(file, owners);
		}
	}

	const reviews = input.records.map((record) => {
		const files = seenIds.has(record.id)
			? filesClaimedBy(record.covers, input.auditedFiles, record.excludes)
			: [];
		const own = evaluateAssetLicense(record, input.observations);
		const recordFindings = [...own.findings];
		if (record.covers.length > 0 && files.length === 0) {
			recordFindings.push(
				finding(
					'L009',
					'warn',
					record.id,
					'covers が宣言しているパターンに一致する監査対象ファイルがありません。',
					'パスを更新するか、存在しなくなった資産なら記録ごと削除する。',
				),
			);
		}
		findings.push(...recordFindings);
		return { ...own, files };
	});

	for (const file of input.auditedFiles) {
		const owners = claimedBy.get(file);
		if (owners === undefined || owners.length === 0) {
			findings.push(
				finding(
					'L001',
					'error',
					file,
					'監査対象のファイルに資産記録がありません（権利記録がないまま配布されます）。',
					'資産記録を追加するか、監査対象から外す判断を記録する。',
				),
			);
			continue;
		}
		if (owners.length > 1) {
			findings.push(
				finding(
					'L002',
					'error',
					file,
					`1 つのファイルを ${owners.length} 件の記録が主張しています（${owners.join(', ')}）。`,
					'どちらの記録が正当かを 1 件に決める。',
				),
			);
		}
	}

	const summary = summarizeAssetReview({
		reviews,
		findings,
		auditedFiles: input.auditedFiles.length,
		uncoveredFiles: input.auditedFiles.filter((file) => (claimedBy.get(file) ?? []).length === 0)
			.length,
	});

	return { reviews, findings, summary, verdict: summary.verdict };
}

export interface AssetSummaryInput {
	readonly reviews: readonly AssetReview[];
	readonly findings: readonly AssetReviewFinding[];
	readonly auditedFiles: number;
	readonly uncoveredFiles: number;
}

/** Counts a report and the review screen both render. */
export function summarizeAssetReview(input: AssetSummaryInput): AssetReviewSummary {
	let publishable = 0;
	let hold = 0;
	let providerTerms = 0;
	let claimedFiles = 0;
	for (const review of input.reviews) {
		if (review.decision === 'publishable') publishable += 1;
		else if (review.decision === 'hold') hold += 1;
		else providerTerms += 1;
		claimedFiles += review.files.length;
	}
	let errors = 0;
	let warnings = 0;
	let infos = 0;
	for (const item of input.findings) {
		if (item.severity === 'error') errors += 1;
		else if (item.severity === 'warn') warnings += 1;
		else infos += 1;
	}
	return {
		verdict: verdictFor(input.findings),
		records: input.reviews.length,
		auditedFiles: input.auditedFiles,
		claimedFiles,
		uncoveredFiles: input.uncoveredFiles,
		publishable,
		hold,
		providerTerms,
		findings: input.findings.length,
		errors,
		warnings,
		infos,
	};
}
