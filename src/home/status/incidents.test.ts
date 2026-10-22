import { describe, expect, it } from 'vitest';
import type { KnownIncident } from './incidents';
import {
	INCIDENT_TRACKER_URL,
	KNOWN_INCIDENTS,
	isPublishableIncidentReference,
	isValidIncidentRecord,
	selectPublishableIncidents,
} from './incidents';

/**
 * The incident data contract (Issue #502).
 *
 * The published incident list is a COMMITTED data file, so the
 * properties an auditor checks are properties of the file, not of a
 * runtime feed:
 *
 *   - every published record points at a page that really exists
 *     (an issue in the canonical public repository, or a public
 *     route of this site), and nothing else;
 *   - a record that fails the rule is withheld rather than
 *     rendered, and the surface does not then claim that there were
 *     no incidents;
 *   - the published list starts EMPTY, because the platform has no
 *     incident that is both public and safe to publish. Adding a
 *     real incident means adding it HERE, with a real reference, and
 *     updating the expectation below in the same pull request — a
 *     fabricated record cannot be added quietly.
 */

const VALID_RECORD: KnownIncident = {
	id: 'sample',
	title: 'A sample record',
	occurredAt: '2026-01-05',
	summary: 'A record that satisfies every rule.',
	reference: 'https://github.com/rebuildup/my-web-2026/issues/1',
};

describe('incident references', () => {
	it('accepts the canonical public issue tracker and its issues', () => {
		expect(isPublishableIncidentReference(INCIDENT_TRACKER_URL)).toBe(true);
		expect(
			isPublishableIncidentReference('https://github.com/rebuildup/my-web-2026/issues/42'),
		).toBe(true);
	});

	it('accepts a public route of this site', () => {
		expect(isPublishableIncidentReference('https://rebuildup.dev/portfolio')).toBe(true);
	});

	it('refuses anything that is not a real public page', () => {
		// A status domain that does not exist.
		expect(isPublishableIncidentReference('https://status.rebuildup.dev/incidents')).toBe(false);
		// A different repository.
		expect(isPublishableIncidentReference('https://github.com/someone/else/issues/1')).toBe(false);
		// A path that is not the issue tracker.
		expect(isPublishableIncidentReference('https://github.com/rebuildup/my-web-2026')).toBe(false);
		// Not HTTPS.
		expect(isPublishableIncidentReference('http://github.com/rebuildup/my-web-2026/issues/1')).toBe(
			false,
		);
		// A script URL.
		expect(isPublishableIncidentReference('javascript:alert(1)')).toBe(false);
		// The admin surface is not a public record.
		expect(isPublishableIncidentReference('https://rebuildup.dev/admin/login')).toBe(false);
		// Not a URL at all.
		expect(isPublishableIncidentReference('issues/1')).toBe(false);
	});
});

describe('incident records', () => {
	it('accepts a complete record', () => {
		expect(isValidIncidentRecord(VALID_RECORD)).toBe(true);
	});

	it('refuses a record with a missing field or an unreadable date', () => {
		expect(isValidIncidentRecord({ ...VALID_RECORD, title: '' })).toBe(false);
		expect(isValidIncidentRecord({ ...VALID_RECORD, summary: '' })).toBe(false);
		expect(isValidIncidentRecord({ ...VALID_RECORD, id: '' })).toBe(false);
		expect(isValidIncidentRecord({ ...VALID_RECORD, occurredAt: 'last tuesday' })).toBe(false);
	});

	it('withholds the records that fail the rule', () => {
		const records: readonly KnownIncident[] = [
			VALID_RECORD,
			{ ...VALID_RECORD, id: 'broken', reference: 'https://example.invalid/status' },
		];
		const publishable = selectPublishableIncidents(records);
		expect(publishable).toHaveLength(1);
		expect(publishable[0]?.id).toBe('sample');
	});
});

describe('the published list', () => {
	it('publishes only records whose reference can be verified', () => {
		for (const record of KNOWN_INCIDENTS) {
			expect(isValidIncidentRecord(record)).toBe(true);
		}
	});

	it('starts from an empty list — the honest starting point (Issue #502)', () => {
		// There is no public, safe incident record to publish yet, so
		// the surface renders "no incidents recorded" instead of an
		// invented one. Adding a REAL incident means updating this
		// expectation in the same pull request, which is the point:
		// the list cannot grow quietly.
		expect(KNOWN_INCIDENTS).toHaveLength(0);
	});
});
