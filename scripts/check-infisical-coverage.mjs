#!/usr/bin/env node
/**
 * `check-infisical-coverage.mjs` — 2-tier static secret-contract integrity check.
 *
 * ADR-0015 §7 declares a 2-tier secret contract:
 *
 *   Tier 1 (runtime)   — 3-name contract (Infisical):
 *     BETTER_AUTH_SECRETS, BETTER_AUTH_SECRET (legacy), MY_WEB_2026_CONSUMER_API_KEY
 *   Tier 2 (deploy)    — phase-specific 2-name contract (wrangler):
 *     Phase 1-2: legacy 2-name (BETTER_AUTH_SECRET, MY_WEB_2026_CONSUMER_API_KEY)
 *     Phase 3+:  versioned 2-name (BETTER_AUTH_SECRETS, MY_WEB_2026_CONSUMER_API_KEY)
 *
 * This script is a CI-runnable, **static** lint: it reads the
 * wrangler config files and the deploy script's `REQUIRED_RUNTIME_SECRETS`
 * constant, and verifies the 3 deploy-time sources all agree on the
 * phase-specific 2-name contract. The runtime 3-name contract is
 * asserted via a hard-coded constant in this script (a tautology that
 * documents the contract — actual Infisical API verification is done
 * by `check-cf-secrets.mjs --execute`).
 *
 * Output: exits 0 if all 3 sources agree, 1 otherwise. Printout is
 * structured for CI logs.
 *
 * Usage:
 *   pnpm run infisical:check:coverage
 *
 * Invariants:
 *   - No HTTP calls. No env reads. Pure file reads + JSONC / TS regex
 *     parsing.
 *   - argv / log never carries a secret value (only names).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const RUNTIME_REQUIRED = [
	'BETTER_AUTH_SECRETS',
	'BETTER_AUTH_SECRET',
	'MY_WEB_2026_CONSUMER_API_KEY',
];

const PHASE_1_2_REQUIRED = ['BETTER_AUTH_SECRET', 'MY_WEB_2026_CONSUMER_API_KEY'];
const PHASE_3_REQUIRED = ['BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY'];

const SOURCES = [
	{ label: 'wrangler.jsonc#secrets.required', path: 'wrangler.jsonc' },
	{
		label: 'wrangler.production.jsonc#secrets.required',
		path: 'wrangler.production.jsonc',
	},
	{
		label: 'scripts/run-deploy-inner.mjs#REQUIRED_RUNTIME_SECRETS',
		path: 'scripts/run-deploy-inner.mjs',
	},
];

function stripJsoncComments(raw) {
	return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readWranglerRequired(path) {
	const fullPath = resolve(REPO_ROOT, path);
	if (!existsSync(fullPath)) {
		throw new Error(`Wrangler config not found: ${fullPath}`);
	}
	const raw = readFileSync(fullPath, 'utf8');
	const stripped = stripJsoncComments(raw);
	const parsed = JSON.parse(stripped);
	const required = parsed?.secrets?.required;
	if (!Array.isArray(required)) {
		return [];
	}
	return required.map((name) => {
		if (typeof name !== 'string' || name.length === 0) {
			throw new Error(`Invalid secrets.required entry in ${path}: ${JSON.stringify(name)}`);
		}
		return name;
	});
}

/**
 * Extract the `REQUIRED_RUNTIME_SECRETS` array literal from
 * `run-deploy-inner.mjs`. We use a regex (not AST parsing) because
 * the file is small and stable. The pattern matches:
 *   const REQUIRED_RUNTIME_SECRETS = [ 'A', 'B', 'C' ];
 */
