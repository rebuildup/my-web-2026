#!/usr/bin/env node
/**
 * Dependency advisory gate — CLI (Issue #470).
 *
 * Reads the reviewed gate declaration, obtains the registry advisory
 * document for the committed lockfile, and prints one status-only
 * verdict. The decision itself lives in `_dependency-advisories.mjs` and
 * the HTML rendering in `render-dependency-audit-report.mjs`; this file
 * owns argument handling and, more importantly, the acquisition contract:
 *
 *   - `pnpm audit --json` is the source. Its exit code is 1 whenever
 *     advisories exist, which is NOT a failure of this gate, so the exit
 *     code is never used to decide whether data arrived.
 *   - `--ignore-registry-errors` is never passed. That flag makes a
 *     registry outage look like an empty advisory set, which is the one
 *     outcome this gate exists to refuse.
 *   - Data that does not parse, is not an advisory document, or cannot be
 *     fetched at all is reported as `data-unavailable` and fails closed.
 *
 * Usage:
 *   node scripts/check-dependency-advisories.mjs [--input <file|->]
 *        [--gate <file>] [--format text|json] [--report <file>]
 *        [--enforce] [--now <YYYY-MM-DD>]
 *
 * Exit codes:
 *   0  pass, or blocking findings recorded under `audit` enforcement
 *   1  blocking advisories outstanding under `block` enforcement
 *   2  usage or gate-declaration error (including an unreadable --input)
 *   3  advisory data unavailable (fail closed; never reported as clean)
 *
 * Secret posture (AGENTS.md section 4): the only inputs are the lockfile's
 * resolved package set (via `pnpm audit`) and the reviewed gate
 * declaration. No Infisical command, no Wrangler secret subcommand, no
 * `.dev.vars` read and no environment value is printed — the inherited
 * environment is used only to locate `pnpm` on PATH.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	GateDefinitionError,
	STATUS,
	evaluateAdvisories,
	evaluateUnavailableData,
	parseAdvisoryPayload,
	parseEvaluationDate,
	parseGateDeclaration,
	renderText,
} from './_dependency-advisories.mjs';
import { buildReportModel, renderReport } from './render-dependency-audit-report.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_GATE = 'quality/dependency-advisory-gate.json';
const AUDIT_COMMAND = 'pnpm';
const AUDIT_ARGS = ['audit', '--json'];
const AUDIT_TIMEOUT_MS = 180_000;

export const EXIT = Object.freeze({
	PASS: 0,
	BLOCKED: 1,
	USAGE: 2,
	DATA_UNAVAILABLE: 3,
});

const USAGE = `dependency advisory gate (Issue #470)

  --gate <file>      gate declaration (default: ${DEFAULT_GATE})
  --input <file|->   read the advisory document from a file or stdin
                     instead of running \`${AUDIT_COMMAND} ${AUDIT_ARGS.join(' ')}\`
  --report <file>    write the self-contained HTML inspection report
  --format text|json verdict rendering (default: text)
  --enforce          evaluate as \`block\` regardless of the declared mode
  --now <YYYY-MM-DD> evaluation date, for reproducible expiry behaviour
  --help             this message

Exit codes:
  0  pass, or blocking findings recorded under \`audit\` enforcement
  1  blocking advisories outstanding under \`block\` enforcement
  2  usage or gate-declaration error (including an unreadable --input path)
  3  advisory data unavailable (fail closed; never reported as clean)
`;

export function parseArgs(argv) {
	const options = {
		gatePath: resolve(REPO_ROOT, DEFAULT_GATE),
		input: null,
		reportPath: null,
		format: 'text',
		enforce: false,
		now: null,
		help: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = () => {
			const value = argv[index + 1];
			if (value === undefined) throw new GateDefinitionError(`${arg} requires a value`);
			index += 1;
			return value;
		};
		switch (arg) {
			case '--':
				// `pnpm run dep-audit:check -- --report …` — pnpm forwards the
				// separator verbatim, and the CI step uses that form. Skipping
				// it keeps the canonical npm-script invocation working without
				// making the CLI aware of which runner invoked it.
				break;
			case '--gate':
				options.gatePath = resolve(next());
				break;
			case '--input':
				options.input = next();
				break;
			case '--report':
				options.reportPath = resolve(next());
				break;
			case '--format':
				options.format = next();
				break;
			case '--enforce':
				options.enforce = true;
				break;
			case '--now':
				// Validated here so a typo is a usage error (exit 2) and
				// never an exception thrown from inside the verdict path,
				// where it would be indistinguishable from a data failure.
				options.now = parseEvaluationDate(next());
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			default:
				if (arg.startsWith('--')) throw new GateDefinitionError(`unknown option ${arg}`);
				throw new GateDefinitionError(`unexpected argument ${JSON.stringify(arg)}`);
		}
	}
	if (!['text', 'json'].includes(options.format)) {
		throw new GateDefinitionError(`--format must be text or json (got ${options.format})`);
	}
	return options;
}

export function loadGate(gatePath) {
	let raw;
	try {
		raw = readFileSync(gatePath, 'utf8');
	} catch (error) {
		throw new GateDefinitionError(`cannot read gate declaration ${gatePath}: ${error.message}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new GateDefinitionError(
			`gate declaration ${gatePath} is not valid JSON: ${error.message}`,
		);
	}
	return parseGateDeclaration(parsed);
}

/**
 * Obtain the advisory document.
 *
 * Returns `{ payload, source }` or `{ error, source }`. The error string
 * is the only thing a caller may print about a failed acquisition, and it
 * describes the failure, never the contents of an environment.
 *
 * A local `--input` path that cannot be read is a *usage* error, not an
 * acquisition failure: it throws `GateDefinitionError` so the caller
 * exits `2` rather than reporting a registry problem that never
 * happened.
 */
