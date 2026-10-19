/**
 * Tool artefact license + dependency inventory policy (Issue #466).
 *
 * Problem this module solves
 * --------------------------
 * ADR-0006 and `src/tools/manifest.json` decide *how* a Tool is
 * delivered. Two facts about the bytes that get delivered were
 * recorded nowhere that a gate could read:
 *
 *   1. **The license claim was unverified.** Every manifest entry
 *      carries `"license": "MIT"`, and `scripts/check-tools-manifest.mjs`
 *      only checks that the field *exists*. A Tool whose pinned commit
 *      ships an AGPL-3.0 `LICENSE`, or no license file at all, passed
 *      the gate with the same MIT string as a Tool that ships the MIT
 *      text. A claim the operator typed is not evidence.
 *   2. **The dependency set was invisible.** The Tools build from their
 *      own lockfile inside `external/<slug>/`, so nothing in this
 *      repository recorded which dependency bytes produced the
 *      artefact under `/tools/<slug>/app/`. A submodule bump that
 *      rewrites the lockfile changed what is published without changing
 *      a single file an operator reviews in this repository.
 *
 * The contract implemented here
 * -----------------------------
 * This module is **pure policy**. It reads observations (evidence a
 * caller collected from a checkout, an artefact directory and a
 * reviewed record) and decides the verdicts; it touches no filesystem,
 * no network, no git, and no clock, which is why
 * `scripts/check-tool-artifact-inventory.mjs` (the gate),
 * `scripts/build-tools.mjs` (the build gate) and the fixture scripts
 * can never disagree about what "verified" means.
 *
 * 1. **Evidence, not claims.** A license is `verified` only when the
 *    pinned checkout carries a license file whose text carries a
 *    recognisable SPDX identifier AND that identifier is the one the
 *    manifest declares. Everything else is `unverified` or `mismatch`.
 * 2. **Fail / hold, never pass.** Severity depends on what is actually
 *    published:
 *      - `same_origin_static` (this repository builds and serves the
 *        artefact) → `error`. The build refuses; a Tool whose license
 *        nobody read cannot become `/tools/<slug>/app/`.
 *      - any other delivery kind → `warn` (a *hold*) when bytes exist
 *        to inspect, `info` when the entry is inventory-only. An
 *        entry nobody fetches is reported as unreviewed, never
 *        silently green.
 * 3. **The review is a reviewed record, and it is pinned to a commit.**
 *    `quality/tool-artifact-inventory.json` records, per Tool, the
 *    commit plus the digests of the license file and of the lockfile
 *    that a human looked at. Evidence is only evidence *about a
 *    commit*: a bump that changes the pin, the license text or the
 *    resolved dependencies is a new unreviewed claim, so it is a
 *    finding until the record is regenerated and reviewed in a diff.
 * 4. **Outbound communication is observed, then declared.** The
 *    artefact's absolute URLs are extracted from the collected files,
 *    reduced to bare hostnames (userinfo is discarded, never printed),
 *    and compared with the reviewed host set. A new host is a `warn`
 *    hold, not an `error`: a static scan of a minified bundle cannot
 *    tell a live request from a bundled library's documentation link,
 *    and a gate that fails closed on that ambiguity would be a machine
 *    generating false positives rather than evidence. The committed
 *    record is what makes the drift reviewable.
 */

export type InventorySeverity = 'error' | 'warn' | 'info';

export type InventoryVerdict = 'FAIL' | 'WARN' | 'PASS' | 'INFO';

export type DeliveryKind = 'same_origin_static' | 'external_exception' | 'host_disabled';

export type LicenseStatus = 'verified' | 'mismatch' | 'unverified';

export type DependencyStatus = 'verified' | 'unverified';

export interface InventoryFinding {
	readonly code: string;
	readonly severity: InventorySeverity;
	readonly subject: string;
	readonly message: string;
	readonly remedy: string;
}

