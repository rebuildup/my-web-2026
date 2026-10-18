import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
/**
 * `render-dependency-audit-report.mjs` tests (Issue #470).
 *
 * The report is a committed screenshot source and a CI artifact, so it
 * has to satisfy three properties that are asserted here rather than
 * assumed:
 *
 *   1. Self-contained: no script tag, no external asset, no network
 *      fetch. A report that could execute would make the artifact
 *      untrustworthy.
 *   2. Escaped: advisory titles arrive from the registry, so every
 *      interpolated value is HTML-escaped.
 *   3. Honest about data: the unavailable verdict renders `unknown`
 *      counts and says so, rather than a table of zeros that reads like
 *      a clean scan.
 */
import {
	evaluateAdvisories,
	evaluateUnavailableData,
	parseAdvisoryPayload,
	parseGateDeclaration,
} from './_dependency-advisories.mjs';
import { buildReportModel, escapeHtml, renderReport } from './render-dependency-audit-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'dependency-advisories');
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const NOW = new Date('2026-10-18T00:00:00Z');

const gateWithException = parseGateDeclaration(fixture('gate-with-exception.json'));
const gateWithMismatchedException = parseGateDeclaration(
	fixture('gate-with-mismatched-exception.json'),
);
const blockingFindings = parseAdvisoryPayload(fixture('blocking.json'));
const multiPackageFindings = parseAdvisoryPayload(fixture('multi-package.json'));
const auditGate = parseGateDeclaration(
	JSON.parse(readFileSync(join(HERE, '..', 'quality', 'dependency-advisory-gate.json'), 'utf8')),
);

const blockingResult = evaluateAdvisories({
	findings: blockingFindings,
	gate: { ...gateWithException, exceptions: [] },
	now: NOW,
});
const exceptedResult = evaluateAdvisories({
	findings: blockingFindings.filter((finding) => finding.severity === 'critical'),
	gate: gateWithException,
	now: NOW,
});
const unavailableResult = evaluateUnavailableData({
	gate: auditGate,
	now: NOW,
	reason: 'pnpm audit --json returned an error document',
});
const meta = { source: 'fixture', gatePath: 'quality/dependency-advisory-gate.json' };

describe('buildReportModel', () => {
	it('flattens the verdict into the numbers the report shows', () => {
		const model = buildReportModel(blockingResult, meta);
		assert.equal(model.status, 'fail');
		assert.equal(model.statusLabel, 'FAIL');
		assert.equal(model.total, 4);
		assert.equal(model.blockingCount, 2);
		assert.deepEqual(model.counts, { info: 0, low: 1, moderate: 1, high: 1, critical: 1 });
		assert.deepEqual(
			model.blocking.map((row) => row.package),
			['fixture-runtime', 'fixture-parser'],
		);
		assert.equal(model.source, 'fixture');
	});

	it('marks unavailable data with unknown counts, never zero', () => {
		const model = buildReportModel(unavailableResult, meta);
		assert.equal(model.statusLabel, 'DATA UNAVAILABLE');
		assert.equal(model.total, 'unknown');
		assert.equal(model.blockingCount, 'unknown');
		for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
			assert.equal(model.counts[severity], 'unknown');
		}
		assert.match(model.dataDetail, /error document/);
	});

	it('carries the exception record through for review', () => {
		const model = buildReportModel(exceptedResult, meta);
		assert.equal(model.status, 'pass');
		assert.equal(model.excepted.length, 1);
		assert.equal(model.excepted[0].approvedBy, 'fixture: repository owner (not a real approval)');
		assert.equal(model.excepted[0].trackingIssue, '470');
		assert.equal(model.excepted[0].daysRemaining, 105);
	});

	it('shows a record that matches no finding as what it is, next to the finding it failed to cover', () => {
		const result = evaluateAdvisories({
			findings: multiPackageFindings,
			gate: gateWithMismatchedException,
			now: NOW,
		});
		const model = buildReportModel(result, meta);
		assert.equal(model.status, 'fail');
		assert.equal(model.blockingCount, 2);
		assert.equal(model.excepted.length, 0);
		assert.equal(model.mismatched.length, 1);
		assert.equal(model.mismatched[0].declared, 'fixture-server-bundle/critical');
		assert.equal(
			model.mismatched[0].reportedAs,
			'fixture-runtime/critical, fixture-server-core/critical',
		);
		const html = renderReport(result, model);
		assert.ok(html.includes('Exception records that match no finding (1)'));
		assert.ok(html.includes('suppressed nothing'));
		assert.ok(html.includes('fixture-server-bundle/critical'));
	});
});

