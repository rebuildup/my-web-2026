/**
 * RFC 9116 `security.txt` document builder (Issue #468).
 *
 * Ownership
 * ---------
 * The vulnerability-reporting *document* is owned by the external HTTP
 * boundary, for the same reason `/sitemap.xml` and `/robots.txt` are
 * (`src/http/seo/README.md`): TanStack Start 1.168 has no raw-response
 * route primitive, so a route file cannot answer with a
 * `text/plain` body. `/.well-known/security.txt` is registered in
 * `EXTERNAL_BOUNDARY_PREFIXES` (`src/server.ts`) and served by
 * `./router.ts`.
 *
 * Module contract
 * ---------------
 * This file is deliberately **dependency-free** (no imports at all):
 *
 *   1. it is pure, so it can be unit-tested without workerd, without
 *      the Worker bundle, and without any Cloudflare binding, and
 *   2. it is importable from a plain `node --test` / `node` script,
 *      which is how `scripts/make-security-txt-verification-report.mjs`
 *      renders the browser screenshot without starting a Worker.
 *
 * The grammar this implements is the one the client needs, not the one
 * the author would enjoy: RFC 9116 §6 parses the file as
 *
 *   *WSP [ start-line ] *( field ) *WSP [ last-line ]
 *
 * where `start-line` is `Contact:` and `last-line` is `Expires:`. The
 * two ORDERING rules are load-bearing and are therefore produced here
 * rather than left to the caller: a `Contact:` after `Expires:` is
 * not a valid `security.txt`, and neither is an `Expires:` before the
 * last line. `{@link renderSecurityTxt}` emits the fields in the order
 * the ABNF allows and `document.test.ts` pins it.
 *
 * No comment lines
 * ----------------
 * RFC 9116 §6 has no comment production: a line beginning with `#` is
 * a field whose name this parser does not know, so a well-meaning
 * "helpful" comment makes the whole file invalid. Nothing here emits
 * one, and {@link SECURITY_TXT_ALLOWED_FIELDS} is the exhaustive list
 * of names the output may contain.
 *
 * Encoding
 * --------
 * The file is UTF-8 (`; charset=utf-8` on the response). RFC 9116 §7
 * says the fields themselves are restricted to a small ASCII subset;
 * every value is validated in `./schema.ts` before it reaches this
 * renderer, so a value containing a line break cannot inject a second
 * field into the document.
 */

/**
 * RFC 9116 §3.1: the normative location. `/.well-known/security.txt`
 * is the only path this surface is served at — the legacy `/security.txt`
 * fallback of RFC 9116 §3.2 is deliberately NOT published, so there is
 * exactly one canonical URL and one `Canonical:` value.
 */
export const SECURITY_TXT_PATH = '/.well-known/security.txt';

/**
 * RFC 9116 §3: the file MUST be served with `text/plain`. The charset
 * parameter is stated explicitly so the document does not depend on the
 * platform's default (RFC 9116 §7 allows UTF-8).
 */
export const SECURITY_TXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

/**
 * Canonical production origin (ADR-0014). Declared here for the same
 * reason `SITEMAP_ORIGIN` is declared in `src/http/seo/sitemap.ts`:
 * the `Canonical:` field has to be an absolute URL, and the production
 * origin is a deployment fact rather than something derivable from the
 * request the Worker happens to be answering.
 */
export const SECURITY_TXT_ORIGIN = 'https://rebuildup.dev';

/**
 * Every field name this renderer may emit, in emission order.
 *
 * RFC 9116 §2 orders the grammar `Contact` → (any) → `Expires`, and
 * the test suite asserts that this list is both complete and ordered.
 * `Signatures:` (§2.10) is intentionally absent: it carries a detached
 * PGP signature over the file, which needs an operator key this
 * repository does not own and must never invent.
 */
export const SECURITY_TXT_ALLOWED_FIELDS = Object.freeze([
	'Contact',
	'Encryption',
	'Acknowledgments',
	'Preferred-Languages',
	'Canonical',
	'Policy',
	'Hiring',
	'CSAF',
	'Expires',
] as const);

/**
 * One `security.txt` document, already validated.
 *
 * Every field is optional except {@link expires}: RFC 9116 §2 requires
 * at least ONE of `Contact` / `Encryption` / `Acknowledgments` /
 * `Policy`, and `./schema.ts` refuses to build a `SecurityTxtDocument`
 * that carries none of them — a document with no way to report
 * anything is worse than no document, because a scanner records it as
 * "published".
 */