/** What a caller observed about one Tool's license, from the checkout. */
export interface LicenseObservation {
	/** `tool.license` from the manifest, `null` when it declares none. */
	readonly declared: string | null;
	/** Repository-relative license file name, `null` when none exists. */
	readonly evidenceFile: string | null;
	/** sha256 of the license file, `null` when there is no file. */
	readonly evidenceSha256: string | null;
	/** Raw license file text; the SPDX classifier reads this. */
	readonly evidenceText: string | null;
	/** `package.json#license` as written upstream, `null` when absent. */
	readonly packageLicenseField: string | null;
}

/** What a caller observed about one Tool's dependencies, from the checkout. */
export interface DependencyObservation {
	/** Repository-relative lockfile name, `null` when none exists. */
	readonly lockfile: string | null;
	/** sha256 of the lockfile, `null` when there is none. */
	readonly lockfileSha256: string | null;
	/** Names from `package.json#dependencies` (the set that can ship). */
	readonly runtimeDependencies: readonly string[];
	/** Size of `package.json#devDependencies` (build-time only). */
	readonly devDependencyCount: number;
}

/** What a caller observed inside the collected artefact directory. */
export interface OutboundObservation {
	/** `false` when nothing has been collected (no build has run). */
	readonly present: boolean;
	/** Bare hostnames referenced by the artefact's absolute URLs. */
	readonly hosts: readonly string[];
}

/** One Tool's entry in `quality/tool-artifact-inventory.json`. */
export interface ReviewedToolRecord {
	readonly pinned_sha: string;
	readonly license: {
		readonly status: LicenseStatus;
		readonly evidence_file: string | null;
		readonly evidence_sha256: string | null;
		readonly detected: readonly string[];
	};
	readonly dependencies: {
		readonly status: DependencyStatus;
		readonly lockfile: string | null;
		readonly lockfile_sha256: string | null;
		readonly runtime: readonly string[];
	};
	readonly outbound: {
		readonly observed: boolean;
		readonly hosts: readonly string[];
	};
}

export interface ToolInventoryInput {
	readonly slug: string;
	readonly deliveryKind: DeliveryKind;
	readonly pinnedSha: string;
	/** `false` when the Tool has no checked-out source in this tree. */
	readonly checkoutPresent: boolean;
	readonly license: LicenseObservation;
	readonly dependencies: DependencyObservation;
	readonly outbound: OutboundObservation;
	readonly reviewed: ReviewedToolRecord | null;
}

export interface ToolInventoryRow {
	readonly slug: string;
	readonly delivery_kind: DeliveryKind;
	readonly shipped: boolean;
	/** `false` when the Tool has no checked-out source in this tree. */
	readonly checkout_present: boolean;
	readonly pinned_sha: string;
	readonly reviewed_pin: string | null;
	readonly license_status: LicenseStatus;
	readonly license_declared: string | null;
	readonly license_evidence: string | null;
	readonly license_detected: readonly string[];
	readonly dependencies_status: DependencyStatus;
	readonly lockfile: string | null;
	readonly runtime_dependencies: number;
	readonly outbound_status: 'observed' | 'unobserved';
	readonly outbound_reviewed: number;
	readonly outbound_new: readonly string[];
	readonly verdict: InventoryVerdict;
}

export interface ToolInventoryResult {
	readonly rows: readonly ToolInventoryRow[];
	readonly findings: readonly InventoryFinding[];
}

/**
 * Repository-relative file names treated as a Tool's license evidence,
 * in resolution order. The list is the *policy* (which names count as
 * license evidence), so it lives here rather than in the gate script:
 * a caller must not be able to widen it per invocation.
 */
export const LICENSE_FILE_CANDIDATES: readonly string[] = [
	'LICENSE',
	'LICENSE.md',
	'LICENSE.txt',
	'LICENCE',
	'LICENCE.md',
	'LICENCE.txt',
	'COPYING',
	'COPYING.md',
	'COPYING.txt',
];

