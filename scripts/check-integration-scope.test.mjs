import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	PROBE_FIXTURES,
	applyOps,
	checkIntegrationScope,
	evaluateFixture,
	findIntegrationMounts,
	findProvisionedIntegrationSecrets,
	findSecretCell,
	isRealReason,
	parseIntegrationRoster,
} from './check-integration-scope.mjs';

/**
 * The gate's own contract (Issue #464).
 *
 * Two things are being protected here. First, that the shipped ledger
 * passes: the gate must not become a check that fails because a probe
 * rotted. Second — and this is the one that matters — that a *broken*
 * ledger still fails: every false-green probe has to be refused, and the
 * refusal has to be the one the probe claims to test.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = 'quality/fixtures/integration-scope';

test('the shipped ledger passes the gate', () => {
	const result = checkIntegrationScope({ root: ROOT });
	assert.deepEqual(result.errors, []);
	assert.ok(result.summary.candidates >= 3, 'at least the three named candidates are reviewed');
	assert.ok(result.summary.approved >= 1, 'at least one connection is validated end to end');
	assert.ok(result.summary.refused >= 1, 'at least one connection is refused');
});

test('every reviewed connection is measured, and the measurement agrees with the claim', () => {
	const { connections } = checkIntegrationScope({ root: ROOT });
	assert.ok(connections.length > 0);
	for (const connection of connections) {
		assert.equal(connection.matches, true, `${connection.id} does not match its declared verdict`);
		assert.ok(
			connection.verdict !== 'approved' || connection.code === 'approved',
			`${connection.id}: an approval must carry the approval code`,
		);
	}
});

test('the ledger refuses every unapproved scope and every dead grant it claims to', () => {
	const { connections } = checkIntegrationScope({ root: ROOT });
	const refusals = connections.filter((row) => row.verdict !== 'approved');
	assert.ok(
		refusals.some((row) => row.verdict === 'unapproved_scope'),
		'an unapproved scope must be visible in the report',
	);
	assert.ok(
		refusals.some((row) => row.verdict === 'reauth_required'),
		'a re-authorization failure must be visible in the report',
	);
	for (const row of refusals) {
		const detail = row.unapproved.concat(row.missing, row.reauth);
		assert.ok(detail.length > 0, `${row.id}: a refusal must name what was wrong`);
	}
});

test('no candidate is published while the owner allowlist is empty', () => {
	const { rows, summary, manifest } = checkIntegrationScope({ root: ROOT });
	assert.deepEqual(manifest.allowlist.entries, []);
	assert.equal(summary.allowlisted, 0);
	assert.equal(summary.mounts, 0);
	for (const row of rows) {
		assert.equal(row.published_surface, 'none', `${row.id} must not declare a published surface`);
	}
});

test('the false-green probes are all refused for the reason they claim', () => {
	assert.ok(PROBE_FIXTURES.length >= 4, 'the probe suite must cover more than the happy path');
	for (const file of PROBE_FIXTURES) {
		const probe = evaluateFixture(ROOT, file);
		assert.equal(probe.verdict, 'pass', `${file}: ${probe.errors.join(' | ')}`);
	}
});

test('the happy-path probe is the shipped ledger with no patch', () => {
	const fixture = JSON.parse(readFileSync(join(ROOT, FIXTURES, 'pass.json'), 'utf8'));
	assert.deepEqual(fixture.ops, [], 'pass.json must not patch anything');
});

test('a ledger that claims an over-scoped connection is approved fails', () => {
	const fixture = JSON.parse(
		readFileSync(join(ROOT, FIXTURES, 'false-green-approval.json'), 'utf8'),
	);
	const result = checkIntegrationScope({ root: ROOT, ops: fixture.ops });
	assert.ok(result.errors.length > 0);
	assert.match(result.errors.join('\n'), /the adapter returns/);
});

test('publishing a candidate without an owner allowlist entry fails', () => {
	const result = checkIntegrationScope({
		root: ROOT,
		ops: [
			{
				op: 'set',
				path: 'integrations.0.published_surface',
				value: '/integrations/github/callback',
			},
		],
	});
	assert.match(result.errors.join('\n'), /without an allowlist entry/);
});

test('an allowlist entry is enough to publish, and it still has to be a real decision', () => {
	const ops = [
		{ op: 'set', path: 'integrations.0.published_surface', value: '/integrations/github/callback' },
		{
			op: 'set',
			path: 'allowlist.entries',
			value: [
				{
					id: 'github',
					approved_by: 'repository owner',
					approved_on: '2026-10-19',
					reason: 'the activity capability now owns the public identity read',
				},
			],
		},
	];
	assert.deepEqual(checkIntegrationScope({ root: ROOT, ops }).errors, []);

	const withoutReason = structuredClone(ops);
	withoutReason[1].value[0].reason = 'tbd';
	assert.match(
		checkIntegrationScope({ root: ROOT, ops: withoutReason }).errors.join('\n'),
		/allowlist\.entries\[0\]\.reason/,
	);
});

test('a candidate that vanishes from the ledger while the domain document lists it fails', () => {
	const result = checkIntegrationScope({
		root: ROOT,
		ops: [{ op: 'remove', path: 'integrations.0.id' }],
	});
	assert.match(result.errors.join('\n'), /no reviewed row/);
});

test('a status that disagrees with docs/domain/integrations.md fails', () => {
	const result = checkIntegrationScope({
		root: ROOT,
		ops: [{ op: 'set', path: 'integrations.0.status', value: 'integrated' }],
	});
	assert.match(result.errors.join('\n'), /ledger says "integrated"/);
});

test('a row without a revocation procedure fails', () => {
	const result = checkIntegrationScope({
		root: ROOT,
		ops: [{ op: 'remove', path: 'integrations.1.revocation.procedure' }],
	});
	assert.match(result.errors.join('\n'), /revocation\.procedure/);
});

test('a retention ceiling of zero fails: an unbounded token is not a reviewed contract', () => {
	const result = checkIntegrationScope({
		root: ROOT,
		ops: [{ op: 'set', path: 'integrations.0.token_retention.max_age_days', value: 0 }],
	});
	assert.match(result.errors.join('\n'), /max_age_days/);
});

test('a required scope that is also denied fails as a contradiction', () => {
	const result = checkIntegrationScope({
		root: ROOT,
		ops: [
			{ op: 'set', path: 'integrations.0.least_privilege.denied_scopes', value: ['read:user'] },
		],
	});
	assert.match(result.errors.join('\n'), /both required\/optional and denied/);
});

test('an unreviewed re-auth code fails: a caller cannot surface a code the adapter never emits', () => {
	const result = checkIntegrationScope({
		root: ROOT,
		ops: [{ op: 'set', path: 'integrations.0.reauth.error_codes', value: ['try_again_later'] }],
	});
	assert.match(result.errors.join('\n'), /not a code the adapter publishes/);
});

test('an evidence path that does not exist fails', () => {
	const result = checkIntegrationScope({
		root: ROOT,
		ops: [
			{ op: 'set', path: 'integrations.0.evidence', value: ['docs/security/does-not-exist.md'] },
		],
	});
	assert.match(result.errors.join('\n'), /does not exist/);
});

test('applyOps refuses a path that does not exist and an unknown operation', () => {
	const base = { a: { b: 1 } };
	assert.deepEqual(applyOps(base, [{ op: 'set', path: 'a.b', value: 2 }]), { a: { b: 2 } });
	assert.deepEqual(applyOps(base, [{ op: 'remove', path: 'a.b' }]), { a: {} });
	assert.throws(() => applyOps(base, [{ op: 'set', path: 'a.z.b', value: 2 }]), /does not exist/);
	assert.throws(() => applyOps(base, [{ op: 'merge', path: 'a', value: {} }]), /unknown op/);
	// The input is never mutated: the real ledger must survive a probe.
	assert.deepEqual(base, { a: { b: 1 } });
});

test('parseIntegrationRoster reads the domain document, not the ledger', () => {
	const markdown = [
		'| ID | Service | Current status | Current owner |',
		'| --- | --- | --- | --- |',
		'| github | GitHub API | **not integrated** | none |',
		'| notion | Notion API | **uncommitted** | none |',
		'| Cloudflare Workers | active | runtime |',
	].join('\n');
	const roster = parseIntegrationRoster(markdown);
	assert.equal(roster.get('github'), 'not integrated');
	assert.equal(roster.get('notion'), 'uncommitted');
	assert.equal(roster.has('Cloudflare Workers'), false, 'platform rows are not candidates');
});

test('no /integrations route is mounted and no integration token is provisioned', () => {
	assert.deepEqual(findIntegrationMounts(ROOT), []);
	assert.deepEqual(
		findProvisionedIntegrationSecrets(),
		[],
		'no Worker secret name belongs to a candidate integration',
	);
});

test('the mount detector reports a route and ignores the boundary’s own documentation', () => {
	const root = mkdtempSync(join(tmpdir(), 'integration-scope-'));
	const httpRoot = join(root, 'src/http');
	mkdirSync(join(httpRoot, 'integrations'), { recursive: true });
	writeFileSync(
		join(httpRoot, 'integrations/router.ts'),
		[
			'/**',
			' * `/integrations/*` third-party integration adapters — this comment',
			' * must not be mistaken for a mounted route.',
			' */',
			"export const router = new Hono().post('/integrations/github/callback', handler);",
		].join('\n'),
		'utf8',
	);
	writeFileSync(
		join(httpRoot, 'hono.ts'),
		"const app = new Hono();\n// '/integrations/*' is documented here\n",
		'utf8',
	);

	const found = findIntegrationMounts(root);
	assert.equal(found.length, 1, 'only the file that registers a route is reported');
	assert.match(found[0], /src\/http\/integrations\/router\.ts$/);
	rmSync(root, { recursive: true, force: true });
});