export function acquireAdvisoryDocument({ input }) {
	if (input === '-') {
		return parseText(
			readLocal(0, 'the advisory document on stdin'),
			'advisory document from stdin',
		);
	}
	if (input) {
		return parseText(
			readLocal(resolve(input), `the advisory document at ${input}`),
			`advisory document from ${input}`,
		);
	}
	const result = spawnSync(AUDIT_COMMAND, AUDIT_ARGS, {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		timeout: AUDIT_TIMEOUT_MS,
		// pnpm's advisory endpoint needs outbound HTTPS; the proxy
		// variables it honours are inherited like any other tool's, and
		// nothing in this environment is printed.
		env: process.env,
	});
	if (result.error) {
		return {
			source: `${AUDIT_COMMAND} ${AUDIT_ARGS.join(' ')}`,
			error: `could not run \`${AUDIT_COMMAND} ${AUDIT_ARGS.join(' ')}\`: ${result.error.message}`,
		};
	}
	return parseText(result.stdout, `${AUDIT_COMMAND} ${AUDIT_ARGS.join(' ')}`);
}

function parseText(text, source) {
	if (typeof text !== 'string' || text.trim().length === 0) {
		return { source, error: `${source} produced no output` };
	}
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		// The body is NOT echoed. It is upstream output, it ends up in a
		// CI log and in a 90-day artifact, and "status-only" has to mean
		// status-only on this path too — a registry that answers with an
		// unexpected payload must not be able to plant text (or a token)
		// in either. The operator is pointed at the runbook instead.
		return {
			source,
			error: `${source} did not return JSON; the response body is withheld (see runbook section 5)`,
		};
	}
	if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.error) {
		// The code is the diagnostic; the message is upstream prose and is
		// not repeated here. Same reasoning as the unparsable branch.
		const code = payload.error?.code ? ` ${payload.error.code}` : '';
		return {
			source,
			error: `${source} returned an error document${code}; the response body is withheld (see runbook section 5)`,
		};
	}
	return { payload, source };
}

/** Read a caller-supplied path, reporting a usage error instead of crashing. */
function readLocal(target, label) {
	try {
		return readFileSync(target, 'utf8');
	} catch (error) {
		throw new GateDefinitionError(`cannot read ${label}: ${error.code ?? error.message}`);
	}
}

export function exitCodeFor(result) {
	if (result.status === STATUS.DATA_UNAVAILABLE) return EXIT.DATA_UNAVAILABLE;
	if (result.status === STATUS.FAIL) return EXIT.BLOCKED;
	return EXIT.PASS;
}

