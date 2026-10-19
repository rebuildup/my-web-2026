/**
 * `scripts/make-operator-mfa-checklist-report.mjs` — the Issue #469
 * verification report.
 *
 * The page is evidence, so it is asserted rather than eyeballed:
 *
 *   - every recorded case appears with the verdict the classifier returned,
 *     including the shipped ledger's own 未確認 rows — a report that
 *     showed four green ticks would be a false green, and the shipped
 *     ledger is deliberately unconfirmed because no agent can read a
 *     provider console;
 *   - the page carries no account identifier and no credential: it is run
 *     through the same anonymization guard as the CLI output it embeds,
 *     and the generator exits non-zero instead of writing a leaking page;
 *   - a fixture that no longer decides the verdict it declares stops the
 *     generator (exit 1), so the page can never drift away from the
 *     assertions in `scripts/check-operator-mfa.test.mjs`.
 *
 * The browser capture is skipped here: Playwright + a WebP encode is the
 * slow part of the command and its output is a committed artefact, not a
 * behaviour. `pnpm run verify:operator-mfa-checklist-screenshot` produces
 * it.
 *
 * Run: `node --test scripts/make-operator-mfa-checklist-report.test.mjs`
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertNoSensitiveInText } from './_operator-mfa-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = resolve(ROOT, 'scripts', 'make-operator-mfa-checklist-report.mjs');
const FIXTURE_DIR = resolve(ROOT, 'quality', 'fixtures', 'operator-mfa');

function runGenerator(args) {
	return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

function generateInto(dir, extraArgs = []) {
	const out = join(dir, 'report.html');
	const result = runGenerator(['--skip-screenshot', `--out=${out}`, ...extraArgs]);
	return { result, out };
}

describe('operator MFA checklist report', () => {
	it('renders the shipped ledger and every recorded case, with no identifier', () => {
		const dir = mkdtempSync(join(tmpdir(), 'operator-mfa-report-'));
		try {
			const { result, out } = generateInto(dir);
			assert.equal(result.status, 0, result.stderr);
			const page = readFileSync(out, 'utf8');
			assertNoSensitiveInText(page);
			assert.equal(page.includes('@'), false, 'the page names no address');

			// The real checklist is shown as it is: unconfirmed.
			assert.match(page, /OUTSTANDING/);
			assert.match(page, /confirmation_date_missing/);
			assert.match(page, /service_missing/);
			assert.match(page, /confirmation_stale/);
			assert.match(page, /confirmation_date_inconsistent/);
			assert.match(page, /ledger_forbidden_field/);

			// Every service appears, and every state the classifier can emit.
			for (const label of ['GitHub', 'Cloudflare', 'Infisical', 'registrar']) {
				assert.ok(page.includes(label), `${label} must be on the page`);
			}
			for (const state of ['confirmed', 'unconfirmed', 'stale', 'missing']) {
				assert.ok(page.includes(`>${state}<`), `${state} must be rendered`);
			}
			// The commit sha is provenance for the artefact.
			assert.match(page, /head [0-9a-f]{7,}/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('refuses to render a fixture that drifted from its declared verdict', () => {
		const dir = mkdtempSync(join(tmpdir(), 'operator-mfa-drift-'));
		try {
			const fixtures = join(dir, 'fixtures');
			cpSync(FIXTURE_DIR, fixtures, { recursive: true });
			const path = join(fixtures, 'one-unconfirmed.json');
			const drifted = JSON.parse(readFileSync(path, 'utf8'));
			drifted.expect.verdict = 'OK';
			drifted.expect.exitCode = 0;
			writeFileSync(path, `${JSON.stringify(drifted, null, 2)}\n`, 'utf8');

			const { result, out } = generateInto(dir, [`--fixtures=${fixtures}`]);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /drifted from its declared expectation/);
			assert.equal(existsSync(out), false, 'a drifted fixture produces no page');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('renders a fully recorded ledger as OK, so the report is not stuck on 未確認', () => {
		const dir = mkdtempSync(join(tmpdir(), 'operator-mfa-ok-'));
		try {
			// The shipped ledger is unconfirmed by design, so the report's own
			// fixture proves the pass state too: a ledger whose four rows are
			// filled in renders `verdict: OK`.
			const ledger = join(dir, 'ledger.json');
			const raw = JSON.parse(
				readFileSync(resolve(ROOT, 'quality', 'operator-mfa-ledger.json'), 'utf8'),
			);
			raw.policy.status = 'ratified';
			for (const row of raw.services) {
				row.confirmed_at = '2026-10-12';
				row.factors = [
					{ kind: 'passkey', confirmed_at: '2026-10-12' },
					{ kind: 'totp_app', confirmed_at: '2026-10-12' },
				];
			}
			writeFileSync(ledger, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
			const { result, out } = generateInto(dir, [`--ledger=${ledger}`]);
			assert.equal(result.status, 0, result.stderr);
			const page = readFileSync(out, 'utf8');
			assert.equal(page.includes('verdict: OK'), true);
			assert.equal(page.includes('policy_status=proposed'), false);
			assertNoSensitiveInText(page);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('refuses to write a page whose own text would leak a value', () => {
		const dir = mkdtempSync(join(tmpdir(), 'operator-mfa-leak-'));
		try {
			// The case label is fixture data rendered onto the page, so an
			// address pasted there must stop the command rather than become
			// the artefact.
			const fixtures = join(dir, 'fixtures');
			cpSync(FIXTURE_DIR, fixtures, { recursive: true });
			const path = join(fixtures, 'one-unconfirmed.json');
			const leaky = JSON.parse(readFileSync(path, 'utf8'));
			leaky.case = 'Infisical (owner@example.invalid)';
			writeFileSync(path, `${JSON.stringify(leaky, null, 2)}\n`, 'utf8');

			const out = join(dir, 'leaky.html');
			const result = runGenerator(['--skip-screenshot', `--out=${out}`, `--fixtures=${fixtures}`]);
			assert.equal(result.status, 2);
			assert.match(result.stderr, /anonymization guard: email-address/);
			assert.equal(result.stderr.includes('owner@example.invalid'), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