/**
 * Lockfile names per declared package manager. A Tool whose build runs
 * `<pm> install --frozen-lockfile` without a lockfile is not frozen at
 * all: the artefact would be built from whatever the registry served
 * that day, which is why `build.command` naming a package manager is
 * not evidence of a pinned dependency set.
 */
export const LOCKFILE_CANDIDATES_BY_PACKAGE_MANAGER: Readonly<Record<string, readonly string[]>> = {
	pnpm: ['pnpm-lock.yaml'],
	bun: ['bun.lock', 'bun.lockb'],
	npm: ['package-lock.json', 'npm-shrinkwrap.json'],
	yarn: ['yarn.lock'],
};

/**
 * SPDX identifiers this policy can recognise in license evidence, each
 * with the phrases that must ALL appear. Requiring every phrase is what
 * keeps a passing mention ("this file is licensed under MIT") from being
 * read as a grant; an unknown license therefore reports as
 * `unverified` — a hold — instead of being waved through.
 */
const SPDX_SIGNATURES: readonly { readonly id: string; readonly phrases: readonly string[] }[] = [
	{
		id: 'MIT',
		phrases: ['permission is hereby granted, free of charge', 'without restriction'],
	},
	{
		id: 'Apache-2.0',
		phrases: ['apache license', 'version 2.0'],
	},
	{
		id: 'ISC',
		phrases: ['permission to use, copy, modify, and/or distribute this software'],
	},
	{
		id: 'BSD-3-Clause',
		phrases: ['redistribution and use in source and binary forms', 'neither the name'],
	},
	{
		id: 'BSD-2-Clause',
		phrases: [
			'redistribution and use in source and binary forms',
			'redistributions of source code',
		],
	},
	{
		id: 'MPL-2.0',
		phrases: ['mozilla public license', 'version 2.0'],
	},
	{
		id: 'GPL-3.0-only',
		phrases: ['gnu general public license', 'version 3'],
	},
	{
		id: 'AGPL-3.0-only',
		phrases: ['gnu affero general public license', 'version 3'],
	},
	{
		id: 'GPL-2.0-only',
		phrases: ['gnu general public license', 'version 2'],
	},
	{
		id: 'Unlicense',
		phrases: ['this is free and unencumbered software released into the public domain'],
	},
	{
		id: 'CC0-1.0',
		phrases: ['creative commons', 'cc0'],
	},
];

/** Every SPDX identifier `detectSpdxLicenses` can return. */
export const KNOWN_SPDX_IDS: readonly string[] = SPDX_SIGNATURES.map((entry) => entry.id);

/**
 * Values that are a deliberate refusal to license, not a license. They
 * never satisfy a declared SPDX identifier.
 */
const NON_LICENSE_MARKERS: readonly string[] = [
	'unlicensed',
	'proprietary',
	'all rights reserved',
	'see license in',
];

/**
 * Classify license text into the SPDX identifiers it grants.
 *
 * Returns every identifier whose full phrase set is present, sorted and
 * de-duplicated. An empty array means "no recognisable grant" — the
 * caller treats that as `unverified`, never as a pass.
 */
export function detectSpdxLicenses(text: string | null | undefined): string[] {
	const normalized = String(text ?? '')
		.toLowerCase()
		.replace(/[‘’“”]/g, "'");
	if (normalized.trim() === '') return [];
	const matched = SPDX_SIGNATURES.filter((entry) =>
		entry.phrases.every((phrase) => normalized.includes(phrase)),
	).map((entry) => entry.id);
	return [...new Set(matched)].sort();
}

/**
 * `true` when the value is an identifier this policy can recognise.
 * Used for the manifest's own `license` field: a declaration that names
 * something outside the recognised set is reported by name so a typo
 * cannot read as a permissive grant.
 */
export function isKnownSpdxId(value: string | null | undefined): boolean {
	return KNOWN_SPDX_IDS.includes(String(value ?? '').trim());
}

