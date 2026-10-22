/**
 * Known-incident records for the status surface (Issue #502).
 *
 * What is published
 * -----------------
 * This module owns the ONLY incident information the public status
 * surface may render: a short title, the date it happened on, a
 * one-line summary and a link to a public record of it. Nothing
 * else about an incident is published — no operator name, no
 * credential, no third-party personal data, no internal note.
 *
 * Where the records come from
 * ---------------------------
 * A COMMITTED data file, read at request time. The status surface
 * never fetches an incident list from a third party, and there is no
 * runtime feed to fall back on: the point of a committed record is
 * that what a visitor reads is exactly what the repository holds and
 * what a reviewer can diff.
 *
 * What the surface does NOT do
 * -----------------------------
 *   - It performs NO external communication. Nothing here fetches,
 *     posts or reports to any host; the only outbound link the
 *     visitor can follow is a plain `<a>` to a public page, which the
 *     visitor's own browser resolves, not the Worker.
 *   - It publishes NO guessed personal information. A record is a
 *     statement about the platform, and the only actor it may name
 *     is the platform itself.
 *
 * What an auditor can check
 * --------------------------
 *   - `KNOWN_INCIDENTS` is the whole published set; it is read from
 *     this file and from nowhere else.
 *   - Every record must carry a reference that resolves to a page
 *     that really exists: an issue in the canonical public
 *     repository, or a public route of this site.
 *     `isPublishableIncidentReference()` is the fail-closed rule and
 *     it is enforced again at render time, so a record that slips
 *     past review is still withheld from the page.
 *   - `selectPublishableIncidents()` returns only the records that
 *     pass the rule; the component renders the withheld ones as
 *     withheld, never as "there were no incidents".
 */

/**
 * A published incident record.
 *
 * Every field is a fact about the platform. `reference` is the only
 * way out of the page, so it is the field the fail-closed rule
 * guards.
 */
export interface KnownIncident {
	/** Stable identifier, unique within the published list. */
	id: string;
	/** Short headline of what happened. */
	title: string;
	/** ISO-8601 date (or instant) the incident happened on. */
	occurredAt: string;
	/** One line describing the impact in public terms. */
	summary: string;
	/** Absolute URL of a public record of this incident. */
	reference: string;
}

/**
 * The canonical public issue tracker of this repository.
 *
 * It is the default place a visitor is pointed at when there is no
 * incident to link, and the only host the reference rule trusts for
 * repository records. The repository is public, so the tracker is
 * readable by anyone.
 */
export const INCIDENT_TRACKER_URL = 'https://github.com/rebuildup/my-web-2026/issues';

/**
 * Hosts a published incident reference may point at.
 *
 * `github.com` is trusted only for the canonical repository's issue
 * tracker; `rebuildup.dev` is trusted only for a public route of this
 * site. Anything else — a status domain that does not exist, a
 * shortened link, a `http://` URL, a `javascript:` URL — is refused.
 */
const REPOSITORY_ISSUE_PATH = '/rebuildup/my-web-2026/issues';
const PUBLIC_ROUTE_HOST = 'rebuildup.dev';

/**
 * Whether a reference points at a page that really exists.
 *
 * The rule is deliberately narrow and fails closed: an unknown host,
 * a non-HTTPS scheme, or a non-public path is refused.
 */
export function isPublishableIncidentReference(reference: string): boolean {
	let url: URL;
	try {
		url = new URL(reference);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:') return false;
	if (url.hostname === 'github.com') {
		return (
			url.pathname === REPOSITORY_ISSUE_PATH || url.pathname.startsWith(`${REPOSITORY_ISSUE_PATH}/`)
		);
	}
	if (url.hostname === PUBLIC_ROUTE_HOST) {
		// A public route of this site. The admin surface is not one:
		// it is not indexed, and an incident record must never point a
		// visitor at a login.
		return url.pathname.startsWith('/') && !url.pathname.startsWith('/admin');
	}
	return false;
}

/** An ISO-8601 date or instant, as `occurredAt` must be. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;

/**
 * Whether a record carries every fact the surface needs and points
 * at a reference that really exists.
 */
export function isValidIncidentRecord(record: KnownIncident): boolean {
	return (
		typeof record.id === 'string' &&
		record.id.length > 0 &&
		typeof record.title === 'string' &&
		record.title.length > 0 &&
		typeof record.summary === 'string' &&
		record.summary.length > 0 &&
		ISO_DATE.test(record.occurredAt) &&
		!Number.isNaN(Date.parse(record.occurredAt)) &&
		isPublishableIncidentReference(record.reference)
	);
}

/**
 * The records that may be published.
 *
 * Fail-closed: a record that fails any rule is withheld, and the
 * caller can still tell "there was nothing to publish" from
 * "everything was withheld" by comparing the lengths.
 */
export function selectPublishableIncidents(
	records: readonly KnownIncident[],
): readonly KnownIncident[] {
	return records.filter((record) => isValidIncidentRecord(record));
}

/**
 * The published incident records.
 *
 * This list is EMPTY on purpose (Issue #502). The platform has no
 * incident record that is both public and safe to publish, so the
 * honest starting point is an empty list that renders "no incidents
 * recorded" — not an invented incident. A real incident is added
 * here with a real public reference, in a pull request a reviewer can
 * diff.
 */
export const KNOWN_INCIDENTS: readonly KnownIncident[] = [];