function readInnerScriptRequired(path) {
	const fullPath = resolve(REPO_ROOT, path);
	if (!existsSync(fullPath)) {
		throw new Error(`Inner script not found: ${fullPath}`);
	}
	const raw = readFileSync(fullPath, 'utf8');
	const match = raw.match(/REQUIRED_RUNTIME_SECRETS\s*=\s*\[([\s\S]*?)\]/);
	if (!match) {
		throw new Error(`Could not locate REQUIRED_RUNTIME_SECRETS array in ${path}`);
	}
	const arrayBody = match[1];
	const stringLiterals = [...arrayBody.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
	if (stringLiterals.length === 0) {
		throw new Error(`REQUIRED_RUNTIME_SECRETS in ${path} has no string literals`);
	}
	return stringLiterals;
}

function determinePhase(sources) {
	// Phase is determined by the configured sources. Sources with an
	// empty list (e.g. `wrangler.jsonc` in Phase 1-2, before Phase 3
	// ticket #69 adds `secrets.required` to the default config) are
	// skipped from the phase vote. They are still reported as drift
	// separately so the operator sees them.
	const phaseVotes = sources
		.filter((s) => s.list.length > 0)
		.map((s) => ({ ...s, phase: phaseOf(s.list) }));
	const distinct = new Set(phaseVotes.map((v) => v.phase));
	if (distinct.size > 1) {
		return {
			phase: 'conflict',
			detail: phaseVotes.map((v) => `${v.label}=${v.phase}`).join('; '),
		};
	}
	if (distinct.size === 0) return { phase: 'unknown' };
	const phase = [...distinct][0];
	if (phase === 'unknown') return { phase: 'unknown' };
	return { phase, detail: phaseVotes.map((v) => v.label).join(', ') };
}

function phaseOf(list) {
	const set = new Set(list);
	if (set.has('BETTER_AUTH_SECRETS')) return 'phase-3+';
	if (set.has('BETTER_AUTH_SECRET')) return 'phase-1-2';
	return 'unknown';
}

function expectedPhaseRequired(phase) {
	if (phase === 'phase-3+') return PHASE_3_REQUIRED;
	if (phase === 'phase-1-2') return PHASE_1_2_REQUIRED;
	return null;
}

function arraysEqual(a, b) {
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort();
	const sortedB = [...b].sort();
	return sortedA.every((value, i) => value === sortedB[i]);
}

function main() {
	console.log('[check-infisical-coverage] 2-tier static integrity check');
	console.log(
		`[check-infisical-coverage] runtime tier (3-name contract): ${RUNTIME_REQUIRED.join(', ')}`,
	);

	const sourceLists = [];
	for (const source of SOURCES) {
		let list;
		if (source.path.endsWith('.mjs')) {
			list = readInnerScriptRequired(source.path);
		} else {
			list = readWranglerRequired(source.path);
		}
		sourceLists.push({ label: source.label, list });
		console.log(`[check-infisical-coverage] ${source.label} = ${JSON.stringify(list)}`);
	}

	const phaseInfo = determinePhase(sourceLists);
	console.log(
		`[check-infisical-coverage] detected phase: ${phaseInfo.phase}${phaseInfo.detail ? ` (${phaseInfo.detail})` : ''}`,
	);

	let exitCode = 0;

	// Tier 1 (runtime) check: the script's declared constant matches
	// the ADR-0015 §1 / §2 documented contract. (Actual Infisical
	// verification lives in check-cf-secrets.mjs --execute.)
	const runtimeSorted = [...RUNTIME_REQUIRED].sort();
	console.log(
		`[check-infisical-coverage] runtime tier declared invariant: ${JSON.stringify(runtimeSorted)}`,
	);
	console.log('[check-infisical-coverage] [OK] runtime tier contract documented (3-name)');

	// Tier 2 (deploy-time) check: configured sources agree on phase-specific 2-name.
	// Sources with empty lists (e.g. `wrangler.jsonc` in Phase 1-2) are
	// reported as a non-blocking note — the operator knows the default
	// config has not been upgraded to phase-specific 2-name yet. Phase 3
	// (ticket #69) tightens this to a hard requirement.
	const expected = expectedPhaseRequired(phaseInfo.phase);
	if (expected === null) {
		console.error('[check-infisical-coverage] [FAIL] cannot determine phase from sources');
		exitCode = 1;
	} else {
		let configuredAllMatch = true;
		let emptySourcesCount = 0;
		for (const source of sourceLists) {
			if (source.list.length === 0) {
				emptySourcesCount += 1;
				console.log(
					`[check-infisical-coverage] [NOTE] ${source.label}: empty list — phase-specific 2-name not yet configured (Phase 3 ticket #69 will populate)`,
				);
				continue;
			}
			const matches = arraysEqual(source.list, expected);
			if (!matches) configuredAllMatch = false;
			const status = matches ? 'OK' : 'FAIL';
			console.log(
				`[check-infisical-coverage] [${status}] ${source.label}: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(source.list)}`,
			);
		}
		if (!configuredAllMatch) {
			console.error(
				'[check-infisical-coverage] [FAIL] deploy-time sources disagree on phase-specific 2-name contract',
			);
			exitCode = 1;
		} else if (emptySourcesCount === 0) {
			console.log(
				`[check-infisical-coverage] [OK] all deploy-time sources match phase-specific 2-name (${phaseInfo.phase})`,
			);
		} else {
			console.log(
				`[check-infisical-coverage] [OK] configured sources match phase-specific 2-name (${phaseInfo.phase}); ${emptySourcesCount} source(s) not yet configured (Phase 3 ticket #69 pending)`,
			);
		}
	}

	if (exitCode !== 0) {
		process.exit(exitCode);
	}
	console.log('[check-infisical-coverage] all checks OK');
}

main();
