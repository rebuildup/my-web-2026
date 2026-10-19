import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	PROBE_FIXTURES,
	checkIntegrationScope,
	evaluateFixture,
	findSecretCell,
} from './check-integration-scope.mjs';
import { renderIntegrationScopeReport } from './make-integration-scope-report.mjs';

/**
 * The report is the artefact a reviewer reads instead of running the
 * gate, so its claims have to be the gate's claims: same ledger, same
 * measured verdicts, same probes. These assertions are on the rendered
 * HTML, not on the generator's intentions.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = checkIntegrationScope({ root: ROOT });
const probes = PROBE_FIXTURES.map((file) => evaluateFixture(ROOT, file));
const html = renderIntegrationScopeReport({ result, probes, sourceSha: 'test-sha' });

test('the report renders every candidate and every measured connection', () => {
	for (const row of result.rows) {
		assert.ok(html.includes(`<code>${row.id}</code>`), `${row.id} is missing from the report`);
	}
	for (const connection of result.connections) {
		assert.ok(
			html.includes(`<code>${connection.id}</code>`),
			`${connection.id} is missing from the report`,
		);
		assert.ok(
			html.includes(connection.verdict),
			`${connection.id}: the measured verdict is not rendered`,
		);
		assert.ok(html.includes(connection.code), `${connection.id}: the refusal code is not rendered`);
	}
});

test('an unapproved scope and a re-authorization failure are both visible', () => {
	assert.ok(
		html.includes('unapproved_scope'),
		'an unapproved scope must be nameable in the artefact',
	);
	assert.ok(html.includes('reauth_required'), 'a re-authorization failure must be nameable');
	assert.ok(
		html.includes('token_age_exceeds_retention'),
		'the retention refusal code must be rendered',
	);
});

test('the report states the publication state rather than implying a live connection', () => {
	assert.ok(html.includes('allowlist entries'), 'the allowlist count must be rendered');
	assert.ok(html.includes('mounted'), 'the mounted-route count must be rendered');
	assert.match(html, /0\s*<\/strong>mounted/, 'no /integrations route may be mounted today');
});

test('the report renders every false-green probe and its verdict', () => {
	for (const probe of probes) {
		assert.ok(html.includes(probe.file), `${probe.file} is missing from the report`);
		assert.ok(
			html.includes(probe.verdict === 'pass' ? 'error(s), as expected' : 'FAIL'),
			`${probe.file}: the probe verdict cell must say which way it went`,
		);
	}
	assert.ok(
		probes.every((probe) => probe.verdict === 'pass'),
		'the screenshot may only be taken when every probe is refused as intended',
	);
});

test('the report escapes what it renders and carries no credential-shaped cell', () => {
	const serialized = html.replace(/<[^>]+>/g, ' ');
	assert.equal(findSecretCell(serialized.split(/\s{2,}/)), null);
	for (const connection of result.connections) {
		for (const scope of connection.granted.split(', ').filter(Boolean)) {
			assert.equal(findSecretCell([scope]), null, scope);
		}
	}
});

test('the report declares the issue, the ledger and the regeneration command', () => {
	assert.match(html, /Issue #464/);
	assert.match(html, /quality\/integration-scope\.json/);
	assert.match(html, /pnpm run verify:integration-scope-screenshot/);
	assert.match(html, /docs\/security\/integration-token-scope\.md/);
});
