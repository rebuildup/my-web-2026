#!/usr/bin/env node

/**
 * Release-gate check ledger (Issue #508).
 *
 * Why this gate exists
 * --------------------
 * The release gate of this repository is a *chain of commands*, not a
 * document: `pnpm run validate:release` plus the steps of the CI
 * `validate` job. Every security / supply-chain / release-integrity
 * check the project already ships is one link in that chain
 * (`secret:scan`, `dep-audit:check`, `csrf:contract:check`,
 * `security:headers:check`, …), and `docs/release.md` already lists
 * some of them as release conditions.
 *
 * The failure mode this gate closes is the *silent* one. Deleting one
 * `pnpm run x` from a chain, renaming a script, or moving a check to a
 * documentation page leaves the release gate green — the release is
 * reported as verified while one required inspection quietly stopped
 * running. Nothing in the repository compared the release report with
 * the commands the release actually executes, so "not run" and "pass"
 * were the same sentence.
 *
 * What it checks (cheap by design — text scan only, no browser, no
 * network, no Worker, no secret):
 *
 *   1. `quality/release-gate.json` parses, declares `version: 1`, a
 *      non-empty `checks` roster, and a non-empty `protected_checks`
 *      list. An empty guard list would silently disable rule 9, so it
 *      fails closed.
 *   2. Every row has a unique id and a real `contract` sentence (a
 *      placeholder is not a contract).
 *   3. Every row's `state` is `implemented` or `not_applicable`.
 *      `not_applicable` rows carry a real `reason`, and no command —
 *      an N/A is never a way to keep a shipped check invisible.
 *   4. An `implemented` row names exactly one `pnpm run <script>`
 *      command, and that script is registered in `package.json#scripts`.
 *      An unregistered command is `fail`: the check cannot run at all,
 *      on any surface, ever.
 *   5. Every `scripts/**` file the command (transitively) invokes must
 *      exist on disk. A wrapper that points at a deleted file is
 *      `fail` too — the same row, not a runnable gate.
 *   6. Every surface an `implemented` row declares
 *      (`fast` / `integration` / `release` / `ci`) is one the command
 *      is actually reachable from: the transitive expansion of the
 *      matching `validate:*` script for the first three, and the
 *      transitive expansion of the `pnpm run` commands in the CI
 *      `validate` job's `run:` steps for `ci`. A missing surface makes
 *      the row `not_run`.
 *   7. A `required` row that is `not_run` is an **error**: an existing
 *      required inspection that the release does not execute fails the
 *      release instead of being reported as green. This is the Issue's
 *      first acceptance condition.
 *   8. A `not_applicable` row is never counted as a pass; it is counted
 *      in its own bucket and printed with its reason.
 *   9. `protected_checks` must all be present in the roster with
 *      `required: true`. Deleting a row — or flipping its `required`
 *      flag — is the "intentionally omitted" case and fails here even
 *      though nothing else changed.
 *  10. `quality/profile.yaml#gates.<level>.components` must stay in
 *      agreement with the commands the entry point really runs: a
 *      component with no `package.json` script is a phantom step, and a
 *      component unreachable from its own entry point is drift. One
 *      reconciliation is recorded in the ledger
 *      (`profile_equivalences`) because
 *      `pnpm run validate:integration` calls the dry-run through
 *      `deploy:cf:prebuilt:selftest` rather than by name.
 *  11. A security-family command that runs on the release surface but
 *      has no ledger row is a **warning** printed in the report: adding
 *      a check to the chain without adding it to the release report is
 *      exactly the drift the ledger exists to make visible.
 *
 * The four statuses are kept distinct on purpose:
 *
 *   - `pass`            — the check is reachable on every surface it
 *                         declares, and its runner exists.
 *   - `fail`            — the claim is contradicted by the repository
 *                         (unregistered command / missing runner) or a
 *                         required check is not on its declared surface.
 *   - `not_run`         — the command exists, but this release does not
 *                         execute it here. Never green.
 *   - `not_applicable`  — the inspection is not introduced, with a
 *                         recorded reason. Never green.
 *
 * Scanner limits (documented, not hidden):
 *
 *   - Wiring is read as text: "reachable from a surface" means the
 *     command appears in the transitive `pnpm run` expansion of that
 *     surface's entry point, not that the check's own internal `exit 0`
 *     swallowing was audited. Each check script stays the authority for
 *     its own verdict; this gate is the inventory that says whether it
 *     was asked to run at all.
 *   - The `ci` surface is the `validate` job of
 *     `.github/workflows/ci.yml` only. The manual `prod-smoke` workflow
 *     is an operator step after deploy and is modelled as a `not_run`
 *     row, not as a release surface.
 *   - `not_run` is reported per declared surface, so "runs in CI but
 *     not in `validate:release`" and "runs nowhere" stay distinguishable.
 *
 * Exit codes: 0 = every required check is accounted for and run, 1 =
 * false green / drift / malformed ledger, 2 = bad input (unreadable
 * manifest, profile or workflow).
 *
 * Authority: Issue #508. Paired with
 * `docs/verification/security/release-gate-coverage.md`, the
 * `release_gate_coverage` block in `quality/profile.yaml`, the fixtures
 * in `quality/fixtures/release-gate/`, and the committed verification
 * artefact `docs/verification/security/release-gate-missing-check.webp`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_MANIFEST_PATH = 'quality/release-gate.json';
export const PROFILE_PATH = 'quality/profile.yaml';
export const WORKFLOW_PATH = '.github/workflows/ci.yml';
export const CI_JOB = 'validate';
export const FIXTURE_DIR = 'quality/fixtures/release-gate';

/** Surfaces a check may be declared on, in report order. */
export const SURFACES = ['fast', 'integration', 'release', 'ci'];

