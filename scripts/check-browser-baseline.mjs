#!/usr/bin/env node
/**
 * check-browser-baseline — Web feature adoption gate (Issue #414).
 *
 * The repository has no `browserslist`, no `.browserslistrc` and no
 * bundler-level compat transform: Panda emits plain CSS, Vite emits
 * plain JS, and the Worker runs on `workerd`. Nothing in the toolchain
 * ever asked "does this run in the browsers we support?", so a feature
 * could be adopted by a single line of CSS or one `navigator.*` call
 * and the only symptom would be a visitor on an older engine.
 *
 * This gate makes the compatibility contract explicit and checkable:
 *
 *   1. `quality/browser-baseline.json` declares the target browsers,
 *      the Baseline bar (`baseline === "high"`, i.e. Baseline Widely
 *      available) and the scan surfaces.
 *   2. Every adopted Web API / CSS feature is declared there together
 *      with its MDN BCD / web-features Baseline status, vendored from
 *      the `web-features` dataset so the gate is offline, hermetic and
 *      deterministic in CI.
 *   3. Below the bar, adoption is allowed **only** with an explicit
 *      fallback requirement whose evidence is verified against the
 *      working tree; it is reported as a warning. Above the bar it is
 *      a plain pass. Below the bar with no declared fallback it fails.
 *   4. Features the project deliberately has *not* adopted (WebGPU,
 *      View Transitions, anchor positioning, ...) are listed as
 *      `guarded`. Any occurrence in a scanned surface fails until the
 *      feature is registered with a Baseline status and a fallback.
 *
 * The gate is written to be hard to satisfy by accident. Every one of
 * these is an error, never a silent pass:
 *
 *   - a declared surface that matches zero files (a route tree that
 *     moved would otherwise leave the gate scanning nothing)
 *   - a scanned source file under `src/` that no surface covers (an
 *     unimplemented / unregistered route surface)
 *   - a declared feature with zero occurrences (the declaration, or the
 *     detection pattern, has drifted from the code)
 *   - a declared fallback whose evidence file or pattern has vanished
 *   - a `guarded` feature that has been adopted without registration
 *   - a false-positive suppression (`allow`) that matches nothing, or
 *     that is scoped too broadly to be reviewable
 *   - a declared target-browser floor below the Baseline bar implied by
 *     the adopted feature set
 *
 * Usage:
 *   node scripts/check-browser-baseline.mjs
 *   node scripts/check-browser-baseline.mjs --json
 *   node scripts/check-browser-baseline.mjs --dataset <web-features data.json>
 *
 * Exit codes: 0 = gate passed (warnings allowed), 1 = gate failed,
 * 2 = the manifest itself is unusable.
 *
 * The `--dataset` mode re-verifies the vendored snapshot against a
 * locally downloaded `web-features` `data.json` (see
 * `docs/verification/standards/browser-baseline.md`). It is never run
 * by CI: the gate must stay offline and hermetic.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MANIFEST = 'quality/browser-baseline.json';

/** Baseline status required for an un-fallbacked adoption. */
export const BAR = 'high';

/** Browsers the Baseline bar is defined against, in report order. */
const BROWSER_ORDER = ['chrome', 'edge', 'firefox', 'safari', 'safari_ios'];

/** `kind` of a declaration → the only fallback kind that can satisfy it. */
const FALLBACK_KIND_BY_FEATURE_KIND = {
	css: 'progressive',
	'web-api': 'capability',
};

/** Guard rails so a suppression cannot quietly become a blanket. */
const MIN_ALLOW_MATCHES = 1;
const MIN_STRATEGY_CHARS = 40;
const MAX_LISTED = 12;

export class ManifestError extends Error {}

/* ------------------------------------------------------------------ *
 * glob + version helpers
 * ------------------------------------------------------------------ */

