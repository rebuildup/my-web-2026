#!/usr/bin/env node
/**
 * Secret drift / rotation-deadline status (Issue #477).
 *
 * What it decides
 * ---------------
 * Two facts that are invisible in a CI log today, from status-only
 * inputs:
 *
 *   1. **Drift** — the Infisical inventory is a runtime fact, and the
 *      only status-only outputs about it are printed by
 *      `scripts/check-cf-secrets.mjs --execute`. This tool does NOT read
 *      Infisical: it consumes the name lists an operator already
 *      recorded from that script (or a structured equivalent) and reports
 *      them per name. Nothing here needs a credential, so CI can run it.
 *   2. **Deadline** — `docs/runbook/infisical-secrets.md` §2.1 records a
 *      cadence per name; `quality/secret-rotation-ledger.json` is the
 *      machine-readable projection of that column, and this tool turns
 *      it into a deadline.
 *
 * Status-only output (AGENTS.md §4)
 * ---------------------------------
 * Names, verdicts, statuses, counts and dates. No secret value is read,
 * fetched, stored or printed. Three mechanisms enforce that, described in
 * `scripts/_secret-rotation-status.mjs`: the §3.2 name grammar refuses a
 * recorded listing that carries a value instead of a name, the ledger
 * schema rejects unknown keys, and every line this script writes is run
 * through the leak guard first.
 *
 * Exit codes
 * ----------
 *   0 — no drift failure, nothing overdue. Advisories (an unexpected
 *       name, an unrecorded rotation date, a due-soon deadline, and the
 *       "no observation supplied" state itself) are printed and do not
 *       fail: the operator owns those calls.
 *   1 — a drift failure (a contract name the observation reports absent,
 *       a contract name with no ledger row, a ledger row for a name the
 *       contract does not own) or a rotation past its cadence.
 *   2 — undecidable (unreadable or malformed ledger / observation, an
 *       unusable clock, a usage error). "Could not read" is never a pass.
 *
 * Usage:
 *   pnpm run secrets:status:check
 *   node scripts/check-secret-rotation-status.mjs --observation=<recorded status-only listing>
 *   node scripts/check-secret-rotation-status.mjs --case=<fixture> --now=<YYYY-MM-DD>
 *
 * `--now` is accepted only together with `--case`, so the gate itself
 * cannot be run against a clock that makes an overdue deadline look
 * fresh. The release verdict always uses the system clock.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUDIT_ONLY_SECRETS, REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';
import {
	UNDECIDABLE_REASON,
	assertNoValueInText,
	collectNonNameTokens,
	evaluateSecretStatus,
	exitCodeForReport,
	formatStatusReport,
	parseLedger,
	parseObservation,
	undecidableStatus,
} from './_secret-rotation-status.mjs';

const DEFAULT_LEDGER = 'quality/secret-rotation-ledger.json';
const CONTRACT_SOURCE = 'scripts/_cloudflare-contract.mjs';

const USAGE = `Usage:
  node scripts/check-secret-rotation-status.mjs [--ledger=<path>] [--observation=<path>]
  node scripts/check-secret-rotation-status.mjs --case=<fixture> [--now=<YYYY-MM-DD>]

--ledger       rotation ledger (default ${DEFAULT_LEDGER}).
--observation  a recorded status-only drift observation: either a JSON
               record {environment, captured_at, missing, extra} or a
               transcript of \`pnpm run infisical:check:cf -- --execute\`
               kept on the operator side. Only names are read.
--case         a fixture case (demonstration and test input). Never a
               release verdict: the output says source=fixture.
--now          pin the clock for a --case run. Refused without --case.`;

function parseArgs(argv) {
	const options = { ledger: null, observation: null, fixture: null, now: null, help: false };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg.startsWith('--ledger=')) options.ledger = arg.slice('--ledger='.length);
		else if (arg.startsWith('--observation='))
			options.observation = arg.slice('--observation='.length);
		else if (arg.startsWith('--case=')) options.fixture = arg.slice('--case='.length);
		else if (arg.startsWith('--now=')) options.now = arg.slice('--now='.length);
		else return { ...options, error: `unknown argument: ${arg}` };
	}
	if (options.fixture && options.observation) {
		return { ...options, error: '--case and --observation are two different inputs; pick one' };
	}
	if (options.now && !options.fixture) {
		return {
			...options,
			error: '--now is accepted only with --case: a release verdict uses the system clock',
		};
	}
	return options;
}

function readFile(path) {
	return readFileSync(resolve(path), 'utf8');
}

/** A case file carries the ledger, the observation and the clock. */
function loadCase(path) {
	let parsed;
	try {
		parsed = JSON.parse(readFile(path));
	} catch {
		return { reason: UNDECIDABLE_REASON.ledgerUnreadable, errors: ['case file is not JSON'] };
	}
	return {
		ledgerText: JSON.stringify(parsed.ledger ?? {}),
		observation: parsed.observation ?? null,
		now: parsed.now ?? null,
	};
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	if (options.error) {
		process.stderr.write(`${options.error}\n${USAGE}\n`);
		return 2;
	}

	let ledgerText;
	let observationInput = null;
	let now = new Date();
	let source = 'repository';
	let ledgerLabel = options.ledger ?? DEFAULT_LEDGER;

	if (options.fixture) {
		const loaded = loadCase(options.fixture);
		if (loaded.reason) {
			emitUndecidable(loaded.reason, loaded.errors ?? []);
			return 2;
		}
		ledgerText = loaded.ledgerText;
		observationInput = loaded.observation;
		if (options.now) now = options.now;
		else if (loaded.now) now = loaded.now;
		source = 'fixture';
		ledgerLabel = options.fixture;
	} else {
		try {
			ledgerText = readFile(ledgerLabel);
		} catch {
			emitUndecidable(UNDECIDABLE_REASON.ledgerUnreadable, [`cannot read ${ledgerLabel}`]);
			return 2;
		}
		if (options.observation) {
			try {
				observationInput = readFile(options.observation);
			} catch {
				emitUndecidable(UNDECIDABLE_REASON.observationUnreadable, [
					`cannot read ${options.observation}`,
				]);
				return 2;
			}
		}
	}

	const ledger = parseLedger(ledgerText);
	if (!ledger.ok) {
		emitUndecidable(ledger.reason, ledger.errors);
		return 2;
	}

	let observation = null;
	if (observationInput !== null) {
		const parsed = parseObservation(observationInput);
		if (!parsed.ok) {
			emitUndecidable(parsed.reason, parsed.errors);
			return 2;
		}
		observation = parsed.observation;
	}

	const report = evaluateSecretStatus({
		ledger: ledger.ledger,
		contract: { required: REQUIRED_RUNTIME_SECRETS, auditOnly: AUDIT_ONLY_SECRETS },
		observation,
		now,
	});

	// The guard runs on this repository's own output: if the recorded
	// observation ever carried a value, the command fails here instead
	// of writing it anywhere.
	const text = formatStatusReport(report, {
		source,
		ledger: ledgerLabel,
		contract: CONTRACT_SOURCE,
	});
	try {
		assertNoValueInText(text, collectNonNameTokens(observationInput));
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 2;
	}
	process.stdout.write(text);

	if (options.fixture) {
		process.stdout.write('[secret-status] note=fixture input; this is NOT a release verdict\n');
	}
	return exitCodeForReport(report);
}

/**
 * An undecidable run prints the reason CODE and the (value-free) parse
 * problems, then exits 2. No raw error text and no file content: a
 * malformed file is the one input whose content this tool cannot vouch
 * for.
 */
function emitUndecidable(reason, errors) {
	const report = undecidableStatus(reason);
	const text = formatStatusReport(report, {
		source: 'repository',
		ledger: 'unread',
		contract: CONTRACT_SOURCE,
	});
	process.stdout.write(text);
	for (const error of errors) process.stdout.write(`[secret-status] parse_error=${error}\n`);
	process.stdout.write(
		'[secret-status] printed=status only (names, verdicts, counts, dates). No secret value is read, fetched, stored or printed; see AGENTS.md section 4\n',
	);
}

process.exit(main());
