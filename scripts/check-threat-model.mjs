#!/usr/bin/env node

/**
 * Per-capability threat model ledger (Issue #479).
 *
 * Why this gate exists
 * --------------------
 * `docs/security.md` and `docs/security/*.md` describe the *controls*
 * this project ships, one control per page. What they do not answer is
 * the review question "which asset is this control protecting, and
 * which boundary does it sit on". A threat model that lives only in a
 * wiki page drifts silently: a control is added without an asset, an
 * asset is added without a boundary, and the diagram a reviewer reads
 * keeps describing the platform as it was three Issues ago.
 *
 * The second failure this gate closes is *fabrication*. Issue #479 asks
 * for an asset and trust-boundary inventory per feature unit and says
 * explicitly that a STRIDE-shaped document must not fill an attack
 * surface it cannot point at. So nothing in this ledger is allowed to
 * be prose-only:
 *
 *   - every asset declares a `source_of_truth` that is either a file
 *     which exists in the working tree or a `SCREAMING_SNAKE` binding /
 *     variable **name** — never a value;
 *   - every node that claims to be a place in the system carries a
 *     `source` path that must exist on disk, so "the attack surface" can
 *     never be a diagram of nowhere;
 *   - every control and every mitigation is a path that must exist, and
 *     a gate that the threat model cites must be a command registered in
 *     `package.json#scripts` and listed in the control registry.
 *
 * What it checks (cheap by design — text scan only, no browser, no
 * network, no Worker, no binding, no secret):
 *
 *   1. `quality/threat-model.json` parses, declares `version: 1`, a
 *      non-empty capability roster, and a non-empty
 *      `protected_capabilities` list. An empty guard list would silently
 *      disable rule 12, so it fails closed.
 *   2. Every object carries only the keys this schema declares
 *      (`unknownKeys`). A field that is not modelled cannot be reviewed,
 *      and the strict shape is what makes "a confidential asset can
 *      never grow a `value` field" structural rather than social.
 *   3. Vocabularies are closed sets: capability status, trust zone,
 *      STRIDE category, asset classification, mitigation state, control
 *      kind. A typo is an error, never a new category.
 *   4. Ids are unique inside their scope, and every id a row points at
 *      (threat → asset, node → asset, boundary → node, registry →
 *      capability) is declared. A dangling reference fails.
 *   5. Every asset declares a `source_of_truth` that exists on disk or
 *      is a `SCREAMING_SNAKE` name. Nothing else counts as a source.
 *   6. Every boundary crosses the boundary zone: at least one endpoint
 *      must be a `boundary` node, `from !== to`, and each control ref
 *      must exist. Every `untrusted` and every `trusted` node must take
 *      part in at least one boundary — a zone nobody crosses is a claim
 *      nobody can review.
 *   7. Every threat names a declared asset, a real scenario sentence and
 *      at least one mitigation whose `ref` exists. A threat with no
 *      implemented mitigation is `uncovered`, never `covered`.
 *   8. A `planned` mitigation must be followed by a `follow_up`
 *      sentence on the threat. Hand-work that is not written down is the
 *      "unverified" state this repository refuses to print as green.
 *   9. A `live` capability may not carry an `uncovered` threat. A
 *      `planned` / `deferred` capability may, and is reported as such.
 *  10. Every capability carries at least two review items, each a real
 *      question (`?`). This is Issue #479's "review 項目" — the
 *      questions a reviewer is expected to ask out loud.
 *  11. The control registry agrees with the model in both directions:
 *      the set of capabilities a gate is claimed by is exactly the set
 *      that cites it, the command is registered in `package.json`, and
 *      every capability is claimed by at least one gate.
 *  12. `protected_capabilities` rows must exist and stay `live`: deleting
 *      a capability row, or demoting it to `planned`, fails here even
 *      though nothing else changed.
 *  13. Every string in the manifest is scanned with the repository's
 *      own credential shape test (`_secret-scan.mjs#looksLikeCredentialValue`)
 *      and with a NAME=value assignment shape. A hit is an error that
 *      names the JSON pointer and **never** the value. This is Issue
 *      #479's "secret 値を出力する操作は禁止" as a machine check: the
 *      ledger describes assets by name and source, and a value would
 *      make the review artefact itself the leak.
 *  14. A security-family command that the release surface executes but
 *      no threat claims is reported as unaccounted (warning, like the
 *      release-gate ledger's own rule): the drift is made visible
 *      without failing a release over a naming preference.
 *
 * Scanner limits (documented, not hidden):
 *
 *   - The ledger proves that the model *points at real things*. It does
 *     not re-run a control, does not decide whether a mitigation is
 *     sufficient, and cannot tell a good STRIDE scenario from a lazy
 *     one — each check script stays the authority for its own verdict,
 *     and a reviewer stays the authority for sufficiency.
 *   - "Exists on disk" is the file-existence fact. A control file that
 *     exists but is disabled (a commented-out gate, a fixture-only
 *     test) is a review item, not something this gate can decide.
 *   - Node geometry (zone, label) is declared, not derived. The diagram
 *     renderer places a node by its zone; it never invents one.
 *
 * Exit codes: 0 = the model is complete and every claim points at a real
 * artefact, 1 = fabrication / drift / malformed ledger, 2 = bad input
 * (unreadable manifest or package.json).
 *
 * Authority: Issue #479. Paired with
 * `docs/verification/security/threat-model.md`, the `threat_model_coverage`
 * block in `quality/profile.yaml`, the fixtures in
 * `quality/fixtures/threat-model/`, and the committed verification
 * artefact `docs/verification/security/threat-model-diagram.webp`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeCredentialValue } from './_secret-scan.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_MANIFEST_PATH = 'quality/threat-model.json';
export const FIXTURE_DIR = 'quality/fixtures/threat-model';

/** Closed vocabularies. A value outside one is an error, not a new word. */
export const CAPABILITY_STATUSES = ['live', 'planned', 'deferred'];
export const ZONES = ['untrusted', 'boundary', 'trusted'];
export const CLASSIFICATIONS = ['public', 'internal', 'confidential'];
export const STRIDE_CATEGORIES = [
	'spoofing',
	'tampering',
	'repudiation',
	'information-disclosure',
	'denial-of-service',
	'elevation-of-privilege',
];
export const MITIGATION_STATES = ['implemented', 'planned'];
export const CONTROL_KINDS = ['gate', 'test', 'doc', 'code'];

/** Trust zones in diagram order: outside → crossing → inside. */
export const ZONE_ORDER = ['untrusted', 'boundary', 'trusted'];

/** The keys each object may carry. Anything else is an error. */
const SHAPES = {
	root: [
		'version',
		'policy',
		'security_gate_prefixes',
		'diagram_capability',
		'protected_capabilities',
		'control_registry',
		'capabilities',
	],
	capability: [
		'id',
		'title',
		'status',
		'owner',
		'authority',
		'summary',
		'documentation',
		'assets',
		'nodes',
		'boundaries',
		'threats',
		'review_items',
	],
	asset: ['id', 'classification', 'description', 'source_of_truth'],
	node: ['id', 'label', 'zone', 'assets', 'source'],
	boundary: ['id', 'from', 'to', 'crosses', 'controls'],
	control: ['kind', 'ref'],
	threat: ['id', 'stride', 'asset', 'scenario', 'mitigations', 'follow_up'],
	mitigation: ['ref', 'kind', 'state', 'note'],
	registry: ['command', 'ref', 'capabilities', 'contract'],
};