/**
 * Normalise `package.json#license` for comparison with the evidence
 * file. Handles the shapes that are not a bare identifier:
 * `"MIT"`, `"(MIT OR Apache-2.0)"`, `"MIT OR Apache-2.0"`, `"GPL-2.0+"`,
 * `"SEE LICENSE IN LICENSE.md"`, `"UNLICENSED"`.
 *
 * Returns the identifiers the field grants, or `[]` when it grants
 * none. A non-licensing marker (`UNLICENSED`, `SEE LICENSE IN …`) is
 * kept as a sentinel so the caller can report it instead of treating an
 * unreadable field as agreement.
 */
export function declaredSpdxIds(value: string | null | undefined): string[] {
	const raw = String(value ?? '').trim();
	if (raw === '') return [];
	const lowered = raw.toLowerCase();
	if (NON_LICENSE_MARKERS.some((marker) => lowered.includes(marker))) return [];
	const cleaned = raw
		.replace(/^\(|\)$/g, '')
		.replace(/\+$/, '')
		.trim();
	if (KNOWN_SPDX_IDS.includes(cleaned)) return [cleaned];
	// `"GPL-2.0+"` / `"GPL-3.0-or-later"` style declarations: the
	// permissive half is the same identifier this policy records as
	// `-only`, and mapping it keeps a valid declaration from reading as
	// an unknown license.
	const orLater = cleaned.replace(/-or-later$/i, '');
	if (KNOWN_SPDX_IDS.includes(`${orLater}-only`)) return [`${orLater}-only`];
	// An SPDX expression such as "MIT OR Apache-2.0": accept the operands
	// this policy recognises, so an alternative grant is visible rather
	// than silently reduced to its first term.
	return [...new Set(cleaned.split(/\s+(?:OR|AND|WITH)\s+/i).filter(isKnownSpdxId))].sort();
}

/**
 * Only `same_origin_static` Tools are built and served by this
 * repository. Every other delivery kind publishes no bytes from this
 * tree, so its evidence gaps are a hold rather than a failure.
 */
export function isShippedDelivery(kind: DeliveryKind): boolean {
	return kind === 'same_origin_static';
}

/**
 * Severity for one unverified-or-drifted fact.
 *
 * - shipped artefact → `error`: the gate fails and the build refuses.
 * - not shipped, but bytes exist to inspect → `warn`: an explicit hold
 *   that survives into the review instead of being a silent pass.
 * - nothing checked out, nothing published → `info`: the population is
 *   reported once by `summarizeToolInventory()` instead of one finding
 *   per inventory-only entry.
 */
export function driftSeverity(shipped: boolean, hasBytes: boolean): InventorySeverity {
	if (shipped) return 'error';
	return hasBytes ? 'warn' : 'info';
}

function finding(
	code: string,
	severity: InventorySeverity,
	subject: string,
	message: string,
	remedy: string,
): InventoryFinding {
	return { code, severity, subject, message, remedy };
}

function uniqSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

/**
 * Evaluate one Tool against its observations and its reviewed record.
 *
 * Pure: the same input always produces the same findings, so the gate,
 * the build refusal and the fixture report cannot drift apart.
 */