export interface SecurityTxtDocument {
	/**
	 * RFC 9116 §2.1. Ordered, repeatable. Each value is a URI: in
	 * practice `mailto:` for a monitored mailbox, `https:` for a
	 * private-advisory form (GitHub, for instance). The schema rejects
	 * any other scheme, so the field can never carry a `javascript:`
	 * or a `file:` reference a reader's client would follow.
	 */
	readonly contacts: readonly string[];
	/**
	 * RFC 9116 §2.5. An RFC 3339 instant. Rendered verbatim in
	 * UTC (`Date.toISOString()`), never in a local zone: two readers
	 * of the same file must not compute different deadlines.
	 */
	readonly expires: string;
	/** RFC 9116 §2.6. Where to fetch an OpenPGP key (`https:` / `dns:`). */
	readonly encryption?: readonly string[];
	/** RFC 9116 §2.7. Where acknowledgement of a report is published. */
	readonly acknowledgments?: readonly string[];
	/** RFC 9116 §2.4. BCP 47 tags, most-preferred first. */
	readonly preferredLanguages?: readonly string[];
	/** RFC 9116 §2.3. Absolute URL; here always the origin + path. */
	readonly canonical?: string;
	/** RFC 9116 §2.2. The human-readable disclosure policy. */
	readonly policy?: string;
	/** RFC 9116 §2.8. Where security job openings are published. */
	readonly hiring?: string;
	/** RFC 9116 §2.9. A machine-readable CSAF advisories document. */
	readonly csaf?: string;
}

/**
 * Absolute canonical URL of this document on the production origin.
 *
 * Derived from two constants rather than stored in the manifest: the
 * path is fixed by RFC 9116 §3.1 and the origin by ADR-0014, so the
 * only way for the two to disagree is a second hand-written URL
 * literal somewhere in the repository.
 */
export const SECURITY_TXT_CANONICAL_URL = `${SECURITY_TXT_ORIGIN}${SECURITY_TXT_PATH}`;

/** Append one `Field: value` line per value, skipping an absent field. */
function pushField(lines: string[], field: string, values: readonly string[] | undefined): void {
	if (values === undefined) return;
	for (const value of values) lines.push(`${field}: ${value}`);
}

/**
 * Render the document.
 *
 * Field order follows RFC 9116 §6: `Contact:` first (it is the
 * `start-line` production), `Expires:` last (the `last-line`
 * production). Everything in between is one field per line, repeated
 * once per value.
 *
 * The body ends with a trailing newline so the file is a well-formed
 * text file under POSIX and under every parser that splits on `\n`.
 * RFC 9116's ABNF spells the line ending `CRLF`; LF is what every
 * shipping implementation emits (and what `renderRobotsTxt` in
 * `src/http/seo/sitemap.ts` emits for the sibling document), so the
 * two crawler-facing documents agree.
 */
export function renderSecurityTxt(document: SecurityTxtDocument): string {
	const lines: string[] = [];
	pushField(lines, 'Contact', document.contacts);
	pushField(lines, 'Encryption', document.encryption);
	pushField(lines, 'Acknowledgments', document.acknowledgments);
	pushField(lines, 'Preferred-Languages', document.preferredLanguages);
	if (document.canonical !== undefined) lines.push(`Canonical: ${document.canonical}`);
	if (document.policy !== undefined) lines.push(`Policy: ${document.policy}`);
	if (document.hiring !== undefined) lines.push(`Hiring: ${document.hiring}`);
	if (document.csaf !== undefined) lines.push(`CSAF: ${document.csaf}`);
	lines.push(`Expires: ${document.expires}`);
	return `${lines.join('\n')}\n`;
}

/**
 * Is this document still inside its own validity window?
 *
 * RFC 9116 §2.5.1: once `Expires` is in the past the file SHOULD be
 * removed, because the reporting channel it advertises may no longer
 * be monitored. Serving the stale bytes anyway is the failure this
 * whole publication gate exists to prevent — a scanner records the
 * first `Contact:` it ever read and stops looking, so a dead mailbox
 * that is still advertised is worse than a `404`.
 *
 * A value that does not parse as a date is treated as EXPIRED, not as
 * "always valid": an unreadable deadline is not a licence to keep
 * publishing.
 */
export function isSecurityTxtLive(document: SecurityTxtDocument, now: number): boolean {
	const expires = Date.parse(document.expires);
	return Number.isFinite(expires) && expires > now;
}
