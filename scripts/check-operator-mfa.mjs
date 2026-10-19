#!/usr/bin/env node
/**
 * Operator MFA confirmation audit — CLI (Issue #469).
 *
 * What it decides
 * ---------------
 * Whether the **operator-declared ledger**
 * (`quality/operator-mfa-ledger.json`) records a current, complete MFA /
 * Passkey confirmation for each of the four control-plane accounts the
 * project depends on: GitHub, Cloudflare, Infisical and the registrar.
 * The policy is `scripts/_operator-mfa-audit.mjs`; this file is the I/O
 * wrapper that reads the file and prints the verdict.
 *
 * What it never does
 * ------------------
 *   - no network call, no provider API, no Cloudflare binding, no D1 / R2
 *     access. Issue #469's acceptance conditions forbid a production
 *     operation here, and the four account states are not observable from
 *     a Worker anyway — see the seam's header for why the ledger, not the
 *     account, is what gets audited.
 *   - no secret, no account identifier. The ledger schema has no field for
 *     one (an identifier-shaped key is `UNDECIDABLE`), and both the
 *     ledger file and the rendered output go through the anonymization
 *     guard before a byte is printed.
 *   - no write. The gate reads one JSON file and exits.
 *
 * Usage
 * -----
 *   node scripts/check-operator-mfa.mjs                      # the shipped ledger
 *   node scripts/check-operator-mfa.mjs --ledger=<path>      # another ledger
 *   node scripts/check-operator-mfa.mjs --fixture=<path>     # a recorded fixture
 *   node scripts/check-operator-mfa.mjs --help
 *
 * Exit codes
 * ----------
 *   0  OK          every required service is `confirmed`
 *   1  OUTSTANDING at least one service is unconfirmed / stale / missing
 *   2  UNDECIDABLE the ledger could not be read, reconciled or dated —
 *                  or the guard found an identifier/secret in it, or the
 *                  usage was wrong. Never a pass.
 *
 * Note on the shipped ledger: it is deliberately **unconfirmed**. No agent
 * can read a provider console, so this repository does not claim a date
 * it cannot verify (`AGENTS.md` §5 precedence: an unverifiable claim is
 * not a fact). The ledger is the operator's to fill in; until then the
 * gate is expected to exit 1, which is the honest reading.
 */

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	UNDECIDABLE_REASON,
	assertNoSensitiveInText,
	auditLedger,
	exitCodeFor,
	formatAuditReport,
	readFixture,
	undecidableAudit,
} from './_operator-mfa-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LEDGER = 'quality/operator-mfa-ledger.json';

const USAGE = `operator MFA confirmation audit (Issue #469)

usage:
  node scripts/check-operator-mfa.mjs [--ledger=<path> | --fixture=<path>]
  node scripts/check-operator-mfa.mjs --help

options:
  --ledger=<path>    operator ledger to audit (default: ${DEFAULT_LEDGER})
  --fixture=<path>   a recorded fixture; its output says source=fixture and is
                     never a release verdict
  --help             this text

exit codes:
  0 OK           1 OUTSTANDING          2 UNDECIDABLE
`;

function parseArgs(argv) {
	const args = { kind: 'ledger', path: DEFAULT_LEDGER, help: false };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			args.help = true;
			continue;
		}
		if (arg.startsWith('--ledger=')) {
			args.kind = 'ledger';
			args.path = arg.slice('--ledger='.length);
			continue;
		}
		if (arg.startsWith('--fixture=')) {
			args.kind = 'fixture';
			args.path = arg.slice('--fixture='.length);
			continue;
		}
		return { error: 'unknown argument (accepted: --ledger=, --fixture=, --help)' };
	}
	if (args.path.length === 0) return { error: 'the ledger path is empty' };
	return { args };
}

/**
 * A fixture is an envelope; the ledger inside it is audited with the
 * clock the fixture recorded. A fixture whose envelope the reader
 * rejects is reported as the whole-ledger failure it is, rather than
 * crashing with a JSON error.
 */
function auditFixtureInput(raw, label) {
	const read = readFixture(raw);
	if ('reason' in read) {
		const clock = new Date().toISOString().slice(0, 10);
		const audit = undecidableAudit(read.reason, { clock });
		process.stderr.write(`[operator-mfa] fixture envelope rejected (${label})\n`);
		return audit;
	}
	return auditLedger(read.fixture.ledger, { now: read.fixture.now });
}

function main(argv) {
	const parsed = parseArgs(argv);
	if (parsed.error) {
		process.stderr.write(`${parsed.error}\n\n${USAGE}`);
		return 2;
	}
	if (parsed.args.help) {
		process.stdout.write(USAGE);
		return 0;
	}

	const { kind, path } = parsed.args;
	const absolute = resolve(process.cwd(), path);
	const label = relative(ROOT, absolute) || path;

	let raw;
	try {
		raw = readFileSync(absolute, 'utf8');
	} catch {
		// The path itself is echoed (it is the operator's own argument) but
		// never the file content, and never the underlying errno message,
		// which can carry an absolute path the transcript does not need.
		const clock = new Date().toISOString().slice(0, 10);
		const audit = undecidableAudit(UNDECIDABLE_REASON.ledgerUnreadable, { clock });
		// Rendering is guarded here too: an unreadable ledger must still
		// refuse with a value-free message and exit 2, never a stack trace
		// that quotes the path.
		try {
			process.stdout.write(formatAuditReport(audit, { source: `ledger ${label}` }));
		} catch (error) {
			process.stderr.write(`[operator-mfa] ${error.message}\n`);
			return 2;
		}
		return exitCodeFor(audit);
	}

	// The ledger file itself is inspected before it is parsed: a value
	// that should never be in this file must not reach stdout even if the
	// schema would have rejected the row anyway.
	try {
		assertNoSensitiveInText(raw);
	} catch (error) {
		process.stderr.write(`[operator-mfa] ${error.message} (${label})\n`);
		return 2;
	}

	const audit =
		kind === 'fixture' ? auditFixtureInput(raw, label) : auditLedger(raw, { now: new Date() });
	const source =
		kind === 'fixture' ? `fixture ${label} (recorded run clock ${audit.clock})` : `ledger ${label}`;
	// The rendered transcript is guarded too: the file passed the guard
	// above, but the report is what a human pastes into a PR, so it gets
	// its own check and a value-free refusal instead of a stack trace.
	let text;
	try {
		text = formatAuditReport(audit, { source });
	} catch (error) {
		process.stderr.write(`[operator-mfa] ${error.message} (${label})\n`);
		return 2;
	}
	process.stdout.write(text);
	return exitCodeFor(audit);
}

process.exit(main(process.argv.slice(2)));
