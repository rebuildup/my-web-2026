#!/usr/bin/env node
/**
 * Fail-closed dependency install lifecycle script audit (Issue #474).
 *
 * Usage:
 *   node scripts/check-install-scripts.mjs [--root=<repo root>] [--json]
 *   node scripts/check-install-scripts.mjs --html=<out path>
 *
 * What it proves
 * --------------
 * 1. Every installed package that declares an install-time lifecycle
 *    hook (`preinstall` / `install` / `postinstall`) is recorded in
 *    `quality/install-scripts.json` together with the reason its build
 *    is necessary — "record only what is needed" becomes a checkable
 *    contract instead of a memory.
 * 2. The recorded decision and pnpm's execution allow-list
 *    (`pnpm-workspace.yaml#onlyBuiltDependencies` / `#allowBuilds`)
 *    agree in both directions: an "allow" that pnpm blocks is a build
 *    that silently does not run, and a "block" that pnpm allows is code
 *    that runs on every install against policy.
 * 3. No allow-list entry survives without a build to justify it, which
 *    is how unnecessary `preinstall` execution permission gets removed.
 *
 * Exit codes: 0 = audited and clean, 1 = violation(s), 2 = bad input.
 *
 * Status-only by construction: it reads package manifests plus the two
 * policy files. It never reads `.dev.vars`, Infisical, or a Worker
 * secret, and prints names, versions, hook names and policy text only.
 * See docs/runbook/install-script-audit.md.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	auditInstallScripts,
	collectInstalledManifests,
	formatTextReport,
	parsePolicy,
	readPackageManifest,
	readPnpmAllowlist,
	renderHtmlReport,
} from './_install-scripts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(here, '..');

const POLICY_RELATIVE_PATH = 'quality/install-scripts.json';
const ALLOWLIST_RELATIVE_PATH = 'pnpm-workspace.yaml';

export const REMEDY_TEXT = [
	'Remedy: every install-time lifecycle script is a decision, not an accident.',
	'  1. Read the recorded hook in the installed package manifest and decide whether the build is actually needed.',
	'  2. Record the decision + justification in quality/install-scripts.json (add an entry for an unreviewed package,',
	'     or set "decision": "block" when the build is unnecessary).',
	'  3. Keep pnpm-workspace.yaml#onlyBuiltDependencies / #allowBuilds in sync with an "allow" decision, and remove the',
	'     entry when the package stops needing a build.',
	'  4. Re-run `pnpm run install:scripts:check`.',
	'Never silence this gate with a blanket allow: an install-time hook runs before any repository test exists.',
].join('\n');

function parseArgs(argv) {
	const options = { root: defaultRoot, json: false, html: null };
	for (const arg of argv) {
		if (arg === '--json') options.json = true;
		else if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg.startsWith('--root='))
			options.root = resolve(process.cwd(), arg.slice('--root='.length));
		else if (arg.startsWith('--html='))
			options.html = resolve(process.cwd(), arg.slice('--html='.length));
		else return { ...options, error: `unknown argument: ${arg}` };
	}
	return options;
}

/**
 * Run the audit against an explicit repository root (pure seam for
 * tests; production calls it with the real root).
 */
export function runAudit(root) {
	const policyPath = resolve(root, POLICY_RELATIVE_PATH);
	const allowlistPath = resolve(root, ALLOWLIST_RELATIVE_PATH);
	const rootManifestPath = resolve(root, 'package.json');
	const modulesPath = resolve(root, 'node_modules');

	const inputErrors = [];
	for (const path of [policyPath, allowlistPath, rootManifestPath]) {
		if (!existsSync(path)) inputErrors.push(`required input not found: ${path}`);
	}
	// Without an installed tree there is nothing to inventory, and an
	// audit that reports "0 install-time scripts" for an empty scan would
	// be indistinguishable from a clean repository. Fail closed instead.
	if (!existsSync(modulesPath)) {
		inputErrors.push(
			`required input not found: ${modulesPath}\n  Run \`pnpm install\` first — this audit reads the installed manifests, so it cannot pass on an uninstalled tree.`,
		);
	}
	if (inputErrors.length > 0) return { ok: false, inputErrors, violations: [], warnings: [] };

	const { policy, errors: policyErrors } = parsePolicy(readFileSync(policyPath, 'utf8'));
	if (policyErrors.length > 0) {
		return {
			ok: false,
			inputErrors: [
				`${POLICY_RELATIVE_PATH} is not a usable policy:`,
				...policyErrors.map((e) => `  - ${e}`),
			],
			violations: [],
			warnings: [],
		};
	}

	const { names: pnpmAllowlist, errors: allowlistErrors } = readPnpmAllowlist(
		readFileSync(allowlistPath, 'utf8'),
	);
	if (allowlistErrors.length > 0) {
		return {
			ok: false,
			inputErrors: [
				`${ALLOWLIST_RELATIVE_PATH} is not a usable allow-list:`,
				...allowlistErrors.map((e) => `  - ${e}`),
			],
			violations: [],
			warnings: [],
		};
	}

	const rootManifest = readPackageManifest(rootManifestPath);
	const manifests = collectInstalledManifests(root);
	const directNames = new Set([
		...Object.keys(rootManifest?.dependencies ?? {}),
		...Object.keys(rootManifest?.devDependencies ?? {}),
		...Object.keys(rootManifest?.optionalDependencies ?? {}),
	]);

	const audit = auditInstallScripts({
		manifests,
		rootManifest,
		policy,
		pnpmAllowlist,
		directNames,
	});
	return { ok: audit.violations.length === 0, inputErrors: [], audit };
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.error) {
		process.stderr.write(`[check-install-scripts] ${options.error}\n`);
		process.stderr.write(
			'Usage: node scripts/check-install-scripts.mjs [--root=<dir>] [--json] [--html=<path>]\n',
		);
		return 2;
	}
	if (options.help) {
		process.stdout.write(
			'Usage: node scripts/check-install-scripts.mjs [--root=<dir>] [--json] [--html=<path>]\n',
		);
		return 0;
	}

	const result = runAudit(options.root);
	if (result.inputErrors.length > 0) {
		process.stderr.write('[check-install-scripts] cannot audit:\n');
		for (const line of result.inputErrors) process.stderr.write(`  ${line}\n`);
		return 2;
	}

	const context = { policyPath: POLICY_RELATIVE_PATH, allowlistPath: ALLOWLIST_RELATIVE_PATH };
	if (options.html) {
		mkdirSync(dirname(options.html), { recursive: true });
		writeFileSync(options.html, renderHtmlReport(result.audit, context), 'utf8');
		process.stdout.write(`[check-install-scripts] HTML report written to ${options.html}\n`);
	}
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...context, ...result.audit }, null, 2)}\n`);
	} else {
		process.stdout.write(`${formatTextReport(result.audit, context)}\n`);
	}

	if (!result.ok) {
		process.stderr.write(
			`\n[check-install-scripts] FAIL: ${result.audit.violations.length} violation(s) in the install lifecycle script audit.\n${REMEDY_TEXT}\n`,
		);
		return 1;
	}
	process.stdout.write(
		`[check-install-scripts] OK: ${result.audit.summary.install_time_packages} install-time lifecycle script package(s) reviewed, ${result.audit.summary.warnings} warning(s).\n`,
	);
	return 0;
}

// ESM main-module guard: importing this file for testing must not run
// the audit (same pattern as scripts/check-release-assets.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main());
}
