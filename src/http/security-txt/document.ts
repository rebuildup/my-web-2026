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
 * The grammar this implements is the one a strict parser needs, not
 * the one the author would enjoy. RFC 9116 §2 requires the file to
 * follow the ABNF grammar of §4, which for an unsigned file reads
 * (comments and extension fields elided):
 *
 *   unsigned = *line ( contact-field eol )
 *              *line ( expires-field eol )
 *              *line [ lang-field eol ] *line
 *
 * Three ORDERING rules are load-bearing and are therefore produced here
 * rather than left to the caller: at least one `Contact:` line MUST
 * precede the exactly-one `Expires:` line, and the optional
 * `Preferred-Languages:` line — a single field whose values are
 * comma-separated (§2.5.8) — comes AFTER the deadline. A document that
 * satisfies every schema rule but puts `Expires:` first, or languages
 * before it, is not a document the §4 grammar accepts.
 * `{@link renderSecurityTxt}` emits the fields in the order the ABNF
 * allows and `document.test.ts` pins it.
 *
 * No comment lines
 * ----------------
 * RFC 9116 DOES allow comments: §2.1 defines them and the §4 ABNF has
 * a `comment` production (`line = [ ( field / comment ) ] eol`). Not
 * emitting any is therefore a choice, not a requirement, and the
 * choice is deliberate: this file is machine-parsed, a comment line is
 * one more thing that can go stale, and
 * {@link SECURITY_TXT_ALLOWED_FIELDS} stays the exhaustive list of
 * lines the renderer can emit. `document.test.ts` asserts it.
 *
 * Encoding
 * --------
 * The file is UTF-8: §3 requires `Content-Type: text/plain` with the
 * default charset `utf-8`, and §4 requires the UTF-8 encoding. The
 * VALUES are more restricted than that — §2 defines a field value as
 * RFC 5322 `unstructured`, and the §4 ABNF builds its lines out of
 * `VCHAR` / `WSP`, so a line break does not merely look wrong in a
 * value, it ends the field. Every value is validated in
 * `./schema.ts` before it reaches this renderer, so a value carrying a
 * line break cannot inject a second field into the document.
 */

/**
 * RFC 9116 §3: the normative location is `/.well-known/security.txt`
 * (RFC 8615). It is the only path this surface is served at — the
 * legacy top-level `/security.txt` that §3 allows for compatibility is
 * deliberately NOT published, so there is exactly one canonical URL and
 * one `Canonical:` value.
 */
export const SECURITY_TXT_PATH = '/.well-known/security.txt';

/**
 * RFC 9116 §3: the file MUST be served with `text/plain`. The charset
 * parameter is stated explicitly so the document does not depend on the
 * platform's default (RFC 9116 §3 requires the default charset to be
 * `utf-8`).
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
 * The order is the §4 ABNF's: `Contact` first, `Expires` where the
 * grammar requires it, and the single `Preferred-Languages` field after
 * it. The test suite asserts that this list is complete, ordered, and
 * the same list the renderer emits. `Signatures:` (the OpenPGP
 * clearsign wrapper of §2.3) is intentionally absent: it needs an
 * operator key this repository does not own and must never invent.
 */
export const SECURITY_TXT_ALLOWED_FIELDS = Object.freeze([
	'Contact',
	'Encryption',
	'Acknowledgments',
	'Canonical',
	'Policy',
	'Hiring',
	'CSAF',
	'Expires',
	'Preferred-Languages',
] as const);

/**
 * One `security.txt` document, already validated.
 *
 * Every field is optional except {@link contacts} and {@link expires}:
 * RFC 9116 §2.5.3 says `Contact` "MUST always be present" and §2.5.5
 * says the same of `Expires`, and `./schema.ts` refuses a manifest that
 * would publish either without the other — a document with no way to
 * report anything is worse than no document, because a scanner records
 * it as "published".
 */
export interface SecurityTxtDocument {
	/**
	 * RFC 9116 §2.5.3. Ordered, repeatable (the ABNF requires at least
	 * one). Each value is a URI: in practice `mailto:` for a monitored
	 * mailbox, `https:` for a private-advisory form (GitHub, for
	 * instance). The schema rejects any other scheme, so the field can
	 * never carry a `javascript:` or a `file:` reference a reader's
	 * client would follow.
	 */
	readonly contacts: readonly string[];
	/**
	 * RFC 9116 §2.5.5. An RFC 3339 instant, exactly once. Rendered
	 * verbatim in UTC (`Date.toISOString()`), never in a local zone:
	 * two readers of the same file must not compute different
	 * deadlines.
	 */
	readonly expires: string;
	/** RFC 9116 §2.5.4. Where to fetch an OpenPGP key (`https:` / `dns:`). */
	readonly encryption?: readonly string[];
	/** RFC 9116 §2.5.1. Where acknowledgement of a report is published. */
	readonly acknowledgments?: readonly string[];
	/**
	 * RFC 9116 §2.5.8. BCP 47 tags of equal priority, rendered as ONE
	 * comma-separated field: the field "MUST NOT appear more than
	 * once", so this list is never emitted one line per value.
	 */
	readonly preferredLanguages?: readonly string[];
	/** RFC 9116 §2.5.2. Absolute URL; here always the origin + path. */
	readonly canonical?: string;
	/** RFC 9116 §2.5.7. The human-readable disclosure policy. */
	readonly policy?: string;
	/** RFC 9116 §2.5.6. Where security job openings are published. */
	readonly hiring?: string;
	/**
	 * A machine-readable CSAF advisories document. RFC 9116 defines no
	 * `CSAF` section: §2.4 and the §6.2 registry make it an extension
	 * field (`ext-field`) — optional, and ignorable by a parser that
	 * does not implement it.
	 */
	readonly csaf?: string;
}