/** Reasons that mean "the author wrote nothing". */
const PLACEHOLDER_REASONS = new Set(['tbd', 'todo', 'n/a', 'na', 'none', 'later', '-', 'unknown']);

/** A `SCREAMING_SNAKE` identifier is a *name*; anything else is a value. */
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** `NAME = value` / `NAME: value` for a secret-sounding NAME. */
const SECRET_ASSIGNMENT_RE =
	/^\s*[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|CREDENTIALS?)[A-Z0-9_]*\s*[:=]\s*\S/;

/** `pnpm run <name>` in a command body. */
const PNPM_RUN_PATTERN = /pnpm run ([A-Za-z0-9:._-]+)/g;

/** `node scripts/x.mjs`, `node --experimental-strip-types scripts/y.mjs`, … */
const SCRIPT_FILE_PATTERN = /scripts\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|tsx)/g;

/** A short field must say something: prose, not a placeholder. */
export function isRealText(value, minimum = 24) {
	return (
		typeof value === 'string' &&
		value.trim().length >= minimum &&
		!PLACEHOLDER_REASONS.has(value.trim().toLowerCase())
	);
}

/** Keys outside the declared shape, so an unmodelled field cannot hide. */
export function unknownKeys(object, shape) {
	if (object === null || typeof object !== 'object' || Array.isArray(object)) return [];
	return Object.keys(object).filter((key) => !SHAPES[shape].includes(key));
}

function isNonEmptyArray(value) {
	return Array.isArray(value) && value.length > 0;
}

function vocabularyError(value, vocabulary) {
	if (vocabulary.includes(value)) return null;
	return `"${String(value)}" not in {${vocabulary.join(', ')}}`;
}

/**
 * Every string in a manifest value, with the JSON pointer it sits at.
 *
 * The pointer is what an error message may print. The string itself is
 * only ever handed to the shape tests, never to output.
 */
export function collectStrings(value, pointer = '', out = []) {
	if (typeof value === 'string') {
		out.push({ pointer, value });
		return out;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => collectStrings(item, `${pointer}/${index}`, out));
		return out;
	}
	if (value !== null && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) {
			collectStrings(item, `${pointer}/${key}`, out);
		}
	}
	return out;
}

/** Transitive closure of one `package.json` script. */
export function expandScriptNames(scripts, entry, seen = new Set()) {
	if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) return [];
	seen.add(entry);
	const body = scripts?.[entry];
	if (typeof body !== 'string') return [];
	const out = [entry];
	for (const match of String(body).matchAll(PNPM_RUN_PATTERN)) {
		out.push(...expandScriptNames(scripts, match[1], seen));
	}
	return [...new Set(out)];
}

/** Every `scripts/**` file one script runs. */
export function scriptRunnerFiles(scripts, entry) {
	const body = scripts?.[entry];
	if (typeof body !== 'string') return [];
	return [...new Set([...body.matchAll(SCRIPT_FILE_PATTERN)].map((match) => match[0]))];
}

/**
 * Evaluate one ledger against one repository description.
 *
 * Pure with respect to the filesystem: `scripts` and `fileExists` are
 * passed in, so the fixtures in `quality/fixtures/threat-model/` drive
 * the same code path the real checkout does.
 *
 * @returns {{ errors: string[], warnings: string[], capabilities: object[], summary: object, unaccounted: string[] }}
 */