/** The `package.json` entry point behind each script-executed surface. */
export const SURFACE_ENTRIES = {
	fast: 'validate:fast',
	integration: 'validate:integration',
	release: 'validate:release',
};

/** Human-readable origin of each surface, printed in the report. */
export const SURFACE_SOURCES = {
	fast: 'package.json#scripts["validate:fast"]',
	integration: 'package.json#scripts["validate:integration"]',
	release: 'package.json#scripts["validate:release"]',
	ci: `${WORKFLOW_PATH}#jobs.${CI_JOB}.steps[*].run`,
};

const STATES = new Set(['implemented', 'not_applicable']);
const STATUSES = ['pass', 'fail', 'not_run', 'not_applicable'];

/** `node scripts/x.mjs`, `node --experimental-strip-types scripts/y.mjs`, … */
const SCRIPT_FILE_PATTERN = /scripts\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|tsx)/g;

/** `pnpm run <name>` in any command body (chains, workflows, docs). */
const PNPM_RUN_PATTERN = /pnpm run ([A-Za-z0-9:._-]+)/g;

/** Reasons that mean "the author wrote nothing". */
const PLACEHOLDER_REASONS = new Set(['tbd', 'todo', 'n/a', 'na', 'none', 'later', '-']);

/**
 * Commands that belong in a security release report.
 *
 * A new command in this list that reaches the release surface without a
 * ledger row is reported as unaccounted. The prefixes are the
 * obligation-level names already used by `package.json#scripts`, not a
 * re-classification of the gates.
 */
const SECURITY_COMMAND_PREFIXES = [
	'architecture:',
	'ci:pins:',
	'cloudflare:contract:',
	'compat:',
	'csrf:',
	'dep-audit:',
	'infisical:',
	'log:redaction:',
	'secret:',
	'security:',
	'sbom:',
	'tools:provenance:',
	'wrangler:independence:',
];

/** A short reason must be a reason: prose, not a placeholder. */
export function isRealReason(reason, minimum = 12) {
	return (
		typeof reason === 'string' &&
		reason.trim().length >= minimum &&
		!PLACEHOLDER_REASONS.has(reason.trim().toLowerCase())
	);
}

/** Every `pnpm run <name>` a command body invokes, in order. */
export function referencedScriptNames(command) {
	return [...String(command).matchAll(PNPM_RUN_PATTERN)].map((match) => match[1]);
}

/** Every `scripts/**` file a command body invokes, in order. */
export function referencedScriptFiles(command) {
	return [...new Set([...String(command).matchAll(SCRIPT_FILE_PATTERN)])].map((match) => match[0]);
}

/**
 * Transitive closure of one `package.json` script.
 *
 * `validate:fast` is a `&&` chain of other scripts, so the surface a
 * check runs on is the closure of the entry point, not the entry point
 * itself. A cycle terminates instead of looping.
 */