function renderJson(result, { source, gatePath }) {
	return `${JSON.stringify(
		{
			status: result.status,
			exitCode: exitCodeFor(result),
			source,
			gatePath,
			dataStatus: result.dataStatus,
			dataDetail: result.dataDetail,
			evaluatedOn: result.evaluatedOn,
			enforcement: result.enforcement,
			blockingSeverities: result.blockingSeverities,
			reportedSeverities: result.reportedSeverities,
			total: result.total,
			blockingCount: result.blockingCount,
			counts: result.counts,
			blocking: result.blocking.map(({ finding, reason }) => ({
				id: finding.id,
				package: finding.package,
				severity: finding.severity,
				title: finding.title,
				versions: finding.versions,
				patchedVersions: finding.patchedVersions,
				url: finding.url,
				devOnly: finding.devOnly,
				reason,
			})),
			excepted: result.excepted.map(({ finding, exception, daysRemaining }) => ({
				id: finding.id,
				package: finding.package,
				severity: finding.severity,
				reason: exception.reason,
				approvedBy: exception.approvedBy,
				trackingIssue: `${exception.trackingIssue}`,
				expiresOn: exception.expiresOn,
				daysRemaining,
			})),
			expired: result.expired.map(({ finding, exception, daysRemaining }) => ({
				id: finding.id,
				package: finding.package,
				severity: finding.severity,
				expiresOn: exception.expiresOn,
				daysRemaining,
			})),
			staleExceptions: result.staleExceptions.map(({ exception, daysRemaining }) => ({
				id: exception.advisoryId,
				package: exception.package,
				expiresOn: exception.expiresOn,
				daysRemaining,
			})),
			mismatchedExceptions: result.mismatchedExceptions.map(
				({ exception, observed, daysRemaining }) => ({
					id: exception.advisoryId,
					declaredPackage: exception.package,
					declaredSeverity: exception.severity,
					reportedAs: observed.map(({ package: pkg, severity }) => ({
						package: pkg,
						severity,
					})),
					expiresOn: exception.expiresOn,
					daysRemaining,
				}),
			),
			reported: result.reported.map((finding) => ({
				id: finding.id,
				package: finding.package,
				severity: finding.severity,
			})),
		},
		null,
		2,
	)}\n`;
}

/**
 * Acquire the advisory document, or report the usage error.
 *
 * A `--input` path that does not exist is an operator mistake, so it
 * exits `2` with one line on stderr. Left unhandled it would throw past
 * the verdict path and exit `1` — which this tool documents as
 * "blocking advisories outstanding", i.e. a security verdict, for what
 * is only a typo.
 */
function tryAcquire(options) {
	try {
		return acquireAdvisoryDocument(options);
	} catch (error) {
		if (!(error instanceof GateDefinitionError)) throw error;
		process.stderr.write(`${error.message}\n`);
		return EXIT.USAGE;
	}
}

/**
 * Run the gate. Returns the exit code; `run` exists so the tests can
 * exercise the whole pipeline without spawning a second process for the
 * verdict itself (the CLI tests do spawn it, for the real exit codes).
 */
export function run(argv) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`${error.message}\n\n${USAGE}`);
		return EXIT.USAGE;
	}
	if (options.help) {
		process.stdout.write(USAGE);
		return EXIT.PASS;
	}

	let gate;
	try {
		gate = loadGate(options.gatePath);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return EXIT.USAGE;
	}
	if (options.enforce) {
		// The escalation switch from the runbook: decide as `block`
		// without editing the reviewed declaration, so an operator can
		// see the blocking verdict for the real lockfile on demand.
		gate = { ...gate, enforcement: 'block' };
	}

	const acquisition = tryAcquire(options);
	if (acquisition === EXIT.USAGE) return EXIT.USAGE;
	const now = options.now ?? new Date();
	const gatePath = relative(REPO_ROOT, options.gatePath) || options.gatePath;

	let result;
	if (acquisition.error) {
		result = evaluateUnavailableData({ gate, now, reason: acquisition.error });
	} else {
		try {
			const findings = parseAdvisoryPayload(acquisition.payload);
			result = evaluateAdvisories({ findings, gate, now });
		} catch (error) {
			// Only a *document* problem may become `data-unavailable`. A
			// verdict is always reachable for a document this gate can
			// parse, so anything else is a bug, not a scan result, and must
			// not be laundered into "the registry could not be read".
			if (!(error instanceof GateDefinitionError)) throw error;
			result = evaluateUnavailableData({
				gate,
				now,
				reason: `${acquisition.source}: ${error.message}`,
			});
		}
	}

	const code = exitCodeFor(result);
	if (options.format === 'json') {
		process.stdout.write(renderJson(result, { source: acquisition.source, gatePath }));
	} else {
		process.stdout.write(renderText(result, { source: acquisition.source, gatePath }));
	}

	if (options.reportPath) {
		const model = buildReportModel(result, {
			source: acquisition.source,
			gatePath,
			generatedAt: `${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
		});
		mkdirSync(dirname(options.reportPath), { recursive: true });
		writeFileSync(options.reportPath, renderReport(result, model));
		process.stderr.write(`report written: ${relative(REPO_ROOT, options.reportPath)}\n`);
	}
	return code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(run(process.argv.slice(2)));
}