export function evaluateThreatModel({ manifest, scripts = {}, fileExists = () => true }) {
	const errors = [];
	const warnings = [];
	const capabilities = [];
	const unaccounted = [];

	if (manifest?.version !== 1) {
		errors.push('manifest: `version` must be 1');
	}
	if (!isRealText(manifest?.policy, 60)) {
		errors.push(
			'manifest.policy: state what this ledger claims and does not claim (a real sentence)',
		);
	}
	const prefixes = Array.isArray(manifest?.security_gate_prefixes)
		? manifest.security_gate_prefixes
		: [];
	if (!isNonEmptyArray(prefixes)) {
		errors.push(
			'manifest.security_gate_prefixes: at least one prefix, or rule 14 (the unaccounted-gate warning) is disabled',
		);
	}
	const protectedIds = Array.isArray(manifest?.protected_capabilities)
		? manifest.protected_capabilities
		: [];
	if (protectedIds.length === 0) {
		errors.push(
			'manifest.protected_capabilities: at least one id must be protected, or rule 12 (the "deleted a capability" guard) is disabled',
		);
	}

	const declared = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
	if (declared.length === 0) {
		errors.push('manifest.capabilities: the ledger must model at least one capability');
	}

	// Rule 13 runs over the whole document first: a ledger that carries a
	// credential shape is reported before anything else, so the error list
	// never has to be read past a leaked value to find the structural ones.
	for (const { pointer, value } of collectStrings(manifest)) {
		const shape = looksLikeCredentialValue(value);
		const assignment = SECRET_ASSIGNMENT_RE.test(value);
		if (shape || assignment) {
			errors.push(
				`${pointer}: ${shape ? 'credential-shaped' : 'secret-shaped assignment'} string in the threat model. The ledger names assets and their source; a value belongs to ${'Infisical / the Worker secret store'} and must never appear here (Issue #479: fixture or status-only data only).`,
			);
		}
	}

	const capabilityRows = new Map();
	const registryRefs = new Map();

	// Rule 11, first half: the control registry's own shape.
	const registry = Array.isArray(manifest?.control_registry) ? manifest.control_registry : [];
	if (!isNonEmptyArray(registry)) {
		errors.push(
			'manifest.control_registry: at least one gate, or every control in the model is unreviewable (nothing ties it to a command a release runs)',
		);
	}
	for (const [index, entry] of registry.entries()) {
		const label = `control_registry[${entry?.command ?? index}]`;
		for (const key of unknownKeys(entry, 'registry')) {
			errors.push(`${label}: unknown key "${key}" (shape: ${SHAPES.registry.join(', ')})`);
		}
		if (!isRealText(entry?.command, 4)) {
			errors.push(
				`${label}.command: the \`pnpm run\` command of this gate (e.g. csrf:contract:check)`,
			);
		}
		if (typeof scripts?.[entry?.command] !== 'string') {
			errors.push(`${label}: "${entry?.command}" is not registered in package.json#scripts`);
		}
		if (!isRealText(entry?.ref, 8) || !fileExists(entry.ref)) {
			errors.push(`${label}.ref: "${entry?.ref ?? ''}" does not exist on disk`);
		}
		if (!isRealText(entry?.contract, 40)) {
			errors.push(`${label}.contract: state what the gate proves (a real sentence)`);
		}
		if (!isNonEmptyArray(entry?.capabilities)) {
			errors.push(`${label}.capabilities: at least one capability id must claim this gate`);
		}
		if (typeof entry?.ref === 'string') registryRefs.set(entry.ref, entry);
	}

	for (const [index, capability] of declared.entries()) {
		const label = `capabilities[${capability?.id ?? index}]`;
		const extra = unknownKeys(capability, 'capability');
		if (extra.length > 0) {
			errors.push(
				`${label}: unknown key(s) ${extra.map((key) => `"${key}"`).join(', ')} (shape: ${SHAPES.capability.join(', ')})`,
			);
			continue;
		}
		if (typeof capability?.id !== 'string' || capability.id.length === 0) {
			errors.push(`${label}: missing \`id\``);
			continue;
		}
		if (capabilityRows.has(capability.id)) {
			errors.push(`${label}: duplicate capability id "${capability.id}"`);
			continue;
		}
		const status = vocabularyError(capability.status, CAPABILITY_STATUSES);
		if (status) errors.push(`${label}.status: ${status}`);
		for (const field of ['title', 'owner', 'authority', 'summary']) {
			if (!isRealText(capability[field], field === 'title' ? 6 : 30)) {
				errors.push(`${label}.${field}: write the real ${field} (a sentence, not a placeholder)`);
			}
		}
		if (!isRealText(capability.documentation, 8) || !fileExists(capability.documentation)) {
			errors.push(
				`${label}.documentation: "${capability.documentation ?? ''}" does not exist on disk — the capability must point at the page that explains it`,
			);
		}

		const assets = new Map();
		for (const [assetIndex, asset] of (capability.assets ?? []).entries()) {
			const assetLabel = `${label}.assets[${asset?.id ?? assetIndex}]`;
			const assetExtra = unknownKeys(asset, 'asset');
			if (assetExtra.length > 0) {
				errors.push(
					`${assetLabel}: unknown key(s) ${assetExtra.join(', ')} — an asset records its source, never its value`,
				);
				continue;
			}
			if (typeof asset?.id !== 'string' || asset.id.length === 0) {
				errors.push(`${assetLabel}: missing \`id\``);
				continue;
			}
			if (assets.has(asset.id)) {
				errors.push(`${assetLabel}: duplicate asset id "${asset.id}"`);
				continue;
			}
			const classification = vocabularyError(asset.classification, CLASSIFICATIONS);
			if (classification) errors.push(`${assetLabel}.classification: ${classification}`);
			if (!isRealText(asset.description, 24)) {
				errors.push(
					`${assetLabel}.description: say what the asset is and why it matters (a real sentence)`,
				);
			}
			// Rule 5: the source is a file on disk or a binding NAME. The
			// rejected value is never echoed: this is the one field where a
			// value would be pasted, so the error names the rule instead.
			const source = asset.source_of_truth;
			const isPath = typeof source === 'string' && fileExists(source);
			const isName = typeof source === 'string' && ENV_NAME_RE.test(source);
			if (!isPath && !isName) {
				errors.push(
					`${assetLabel}.source_of_truth: must be a path that exists on disk or a SCREAMING_SNAKE binding name. An asset with no source is a claim about a surface nobody can point at, and this ledger never records a value.`,
				);
			}
			assets.set(asset.id, asset);
		}
		if (!isNonEmptyArray(capability.assets)) {
			errors.push(`${label}.assets: a capability models at least one asset`);
		}

		const nodes = new Map();
		for (const [nodeIndex, node] of (capability.nodes ?? []).entries()) {
			const nodeLabel = `${label}.nodes[${node?.id ?? nodeIndex}]`;
			const nodeExtra = unknownKeys(node, 'node');
			if (nodeExtra.length > 0) {
				errors.push(`${nodeLabel}: unknown key(s) ${nodeExtra.join(', ')}`);
				continue;
			}
			if (typeof node?.id !== 'string' || node.id.length === 0) {
				errors.push(`${nodeLabel}: missing \`id\``);
				continue;
			}
			if (nodes.has(node.id)) {
				errors.push(`${nodeLabel}: duplicate node id "${node.id}"`);
				continue;
			}
			const zone = vocabularyError(node.zone, ZONES);
			if (zone) errors.push(`${nodeLabel}.zone: ${zone}`);
			if (!isRealText(node.label, 8)) {
				errors.push(`${nodeLabel}.label: name the place this node is`);
			}
			// The anti-fabrication guard: a node that says it is a file
			// must be that file.
			if (node.source !== undefined && (!isRealText(node.source, 8) || !fileExists(node.source))) {
				errors.push(
					`${nodeLabel}.source: "${node.source ?? ''}" does not exist on disk — a node may only claim a place the repository contains`,
				);
			}
			for (const assetId of node.assets ?? []) {
				if (!assets.has(assetId)) {
					errors.push(`${nodeLabel}.assets: "${assetId}" is not an asset of ${capability.id}`);
				}
			}
			nodes.set(node.id, node);
		}
		if (!isNonEmptyArray(capability.nodes)) {
			errors.push(`${label}.nodes: a capability declares at least one node`);
		}

		const boundaryRows = [];
		for (const [boundaryIndex, boundary] of (capability.boundaries ?? []).entries()) {
			const boundaryLabel = `${label}.boundaries[${boundary?.id ?? boundaryIndex}]`;
			const boundaryExtra = unknownKeys(boundary, 'boundary');
			if (boundaryExtra.length > 0) {
				errors.push(`${boundaryLabel}: unknown key(s) ${boundaryExtra.join(', ')}`);
				continue;
			}
			if (typeof boundary?.id !== 'string' || boundary.id.length === 0) {
				errors.push(`${boundaryLabel}: missing \`id\``);
				continue;
			}
			if (boundaryRows.some((row) => row.id === boundary.id)) {
				errors.push(`${boundaryLabel}: duplicate boundary id "${boundary.id}"`);
				continue;
			}
			const from = nodes.get(boundary.from);
			const to = nodes.get(boundary.to);
			if (boundary.from === boundary.to) {
				errors.push(
					`${boundaryLabel}: from and to are the same node ("${boundary.from}") — that is not a crossing`,
				);
			}
			if (!from)
				errors.push(
					`${boundaryLabel}.from: "${boundary.from ?? ''}" is not a node of ${capability.id}`,
				);
			if (!to)
				errors.push(
					`${boundaryLabel}.to: "${boundary.to ?? ''}" is not a node of ${capability.id}`,
				);
			if (!isRealText(boundary.crosses, 16)) {
				errors.push(`${boundaryLabel}.crosses: name the boundary that is crossed`);
			}
			// Rule 6: a trust boundary must actually cross the boundary zone.
			if (from && to && from.zone !== 'boundary' && to.zone !== 'boundary') {
				errors.push(
					`${boundaryLabel}: ${boundary.from} (${from.zone}) → ${boundary.to} (${to.zone}) touches no \`boundary\` node, so it is a flow, not a trust boundary`,
				);
			}
			if (!isNonEmptyArray(boundary.controls)) {
				errors.push(
					`${boundaryLabel}.controls: at least one control, or the boundary is an unprotected edge`,
				);
			}
			for (const [controlIndex, control] of (boundary.controls ?? []).entries()) {
				const controlLabel = `${boundaryLabel}.controls[${controlIndex}]`;
				const controlExtra = unknownKeys(control, 'control');
				if (controlExtra.length > 0) {
					errors.push(`${controlLabel}: unknown key(s) ${controlExtra.join(', ')}`);
					continue;
				}
				const kind = vocabularyError(control.kind, CONTROL_KINDS);
				if (kind) errors.push(`${controlLabel}.kind: ${kind}`);
				if (!isRealText(control.ref, 8) || !fileExists(control.ref)) {
					errors.push(
						`${controlLabel}.ref: "${control.ref ?? ''}" does not exist on disk — a control the repository does not contain protects nothing`,
					);
				}
			}
			boundaryRows.push(boundary);
		}
		if (!isNonEmptyArray(capability.boundaries)) {
			errors.push(`${label}.boundaries: a capability declares at least one trust boundary`);
		}
		// Every zone that claims a participant must cross one.
		for (const node of nodes.values()) {
			if (node.zone === 'boundary') continue;
			const crosses = boundaryRows.some(
				(boundary) => boundary.from === node.id || boundary.to === node.id,
			);
			if (!crosses) {
				errors.push(
					`${label}.nodes[${node.id}]: a \`${node.zone}\` node that no trust boundary crosses is not reviewable — either it is outside the feature unit or a boundary is missing`,
				);
			}
		}

		const threatRows = [];
		for (const [threatIndex, threat] of (capability.threats ?? []).entries()) {
			const threatLabel = `${label}.threats[${threat?.id ?? threatIndex}]`;
			const threatExtra = unknownKeys(threat, 'threat');
			if (threatExtra.length > 0) {
				errors.push(`${threatLabel}: unknown key(s) ${threatExtra.join(', ')}`);
				continue;
			}
			if (typeof threat?.id !== 'string' || threat.id.length === 0) {
				errors.push(`${threatLabel}: missing \`id\``);
				continue;
			}
			if (threatRows.some((row) => row.id === threat.id)) {
				errors.push(`${threatLabel}: duplicate threat id "${threat.id}"`);
				continue;
			}
			const stride = vocabularyError(threat.stride, STRIDE_CATEGORIES);
			if (stride) errors.push(`${threatLabel}.stride: ${stride}`);
			if (!assets.has(threat.asset)) {
				errors.push(
					`${threatLabel}.asset: "${threat.asset ?? ''}" is not an asset of ${capability.id}`,
				);
			}
			if (!isRealText(threat.scenario, 40)) {
				errors.push(
					`${threatLabel}.scenario: describe the attacker and the outcome (a real sentence)`,
				);
			}
			if (!isNonEmptyArray(threat.mitigations)) {
				errors.push(`${threatLabel}.mitigations: at least one mitigation`);
			}
			let implemented = 0;
			let planned = false;
			for (const [mitigationIndex, mitigation] of (threat.mitigations ?? []).entries()) {
				const mitigationLabel = `${threatLabel}.mitigations[${mitigationIndex}]`;
				const mitigationExtra = unknownKeys(mitigation, 'mitigation');
				if (mitigationExtra.length > 0) {
					errors.push(`${mitigationLabel}: unknown key(s) ${mitigationExtra.join(', ')}`);
					continue;
				}
				const state = vocabularyError(mitigation.state, MITIGATION_STATES);
				if (state) errors.push(`${mitigationLabel}.state: ${state}`);
				if (!isRealText(mitigation.ref, 8) || !fileExists(mitigation.ref)) {
					errors.push(
						`${mitigationLabel}.ref: "${mitigation.ref ?? ''}" does not exist on disk — an unbuilt mitigation is not a mitigation`,
					);
				}
				const kind = vocabularyError(mitigation.kind, CONTROL_KINDS);
				if (kind) errors.push(`${mitigationLabel}.kind: ${kind}`);
				if (mitigation.note !== undefined && !isRealText(mitigation.note, 16)) {
					errors.push(
						`${mitigationLabel}.note: explain what the mitigation does (a real sentence)`,
					);
				}
				if (mitigation.state === 'implemented') implemented += 1;
				if (mitigation.state === 'planned') planned = true;
			}
			// Rule 8: hand-work that is not written down is not tracked.
			if (planned && !isRealText(threat.follow_up, 24)) {
				errors.push(
					`${threatLabel}: a \`planned\` mitigation needs the threat's \`follow_up\` sentence — the outstanding work is part of the model, not a comment`,
				);
			}
			if (threat.follow_up !== undefined && !isRealText(threat.follow_up, 24)) {
				errors.push(`${threatLabel}.follow_up: write the outstanding work as a real sentence`);
			}
			const threatStatus = implemented > 0 ? 'covered' : 'uncovered';
			if (threatStatus === 'uncovered' && capability.status === 'live') {
				errors.push(
					`${threatLabel}: a live capability may not carry an uncovered threat (${threat.stride} on ${threat.asset}). Implement a mitigation or move the capability to \`planned\` / \`deferred\`.`,
				);
			}
			threatRows.push({
				id: threat.id,
				stride: threat.stride,
				asset: threat.asset,
				scenario: threat.scenario,
				status: threatStatus,
				mitigations: (threat.mitigations ?? []).map((mitigation) => ({
					ref: mitigation?.ref ?? '',
					kind: mitigation?.kind ?? '',
					state: mitigation?.state ?? '',
				})),
				follow_up: threat.follow_up ?? null,
			});
		}
		if (!isNonEmptyArray(capability.threats)) {
			errors.push(`${label}.threats: a capability models at least one threat`);
		}

		// Rule 10: the review questions.
		const reviewItems = Array.isArray(capability.review_items) ? capability.review_items : [];
		if (reviewItems.length < 2) {
			errors.push(
				`${label}.review_items: at least two review questions, or the model has no review surface (a diagram a reviewer cannot question is a picture, not a model)`,
			);
		}
		for (const [itemIndex, item] of reviewItems.entries()) {
			if (!isRealText(item, 24)) {
				errors.push(`${label}.review_items[${itemIndex}]: write a real review question`);
			} else if (!item.trim().endsWith('?')) {
				errors.push(
					`${label}.review_items[${itemIndex}]: a review item is a question the reviewer asks out loud (end it with "?"), not a sentence about the model`,
				);
			}
		}

		const cited = new Set();
		for (const ref of [
			...boundaryRows.flatMap((boundary) =>
				(boundary.controls ?? []).map((control) => control?.ref),
			),
			...threatRows.flatMap((threat) => threat.mitigations.map((mitigation) => mitigation.ref)),
		]) {
			if (typeof ref === 'string' && registryRefs.has(ref)) cited.add(ref);
		}

		const row = {
			id: capability.id,
			title: capability.title,
			status: capability.status,
			owner: capability.owner,
			summary: capability.summary,
			documentation: capability.documentation,
			assets: [...assets.values()],
			nodes: [...nodes.values()],
			boundaries: boundaryRows,
			threats: threatRows,
			review_items: reviewItems,
			cited_refs: [...cited],
		};
		capabilities.push(row);
		capabilityRows.set(capability.id, row);
	}

	// Rule 11, second half: the claim sets must agree in both directions.
	for (const entry of registry) {
		const actual = capabilities
			.filter((capability) => capability.cited_refs.includes(entry?.ref))
			.map((capability) => capability.id);
		const declared_ = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
		const dangling = declared_.filter((id) => !capabilityRows.has(id));
		if (dangling.length > 0) {
			errors.push(
				`control_registry[${entry?.command}].capabilities: ${dangling.join(', ')} ${
					dangling.length === 1 ? 'is not a capability' : 'are not capabilities'
				} in this ledger`,
			);
		}
		const missing = actual.filter((id) => !declared_.includes(id));
		if (missing.length > 0) {
			errors.push(
				`control_registry[${entry?.command}].capabilities: ${missing.join(', ')} cites this gate but is not listed as a claimant — a gate no capability claims is unaccounted coverage`,
			);
		}
		const overstated = declared_.filter((id) => !actual.includes(id));
		if (overstated.length > 0) {
			errors.push(
				`control_registry[${entry?.command}].capabilities: ${overstated.join(', ')} is listed as a claimant but does not cite this gate`,
			);
		}
	}
	for (const capability of capabilities) {
		const claimed = registry.some((entry) => (entry?.capabilities ?? []).includes(capability.id));
		if (!claimed) {
			errors.push(
				`${capability.id}: no control_registry entry claims this capability — every feature unit must name at least one gate a release actually runs`,
			);
		}
	}

	// Rule 12: the "we deleted a capability" guard.
	for (const id of protectedIds) {
		const row = capabilityRows.get(id);
		if (!row) {
			errors.push(
				`manifest.protected_capabilities: "${id}" is protected but has no row — deleting a capability fails here on purpose`,
			);
			continue;
		}
		if (row.status !== 'live') {
			errors.push(
				`capabilities.${id}.status: a protected capability cannot become ${row.status} — demoting a shipped feature unit is an owner decision, not a flag`,
			);
		}
	}

	// Rule 14: a security-family command on the release surface with no
	// threat claiming it. Warning, not error: the report must show the
	// drift rather than fail a release over the next gate's name. The
	// comparison is by runner file, so `secret:scan` and its bundle
	// variant count as one claim rather than as a missing row.
	const releaseScripts = expandScriptNames(scripts, 'validate:release');
	for (const script of releaseScripts.sort()) {
		if (!prefixes.some((prefix) => script.startsWith(prefix))) continue;
		const claimed =
			registry.some((entry) => entry?.command === script) ||
			scriptRunnerFiles(scripts, script).some((file) => registryRefs.has(file));
		if (!claimed) unaccounted.push(script);
	}
	if (unaccounted.length > 0) {
		warnings.push(
			`unaccounted security-family command(s) the release executes with no threat claiming them: ${unaccounted.join(', ')}`,
		);
	}

	// The diagram capability must exist, or the report would draw nothing.
	if (typeof manifest?.diagram_capability === 'string') {
		if (!capabilityRows.has(manifest.diagram_capability)) {
			errors.push(
				`manifest.diagram_capability: "${manifest.diagram_capability}" is not a capability in this ledger`,
			);
		}
	} else {
		errors.push(
			'manifest.diagram_capability: name the capability whose trust boundary the report draws',
		);
	}

	const summary = {
		capabilities: capabilities.length,
		covered: 0,
		uncovered: 0,
		assets: 0,
		boundaries: 0,
		threats: 0,
	};
	for (const capability of capabilities) {
		summary.assets += capability.assets.length;
		summary.boundaries += capability.boundaries.length;
		summary.threats += capability.threats.length;
		for (const threat of capability.threats) summary[threat.status] += 1;
	}

	return { errors, warnings, capabilities, summary, unaccounted };
}

