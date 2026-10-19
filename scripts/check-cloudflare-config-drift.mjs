#!/usr/bin/env node
/**
 * Cloudflare configuration drift gate (Issue #480).
 *
 * The claim it enforces
 * ---------------------
 * Cloudflare Workers Builds deploys production from a push to `main`
 * (`docs/runbook/cloudflare-workers-builds.md`). What it deploys is the
 * Worker surface that `cloudflare.config.ts` produces in production mode,
 * plus the build and deploy commands this repository names. Since Issue
 * #247 that surface is written ONCE and branched by mode, so a file-level
 * diff no longer shows whether development and production still differ in
 * exactly the places they are supposed to — and no file diff ever showed
 * whether production still matches the contract we recorded for it.
 *
 * This gate compares five dimensions against
 * `quality/cloudflare-config-drift.json`:
 *
 *   bindings       the production binding set: types, text values, D1 /
 *                  R2 targets, rate-limit namespaces and budgets. Secret
 *                  bindings are compared as NAMES.
 *   routes         the route/hostname surface (`domains`): the canonical
 *                  production origin in production, none in development.
 *   headers        the static-asset `_headers` surface, which is applied
 *                  by Cloudflare Static Assets and is inert under
 *                  `vite dev` — so only this gate notices a lost rule.
 *   build_commands the commands Workers Builds runs, checked against the
 *                  `package.json` scripts they name and against the
 *                  runbook row that documents them.
 *   mode           every difference between the development and the
 *                  production surface must be a difference the record
 *                  declares. This is the Issue's dev/prod question.
 *
 * ONE differing item is ONE finding and ONE red gate. There is no
 * tolerance band, and there is no "close enough".
 *
 * Status-only output
 * ------------------
 * No credential is read, and the report may not carry one: a secret
 * binding is reduced to its NAME during normalization, and a text value
 * that differs from the record is printed as `<redacted len=N>` because an
 * unexpected value is exactly where a credential would hide. The rendered
 * report is checked by the repository's own credential-shape detector
 * before a byte is written (AGENTS.md §4,
 * `docs/runbook/infisical-secrets.md` is the precedent).
 *
 * No credential, no network, no Cloudflare API
 * ---------------------------------------------
 * This gate reads repository files and evaluates `cloudflare.config.ts`
 * for two modes. It issues no API call, needs no token, and performs no
 * mutation, so it belongs in `validate:fast` and therefore runs before
 * every release. What it does NOT cover is stated in the runbook: the
 * built artifact (owned by `cloudflare:contract:check:build`), the live
 * Worker binding state, and the Cloudflare Dashboard settings that no
 * local tool can read.
 *
 * Usage:
 *   node scripts/check-cloudflare-config-drift.mjs
 *   node scripts/check-cloudflare-config-drift.mjs --case=<fixture name>
 *   node scripts/check-cloudflare-config-drift.mjs --json
 *
 * Exit codes: 0 = the surface matches the record, 1 = at least one item
 * drifted, 2 = undecidable (unreadable record / surface / headers file, a
 * record that cannot state the contract, a usage error, or a report that
 * would not be status-only).
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	DRIFT_VERDICT,
	UNDECIDABLE_REASON,
	applyDriftCase,
	assertStatusOnly,
	decide,
	diffBuildCommands,
	diffModeSurfaces,
	diffProductionSurface,
	diffStaticAssetHeaders,
	exitCodeFor,
	formatDriftReport,
	normalizeWorkerSurface,
	readRecord,
} from './_cloudflare-drift.mjs';
import { looksLikeCredentialValue } from './_secret-scan.mjs';
import { parseHeadersFile } from './check-security-headers.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const RECORD_PATH = 'quality/cloudflare-config-drift.json';
export const FIXTURE_DIR = 'quality/fixtures/cloudflare-config-drift';
/**
 * The runbook row that documents the Workers Builds commands. A fixed
 * path, not a record field: the runbook is the human-facing mirror of a
 * dashboard setting, and there is exactly one of it.
 */
