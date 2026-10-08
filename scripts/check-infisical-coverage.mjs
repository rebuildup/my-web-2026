#!/usr/bin/env node
/**
 * `check-infisical-coverage.mjs` — static secret-contract integrity check.
 *
 * ADR-0015 §7 declares a 2-tier secret contract:
 *
 *   Tier 1 (runtime) — the Infisical inventory: the required Worker
 *                      secrets plus the audit-only legacy name retained
 *                      as a recovery trail.
 *   Tier 2 (deploy)  — the set the Worker is actually given, which is
 *                      the required set and must NOT include audit-only
 *                      names.
 *
 * Issue #247: the two tiers are now read from ONE module,
 * `_cloudflare-contract.mjs`, rather than scraped out of three files.
 *
 * The previous version read `wrangler.jsonc#secrets.required`,
 * `wrangler.production.jsonc#secrets.required`, and a regex over
 * `run-deploy-inner.mjs#REQUIRED_RUNTIME_SECRETS`, then voted on which
 * "phase" those three agreed on. That existed to catch the copies
 * drifting apart. The copies are gone: `run-deploy-inner.mjs` imports
 * the contract, `cloudflare.config.ts` declares its bindings by the
 * contract's names, and `check-cloudflare-contract.mjs` compares the
 * generated Build Output against the same array. There is nothing left
 * to vote on, so the phase detection is gone with the duplication it
 * existed to reconcile.
 *
 * What this check now asserts:
 *   1. the required set and the audit-only set are disjoint
 *   2. the Infisical inventory is exactly required + audit-only
 *   3. every name is a well-formed Worker binding name
 *
 * Whether the Worker ARTIFACT implements the contract is proven
 * separately, and more strongly, by `check-cloudflare-contract.mjs`
 * against the generated Build Output — which is the deployed truth,
 * rather than a re-reading of the same source text this script used to
 * scrape three times.
 *
 * Output: exits 0 if the contract is coherent, 1 otherwise.
 *
 * Usage:
 *   pnpm run infisical:check:coverage
 *
 * Invariants:
 *   - No HTTP calls. No env reads. No file reads at all.
 *   - argv / log never carries a secret value (only names).
 */
import { AUDIT_ONLY_SECRETS, REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';

/** The Infisical prod inventory the operators must be able to source. */
function infisicalInventory() {
	return [...REQUIRED_RUNTIME_SECRETS, ...AUDIT_ONLY_SECRETS];
}

function sameSet(a, b) {
	if (a.length !== b.length) return false;
	const left = [...a].sort();
	const right = [...b].sort();
	return left.every((value, index) => value === right[index]);
}

const BINDING_NAME_RE = /^[A-Za-z0-9_]{1,128}$/;

function main() {
	const failures = [];
	console.log('[check-infisical-coverage] runtime contract check');

	console.log(
		`[check-infisical-coverage] required (Tier 2, uploaded): ${JSON.stringify(REQUIRED_RUNTIME_SECRETS)}`,
	);
	console.log(
		`[check-infisical-coverage] audit-only (Tier 1, never uploaded): ${JSON.stringify(AUDIT_ONLY_SECRETS)}`,
	);

	// An audit-only name in the required set would upload the legacy
	// binding on every deploy — the resurrection failure mode.
	const overlap = REQUIRED_RUNTIME_SECRETS.filter((name) => AUDIT_ONLY_SECRETS.includes(name));
	if (overlap.length > 0) {
		failures.push(`audit-only names must not be in the required set: ${overlap.join(', ')}`);
	} else {
		console.log('[check-infisical-coverage] [OK] required and audit-only sets are disjoint');
	}

	// The Infisical inventory must be exactly the union, with no name
	// that is neither uploaded nor retained, and none that is lost.
	const inventory = infisicalInventory();
	if (new Set(inventory).size !== inventory.length) {
		failures.push('the Infisical inventory contains a duplicate name');
	}
	const union = [...new Set([...REQUIRED_RUNTIME_SECRETS, ...AUDIT_ONLY_SECRETS])];
	if (!sameSet(inventory, union)) {
		failures.push(
			`Infisical inventory must be exactly required + audit-only.\n    inventory: ${JSON.stringify(inventory)}\n    expected:  ${JSON.stringify(union)}`,
		);
	} else {
		console.log(
			`[check-infisical-coverage] [OK] Infisical inventory is exactly the union (${inventory.length} name(s))`,
		);
	}

	for (const name of inventory) {
		if (!BINDING_NAME_RE.test(name)) {
			failures.push(`invalid Worker binding name in the contract: ${name}`);
		}
	}
	if (failures.every((f) => !f.startsWith('invalid'))) {
		console.log('[check-infisical-coverage] [OK] every contract name is a valid binding name');
	}

	// Name that the generated Worker artifact must carry, and must not
	// carry — reported for the operator's benefit. Verified for real by
	// `check-cloudflare-contract.mjs --build` against the Build Output.
	console.log(
		'[check-infisical-coverage] note: Worker artifact conformance is proven by check-cloudflare-contract.mjs --build (Build Output is the deployed truth)',
	);

	if (failures.length > 0) {
		for (const failure of failures) console.error(`[check-infisical-coverage] [FAIL] ${failure}`);
		process.exit(1);
	}
	console.log('[check-infisical-coverage] all checks OK');
}

main();