/**
 * Run the gate over a checkout.
 *
 * @returns {{ errors: string[], warnings: string[], capabilities: object[], summary: object, unaccounted: string[], manifest: object }}
 */
export function checkThreatModel({ root = REPO_ROOT, manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
	const read = (path) => {
		try {
			return readFileSync(resolve(root, path), 'utf8');
		} catch {
			return null;
		}
	};

	const manifestText = read(manifestPath);
	if (manifestText === null) {
		return {
			errors: [`manifest: ${manifestPath} does not exist`],
			warnings: [],
			capabilities: [],
			summary: { capabilities: 0, covered: 0, uncovered: 0, assets: 0, boundaries: 0, threats: 0 },
			unaccounted: [],
			manifest: null,
		};
	}
	let manifest;
	try {
		manifest = JSON.parse(manifestText);
	} catch (error) {
		return {
			errors: [`manifest: ${manifestPath} is not valid JSON (${error.message})`],
			warnings: [],
			capabilities: [],
			summary: { capabilities: 0, covered: 0, uncovered: 0, assets: 0, boundaries: 0, threats: 0 },
			unaccounted: [],
			manifest: null,
		};
	}

	const packageText = read('package.json');
	if (packageText === null) {
		return {
			errors: [
				'input: package.json must be readable (rule 11 resolves each gate command through it)',
			],
			warnings: [],
			capabilities: [],
			summary: { capabilities: 0, covered: 0, uncovered: 0, assets: 0, boundaries: 0, threats: 0 },
			unaccounted: [],
			manifest,
		};
	}

	const result = evaluateThreatModel({
		manifest,
		scripts: JSON.parse(packageText).scripts ?? {},
		fileExists: (path) => existsSync(join(root, path)),
	});
	return { ...result, manifest };
}

/** Run one fixture from `quality/fixtures/threat-model/`. */
export function evaluateFixture(fixture) {
	const files = new Set(Array.isArray(fixture?.files) ? fixture.files : []);
	return evaluateThreatModel({
		manifest: fixture?.manifest,
		scripts: fixture?.scripts ?? {},
		fileExists: (path) => files.has(path),
	});
}

export function loadFixture(root, name) {
	return JSON.parse(readFileSync(join(root, FIXTURE_DIR, `${name}.json`), 'utf8'));
}

/**
 * The report's false-green probe: every fixture, evaluated by the same
 * pure evaluator the gate uses. Shared with the screenshot generator so
 * the page and the verdict cannot come from different code.
 */
export function collectProbes(root) {
	return PROBE_FIXTURES.map((name) => {
		try {
			const fixture = loadFixture(root, name);
			return { name, note: fixture.note, ...evaluateFixture(fixture) };
		} catch (error) {
			return {
				name,
				note: `fixture unreadable: ${error.message}`,
				errors: [],
				capabilities: [],
				summary: {
					capabilities: 0,
					covered: 0,
					uncovered: 0,
					assets: 0,
					boundaries: 0,
					threats: 0,
				},
			};
		}
	});
}

/** The fixtures the report renders as the false-green probe, in order. */
export const PROBE_FIXTURES = ['pass', 'missing-evidence', 'unowned-threat', 'secret-literal'];

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

export { escapeHtml };

function parseArg(argv, name) {
	for (const arg of argv) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

function main(argv) {
	const root = resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : REPO_ROOT);
	const manifestPath = parseArg(argv, '--manifest') ?? DEFAULT_MANIFEST_PATH;
	const reportPath = parseArg(argv, '--report');

	const result = checkThreatModel({ root, manifestPath });

	if (reportPath) {
		const probes = collectProbes(root);
		const html = renderReport({ manifest: result.manifest, result, probes });
		const target = resolve(root, reportPath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, html);
		process.stdout.write(`wrote ${reportPath}\n`);
	}

	if (result.errors.length === 0) {
		const { capabilities, covered, uncovered, threats } = result.summary;
		process.stdout.write(
			`threat model OK: ${capabilities} capabilit${capabilities === 1 ? 'y' : 'ies'}, ${threats} threats (${covered} covered, ${uncovered} uncovered)\n`,
		);
		for (const warning of result.warnings) process.stderr.write(`  ! ${warning}\n`);
		return 0;
	}

	process.stderr.write(`threat model: ${result.errors.length} problem(s) in ${manifestPath}:\n`);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	for (const warning of result.warnings) process.stderr.write(`  ! ${warning}\n`);
	process.stderr.write(
		[
			'',
			'A threat model that cannot point at a real artefact is a diagram of nowhere.',
			'Give the claim a source (a path that exists, or a binding NAME), or remove the claim.',
			'See docs/verification/security/threat-model.md for the status vocabulary.',
			'',
		].join('\n'),
	);
	return 1;
}

/**
 * Deterministic SVG of one capability's trust boundaries.
 *
 * Columns are the trust zones (`untrusted` → `boundary` → `trusted`),
 * boxes are the nodes, arrows are the declared boundaries, and each
 * arrow is labelled with the ids of the controls that sit on it. The
 * layout is a grid computed from the manifest — no measured geometry, no
 * bundled layout library, no hand-placed coordinates — so the picture
 * cannot disagree with the ledger it is drawn from.
 */
export function renderDiagram(capability, { width = 1360 } = {}) {
	const columnWidth = 380;
	const nodeWidth = 250;
	const nodeHeight = 84;
	const nodeGap = 22;
	const left = 40;
	const top = 74;
	const zoneX = Object.fromEntries(
		ZONE_ORDER.map((zone, index) => [zone, left + index * columnWidth]),
	);
	const byZone = new Map(ZONE_ORDER.map((zone) => [zone, []]));
	for (const node of capability.nodes) {
		if (!byZone.has(node.zone)) continue;
		byZone.get(node.zone).push(node);
	}
	const height =
		top +
		Math.max(...ZONE_ORDER.map((zone) => byZone.get(zone).length)) * (nodeHeight + nodeGap) +
		80;
	const centreY = (node) => {
		const index = byZone.get(node.zone).indexOf(node);
		return top + index * (nodeHeight + nodeGap) + nodeHeight / 2;
	};

	const zoneHeaders = ZONE_ORDER.map((zone) => {
		const x = zoneX[zone];
		const count = byZone.get(zone).length;
		return `<text x="${x + nodeWidth / 2}" y="40" class="zone" text-anchor="middle">${escapeHtml(
			zone,
		)}</text><text x="${x + nodeWidth / 2}" y="58" class="zone-sub" text-anchor="middle">${count} node${count === 1 ? '' : 's'}</text><rect x="${x}" y="${top - 14}" width="${nodeWidth + 30}" height="${
			height - top - 6
		}" rx="6" class="zone-box"/>`;
	}).join('');

	const anchors = new Map();
	const edges = [];
	for (const boundary of capability.boundaries) {
		const from = capability.nodes.find((node) => node.id === boundary.from);
		const to = capability.nodes.find((node) => node.id === boundary.to);
		if (!from || !to) continue;
		const forward = ZONE_ORDER.indexOf(from.zone) <= ZONE_ORDER.indexOf(to.zone);
		const x1 = forward ? zoneX[from.zone] + nodeWidth : zoneX[from.zone];
		const x2 = forward ? zoneX[to.zone] : zoneX[to.zone] + nodeWidth;
		const y1 = centreY(from);
		const y2 = centreY(to);
		const mid = (x1 + x2) / 2;
		const controls = boundary.controls ?? [];
		const label = [boundary.id, ...controls.map((control) => basename(control.ref))].join(' · ');
		const labelY = (y1 + y2) / 2 + 4;
		edges.push(
			`<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" class="edge" marker-end="url(#arrow)"/>` +
				`<text x="${mid}" y="${labelY}" class="edge-label" text-anchor="middle">${escapeHtml(
					label,
				).slice(0, 58)}</text>`,
		);
	}

	const boxes = capability.nodes.map((node) => {
		const index = byZone.get(node.zone).indexOf(node);
		const x = zoneX[node.zone];
		const y = top + index * (nodeHeight + nodeGap);
		anchors.set(node.id, { x, y });
		const assets = (node.assets ?? []).join(', ');
		return `<g><rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="6" class="node node-${node.zone}"/>
      <text x="${x + 12}" y="${y + 22}" class="node-title">${escapeHtml(node.label).slice(0, 34)}</text>
      <text x="${x + 12}" y="${y + 40}" class="node-id">${escapeHtml(node.id)}</text>
      <text x="${x + 12}" y="${y + 58}" class="node-assets">assets: ${escapeHtml(assets).slice(0, 40) || '—'}</text>
      ${node.source ? `<text x="${x + 12}" y="${y + 74}" class="node-source">${escapeHtml(node.source)}</text>` : ''}</g>`;
	});

	return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="trust boundaries of ${escapeHtml(
		capability.id,
	)}" class="diagram">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head" />
    </marker>
  </defs>
  ${zoneHeaders}
  ${edges.join('\n  ')}
  ${boxes.join('\n  ')}