export const RUNBOOK_PATH = 'docs/runbook/cloudflare-workers-builds.md';
export const REPORT_PREFIX = '[cf-config-drift]';

function readJson(root, relativePath) {
	return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function readText(root, relativePath) {
	return readFileSync(join(root, relativePath), 'utf8');
}

/**
 * Evaluate the real configuration for both modes.
 *
 * `cloudflare.config.ts` is TypeScript with erasable syntax, so Node
 * loads it directly (the same mechanism `pnpm run cf-typegen` and the
 * other `node --experimental-strip-types` scripts rely on). Nothing is
 * built, no Worker is started, and no binding is materialised with a
 * value: `cf/config`'s binding factories describe a binding, they do not
 * fetch one.
 */
async function loadSurfaces(root) {
	const configUrl = pathToFileURL(join(root, 'cloudflare.config.ts')).href;
	const config = (await import(configUrl)).default;
	const production = normalizeWorkerSurface({ mode: 'production', config });
	const development = normalizeWorkerSurface({ mode: 'development', config });
	if (production.error)
		return { error: `${UNDECIDABLE_REASON.surfaceUnreadable}:${production.error}` };
	if (development.error) {
		return { error: `${UNDECIDABLE_REASON.surfaceUnreadable}:${development.error}` };
	}
	return { production, development };
}

/** Counts only — the summary line never names a value. */
function summarize(surface) {
	const names = Object.keys(surface.bindings);
	const secrets = names.filter((name) => surface.bindings[name].type === 'secret').length;
	return `bindings=${names.length} secrets=${secrets} (names only) routes=${surface.routes.length}`;
}

/**
 * Run the audit. Exported so the report generator and the unit test drive
 * the SAME decision this CLI prints, instead of a second implementation
 * of it.
 */
export async function runDriftAudit({ root = REPO_ROOT, caseName = null } = {}) {
	const notes = [];
	let record;
	try {
		record = readJson(root, RECORD_PATH);
	} catch {
		return undecidableRun(UNDECIDABLE_REASON.recordUnreadable, { notes });
	}
	const recordProblem = readRecord(record);
	if (recordProblem) {
		return undecidableRun(recordProblem.error, { notes, record });
	}

	let surfaces;
	try {
		surfaces = await loadSurfaces(root);
	} catch {
		return undecidableRun(UNDECIDABLE_REASON.surfaceUnreadable, { notes, record });
	}
	if (surfaces.error) {
		return undecidableRun(surfaces.error, { notes, record });
	}

	let { production, development } = surfaces;
	let caseLabel = null;
	if (caseName !== null) {
		try {
			const fixture = readJson(root, join(FIXTURE_DIR, `${caseName}.json`));
			caseLabel = fixture.case ?? caseName;
			({ production, development } = applyDriftCase(production, development, fixture.apply));
			notes.push(
				`case=${caseLabel} recipe applied to the live surface; this is NOT a release verdict`,
			);
		} catch {
			return undecidableRun(UNDECIDABLE_REASON.inputUnreadable, { notes, record });
		}
	}

	let scripts;
	try {
		scripts = readJson(root, 'package.json').scripts ?? {};
	} catch {
		return undecidableRun(UNDECIDABLE_REASON.scriptsUnreadable, { notes, record });
	}
	let runbookText;
	try {
		runbookText = readText(root, RUNBOOK_PATH);
	} catch {
		return undecidableRun(UNDECIDABLE_REASON.runbookUnreadable, { notes, record });
	}
	let headersRules;
	try {
		headersRules = parseHeadersFile(readText(root, record.static_asset_headers.file));
	} catch {
		return undecidableRun(UNDECIDABLE_REASON.headersUnreadable, { notes, record });
	}
	let policy;
	try {
		policy = readJson(root, record.static_asset_headers.policy_file);
	} catch {
		return undecidableRun(UNDECIDABLE_REASON.policyUnreadable, { notes, record });
	}

	const findings = [
		...diffProductionSurface(record.production, production),
		...diffModeSurfaces(record, production, development),
		...diffBuildCommands(record, scripts, runbookText),
		...diffStaticAssetHeaders(record, headersRules, policy),
	];
	const result = decide(findings);
	const meta = {
		source: caseName === null ? 'repository' : 'fixture',
		target: 'production',
		summary: `${summarize(production)} build_commands=${Object.keys(record.build_commands).length} header_rules=${headersRules.length}`,
		notes,
	};
	return {
		result,
		meta,
		record,
		production,
		development,
		caseLabel,
		runbookText,
		headersRules,
		policy,
	};
}

/**
 * The UNDECIDABLE shape.
 *
 * The same object keys as a decided run, so a caller never has to ask
 * whether it is holding a verdict or a refusal — only what `verdict` says.
 */
function undecidableRun(reason, { notes, record = null }) {
	return {
		result: decide([], reason),
		meta: { source: 'repository', target: 'production', summary: null, notes },
		record,
		production: null,
		development: null,
		caseLabel: null,
	};
}

/**
 * Render, then prove the render is status-only.
 *
 * The guard runs on the SAME text the caller writes, so the promise and
 * the check cannot diverge: if a future change would put a
 * credential-shaped token in the report, this command exits 2 instead of
 * printing it.
 */
export function renderAudit(audit) {
	const text = formatDriftReport(audit.result, audit.meta);
	assertStatusOnly(audit.result, { isCredential: looksLikeCredentialValue });
	return text;
}

const USAGE = `Usage:
  node scripts/check-cloudflare-config-drift.mjs [--json]
  node scripts/check-cloudflare-config-drift.mjs --case=<fixture name>
  pnpm run cf:config:drift:check -- --case=<fixture name>

--case   replay a recorded single-item mutation from ${FIXTURE_DIR}
         against the live surface. A demonstration and a test input,
         never a release verdict: the output says source=fixture.
--json   print the machine-readable result instead of the status-only
         report. Same status-only rule: no binding value is included.`;

function parseArgs(argv) {
	const options = { caseName: null, json: false, help: false };
	for (const arg of argv) {
		// A bare `--` is pnpm's argument separator and carries no meaning
		// here; rejecting it would make the documented
		// `pnpm run cf:config:drift:check -- --case=<name>` fail on a
		// separator rather than on the argument.
		if (arg === '--') continue;
		if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg === '--json') options.json = true;
		else if (arg.startsWith('--case=')) options.caseName = arg.slice('--case='.length);
		else return { ...options, error: `unknown argument: ${arg}` };
	}
	if (options.caseName !== null && !/^[a-z0-9-]+$/.test(options.caseName)) {
		return { ...options, error: '--case takes a fixture name (lowercase, digits, dashes)' };
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	if (options.error) {
		process.stderr.write(`${options.error}\n${USAGE}\n`);
		return 2;
	}

	const audit = await runDriftAudit({ root: REPO_ROOT, caseName: options.caseName });

	if (options.json) {
		// Findings carry redacted values only (see `assertStatusOnly`), so
		// this stream inherits the same contract as the text report.
		process.stdout.write(
			`${JSON.stringify({ verdict: audit.result.verdict, reason: audit.result.reason, counts: audit.result.counts, findings: audit.result.findings }, null, '\t')}\n`,
		);
	} else {
		let text;
		try {
			text = renderAudit(audit);
		} catch (error) {
			process.stderr.write(`${REPORT_PREFIX} ${error.message}\n`);
			return 2;
		}
		if (audit.result.verdict === DRIFT_VERDICT.undecidable) {
			process.stderr.write(text);
		} else if (audit.result.findings.length > 0) {
			// A red gate must be readable in a CI log without scrolling:
			// the report goes to stderr the way every other failing gate
			// in this repository writes its findings.
			process.stderr.write(text);
		} else {
			process.stdout.write(text);
		}
	}
	return exitCodeFor(audit.result);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await main());
}
