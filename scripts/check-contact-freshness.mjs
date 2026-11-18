#!/usr/bin/env node
/**
 * Periodic-audit report for the `/contact` channel records (Issue #833).
 *
 * Display validity and audit freshness are separate contracts:
 * `active` + a confirmable `verified_at` decides whether a channel is
 * listed; the audit window decides whether the record needs
 * re-verification. This script is the REPORTING half of the audit
 * contract — it lists every channel's audit state and exits 0. It
 * never deletes, deactivates, or rewrites a record: reporting an
 * overdue audit must not silently change what the public page shows
 * (the page itself renders `due` channels with a re-verification
 * note).
 *
 * States reported per channel (mirroring `auditChannelState` in
 * `src/contact/schema.ts` — the constant is duplicated here because
 * operator scripts cannot import TypeScript; the parity test in
 * `check-contact-freshness.test.mjs` pins the two values together):
 *
 *   - `inactive` — `active: false`; the operator retired it.
 *   - `fresh`    — verified inside the audit window.
 *   - `due`      — verified, but the audit window has elapsed.
 *                  Re-verify per docs/runbook/contact-channel-reverification.md.
 *   - `unknown`  — `verified_at` unparseable or future-dated; the
 *                  record cannot confirm the channel was verified.
 *
 * Exit codes: 0 = report printed (any state), 1 = file invalid,
 * 2 = file unreadable.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Must equal AUDIT_WINDOW_DAYS in src/contact/schema.ts (parity-tested). */
export const AUDIT_WINDOW_DAYS = 30;

/** Must equal the JST anchoring in src/contact/schema.ts#verifiedAtMs. */
const VERIFIED_AT_SUFFIX = 'T00:00:00+09:00';

export const CHANNELS_PATH = 'src/contact/channels.json';

function verifiedAtMs(verifiedAt) {
	return Date.parse(`${verifiedAt}${VERIFIED_AT_SUFFIX}`);
}

/**
 * Classify one raw channel record. Returns the audit state plus the
 * day count for display. `active` is checked first: an inactive
 * channel is `inactive` regardless of its date.
 */
export function auditChannel(record, now) {
	if (record.active !== true) return { state: 'inactive', days: null };
	const verifiedMs = verifiedAtMs(record.verified_at);
	const days = Number.isNaN(verifiedMs)
		? null
		: Math.floor((now - verifiedMs) / (24 * 60 * 60 * 1000));
	if (Number.isNaN(verifiedMs) || verifiedMs > now) {
		return { state: 'unknown', days };
	}
	return {
		state: verifiedMs < now - AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000 ? 'due' : 'fresh',
		days,
	};
}

export function loadChannels(root = REPO_ROOT) {
	const raw = readFileSync(join(root, CHANNELS_PATH), 'utf8');
	const parsed = JSON.parse(raw);
	if (!parsed || !Array.isArray(parsed.channels)) {
		throw new Error(`${CHANNELS_PATH}: missing "channels" array`);
	}
	return parsed.channels;
}

function main() {
	const now = Date.now();
	let channels;
	try {
		channels = loadChannels();
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			console.error(`[contact-freshness] unreadable: ${CHANNELS_PATH} (${error.message})`);
			process.exit(2);
		}
		console.error(`[contact-freshness] invalid: ${error.message}`);
		process.exit(1);
	}

	const counts = { fresh: 0, due: 0, unknown: 0, inactive: 0 };
	const rows = [];
	for (const ch of channels) {
		const { state, days } = auditChannel(ch, now);
		counts[state] += 1;
		rows.push({ id: ch.id, state, days });
	}

	console.log(
		`[contact-freshness] ${channels.length} channel(s): ` +
			`fresh ${counts.fresh}, due ${counts.due}, unknown ${counts.unknown}, inactive ${counts.inactive} ` +
			`(audit window ${AUDIT_WINDOW_DAYS}d; report-only — nothing is changed)`,
	);
	for (const row of rows) {
		const age = row.days === null ? 'n/a' : `${row.days}d`;
		console.log(`  ${row.state.padEnd(8)} ${row.id} (verified ${age} ago)`);
	}
	if (counts.due > 0 || counts.unknown > 0) {
		console.log(
			'[contact-freshness] action: re-verify per docs/runbook/contact-channel-reverification.md ' +
				'(due/unknown channels need a two-axis check; this report never edits channels.json)',
		);
	}
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