describe('renderReport — self-contained document', () => {
	const html = renderReport(blockingResult, buildReportModel(blockingResult, meta));

	it('is an HTML document with an inline stylesheet only', () => {
		assert.match(html, /^<!doctype html>/);
		assert.ok(html.includes('<style>'));
		assert.doesNotMatch(html, /<script\b/i);
		assert.doesNotMatch(html, /<(link|img|iframe)\b[^>]*\b(src|href)=/i);
		assert.doesNotMatch(html, /https?:\/\/[^"' ]*\.(js|css|woff2?|png|jpg)/i);
	});

	it('states the verdict, the enforcement mode and the blocking severities', () => {
		assert.ok(html.includes('>FAIL<'));
		assert.ok(html.includes('critical, high'));
		assert.ok(html.includes('enforcement'));
		assert.ok(html.includes('blocking advisories are outstanding and enforcement is block'));
	});

	it('lists every blocking advisory with its patched version and dependency path', () => {
		assert.ok(html.includes('GHSA-fixt-fixt-fixt'));
		assert.ok(html.includes('GHSA-fixt-fixt-figh'));
		assert.ok(html.includes('&gt;=2.4.0'));
		assert.ok(html.includes('.&gt;fixture-app&gt;fixture-runtime'));
		assert.ok(html.includes('dev dependency path'));
	});

	it('shows the approved exception with reason, approver, tracking and expiry', () => {
		const excepted = renderReport(exceptedResult, buildReportModel(exceptedResult, meta));
		assert.ok(excepted.includes('GHSA-fixt-fixt-fixt'));
		assert.ok(excepted.includes('fixture: repository owner (not a real approval)'));
		assert.ok(excepted.includes('2027-01-31'));
		assert.ok(excepted.includes('Approved exceptions in force (1)'));
	});

	it('renders the unavailable verdict without a numeric advisory count', () => {
		const unavailable = renderReport(unavailableResult, buildReportModel(unavailableResult, meta));
		assert.ok(unavailable.includes('DATA UNAVAILABLE'));
		assert.ok(unavailable.includes('UNAVAILABLE — pnpm audit --json returned an error document'));
		assert.ok(unavailable.includes('>unknown<'));
		assert.ok(unavailable.includes('Blocking (unknown)'));
		assert.doesNotMatch(unavailable, /Blocking \(0\)/);
		assert.doesNotMatch(unavailable, /advisory data<\/dt><dd>read from the source/);
	});
});

describe('renderReport — unavailable data must not carry upstream bytes', () => {
	it('renders the withheld-body reason, not the upstream message', () => {
		const result = evaluateUnavailableData({
			gate: auditGate,
			now: NOW,
			reason:
				'pnpm audit --json returned an error document ERR_PNPM_AUDIT_NO_ADVISORY_DOCUMENT; the response body is withheld (see runbook section 5)',
		});
		const html = renderReport(result, buildReportModel(result, meta));
		assert.ok(html.includes('UNAVAILABLE — pnpm audit --json returned an error document'));
		assert.ok(html.includes('the response body is withheld'));
	});
});

describe('renderReport — hostile registry content', () => {
	it('escapes markup arriving from an advisory title', () => {
		const findings = parseAdvisoryPayload(fixture('hostile-title.json'));
		const result = evaluateAdvisories({
			findings,
			gate: { ...gateWithException, exceptions: [] },
			now: NOW,
		});
		const html = renderReport(result, buildReportModel(result, meta));
		assert.doesNotMatch(html, /<img src=x/i);
		assert.doesNotMatch(html, /alert\('xss'\)/);
		assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;'));
	});

	it('escapes the documented five characters', () => {
		assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
		assert.equal(escapeHtml(undefined), '');
	});
});