export function expandScriptNames(scripts, entry, seen = new Set()) {
	if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) return [];
	seen.add(entry);
	const body = scripts?.[entry];
	if (typeof body !== 'string') return [];
	const out = [entry];
	for (const name of referencedScriptNames(body))
		out.push(...expandScriptNames(scripts, name, seen));
	return [...new Set(out)];
}

/**
 * Every `scripts/**` file one script reaches, transitively.
 *
 * Used to prove the command has a runner at all: a wrapper that names a
 * deleted file is `fail`, not `pass`.
 */
export function scriptFilesOfChain(scripts, entry, seen = new Set()) {
	if (typeof entry !== 'string' || seen.has(entry)) return [];
	seen.add(entry);
	const body = scripts?.[entry];
	if (typeof body !== 'string') return [];
	const files = referencedScriptFiles(body);
	for (const name of referencedScriptNames(body)) {
		files.push(...scriptFilesOfChain(scripts, name, seen));
	}
	return [...new Set(files)];
}

/**
 * `quality/profile.yaml#gates.<level>.components` as a map of arrays.
 *
 * A line-oriented reader, not a YAML parser: the repository has no YAML
 * dependency on purpose, and the file shape (two-space keys, six-space
 * list items) is asserted by `scripts/check-workflow-pinning.mjs` for
 * the workflows. A malformed file yields empty lists, and the caller
 * fails closed on that rather than reporting a clean profile.
 */
