import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AUDIT_WINDOW_DAYS, auditChannel, loadChannels } from './check-contact-freshness.mjs';

/**
 * Fixture coverage for the contact audit report (Issue #833).
 *
 * The report is the audit half of the display/audit split: it must
 * classify `fresh` / `due` / `unknown` / `inactive` exactly the way
 * `src/contact/schema.ts` does, and it must agree with the shipped
 * `channels.json` on the constant that defines "due".
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0); // 2026-11-18T12:00:00Z
const ONE_DAY = 24 * 60 * 60 * 1000;

function jstDate(daysAgo) {
	// verified_at is a JST calendar day; approximate with UTC date minus N
	// days — sufficient for state classification at day granularity.
	return new Date(NOW - daysAgo * ONE_DAY).toISOString().slice(0, 10);
}

function record(overrides = {}) {
	return {
		id: 'x',
		label: 'X',
		labelEn: 'X',
		purpose: 'technical',
		url: 'https://example.com',
		verified_at: jstDate(1),
		active: true,
		...overrides,
	};
}

describe('auditChannel', () => {
	it('reports inactive regardless of the date', () => {
		assert.equal(
			auditChannel(record({ active: false, verified_at: jstDate(1) }), NOW).state,
			'inactive',
		);
	});

	it('reports fresh inside the window and due past it', () => {
		assert.equal(auditChannel(record({ verified_at: jstDate(5) }), NOW).state, 'fresh');
		assert.equal(
			auditChannel(record({ verified_at: jstDate(AUDIT_WINDOW_DAYS + 1) }), NOW).state,
			'due',
		);
	});

	it('reports unknown for unparseable and future dates', () => {
		assert.equal(auditChannel(record({ verified_at: 'garbage' }), NOW).state, 'unknown');
		assert.equal(auditChannel(record({ verified_at: '2999-01-01' }), NOW).state, 'unknown');
	});
});

describe('AUDIT_WINDOW_DAYS parity with src/contact/schema.ts', () => {
	it('the script constant equals the schema constant', () => {
		const schema = readFileSync(join(REPO_ROOT, 'src/contact/schema.ts'), 'utf8');
		const match = schema.match(/export const AUDIT_WINDOW_DAYS = (\d+);/);
		assert.ok(match, 'schema.ts must export AUDIT_WINDOW_DAYS');
		assert.equal(Number(match[1]), AUDIT_WINDOW_DAYS);
	});
});

describe('loadChannels on the shipped file', () => {
	it('parses channels.json and classifies every record', () => {
		const channels = loadChannels(REPO_ROOT);
		assert.ok(channels.length > 0);
		const states = new Set(channels.map((ch) => auditChannel(ch, NOW).state));
		for (const state of states) {
			assert.ok(['inactive', 'fresh', 'due', 'unknown'].includes(state), state);
		}
	});
});