export function evaluateToolArtifactInventory(input: ToolInventoryInput): ToolInventoryResult {
	const findings: InventoryFinding[] = [];
	const shipped = isShippedDelivery(input.deliveryKind);
	const severity = driftSeverity(shipped, input.checkoutPresent);
	const declared = input.license.declared?.trim() ?? '';
	const declaredLabel = declared === '' ? 'none' : declared;

	// --- 1. license evidence ------------------------------------------------
	let licenseStatus: LicenseStatus;
	let detected: string[] = [];

	if (!input.checkoutPresent) {
		licenseStatus = 'unverified';
		if (shipped) {
			findings.push(
				finding(
					'CHECKOUT_UNVERIFIABLE',
					'error',
					input.slug,
					`delivery.kind=${input.deliveryKind} publishes this Tool's bytes, but no submodule checkout is present, so the declared license "${declaredLabel}" cannot be read from any file`,
					'run `git submodule update --init --recursive`, then re-run this gate',
				),
			);
		}
	} else if (input.license.evidenceFile === null) {
		licenseStatus = 'unverified';
		findings.push(
			finding(
				'LICENSE_EVIDENCE_MISSING',
				severity,
				input.slug,
				`the manifest declares license "${declaredLabel}" but the pinned checkout carries none of ${LICENSE_FILE_CANDIDATES.join(', ')}`,
				'add the license file to the Tool repository, or correct `license` in src/tools/manifest.json if the claim is wrong',
			),
		);
	} else if (declared === '') {
		licenseStatus = 'unverified';
		findings.push(
			finding(
				'LICENSE_UNDECLARED',
				severity,
				input.slug,
				`${input.license.evidenceFile} exists in the pinned checkout, but the manifest declares no license, so the shipped bytes carry an unstated grant`,
				'declare the SPDX identifier the Tool repository licenses itself under in src/tools/manifest.json',
			),
		);
	} else {
		detected = detectSpdxLicenses(input.license.evidenceText);
		const packageIds = declaredSpdxIds(input.license.packageLicenseField);
		if (detected.length === 0) {
			licenseStatus = 'unverified';
			findings.push(
				finding(
					'LICENSE_UNRECOGNISED',
					severity,
					input.slug,
					`${input.license.evidenceFile} carries no SPDX identifier this policy recognises, so the declared "${declared}" cannot be confirmed from the bytes`,
					'use standard SPDX license text, or set `license` to null and keep the Tool unpublished',
				),
			);
		} else if (!detected.includes(declared)) {
			licenseStatus = 'mismatch';
			findings.push(
				finding(
					'LICENSE_MISMATCH',
					severity,
					input.slug,
					`the manifest declares "${declared}" but ${input.license.evidenceFile} grants ${detected.join(', ')}`,
					'correct `license` in src/tools/manifest.json, or re-license the Tool repository before the next pin',
				),
			);
		} else if (
			input.license.packageLicenseField !== null &&
			packageIds.length > 0 &&
			!packageIds.some((id) => detected.includes(id))
		) {
			licenseStatus = 'mismatch';
			findings.push(
				finding(
					'LICENSE_FIELD_MISMATCH',
					severity,
					input.slug,
					`${input.license.evidenceFile} grants ${detected.join(', ')} but package.json declares license "${input.license.packageLicenseField}"`,
					"reconcile the Tool repository's package.json license field with its license file, then re-pin",
				),
			);
		} else {
			licenseStatus = 'verified';
		}
	}

	// --- 2. dependency evidence -------------------------------------------
	let dependenciesStatus: DependencyStatus;
	if (!input.checkoutPresent) {
		dependenciesStatus = 'unverified';
		if (shipped) {
			findings.push(
				finding(
					'DEPENDENCY_UNVERIFIABLE',
					'error',
					input.slug,
					"no submodule checkout is present, so the dependency set that produced this Tool's artefact cannot be read",
					'run `git submodule update --init --recursive`, then re-run this gate',
				),
			);
		}
	} else if (input.dependencies.lockfile === null) {
		dependenciesStatus = 'unverified';
		findings.push(
			finding(
				'LOCKFILE_MISSING',
				severity,
				input.slug,
				'the pinned checkout has no lockfile, so `install --frozen-lockfile` resolves against whatever the registry serves and the published bytes are not reproducible from this commit',
				'commit the package manager lockfile in the Tool repository, or keep the Tool unpublished until it exists',
			),
		);
	} else {
		dependenciesStatus = 'verified';
	}

	// --- 3. reviewed record drift -----------------------------------------
	if (input.checkoutPresent) {
		if (input.reviewed === null) {
			findings.push(
				finding(
					'REVIEW_RECORD_MISSING',
					severity,
					input.slug,
					'quality/tool-artifact-inventory.json carries no reviewed entry for this Tool, so its license and dependency evidence has never been reviewed',
					'run `pnpm run tools:artifact:update` and review the generated diff',
				),
			);
		} else {
			if (input.reviewed.pinned_sha !== input.pinnedSha) {
				findings.push(
					finding(
						'REVIEWED_PIN_MISMATCH',
						severity,
						input.slug,
						`the reviewed entry records pin ${input.reviewed.pinned_sha} but the manifest pins ${input.pinnedSha}; the recorded license and dependency evidence describes different bytes`,
						'run `pnpm run tools:artifact:update` and review the regenerated record in the same PR as the bump',
					),
				);
			}
			if (
				input.license.evidenceFile !== null &&
				(input.reviewed.license.evidence_sha256 !== input.license.evidenceSha256 ||
					input.reviewed.license.evidence_file !== input.license.evidenceFile)
			) {
				findings.push(
					finding(
						'LICENSE_EVIDENCE_CHANGED',
						severity,
						input.slug,
						`the reviewed license evidence (${input.reviewed.license.evidence_file ?? 'none'}) no longer matches the checkout (${input.license.evidenceFile ?? 'none'})`,
						're-run `pnpm run tools:artifact:update` and review the license change in the PR that changed it',
					),
				);
			}
			if (input.reviewed.dependencies.lockfile_sha256 !== input.dependencies.lockfileSha256) {
				const before = new Set(input.reviewed.dependencies.runtime);
				const after = new Set(input.dependencies.runtimeDependencies);
				const added = [...after].filter((name) => !before.has(name)).sort();
				const removed = [...before].filter((name) => !after.has(name)).sort();
				const detail =
					added.length > 0 || removed.length > 0
						? ` (runtime dependencies added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'})`
						: '';
				findings.push(
					finding(
						'DEPENDENCY_DRIFT',
						severity,
						input.slug,
						`${input.dependencies.lockfile ?? 'the lockfile'} no longer matches the reviewed digest${detail}`,
						're-run `pnpm run tools:artifact:update` and review the dependency change in the PR that changed it',
					),
				);
			}
		}
	}

	// --- 4. outbound communication in the collected artefact ---------------
	const observedHosts = uniqSorted(input.outbound.hosts);
	let outboundStatus: 'observed' | 'unobserved' = 'unobserved';
	const reviewedHosts = uniqSorted(input.reviewed?.outbound.hosts ?? []);
	let newHosts: string[] = [];
	if (input.outbound.present) {
		outboundStatus = 'observed';
		const reviewed = new Set(reviewedHosts);
		const observed = new Set(observedHosts);
		newHosts = observedHosts.filter((host) => !reviewed.has(host));
		if (newHosts.length > 0) {
			findings.push(
				finding(
					'OUTBOUND_UNDECLARED',
					'warn',
					input.slug,
					`the collected artefact references host(s) absent from the reviewed set: ${newHosts.join(', ')}`,
					'review the references (a live request and a bundled library documentation link are indistinguishable to a static scan), then re-run `pnpm run tools:artifact:update`',
				),
			);
		}
		const stale = reviewedHosts.filter((host) => !observed.has(host));
		if (stale.length > 0) {
			findings.push(
				finding(
					'OUTBOUND_RECORD_STALE',
					'warn',
					input.slug,
					`the reviewed set still lists host(s) the artefact no longer references: ${stale.join(', ')}`,
					're-run `pnpm run tools:artifact:update` so the record matches the artefact',
				),
			);
		}
	}

	const row: ToolInventoryRow = {
		slug: input.slug,
		delivery_kind: input.deliveryKind,
		shipped,
		checkout_present: input.checkoutPresent,
		pinned_sha: input.pinnedSha,
		reviewed_pin: input.reviewed?.pinned_sha ?? null,
		license_status: licenseStatus,
		license_declared: declared === '' ? null : declared,
		license_evidence: input.license.evidenceFile,
		license_detected: detected,
		dependencies_status: dependenciesStatus,
		lockfile: input.dependencies.lockfile,
		runtime_dependencies: input.dependencies.runtimeDependencies.length,
		outbound_status: outboundStatus,
		outbound_reviewed: reviewedHosts.length,
		outbound_new: newHosts,
		verdict: 'PASS',
	};

	return { rows: [{ ...row, verdict: verdictFor(row, findings) }], findings };
}