function globToRegExp(glob) {
	let source = '';
	for (let i = 0; i < glob.length; i += 1) {
		const char = glob[i];
		if (char === '*') {
			if (glob[i + 1] === '*') {
				source += '.*';
				i += 1;
				if (glob[i + 1] === '/') i += 1;
			} else {
				source += '[^/]*';
			}
			continue;
		}
		if (char === '?') {
			source += '[^/]';
			continue;
		}
		source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${source}$`);
}

function parseVersion(value) {
	if (typeof value !== 'string' || value.trim() === '') return null;
	const parts = value
		.trim()
		.split('.')
		.map((part) => Number.parseInt(part, 10));
	if (parts.some((part) => Number.isNaN(part))) return null;
	return parts;
}

function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return 0;
	for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
		const l = left[i] ?? 0;
		const r = right[i] ?? 0;
		if (l !== r) return l < r ? -1 : 1;
	}
	return 0;
}

function maxVersion(versions) {
	return versions
		.filter(Boolean)
		.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best), null);
}

function formatList(items, render = (item) => item) {
	const shown = items.slice(0, MAX_LISTED).map(render);
	if (items.length > MAX_LISTED) shown.push(`… +${items.length - MAX_LISTED} more`);
	return shown.join('\n    ');
}

/* ------------------------------------------------------------------ *
 * manifest loading + validation
 * ------------------------------------------------------------------ */

function requireString(value, label) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new ManifestError(`${label} must be a non-empty string`);
	}
	return value;
}

function requireArray(value, label, { min = 1 } = {}) {
	if (!Array.isArray(value) || value.length < min) {
		throw new ManifestError(
			`${label} must be an array with at least ${min} entr${min === 1 ? 'y' : 'ies'}`,
		);
	}
	return value;
}

function validateDatasetBlock(block, label) {
	const dataset = block?.dataset;
	if (!dataset || typeof dataset !== 'object') {
		throw new ManifestError(`${label}: "dataset" block is required (feature_id + Baseline status)`);
	}
	requireString(dataset.feature_id, `${label}: dataset.feature_id`);
	if (!BROWSER_ORDER.some((browser) => browser in (dataset.support ?? {}))) {
		throw new ManifestError(
			`${label}: dataset.support must record at least one of ${BROWSER_ORDER.join(', ')}`,
		);
	}
	if (!['high', 'low', false].includes(dataset.baseline)) {
		throw new ManifestError(`${label}: dataset.baseline must be "high", "low" or false`);
	}
	for (const key of ['baseline_low_date', 'baseline_high_date']) {
		if (dataset[key] !== null && typeof dataset[key] !== 'string') {
			throw new ManifestError(`${label}: dataset.${key} must be a date string or null`);
		}
	}
}

function validateDetect(list, label) {
	requireArray(list, `${label}: detect`);
	for (const pattern of list) {
		requireString(pattern, `${label}: detect entry`);
		try {
			RegExp(pattern);
		} catch (error) {
			throw new ManifestError(
				`${label}: detect pattern is not a valid RegExp: ${pattern} (${error.message})`,
			);
		}
	}
}

export function loadManifest(manifestPath) {
	let raw;
	try {
		raw = readFileSync(manifestPath, 'utf8');
	} catch (error) {
		throw new ManifestError(`cannot read the manifest at ${manifestPath}: ${error.message}`);
	}
	let manifest;
	try {
		manifest = JSON.parse(raw);
	} catch (error) {
		throw new ManifestError(`${manifestPath} is not valid JSON: ${error.message}`);
	}

	if (manifest.schema_version !== 1) {
		throw new ManifestError(
			`${manifestPath}: unsupported schema_version ${manifest.schema_version}`,
		);
	}
	if (manifest.policy?.bar !== 'baseline-widely-available') {
		throw new ManifestError(`${manifestPath}: policy.bar must be "baseline-widely-available"`);
	}
	requireArray(manifest.policy?.target_browsers, 'policy.target_browsers');
	for (const target of manifest.policy.target_browsers) {
		requireString(target?.id, 'policy.target_browsers[].id');
		requireString(target?.floor, `policy.target_browsers[${target?.id}].floor`);
		if (parseVersion(target.floor) === null) {
			throw new ManifestError(
				`policy.target_browsers[${target.id}].floor is not a version: ${target.floor}`,
			);
		}
	}
	requireString(manifest.dataset?.name, 'dataset.name');
	requireString(manifest.dataset?.snapshot_date, 'dataset.snapshot_date');
	requireString(manifest.dataset?.source_url, 'dataset.source_url');

	const scan = manifest.scan ?? {};
	requireArray(scan.extensions, 'scan.extensions');
	requireArray(scan.exclude, 'scan.exclude');
	requireString(scan.coverage_root, 'scan.coverage_root');

	const surfaces = requireArray(manifest.surfaces, 'surfaces');
	const seenSurfaces = new Set();
	for (const surface of surfaces) {
		requireString(surface?.id, 'surfaces[].id');
		if (seenSurfaces.has(surface.id))
			throw new ManifestError(`duplicate surface id: ${surface.id}`);
		seenSurfaces.add(surface.id);
		const hasRoot = typeof surface.root === 'string';
		const hasFiles = Array.isArray(surface.files);
		if (hasRoot === hasFiles) {
			throw new ManifestError(`surface ${surface.id}: declare exactly one of "root" or "files"`);
		}
		if (hasRoot) requireString(surface.root, `surface ${surface.id}: root`);
		if (hasFiles) requireArray(surface.files, `surface ${surface.id}: files`);
		if (!Number.isInteger(surface.min_files) || surface.min_files < 1) {
			throw new ManifestError(`surface ${surface.id}: min_files must be an integer >= 1`);
		}
		requireString(surface.role, `surface ${surface.id}: role`);
	}

	const ids = new Set();
	for (const feature of requireArray(manifest.features, 'features')) {
		const label = `features[${feature?.id ?? '?'}]`;
		requireString(feature.id, `${label}: id`);
		if (ids.has(feature.id)) throw new ManifestError(`duplicate feature id: ${feature.id}`);
		ids.add(feature.id);
		requireString(feature.label, `${label}: label`);
		if (!Object.hasOwn(FALLBACK_KIND_BY_FEATURE_KIND, feature.kind)) {
			throw new ManifestError(
				`${label}: kind must be one of ${Object.keys(FALLBACK_KIND_BY_FEATURE_KIND).join(', ')}`,
			);
		}
		validateDetect(feature.detect, label);
		validateDatasetBlock(feature, label);
		if (feature.fallback !== null) {
			const fallback = feature.fallback;
			requireString(fallback?.kind, `${label}: fallback.kind`);
			if (fallback.kind !== FALLBACK_KIND_BY_FEATURE_KIND[feature.kind]) {
				throw new ManifestError(
					`${label}: a ${feature.kind} feature needs fallback.kind "${FALLBACK_KIND_BY_FEATURE_KIND[feature.kind]}", got "${fallback.kind}"`,
				);
			}
			requireString(fallback.strategy, `${label}: fallback.strategy`);
			if (fallback.strategy.trim().length < MIN_STRATEGY_CHARS) {
				throw new ManifestError(
					`${label}: fallback.strategy must state the requirement in at least ${MIN_STRATEGY_CHARS} characters`,
				);
			}
			for (const evidence of requireArray(fallback.evidence, `${label}: fallback.evidence`)) {
				requireString(evidence?.file, `${label}: fallback.evidence[].file`);
				requireString(evidence?.pattern, `${label}: fallback.evidence[].pattern`);
				requireString(evidence?.proves, `${label}: fallback.evidence[].proves`);
			}
		}
		for (const allow of feature.allow ?? []) {
			requireString(allow?.file, `${label}: allow[].file`);
			requireString(allow?.pattern, `${label}: allow[].pattern`);
			requireString(allow?.reason, `${label}: allow[].reason`);
			// A file scope without a glob would silently stop suppressing the
			// moment the file is renamed, and a bare `**` would waive the whole
			// repository; both must be spelled out so they survive review.
			if (!allow.file.includes('*')) {
				throw new ManifestError(
					`${label}: allow[].file must be a scoped glob (e.g. "src/routes/*.tsx"), not the exact file "${allow.file}"`,
				);
			}
			if (/^\*\*\/?$/.test(allow.file)) {
				throw new ManifestError(
					`${label}: allow[].file "${allow.file}" is repository-wide; a false-positive waiver must name its directory`,
				);
			}
		}
	}

	for (const guarded of requireArray(manifest.guarded_features, 'guarded_features')) {
		const label = `guarded_features[${guarded?.id ?? '?'}]`;
		requireString(guarded.id, `${label}: id`);
		if (ids.has(guarded.id)) throw new ManifestError(`duplicate feature id: ${guarded.id}`);
		ids.add(guarded.id);
		requireString(guarded.label, `${label}: label`);
		requireString(guarded.rationale, `${label}: rationale`);
		validateDetect(guarded.detect, label);
		validateDatasetBlock(guarded, label);
	}

	return manifest;
}

/* ------------------------------------------------------------------ *
 * file collection
 * ------------------------------------------------------------------ */

function walk(dir, out = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.tmp') continue;
			walk(path, out);
			continue;
		}
		if (entry.isFile()) out.push(path);
	}
	return out;
}

function matchesExtension(path, extensions) {
	return extensions.some((extension) => path.endsWith(extension));
}

export function collectFiles(root, manifest) {
	const { extensions, exclude } = manifest.scan;
	const excludes = exclude.map(globToRegExp);
	const isScanned = (absPath) => {
		const rel = relative(root, absPath).split(sep).join('/');
		return matchesExtension(rel, extensions) && !excludes.some((pattern) => pattern.test(rel));
	};

	const files = [];
	for (const surface of manifest.surfaces) {
		if (surface.root) {
			const absRoot = join(root, surface.root);
			let matched = 0;
			for (const absPath of walk(absRoot)) {
				if (!isScanned(absPath)) continue;
				files.push({ surface: surface.id, path: relative(root, absPath).split(sep).join('/') });
				matched += 1;
			}
			surface.__matched = matched;
			continue;
		}
		let matched = 0;
		for (const file of surface.files) {
			const absPath = join(root, file);
			if (!statSync(absPath, { throwIfNoEntry: false })) {
				surface.__missing = [...(surface.__missing ?? []), file];
				continue;
			}
			if (!isScanned(absPath)) continue;
			files.push({ surface: surface.id, path: file });
			matched += 1;
		}
		surface.__matched = matched;
	}

	// Coverage: every scanned source file under the coverage root must be
	// owned by a declared surface, so a new (or moved) route tree cannot
	// fall outside the gate.
	const coverageRoot = join(root, manifest.scan.coverage_root);
	const covered = new Set(files.map((file) => file.path));
	const uncovered = walk(coverageRoot)
		.filter((absPath) => isScanned(absPath))
		.map((absPath) => relative(root, absPath).split(sep).join('/'))
		.filter((path) => !covered.has(path));

	return { files, uncovered };
}

/* ------------------------------------------------------------------ *
 * detection
 * ------------------------------------------------------------------ */

function findMatches(content, pattern, limit = 5) {
	const regex = new RegExp(pattern, 'g');
	const found = [];
	let match = regex.exec(content);
	while (match !== null) {
		if (match[0].length === 0) {
			regex.lastIndex += 1;
			match = regex.exec(content);
			continue;
		}
		const before = content.slice(0, match.index);
		const line = before.split('\n').length;
		const column = match.index - (before.lastIndexOf('\n') + 1) + 1;
		found.push({
			index: match.index,
			end: match.index + match[0].length,
			line,
			column,
			text: match[0],
		});
		if (found.length >= limit) break;
		match = regex.exec(content);
	}
	return found;
}

export function scanContent(manifest, entries, readContent) {
	const detections = new Map();
	for (const entry of entries) {
		const content = readContent(entry.path);
		const declarations = [...manifest.features, ...manifest.guarded_features];
		for (const declaration of declarations) {
			const bucket = detections.get(declaration.id) ?? [];
			for (const pattern of declaration.detect) {
				for (const match of findMatches(content, pattern)) {
					bucket.push({ file: entry.path, pattern, ...match });
				}
			}
			detections.set(declaration.id, bucket);
		}
	}
	return detections;
}

/* ------------------------------------------------------------------ *
 * evaluation
 * ------------------------------------------------------------------ */

function describeBaseline(dataset) {
	if (dataset.baseline === 'high') {
		return `widely available since ${dataset.baseline_high_date}`;
	}
	if (dataset.baseline === 'low') return `newly available since ${dataset.baseline_low_date}`;
	return 'not Baseline (limited availability)';
}

function belowBar(dataset) {
	return dataset.baseline !== BAR;
}

export function computeTargetFloors(manifest) {
	const highDates = manifest.features
		.filter((feature) => feature.dataset.baseline === BAR && feature.dataset.baseline_high_date)
		.map((feature) => feature.dataset.baseline_high_date)
		.sort();
	const earliest = highDates[0] ?? null;
	const latest = highDates[highDates.length - 1] ?? null;

	const floors = [];
	for (const target of manifest.policy.target_browsers) {
		const releases = manifest.dataset.browsers?.[target.id]?.releases ?? [];
		const implied =
			latest && releases.length > 0
				? (releases.find((release) => release.date >= latest)?.version ?? null)
				: null;
		floors.push({
			id: target.id,
			label: target.label ?? target.id,
			role: target.role ?? 'Baseline core',
			declared: target.floor,
			implied,
		});
	}
	return { earliest, latest, floors };
}

export function evaluate({ manifest, root, files, uncovered, detections }) {
	const errors = [];
	const warnings = [];
	const rows = [];

	const error = (rule, message) => errors.push({ rule, message });
	const warn = (rule, message) => warnings.push({ rule, message });

	for (const surface of manifest.surfaces) {
		if (surface.__missing?.length) {
			error(
				'surface_file_missing',
				`surface "${surface.id}" declares files that do not exist: ${surface.__missing.join(', ')}`,
			);
		}
		if ((surface.__matched ?? 0) < surface.min_files) {
			error(
				'surface_empty',
				`surface "${surface.id}" matched ${surface.__matched ?? 0} file(s) but declares min_files ${surface.min_files}; a gate that scans nothing must never pass`,
			);
		}
	}
	if (uncovered.length > 0) {
		error(
			'surface_uncovered',
			`${uncovered.length} scanned file(s) under ${manifest.scan.coverage_root} are owned by no surface:\n    ${formatList(uncovered)}`,
		);
	}

	const evidenceCache = new Map();
	const readEvidence = (file) => {
		if (!evidenceCache.has(file)) {
			const abs = join(root, file);
			evidenceCache.set(
				file,
				statSync(abs, { throwIfNoEntry: false }) ? readFileSync(abs, 'utf8') : null,
			);
		}
		return evidenceCache.get(file);
	};

	for (const feature of manifest.features) {
		const hits = detections.get(feature.id) ?? [];
		// A declared false-positive waiver suppresses a hit only where the
		// waiver's own pattern overlaps that hit inside a scoped file. Both
		// sides must still be real, and a waiver that stops overlapping
		// anything is an error rather than an invisible no-op.
		const live = [...hits];
		for (const [index, allow] of (feature.allow ?? []).entries()) {
			const glob = globToRegExp(allow.file);
			const scopedFiles = [
				...new Set(hits.map((hit) => hit.file).filter((file) => glob.test(file))),
			];
			let suppressed = 0;
			for (const file of scopedFiles) {
				for (const waiver of findMatches(readEvidence(file) ?? '', allow.pattern, 50)) {
					const overlapping = hits.filter(
						(hit) => hit.file === file && waiver.index < hit.end && hit.index < waiver.end,
					);
					for (const hit of overlapping) {
						const position = live.indexOf(hit);
						if (position !== -1) {
							live.splice(position, 1);
							suppressed += 1;
						}
					}
				}
			}
			if (suppressed < MIN_ALLOW_MATCHES) {
				error(
					'allow_unused',
					`${feature.id}: allow[${index}] (${allow.file} / ${allow.pattern}) suppresses nothing; a suppression that no longer suppresses is a silent no-op, not a false-positive waiver`,
				);
			}
		}

		const row = {
			id: feature.id,
			label: feature.label,
			kind: feature.kind,
			dataset: feature.dataset,
			baseline: describeBaseline(feature.dataset),
			belowBar: belowBar(feature.dataset),
			hits: live,
			allHits: hits,
			suppressed: hits.length - live.length,
			fallback: feature.fallback,
			fallbackEvidence: [],
		};

		if (live.length === 0) {
			error(
				'feature_not_detected',
				`declared feature "${feature.id}" (${feature.label}) has no occurrence in any surface; the declaration or its detect patterns have drifted from the code`,
			);
		}

		if (row.belowBar) {
			if (!feature.fallback) {
				error(
					'fallback_required',
					`"${feature.id}" (${feature.label}) is ${row.baseline} — adopting it without a declared ` +
						`${feature.kind === 'css' ? 'progressive' : 'capability'} fallback fails the gate`,
				);
			} else {
				for (const [index, evidence] of feature.fallback.evidence.entries()) {
					const content = readEvidence(evidence.file);
					if (content === null) {
						error(
							'fallback_evidence_missing',
							`"${feature.id}": fallback evidence file ${evidence.file} does not exist`,
						);
						continue;
					}
					const proofs = findMatches(content, evidence.pattern);
					if (proofs.length === 0) {
						error(
							'fallback_evidence_missing',
							`"${feature.id}": fallback evidence pattern /${evidence.pattern}/ has no match in ${evidence.file}; the declared fallback story no longer exists in the working tree`,
						);
						continue;
					}
					row.fallbackEvidence.push({ ...evidence, proofs });

					if (evidence.precedes === true) {
						const firstHit = row.allHits.find((hit) => hit.file === evidence.file);
						const proof = proofs[0];
						if (!firstHit) {
							error(
								'fallback_evidence_missing',
								`"${feature.id}": evidence claims to precede the declaration in ${evidence.file}, but the feature is not used there`,
							);
						} else if (proof.index >= firstHit.index) {
							error(
								'fallback_evidence_unordered',
								`"${feature.id}": in ${evidence.file} the fallback match at line ${proof.line} does not precede ` +
									`the feature declaration at line ${firstHit.line}; a fallback declared after the feature is not a fallback`,
							);
						}
					}
				}
				warn(
					'below_baseline_with_fallback',
					`"${feature.id}" (${feature.label}) is ${row.baseline}; accepted via ${feature.fallback.kind} fallback — ${feature.fallback.strategy}`,
				);
			}
		}
		rows.push(row);
	}

	const guardedRows = [];
	for (const guarded of manifest.guarded_features) {
		const hits = detections.get(guarded.id) ?? [];
		guardedRows.push({
			id: guarded.id,
			label: guarded.label,
			dataset: guarded.dataset,
			baseline: describeBaseline(guarded.dataset),
			hits,
		});
		if (hits.length > 0) {
			error(
				'guarded_feature_adopted',
				`guarded feature "${guarded.id}" (${guarded.label}, ${describeBaseline(guarded.dataset)}) is used in ` +
					`${hits.length} place(s):\n    ${formatList(hits, (hit) => `${hit.file}:${hit.line}:${hit.column} (/${hit.pattern}/)`)}\n` +
					`    register it under "features" with its Baseline status and an explicit fallback, or remove the usage. Rationale for guarding: ${guarded.rationale}`,
			);
		}
	}

	const targets = computeTargetFloors(manifest);
	for (const floor of targets.floors) {
		if (floor.implied && compareVersions(floor.declared, floor.implied) < 0) {
			error(
				'target_floor_below_bar',
				`declared target ${floor.label} floor ${floor.declared} is below the Baseline Widely available bar ` +
					`implied by the adopted set (${floor.implied}, available ${targets.latest}); raise the declared floor or drop the feature`,
			);
		}
	}

	return {
		errors,
		warnings,
		rows,
		guardedRows,
		targets,
		stats: {
			surfaces: manifest.surfaces.length,
			files: files.length,
			uncovered: uncovered.length,
			adopted: manifest.features.length,
			belowBar: rows.filter((row) => row.belowBar).length,
			guarded: manifest.guarded_features.length,
			suppressed: rows.reduce((sum, row) => sum + row.suppressed, 0),
		},
		manifest,
		root,
	};
}

/* ------------------------------------------------------------------ *
 * dataset drift verification
 * ------------------------------------------------------------------ */

export function verifyDataset(manifest, datasetPath) {
	const raw = JSON.parse(readFileSync(datasetPath, 'utf8'));
	const drift = [];
	for (const declaration of [...manifest.features, ...manifest.guarded_features]) {
		const upstream = raw.features?.[declaration.dataset.feature_id];
		if (!upstream) {
			drift.push(`${declaration.id}: ${declaration.dataset.feature_id} is absent from the dataset`);
			continue;
		}
		const byKey = declaration.dataset.compat_key
			? upstream.status?.by_compat_key?.[declaration.dataset.compat_key]
			: undefined;
		if (declaration.dataset.compat_key && !byKey) {
			drift.push(
				`${declaration.id}: compat key ${declaration.dataset.compat_key} is absent from the dataset`,
			);
			continue;
		}
		const status = byKey ?? upstream.status;
		const actual = {
			baseline: status.baseline,
			baseline_low_date: status.baseline_low_date ?? null,
			baseline_high_date: status.baseline_high_date ?? null,
		};
		for (const [key, value] of Object.entries(actual)) {
			if (JSON.stringify(declaration.dataset[key]) !== JSON.stringify(value)) {
				drift.push(
					`${declaration.id}: dataset.${key} is ${JSON.stringify(declaration.dataset[key])}, dataset says ${JSON.stringify(value)}`,
				);
			}
		}
		for (const browser of BROWSER_ORDER) {
			const vendored = declaration.dataset.support?.[browser] ?? null;
			const upstreamVersion = status.support?.[browser] ?? null;
			if (vendored !== upstreamVersion) {
				drift.push(
					`${declaration.id}: support.${browser} is ${JSON.stringify(vendored)}, dataset says ${JSON.stringify(upstreamVersion)}`,
				);
			}
		}
	}
	return drift;
}

/* ------------------------------------------------------------------ *
 * orchestration + output
 * ------------------------------------------------------------------ */

export function runCheck({
	root = REPO_ROOT,
	manifestPath = DEFAULT_MANIFEST,
	datasetPath = null,
} = {}) {
	const manifest = loadManifest(join(root, manifestPath));
	const { files, uncovered } = collectFiles(root, manifest);
	const cache = new Map();
	const detections = scanContent(manifest, files, (path) => {
		if (!cache.has(path)) cache.set(path, readFileSync(join(root, path), 'utf8'));
		return cache.get(path);
	});
	const result = evaluate({ manifest, root, files, uncovered, detections });
	result.datasetDrift = datasetPath ? verifyDataset(manifest, datasetPath) : null;
	return result;
}

function browserSummary(row) {
	return BROWSER_ORDER.map((browser) => row.dataset.support?.[browser] ?? '—').join(' / ');
}

export function formatReport(result) {
	const lines = [];
	const { stats, targets, manifest } = result;
	lines.push('my-web-2026 — Web feature adoption gate (Baseline, Issue #414)');
	lines.push(`  dataset   ${manifest.dataset.name} @ ${manifest.dataset.snapshot_date}`);
	lines.push(`  source    ${manifest.dataset.source_url}`);
	lines.push(`  bar       Baseline: Widely available (baseline === "${BAR}")`);
	lines.push(
		`  surfaces  ${stats.surfaces} declared · ${stats.files} files scanned · ${stats.uncovered} uncovered`,
	);
	lines.push(
		`  features  ${stats.adopted} adopted (${stats.belowBar} below the bar, each with a verified fallback) · ${stats.guarded} guarded · ${stats.suppressed} occurrence(s) suppressed by a declared false-positive waiver`,
	);
	lines.push('');

	lines.push(`adopted features (browsers: ${BROWSER_ORDER.join(' / ')})`);
	for (const row of result.rows) {
		const marks = row.hits.length;
		lines.push(
			`  ${row.belowBar ? 'warn' : ' ok '} ${row.id.padEnd(24)} ${row.baseline.padEnd(34)} ${browserSummary(row)}`,
		);
		lines.push(
			`         ${row.label} — ${marks} site(s)${row.fallback ? `, fallback: ${row.fallback.kind}` : ''}`,
		);
		if (row.fallback) {
			for (const evidence of row.fallbackEvidence) {
				lines.push(
					`         evidence ${evidence.file}:${evidence.proofs[0].line} /${evidence.pattern}/ — ${evidence.proves}`,
				);
			}
		}
	}
	lines.push('');

	lines.push('guarded features (not adopted — any occurrence fails)');
	for (const row of result.guardedRows) {
		lines.push(`  ok   ${row.id.padEnd(24)} ${row.baseline.padEnd(34)} ${browserSummary(row)}`);
	}
	lines.push('');

	lines.push(
		`target browsers (Baseline Widely available across the adopted set: ${targets.earliest ?? '—'} … ${targets.latest ?? '—'})`,
	);
	for (const floor of targets.floors) {
		lines.push(
			`  ${floor.id.padEnd(12)} declared ${String(floor.declared).padEnd(8)} bar-implied ${String(floor.implied ?? '—').padEnd(8)} ${floor.role}`,
		);
	}

	if (result.warnings.length > 0) {
		lines.push('');
		lines.push(`warnings (${result.warnings.length})`);
		for (const warning of result.warnings)
			lines.push(`  WARN  ${warning.rule}: ${warning.message}`);
	}
	if (result.datasetDrift) {
		lines.push('');
		if (result.datasetDrift.length === 0) {
			lines.push(
				'dataset verification: the vendored snapshot matches the supplied web-features data.json',
			);
		} else {
			lines.push(`dataset verification: ${result.datasetDrift.length} drift(s)`);
			for (const entry of result.datasetDrift) lines.push(`  DRIFT ${entry}`);
		}
	}
	if (result.errors.length > 0) {
		lines.push('');
		lines.push(`errors (${result.errors.length})`);
		for (const entry of result.errors) lines.push(`  FAIL  ${entry.rule}: ${entry.message}`);
	}
	return lines.join('\n');
}

function main(argv) {
	const asJson = argv.includes('--json');
	const datasetIndex = argv.indexOf('--dataset');
	const datasetPath = datasetIndex === -1 ? null : argv[datasetIndex + 1];
	if (datasetIndex !== -1 && !datasetPath) {
		process.stderr.write('--dataset requires a path to a web-features data.json\n');
		return 2;
	}

	let result;
	try {
		result = runCheck({ datasetPath });
	} catch (error) {
		if (error instanceof ManifestError) {
			process.stderr.write(`browser-baseline manifest is unusable: ${error.message}\n`);
			return 2;
		}
		throw error;
	}

	const driftFailed = (result.datasetDrift?.length ?? 0) > 0;
	if (asJson) {
		process.stdout.write(
			`${JSON.stringify(
				{
					ok: result.errors.length === 0 && !driftFailed,
					stats: result.stats,
					targets: result.targets,
					errors: result.errors,
					warnings: result.warnings,
					rows: result.rows.map((row) => ({
						id: row.id,
						baseline: row.dataset.baseline,
						sites: row.hits.length,
						fallback: row.fallback?.kind ?? null,
					})),
					datasetDrift: result.datasetDrift,
				},
				null,
				2,
			)}\n`,
		);
	} else {
		const report = formatReport(result);
		if (result.errors.length > 0 || driftFailed) process.stderr.write(`${report}\n`);
		else process.stdout.write(`${report}\n`);
	}

	if (result.errors.length > 0 || driftFailed) return 1;
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main(process.argv.slice(2)));
}