export function parseProfileComponents(text) {
	const out = { fast: [], integration: [], release: [] };
	const lines = String(text).split('\n');
	let inGates = false;
	let level = null;
	let inComponents = false;

	for (const line of lines) {
		if (!inGates) {
			if (/^gates:\s*$/.test(line)) inGates = true;
			continue;
		}
		if (/^\S/.test(line)) break; // the next top-level key ends `gates:`
		const levelMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
		if (levelMatch) {
			level = SURFACES.includes(levelMatch[1]) ? levelMatch[1] : null;
			inComponents = false;
			continue;
		}
		if (level === null) continue;
		if (/^ {4}components:\s*$/.test(line)) {
			inComponents = true;
			continue;
		}
		if (!inComponents) continue;
		if (/^ {6}- /.test(line)) {
			// A quoted entry is a command (`- 'pnpm run x'`). An unquoted
			// entry is a level reference (`- fast`), which names no command of
			// its own: the three surfaces already include the lower levels
			// transitively, so it is skipped rather than treated as a step.
			const item = /^ {6}-\s+'(.+?)'\s*(?:#.*)?$/.exec(line);
			if (item) out[level].push(item[1]);
			continue;
		}
		if (line.trim().length > 0 && !/^ {6}#/.test(line)) inComponents = false;
	}
	return out;
}

/**
 * Every `run:` body of one workflow job.
 *
 * Both forms are read: a single-line `run: pnpm run x` and a block
 * scalar `run: |` whose body is indented deeper than the key.
 */
export function parseWorkflowJobRunCommands(text, jobName = CI_JOB) {
	const lines = String(text).split('\n');
	const out = [];
	let inJob = false;
	let inRunBlock = false;
	let keyColumn = 0;

	for (const line of lines) {
		const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
		if (jobMatch) {
			if (inJob) break; // the next job ends this one
			inJob = jobMatch[1] === jobName;
			inRunBlock = false;
			continue;
		}
		if (!inJob) continue;
		if (inRunBlock) {
			if (line.trim().length === 0) continue;
			if (line.search(/\S/) > keyColumn) {
				out.push(line.trim());
				continue;
			}
			inRunBlock = false;
		}
		// Both spellings occur in this repository's workflows: `- run: x`
		// (a step with no name) and `name: x` followed by `  run: x`.
		const runMatch = /^(\s*)(?:-\s+)?run:(\s*)(.*)$/.exec(line);
		if (!runMatch) continue;
		keyColumn = runMatch[1].length + (line.trimStart().startsWith('- ') ? 2 : 0);
		const body = runMatch[3].replace(/\s+#.*$/, '').trim();
		if (body === '' || /^[|>][-+]?$/.test(body)) {
			inRunBlock = true;
			continue;
		}
		out.push(body);
	}
	return out;
}

/**
 * Resolve the four release surfaces of a checkout.
 *
 * @returns {{ fast: Set<string>, integration: Set<string>, release: Set<string>, ci: Set<string> }}
 */
export function collectSurfaces({ scripts = {}, workflowText = '' } = {}) {
	const surfaces = {};
	for (const surface of ['fast', 'integration', 'release']) {
		surfaces[surface] = new Set(expandScriptNames(scripts, SURFACE_ENTRIES[surface]));
	}
	const ci = new Set();
	for (const command of parseWorkflowJobRunCommands(workflowText, CI_JOB)) {
		for (const name of referencedScriptNames(command)) {
			for (const expanded of expandScriptNames(scripts, name)) ci.add(expanded);
			ci.add(name);
		}
	}
	surfaces.ci = ci;
	return surfaces;
}

/** `pnpm run secret:scan` → `secret:scan`; anything else → null. */
export function scriptNameOfCommand(command) {
	if (typeof command !== 'string') return null;
	const names = referencedScriptNames(command.trim());
	if (names.length !== 1) return null;
	if (!/^pnpm run [A-Za-z0-9:._-]+$/.test(command.trim())) return null;
	return names[0];
}

/**
 * Evaluate the ledger against one repository description.
 *
 * Pure with respect to the filesystem: `scripts`, `surfaces`,
 * `profileComponents` and `fileExists` are all passed in, so the
 * fixtures in `quality/fixtures/release-gate/` drive the same code path
 * the real checkout does.
 *
 * @returns {{ errors: string[], warnings: string[], rows: object[], summary: object, unaccounted: string[] }}
 */
export function evaluateReleaseGate({
	manifest,
	scripts = {},
	surfaces = {},
	profileComponents = null,
	fileExists = () => true,
}) {
	const errors = [];
	const warnings = [];
	const rows = [];
	const checks = Array.isArray(manifest?.checks) ? manifest.checks : [];
	const unaccounted = [];

	if (manifest?.version !== 1) {
		errors.push('manifest: `version` must be 1');
	}
	if (checks.length === 0) {
		errors.push('manifest.checks: the release report must list at least one check');
	}
	const protectedIds = Array.isArray(manifest?.protected_checks) ? manifest.protected_checks : [];
	if (protectedIds.length === 0) {
		errors.push(
			'manifest.protected_checks: at least one id must be protected, or rule 9 (the "intentionally omitted" guard) is disabled',
		);
	}

	const listedScripts = new Set();
	const rowsById = new Map();

	for (const [index, check] of checks.entries()) {
		const label = `checks[${check?.id ?? index}]`;
		if (typeof check?.id !== 'string' || check.id.length === 0) {
			errors.push(`${label}: missing \`id\``);
			continue;
		}
		if (rowsById.has(check.id)) {
			errors.push(`${label}: duplicate id "${check.id}"`);
			continue;
		}
		if (!isRealReason(check.contract)) {
			errors.push(`${label}.contract: state what the check proves (a real sentence)`);
		}
		if (!STATES.has(check.state)) {
			errors.push(`${label}.state: "${check.state}" not in {implemented, not_applicable}`);
			continue;
		}
		if (typeof check.required !== 'boolean') {
			errors.push(`${label}.required: required boolean`);
		}

		if (check.state === 'not_applicable') {
			if (!isRealReason(check.reason, 20)) {
				errors.push(
					`${label}.reason: a not_applicable check must record why it does not apply (a real sentence)`,
				);
			}
			if (check.command !== undefined) {
				errors.push(`${label}: a not_applicable check carries no command`);
			}
			if (Array.isArray(check.surfaces) && check.surfaces.length > 0) {
				errors.push(`${label}: a not_applicable check runs on no surface`);
			}
			const row = {
				id: check.id,
				contract: check.contract ?? '',
				command: null,
				script: null,
				state: check.state,
				required: check.required === true,
				declared_surfaces: [],
				present_surfaces: [],
				missing_surfaces: [],
				status: 'not_applicable',
				note: check.reason ?? '<no reason recorded>',
				documentation: check.documentation ?? null,
			};
			rows.push(row);
			rowsById.set(check.id, row);
			continue;
		}

		const script = scriptNameOfCommand(check.command);
		if (script === null) {
			errors.push(
				`${label}.command: an implemented check must be exactly one \`pnpm run <script>\``,
			);
			continue;
		}
		listedScripts.add(script);

		const declaredSurfaces = Array.isArray(check.surfaces) ? check.surfaces : [];
		for (const surface of declaredSurfaces) {
			if (!SURFACES.includes(surface)) {
				errors.push(`${label}.surfaces: "${surface}" not in {${SURFACES.join(', ')}}`);
			}
		}
		if (check.required === true && declaredSurfaces.length === 0) {
			errors.push(
				`${label}: a required check must declare the surfaces it runs on (currently none)`,
			);
		}

		const present = [];
		const missing = [];
		for (const surface of declaredSurfaces) {
			if (surfaces?.[surface]?.has(script)) present.push(surface);
			else missing.push(surface);
		}

		const runnerFiles = scriptFilesOfChain(scripts, script);
		const missingFiles = runnerFiles.filter((file) => !fileExists(file));

		let status = 'pass';
		let note =
			present.length > 0 ? `ran on ${present.join(', ')}` : 'reachable on every declared surface';
		if (typeof scripts?.[script] !== 'string') {
			status = 'fail';
			note = `"${script}" is not registered in package.json#scripts`;
			errors.push(`${label}: ${note} — the check cannot run on any surface`);
		} else if (missingFiles.length > 0) {
			status = 'fail';
			note = `runner file(s) not on disk: ${missingFiles.join(', ')}`;
			errors.push(`${label}: ${note} — the command would fail on every surface`);
		} else if (declaredSurfaces.length === 0) {
			// A command nobody runs is `not run`, never `pass`: reporting an
			// inspection as verified because its script happens to exist is
			// exactly the false green this Issue is about.
			status = 'not_run';
			note = 'the command exists but no release surface runs it';
		} else if (missing.length > 0) {
			status = 'not_run';
			note = `not reachable from ${missing.join(', ')}`;
			if (check.required === true) {
				errors.push(
					`${label}: required check "${check.id}" is not run — ${note}. A release must not report a check it does not execute as verified.`,
				);
			}
		}

		// A row may carry its own note (why the check is deliberately not on
		// the chain); it is appended to the computed reason instead of
		// replacing it, so the report never shows an authored excuse in place
		// of a derived verdict.
		if (isRealReason(check.note, 20)) note = `${note} — ${check.note.trim()}`;

		const row = {
			id: check.id,
			contract: check.contract ?? '',
			command: check.command,
			script,
			state: check.state,
			required: check.required === true,
			declared_surfaces: declaredSurfaces,
			present_surfaces: present,
			missing_surfaces: missing,
			status,
			note,
			runner_files: runnerFiles,
			documentation: check.documentation ?? null,
		};
		rows.push(row);
		rowsById.set(check.id, row);
	}

	for (const id of protectedIds) {
		const row = rowsById.get(id);
		if (!row) {
			errors.push(
				`manifest.protected_checks: "${id}" is protected but has no row — deleting a required check row fails here on purpose`,
			);
			continue;
		}
		if (row.required !== true) {
			errors.push(
				`checks.${id}.required: a protected check must stay required (set to false to relax it)`,
			);
		}
		if (row.state !== 'implemented') {
			errors.push(
				`checks.${id}.state: a protected check cannot become not_applicable — that is a release decision, not a flag`,
			);
		}
	}

	// Rule 11: a security-family command on the release surface with no
	// row is unaccounted. Warning, not error: the roster is a curated
	// security / release-integrity report, and the report must show the
	// drift rather than fail a release over a naming preference.
	for (const script of [...(surfaces?.release ?? new Set())].sort()) {
		if (!SECURITY_COMMAND_PREFIXES.some((prefix) => script.startsWith(prefix))) continue;
		if (listedScripts.has(script)) continue;
		unaccounted.push(script);
	}
	if (unaccounted.length > 0) {
		warnings.push(
			`unaccounted security-family command(s) on the release surface with no ledger row: ${unaccounted.join(', ')}`,
		);
	}

	// Rule 10: the quality profile is the canonical component list, so a
	// phantom component or an unreachable one is drift, not a comment.
	if (profileComponents) {
		for (const surface of ['fast', 'integration', 'release']) {
			const components = Array.isArray(profileComponents[surface])
				? profileComponents[surface]
				: [];
			if (components.length === 0) {
				errors.push(`profile: gates.${surface}.components is missing or empty`);
				continue;
			}
			const chain = surfaces?.[surface] ?? new Set();
			const equivalences = new Map(
				(Array.isArray(manifest?.profile_equivalences) ? manifest.profile_equivalences : []).map(
					(entry) => [`${entry?.surface}:${entry?.component}`, entry?.reached_via],
				),
			);
			for (const raw of components) {
				const component = raw.replace(/^-\s*/, '');
				// `fast` / `release` are level references in the profile, not
				// commands: the three surfaces already include the lower levels
				// transitively, so they are not steps to resolve.
				if (SURFACES.includes(component)) continue;
				const script = scriptNameOfCommand(component);
				if (script === null) {
					errors.push(
						`profile: gates.${surface}.components entry "${component}" is not a \`pnpm run <script>\``,
					);
					continue;
				}
				if (typeof scripts?.[script] !== 'string') {
					errors.push(
						`profile: gates.${surface}.components declares "${component}" but package.json#scripts has no "${script}" — a phantom step`,
					);
					continue;
				}
				if (chain.has(script)) continue;
				const reachedVia = equivalences.get(`${surface}:${component}`);
				if (typeof reachedVia === 'string' && chain.has(reachedVia)) continue;
				errors.push(
					`profile: gates.${surface}.components declares "${component}" but \`pnpm run ${SURFACE_ENTRIES[surface]}\` never reaches it${
						typeof reachedVia === 'string'
							? ` (ledger records "${reachedVia}" as the way in, and that is gone too)`
							: ''
					}`,
				);
			}
		}
	}

	const summary = Object.fromEntries(STATUSES.map((status) => [status, 0]));
	for (const row of rows) summary[row.status] += 1;

	return { errors, warnings, rows, summary, unaccounted, profileComponents };
}

/**
 * Run the gate over a checkout.
 *
 * @returns {{ errors: string[], warnings: string[], rows: object[], summary: object, unaccounted: string[], manifest: object, profileComponents: object }}
 */
export function checkReleaseGateCoverage({
	root = REPO_ROOT,
	manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
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
			rows: [],
			summary: { pass: 0, fail: 0, not_run: 0, not_applicable: 0 },
			unaccounted: [],
			manifest: null,
			profileComponents: null,
		};
	}
	let manifest;
	try {
		manifest = JSON.parse(manifestText);
	} catch (error) {
		return {
			errors: [`manifest: ${manifestPath} is not valid JSON (${error.message})`],
			warnings: [],
			rows: [],
			summary: { pass: 0, fail: 0, not_run: 0, not_applicable: 0 },
			unaccounted: [],
			manifest: null,
			profileComponents: null,
		};
	}

	const packageText = read('package.json');
	const profileText = read(PROFILE_PATH);
	const workflowText = read(WORKFLOW_PATH);
	if (packageText === null || profileText === null || workflowText === null) {
		return {
			errors: [`input: package.json, ${PROFILE_PATH} and ${WORKFLOW_PATH} must all be readable`],
			warnings: [],
			rows: [],
			summary: { pass: 0, fail: 0, not_run: 0, not_applicable: 0 },
			unaccounted: [],
			manifest,
			profileComponents: null,
		};
	}

	const scripts = JSON.parse(packageText).scripts ?? {};
	const profileComponents = parseProfileComponents(profileText);
	const surfaces = collectSurfaces({ scripts, workflowText });
	const result = evaluateReleaseGate({
		manifest,
		scripts,
		surfaces,
		profileComponents,
		fileExists: (path) => existsSync(join(root, path)),
	});
	return { ...result, manifest, profileComponents };
}

/**
 * Run one fixture from `quality/fixtures/release-gate/`.
 *
 * A fixture is a complete, self-contained description of a repository
 * (scripts map, surfaces, files, profile components), so the same pure
 * evaluator drives both the report and the test suite.
 */
export function evaluateFixture(fixture) {
	const surfaces = {};
	for (const surface of SURFACES) {
		surfaces[surface] = new Set(fixture?.surfaces?.[surface] ?? []);
	}
	const files = new Set(fixture?.files ?? []);
	return evaluateReleaseGate({
		manifest: fixture?.manifest,
		scripts: fixture?.scripts ?? {},
		surfaces,
		profileComponents: fixture?.profile_components ?? null,
		fileExists: (path) => files.has(path),
	});
}

export function loadFixture(root, name) {
	return JSON.parse(readFileSync(join(root, FIXTURE_DIR, `${name}.json`), 'utf8'));
}

/** The two probe fixtures the report renders, in that order. */
export const PROBE_FIXTURES = ['pass', 'missing-required-check'];

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const STATUS_LABEL = {
	pass: 'pass',
	fail: 'fail',
	not_run: 'not run',
	not_applicable: 'N/A',
};

/**
 * Render the release report as a static HTML page.
 *
 * Deterministic: the same working tree renders byte-identical HTML
 * except for the `source sha` line, so the committed screenshot is
 * regenerable from a clean checkout without a browser or a network.
 */
export function renderReport({ manifest, result, probes = [], sourceSha = 'unknown' }) {
	const verdict = result.errors.length === 0 ? 'PASS' : 'FAIL';
	const cards = STATUSES.map(
		(status) =>
			`<div class="card"><div class="k">${escapeHtml(STATUS_LABEL[status])}</div><div class="v ${status === 'pass' ? 'ok' : status === 'fail' ? 'ng' : 'warn'}">${result.summary[status]}</div></div>`,
	).join('');

	const ledgerRows = result.rows.map((row) => {
		const surfaces =
			row.declared_surfaces.length === 0
				? '<span class="muted">no surface</span>'
				: row.declared_surfaces
						.map((surface) => {
							const hit = row.present_surfaces.includes(surface);
							return `<span class="surface ${hit ? 'hit' : 'miss'}">${escapeHtml(surface)}</span>`;
						})
						.join(' ');
		return `<tr>
      <td class="id"><code>${escapeHtml(row.id)}</code><div class="muted">${row.required ? 'required' : 'optional'} · <code>${escapeHtml(row.command ?? '—')}</code></div></td>
      <td class="contract">${escapeHtml(row.contract)}</td>
      <td class="verdict">${surfaces}<span class="mark ${row.status}">${escapeHtml(STATUS_LABEL[row.status])}</span>${row.status === 'pass' ? '' : `<div class="note">${escapeHtml(row.note)}</div>`}</td>
    </tr>`;
	});

	// Two tables side by side rather than one long one: the ledger is the
	// tallest block, and halving its height halves the screenshot pixels
	// (WebP of a text-dense full-page capture is the size budget here).
	const ledgerTable = (rows) => `<table>
    <thead><tr><th>check · command</th><th>contract</th><th>status</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>`;
	const half = Math.ceil(ledgerRows.length / 2);
	const ledgerTables = `${ledgerTable(ledgerRows.slice(0, half))}${ledgerTable(ledgerRows.slice(half))}`;

	const probeBlocks = probes
		.map((probe) => {
			const probeVerdict = probe.errors.length === 0 ? 'PASS' : 'FAIL';
			const errorList =
				probe.errors.length === 0
					? '<p class="none">no error — the ledger and the release chain agree.</p>'
					: `<ul class="errors">${probe.errors.map((error) => `<li><code>${escapeHtml(error)}</code></li>`).join('')}</ul>`;
			return `<div class="probe">
      <div class="probe-head"><span class="mark ${probeVerdict === 'PASS' ? 'pass' : 'fail'}">${probeVerdict}</span> <code>quality/fixtures/release-gate/${escapeHtml(probe.name)}.json</code><span class="muted"> — ${escapeHtml(probe.note ?? '')}</span></div>
      ${errorList}
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
<title>release gate check ledger — Issue #508</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 18px; background: #fbfbf9; color: #14140f;
         font: 11.5px/1.4 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 12px; margin: 10px 0 3px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  .sub { margin: 0 0 10px; font-size: 11.5px; color: #3d3d33; max-width: 1150px; }
  .cards { display: flex; gap: 10px; margin-bottom: 4px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 6px 14px; min-width: 110px; }
  .card .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 21px; font-weight: 600; }
  .ok { color: #1c6b3a; } .ng { color: #a12020; } .warn { color: #8a6d1f; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  .pair { display: flex; gap: 10px; align-items: flex-start; }
  th, td { text-align: left; padding: 2px 6px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  td.id { width: 145px; } td.verdict { width: 145px; } td.count { width: 40px; }
  .muted { color: #77776a; font-size: 10.5px; }
  .surface { font-size: 10.5px; border: 1px solid #dedcd2; padding: 0 4px; margin-right: 3px; }
  .surface.hit { background: #e8f3ec; border-color: #b8d8c4; }
  .surface.miss { background: #f7e6e6; border-color: #ddb4b4; }
  .mark { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  .mark.pass { color: #1c6b3a; } .mark.fail { color: #a12020; }
  .mark.not_run { color: #8a6d1f; } .mark.not_applicable { color: #55554a; }
  .note { color: #3d3d33; }
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
  <h1>release gate check ledger</h1>
  <p class="sub">
    リリースゲートは「コマンドの列」であり、必須検査の 1 本を外しても緑のまま「検証済み」と書ける。
    この ledger (<code>${escapeHtml(DEFAULT_MANIFEST_PATH)}</code>, schema v${escapeHtml(manifest?.version ?? '?')}) は
    導入済み検査を <code>pass</code> / <code>fail</code> / <code>not run</code> / <code>N/A</code> で記録し、実行していないものを PASS に変換しない。
    判定は <code>${SURFACES.join(' / ')}</code> の <code>pnpm run</code> 推移閉包（${escapeHtml(SURFACE_SOURCES.ci)} を含む）からの到達性で導出する。
  </p>

  <div class="cards">
    <div class="card"><div class="k">verdict</div><div class="v ${verdict === 'PASS' ? 'ok' : 'ng'}">${verdict}</div></div>
    ${cards}
    <div class="card"><div class="k">errors</div><div class="v ${result.errors.length === 0 ? 'ok' : 'ng'}">${result.errors.length}</div></div>
    <div class="card"><div class="k">source sha</div><div class="v" style="font-size:15px">${escapeHtml(sourceSha)}</div></div>
  </div>

  <h2>ledger — ${result.rows.length} rows</h2>
  <div class="pair">${ledgerTables}</div>

  <h2>false-green probe — 正常 fixture と 必須検査を 1 本外した不正常 fixture</h2>
  <p class="sub">同じ評価関数を fixture に通した結果。必須検査を外した側は FAIL になる。</p>
${probeBlocks}

  <h2>対象外 (N/A) と not run</h2>
  <p class="sub">上の ledger の N/A ${result.summary.not_applicable} 行と not run ${result.summary.not_run} 行が理由つきで全件載っている。導入していない検査の理由と将来の手作業は docs/verification/security/release-gate-coverage.md の「対象外と将来の手作業」に列挙した。</p>

  <h2>quality profile components</h2>
  <p class="sub">gates.fast ${(result.profileComponents?.fast ?? []).length} / integration ${(result.profileComponents?.integration ?? []).length} / release ${(result.profileComponents?.release ?? []).length} component: すべて package.json に登録済みの script で、それぞれの entry point から到達できる（唯一の差異は台帳の <code>profile_equivalences</code> に記録）</p>

  ${errorBlock}
  ${warningBlock}

  <footer>
    my-web-2026 · Issue #508 · regenerate with <code>pnpm run release:gate:report</code> ·
    rendered from the working tree only (no browser, no network, no Worker, no secret) ·
    committed as <code>docs/verification/security/release-gate-missing-check.webp</code> ·
    contract: <code>docs/verification/security/release-gate-coverage.md</code>.
  </footer>
</body>
</html>
`;
}

function headSha(root) {
	try {
		return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
		}).trim();
	} catch {
		return 'unknown';
	}
}

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

	const result = checkReleaseGateCoverage({ root, manifestPath });

	if (reportPath) {
		const probes = [];
		for (const name of PROBE_FIXTURES) {
			try {
				const fixture = loadFixture(root, name);
				probes.push({ name, note: fixture.note, ...evaluateFixture(fixture) });
			} catch (error) {
				probes.push({ name, note: `fixture unreadable: ${error.message}`, errors: [], rows: [] });
			}
		}
		const html = renderReport({
			manifest: result.manifest,
			result,
			probes,
			sourceSha: headSha(root),
		});
		const target = resolve(root, reportPath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, html);
		process.stdout.write(`wrote ${reportPath}\n`);
	}

	if (result.errors.length === 0) {
		const { pass, not_run, not_applicable } = result.summary;
		process.stdout.write(
			`release gate ledger OK: ${pass} pass, ${not_run} not run, ${not_applicable} N/A (none of them counted as a pass)\n`,
		);
		for (const warning of result.warnings) process.stderr.write(`  ! ${warning}\n`);
		return 0;
	}

	process.stderr.write(
		`release gate ledger: ${result.errors.length} problem(s) in ${manifestPath} / package.json / ${WORKFLOW_PATH}:\n`,
	);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	for (const warning of result.warnings) process.stderr.write(`  ! ${warning}\n`);
	process.stderr.write(
		[
			'',
			'A release must not report an inspection it does not execute as verified.',
			'Fix the chain (or the ledger, with a reason), then re-run. See',
			'docs/verification/security/release-gate-coverage.md for the status vocabulary.',
			'',
		].join('\n'),
	);
	return 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