/**
 * `FAIL` / `WARN` / `PASS` / `INFO` for one row, from its own findings.
 *
 * An entry with no checkout and no publication is `INFO`, never `PASS`:
 * "nothing was published and nothing could be checked" must not render
 * like a reviewed Tool in a report whose whole purpose is to keep the
 * two apart.
 */
export function verdictFor(
	row: Pick<ToolInventoryRow, 'slug' | 'shipped' | 'checkout_present'>,
	findings: readonly InventoryFinding[],
): InventoryVerdict {
	const own = findings.filter((item) => item.subject === row.slug);
	if (own.some((item) => item.severity === 'error')) return 'FAIL';
	if (own.some((item) => item.severity === 'warn')) return 'WARN';
	if (own.some((item) => item.severity === 'info')) return 'INFO';
	return row.checkout_present ? 'PASS' : 'INFO';
}

/**
 * Population-level counts for the report.
 *
 * `inventoryOnly` is the population the gate deliberately does not
 * enumerate finding-by-finding: entries with no checkout in this tree,
 * which publish no bytes here. They are reported once, by count, so an
 * unreviewed inventory can never look like a reviewed one and can
 * never bury the findings that do matter.
 */
export function summarizeToolInventory(rows: readonly ToolInventoryRow[]): {
	tools: number;
	shipped: number;
	passed: number;
	warned: number;
	failed: number;
	inventoryOnly: number;
} {
	return {
		tools: rows.length,
		shipped: rows.filter((row) => row.shipped).length,
		passed: rows.filter((row) => row.verdict === 'PASS').length,
		warned: rows.filter((row) => row.verdict === 'WARN').length,
		failed: rows.filter((row) => row.verdict === 'FAIL').length,
		inventoryOnly: rows.filter((row) => !row.checkout_present).length,
	};
}