/**
 * Absolute canonical URL of this document on the production origin.
 *
 * Derived from two constants rather than stored in the manifest: the
 * path is fixed by RFC 9116 §3 and the origin by ADR-0014, so the
 * only way for the two to disagree is a second hand-written URL
 * literal somewhere in the repository.
 */
export const SECURITY_TXT_CANONICAL_URL = `${SECURITY_TXT_ORIGIN}${SECURITY_TXT_PATH}`;

/**
 * Append one `Field: value` line per value, skipping an absent field.
 *
 * Only for fields the RFC allows to REPEAT: `Contact`, `Encryption`,
 * `Acknowledgments`, `Canonical`. A field may appear more than once
 * only because §2's default says so ("unless otherwise indicated in a
 * definition of a particular field, a field MAY appear multiple
 * times"); the single-valued fields go through
 * {@link pushSingleValuedField} instead.
 */
function pushRepeatedField(
	lines: string[],
	field: string,
	values: readonly string[] | undefined,
): void {
	if (values === undefined) return;
	for (const value of values) lines.push(`${field}: ${value}`);
}

/**
 * Append ONE line carrying every value, comma-separated.
 *
 * `Preferred-Languages` is a single field whose value is a list
 * (RFC 9116 §2.5.8: `lang-values = lang-tag *(*WSP "," *WSP lang-tag)`,
 * and "This field MUST NOT appear more than once"), so repeating the
 * field name once per value produces a document a compliant parser may
 * reject or read as a duplicate.
 */
function pushSingleValuedField(
	lines: string[],
	field: string,
	values: readonly string[] | undefined,
): void {
	if (values === undefined || values.length === 0) return;
	lines.push(`${field}: ${values.join(', ')}`);
}

/**
 * Render the document.
 *
 * Field order follows the RFC 9116 §4 ABNF: `Contact:` first,
 * `Expires:` after the optional repeatable fields, and the single
 * `Preferred-Languages:` line after the deadline. A repeatable field is
 * one line per value; a single-valued field is one line.
 *
 * The body ends with a trailing newline so the file is a well-formed
 * text file under POSIX and under every parser that splits on `\n`.
 * RFC 9116 §2.2 allows CRLF or LF as the line separator; LF is what
 * every shipping implementation emits (and what `renderRobotsTxt` in
 * `src/http/seo/sitemap.ts` emits for the sibling document), so the
 * two crawler-facing documents agree.
 */
export function renderSecurityTxt(document: SecurityTxtDocument): string {
	const lines: string[] = [];
	pushRepeatedField(lines, 'Contact', document.contacts);
	pushRepeatedField(lines, 'Encryption', document.encryption);
	pushRepeatedField(lines, 'Acknowledgments', document.acknowledgments);
	pushRepeatedField(
		lines,
		'Canonical',
		document.canonical === undefined ? undefined : [document.canonical],
	);
	if (document.policy !== undefined) lines.push(`Policy: ${document.policy}`);
	if (document.hiring !== undefined) lines.push(`Hiring: ${document.hiring}`);
	if (document.csaf !== undefined) lines.push(`CSAF: ${document.csaf}`);
	lines.push(`Expires: ${document.expires}`);
	pushSingleValuedField(lines, 'Preferred-Languages', document.preferredLanguages);
	return `${lines.join('\n')}\n`;
}

/**
 * Is this document still inside its own validity window?
 *
 * RFC 9116 §2.5.5 and §5.3: once `Expires` is in the past the data is
 * stale and SHOULD NOT be used, because the reporting channel it
 * advertises may no longer be monitored. Serving the stale bytes
 * anyway is the failure this whole publication gate exists to
 * prevent — a scanner records the first `Contact:` it ever read and
 * stops looking, so a dead mailbox that is still advertised is worse
 * than a `404`.
 *
 * A value that does not parse as a date is treated as EXPIRED, not as
 * "always valid": an unreadable deadline is not a licence to keep
 * publishing.
 */
export function isSecurityTxtLive(document: SecurityTxtDocument, now: number): boolean {
	const expires = Date.parse(document.expires);
	return Number.isFinite(expires) && expires > now;
}