</svg>`;
}

function basename(path) {
	const parts = String(path).split('/');
	return parts[parts.length - 1];
}

const STATUS_LABEL = { covered: 'covered', uncovered: 'uncovered' };

/**
 * Render the review page: the diagram, the ledger, the review questions
 * and the false-green probe.
 *
 * Deterministic — the same working tree renders byte-identical HTML
 * except for the `source sha` line the caller supplies, so the committed
 * artefact is regenerable from a clean checkout without a browser.
 */
export function renderReport({ manifest, result, probes = [], sourceSha = 'unknown' }) {
	const verdict = result.errors.length === 0 ? 'PASS' : 'FAIL';
	const diagramCapability =
		result.capabilities.find((row) => row.id === manifest?.diagram_capability) ?? null;

	const diagramBlock = diagramCapability
		? `<h2>trust boundary diagram — ${escapeHtml(diagramCapability.title)} (<code>${escapeHtml(
				diagramCapability.id,
			)}</code>)</h2>
    <p class="sub">zone ごとに node を並べ、宣言された trust boundary を矢印で結んだもの。矢印のラベルは boundary id と、その境界にある control の file 名。座標は manifest から機械的に決めたもので、手で置いた位置はない。</p>
    ${renderDiagram(diagramCapability)}
    <div class="diagram-note">
      <div><b>owner</b> ${escapeHtml(diagramCapability.owner)}</div>
      <div><b>authority</b> ${escapeHtml(diagramCapability.summary)}</div>
      <div><b>doc</b> <code>${escapeHtml(diagramCapability.documentation)}</code></div>
    </div>`
		: '<h2>trust boundary diagram</h2><p class="sub">manifest.diagram_capability が解決できなかったため描いていない。</p>';

	// The diagram capability gets the full threat table and its review
	// questions — that is the one feature unit Issue #479 asks to be
	// expressed as a diagram and review items. Every other capability is
	// carried as a compact roster row: the complete per-threat record is
	// the committed manifest itself, and the page stays a review page
	// rather than a dump of all 28 scenarios.
	const detailRows = (diagramCapability?.threats ?? []).map(
		(threat) => `<tr>
      <td class="id"><code>${escapeHtml(threat.id)}</code><div class="muted">${escapeHtml(
				threat.stride,
			)}</div></td>
      <td>${escapeHtml(threat.scenario)}${
				threat.follow_up
					? `<div class="muted">follow-up: ${escapeHtml(threat.follow_up)}</div>`
					: ''
			}</td>
      <td class="asset"><code>${escapeHtml(threat.asset)}</code></td>
      <td class="mit"><ul>${threat.mitigations
				.map(
					(mitigation) =>
						`<li><code>${escapeHtml(basename(mitigation.ref))}</code> <span class="chip ${escapeHtml(
							mitigation.state,
						)}">${escapeHtml(mitigation.state)}</span></li>`,
				)
				.join('')}</ul></td>
      <td><span class="mark ${escapeHtml(threat.status)}">${STATUS_LABEL[threat.status]}</span></td>
    </tr>`,
	);

	const rosterRows = result.capabilities
		.filter((capability) => capability.id !== diagramCapability?.id)
		.map(
			(capability) => `<tr>
      <td class="id"><code>${escapeHtml(capability.id)}</code><div class="muted">${escapeHtml(
				capability.title,
			)}</div></td>
      <td><span class="chip">${escapeHtml(capability.status)}</span></td>
      <td class="counts-cell">${capability.assets.length} / ${capability.nodes.length} / ${
				capability.boundaries.length
			} / ${capability.threats.length}</td>
      <td class="mit"><ul>${capability.threats
				.map(
					(threat) =>
						`<li><code>${escapeHtml(threat.stride)}</code> → <code>${escapeHtml(
							threat.asset,
						)}</code> <span class="mark ${escapeHtml(threat.status)}">${STATUS_LABEL[threat.status]}</span></li>`,
				)
				.join('')}</ul></td>
      <td class="mit">${capability.review_items.length}</td>
    </tr>`,
		)
		.join('\n');

	const probeBlocks = probes
		.map((probe) => {
			const probeVerdict = probe.errors.length === 0 ? 'PASS' : 'FAIL';
			const detail =
				probe.errors.length === 0
					? '<p class="none">no error — every claim in this fixture points at a file the fixture declares.</p>'
					: `<ul class="errors">${probe.errors
							.slice(0, 4)
							.map((error) => `<li><code>${escapeHtml(error)}</code></li>`)
							.join(
								'',
							)}</ul>${probe.errors.length > 4 ? `<p class="muted">… and ${probe.errors.length - 4} more</p>` : ''}`;
			return `<div class="probe">
      <div class="probe-head"><span class="mark ${probeVerdict.toLowerCase()}">${probeVerdict}</span>
        <code>quality/fixtures/threat-model/${escapeHtml(probe.name)}.json</code></div>
      <div class="muted">${escapeHtml(probe.note ?? '')}</div>
      ${detail}
    </div>`;
		})
		.join('\n');

	const errorBlock =
		result.errors.length === 0
			? ''
			: `<h2>gate errors (${result.errors.length})</h2><ul class="errors">${result.errors
					.map((error) => `<li><code>${escapeHtml(error)}</code></li>`)
					.join('')}</ul>`;
	const warningBlock =
		result.warnings.length === 0
			? ''
			: `<h2>warnings (${result.warnings.length})</h2><ul class="warnings">${result.warnings
					.map((warning) => `<li><code>${escapeHtml(warning)}</code></li>`)
					.join('')}</ul>`;

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>per-capability threat model ledger — Issue #479</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 18px; background: #fbfbf9; color: #14140f;
         font: 11.5px/1.4 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 12px; margin: 12px 0 3px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  .sub { margin: 0 0 8px; font-size: 11.5px; color: #3d3d33; max-width: 1150px; }
  .cards { display: flex; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 6px 14px; min-width: 96px; }
  .card .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 21px; font-weight: 600; }
  .ok { color: #1c6b3a; } .ng { color: #a12020; } .warn { color: #8a6d1f; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .muted { color: #77776a; font-size: 10.5px; }
  .chip { font-size: 10px; border: 1px solid #dedcd2; padding: 0 4px; margin-left: 4px; color: #5a5a4e; }
  .chip.implemented { background: #e8f3ec; border-color: #b8d8c4; }
  .chip.planned { background: #f6f0dd; border-color: #ded0a2; }
  .mark { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  .mark.pass, .mark.covered { color: #1c6b3a; } .mark.fail, .mark.uncovered { color: #a12020; }
  .diagram { display: block; background: #fff; border: 1px solid #dedcd2; max-width: 100%; height: auto; }
  .diagram .zone-box { fill: #f7f6f0; stroke: #e4e2d6; }
  .diagram .zone { font: 600 13px ui-monospace, Menlo, monospace; fill: #5a5a4e; letter-spacing: 0.08em; }
  .diagram .zone-sub { font: 9px system-ui, sans-serif; fill: #8b8b7d; }
  .diagram .edge { fill: none; stroke: #4a5a6a; stroke-width: 1.4; }
  .diagram .arrow-head { fill: #4a5a6a; }
  .diagram .edge-label { font: 8.5px ui-monospace, Menlo, monospace; fill: #3d3d33; }
  .diagram .node { fill: #fff; stroke: #c9c7b8; stroke-width: 1.2; }
  .diagram .node-untrusted { stroke: #c98a8a; } .diagram .node-trusted { stroke: #8fb59a; }
  .diagram .node-boundary { stroke: #6f7f9a; stroke-width: 1.6; }
  .diagram .node-title { font: 600 11px system-ui, sans-serif; fill: #14140f; }
  .diagram .node-id { font: 9px ui-monospace, Menlo, monospace; fill: #6a6a5c; }
  .diagram .node-assets { font: 9px system-ui, sans-serif; fill: #3d3d33; }
  .diagram .node-source { font: 8.5px ui-monospace, Menlo, monospace; fill: #8b8b7d; }
  .diagram-note { display: flex; gap: 18px; margin: 6px 0 0; font-size: 11px; color: #3d3d33; }
  .cap { border: 1px solid #dedcd2; background: #fff; padding: 6px 10px; margin-bottom: 8px; }
  .cap-head { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
  .cap-head .title { font-weight: 600; }
  .counts { color: #77776a; font-size: 10.5px; margin: 2px 0 4px; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 2px 6px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  td.id { width: 150px; } td.asset { width: 130px; } td.mit { width: 210px; } td:last-child { width: 78px; }
  td.counts-cell { width: 90px; }
  tr:last-child td:last-child { width: auto; }
  td.mit ul { margin: 0; padding-left: 14px; }
  .review { margin-top: 4px; font-size: 11px; }
  .review ol { margin: 2px 0 0; padding-left: 18px; }
  .probe { border: 1px solid #dedcd2; background: #fff; padding: 5px 10px; margin-bottom: 6px; }
  .probe-head { font-size: 11.5px; }
  ul { margin: 4px 0 0; padding-left: 16px; }
  ul.errors li { color: #a12020; margin-bottom: 2px; }
  ul.warnings li { color: #8a6d1f; margin-bottom: 2px; }
  p.none { color: #1c6b3a; margin: 3px 0 0; }
  footer { margin-top: 14px; color: #77776a; font-size: 11px; max-width: 1150px; }
</style>
</head>
<body>
  <h1>per-capability threat model ledger</h1>
  <p class="sub">
    機能単位ごとの資産と trust boundary。主張はすべて repository に実在する file か binding の
    <em>名前</em> 指す。secret 値・binding 値・本番 credential はこの ledger に現れない
    （<code>quality/threat-model.json</code>, schema v${escapeHtml(manifest?.version ?? '?')}）。
    ${escapeHtml(manifest?.policy ?? '')}
  </p>

  <div class="cards">
    <div class="card"><div class="k">verdict</div><div class="v ${verdict === 'PASS' ? 'ok' : 'ng'}">${verdict}</div></div>
    <div class="card"><div class="k">capabilities</div><div class="v">${result.summary.capabilities}</div></div>
    <div class="card"><div class="k">assets</div><div class="v">${result.summary.assets}</div></div>
    <div class="card"><div class="k">boundaries</div><div class="v">${result.summary.boundaries}</div></div>
    <div class="card"><div class="k">covered</div><div class="v ok">${result.summary.covered}</div></div>
    <div class="card"><div class="k">uncovered</div><div class="v ${result.summary.uncovered === 0 ? 'ok' : 'ng'}">${result.summary.uncovered}</div></div>
    <div class="card"><div class="k">errors</div><div class="v ${result.errors.length === 0 ? 'ok' : 'ng'}">${result.errors.length}</div></div>
    <div class="card"><div class="k">source sha</div><div class="v" style="font-size:15px">${escapeHtml(sourceSha)}</div></div>
  </div>

  ${diagramBlock}

  <h2>feature unit in full — <code>${escapeHtml(diagramCapability?.id ?? '—')}</code></h2>
  <p class="sub">Issue #479 の「独立した 1 機能」。threat / STRIDE / 対象 asset / mitigation とその状態 / 判定の順。状態は <code>implemented</code> が「その file が repository に実在し、既に效力がある」ことを、<code>planned</code> が「まだ無い」ことを表す。</p>
  <table>
    <thead><tr><th>threat · STRIDE</th><th>scenario</th><th>asset</th><th>mitigation</th><th>state</th></tr></thead>
    <tbody>${detailRows.join('\n')}</tbody>
  </table>
  <div class="review"><b>review items — reviewer がこの capability に対して問うこと</b>
    <ol>${(diagramCapability?.review_items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>
  </div>

  <h2>roster — remaining ${result.capabilities.length - 1} feature units</h2>
  <p class="sub">数値は assets / nodes / boundaries / threats。threat 列は STRIDE → 対象 asset → 判定。threat ごとの scenario と mitigation の全文は committed manifest（<code>quality/threat-model.json</code>）が正であり、この page は review 用。</p>
  <table>
    <thead><tr><th>capability</th><th>status</th><th>a / n / b / t</th><th>threats</th><th>review</th></tr></thead>
    <tbody>${rosterRows}</tbody>
  </table>

  <h2>false-green probe — 4 fixture を同じ評価関数に通した結果</h2>
  <p class="sub">「実在しない file を mitigation に書いた」「live capability に未対応 threat」「credential 形の値を書いた」fixture はすべて FAIL になる。error 文面に値そのものは出ない。</p>
  ${probeBlocks}

  <h2>観測と修復手順</h2>
  <table>
    <thead><tr><th>観測</th><th>意味</th><th>修復</th></tr></thead>
    <tbody>
      <tr><td>verdict PASS / uncovered 0</td><td>全 feature unit の threat に実在する mitigation がある。図は manifest から描かれている。</td><td>—（更新時は同じ手順）</td></tr>
      <tr><td><code>does not exist on disk</code></td><td>mitigation / control が実在しない file を ref にしている（未実装の対策）。</td><td>その file を実装する。対策を書かないまま threat を消すのではなく、まず <code>implemented</code> を作る。</td></tr>
      <tr><td><code>source_of_truth: must be a path …</code></td><td>資産の source が無い、または値されている。</td><td>実在する path か <code>SCREAMING_SNAKE</code> の binding <em>名前</em> に書き換える。値を台帳に書いてはならない。</td></tr>
      <tr><td><code>credential-shaped string</code></td><td>台帳に credential 形の値が混入した。error には JSON pointer だけが出る。</td><td>その pointer の値を削除する。値の置換・ローテーションは release runbook の担当であり、この gate は値に触れない。ファイル全体の secret 診断は <code>pnpm run secret:scan</code> の担当。</td></tr>
      <tr><td><code>a live capability may not carry an uncovered threat</code></td><td>出荷済 capability に対策が無い threat がある。</td><td>対策を <code>implemented</code> にする。実装がまだなら capability を <code>planned</code> / <code>deferred</code> に降ろす（protected capability の降ろしは owner decision）。</td></tr>
      <tr><td><code>unaccounted security-family command</code>（warning）</td><td>release が実行する検査のうち、threat が引用していない gate がある。</td><td>その gate を registry に追加して引用するか、security-family ではないと明記する。</td></tr>
    </tbody>
  </table>
  <p class="sub">gate 自身を弱めて緑にする方法（guard を空にする・<code>protected_capabilities</code> を消す・<code>planned</code> を <code>implemented</code> に書き換える）は、いずれも別の fixture が FAIL になる。</p>

  ${errorBlock}
  ${warningBlock}

  <footer>
    my-web-2026 · Issue #479 · regenerate with <code>pnpm run threat:model:report</code> ·
    rendered from the working tree only (no browser, no network, no Worker, no binding, no secret) ·
    committed as <code>docs/verification/security/threat-model-diagram.webp</code> ·
    contract: <code>docs/verification/security/threat-model.md</code>.
  </footer>
</body>
</html>
`;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