test('the credential-shape guard is cell-anchored, not keyword-based', () => {
	// The two provider-shaped values are assembled from parts rather
	// than written as literals: `secret:scan` must never see a
	// credential-shaped string in the tracked tree, and a waiver entry
	// for the scanner would be a worse trade than one `join`.
	const githubToken = ['gh', 'p_', 'a'.repeat(36)].join('');
	const slackToken = ['xox', 'b-', 'b'.repeat(12), '-', 'c'.repeat(10)].join('');
	assert.ok(findSecretCell([githubToken]));
	assert.ok(findSecretCell([slackToken]));
	assert.ok(findSecretCell(['secret_0123456789abcdef0123']));
	assert.ok(findSecretCell(['operator@example.com']));
	assert.ok(findSecretCell(['Bearer 0123456789abcdef']));
	assert.equal(findSecretCell(['read:user', 'insert_content', 'none']), null);
	assert.equal(findSecretCell(['non-Bearer header', '', null]), null);
});

test('isRealReason rejects placeholders and short prose', () => {
	assert.equal(isRealReason('tbd'), false);
	assert.equal(isRealReason('n/a'), false);
	assert.equal(isRealReason('-'), false);
	assert.equal(isRealReason('owner'), false);
	assert.equal(isRealReason('the repository owner may revoke this grant'), true);
});