/**
 * Build the reviewed record for one Tool from the same observations the
 * gate evaluated. `scripts/check-tool-artifact-inventory.mjs --update`
 * writes the result, so a record entry can never describe a different
 * observation than the verdict that was reported for it.
 */
export function buildReviewedRecord(input: ToolInventoryInput): ReviewedToolRecord {
	const detected = input.checkoutPresent ? detectSpdxLicenses(input.license.evidenceText) : [];
	const packageIds = input.checkoutPresent
		? declaredSpdxIds(input.license.packageLicenseField)
		: [];
	const declared = input.license.declared?.trim() ?? '';
	let licenseStatus: LicenseStatus;
	if (!input.checkoutPresent || input.license.evidenceFile === null || declared === '') {
		licenseStatus = 'unverified';
	} else if (detected.length === 0) {
		licenseStatus = 'unverified';
	} else if (!detected.includes(declared)) {
		licenseStatus = 'mismatch';
	} else if (
		input.license.packageLicenseField !== null &&
		packageIds.length > 0 &&
		!packageIds.some((id) => detected.includes(id))
	) {
		licenseStatus = 'mismatch';
	} else {
		licenseStatus = 'verified';
	}
	const dependenciesStatus: DependencyStatus =
		input.checkoutPresent && input.dependencies.lockfile !== null ? 'verified' : 'unverified';
	return {
		pinned_sha: input.pinnedSha,
		license: {
			status: licenseStatus,
			evidence_file: input.license.evidenceFile,
			evidence_sha256: input.license.evidenceSha256,
			detected,
		},
		dependencies: {
			status: dependenciesStatus,
			lockfile: input.dependencies.lockfile,
			lockfile_sha256: input.dependencies.lockfileSha256,
			runtime: [...input.dependencies.runtimeDependencies].sort(),
		},
		outbound: {
			observed: input.outbound.present,
			hosts: input.outbound.present ? uniqSorted(input.outbound.hosts) : [],
		},
	};
}
