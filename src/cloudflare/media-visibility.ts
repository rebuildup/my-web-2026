/**
 * R2 object visibility boundary (Issue #459).
 *
 * Why this obligation
 * -------------------
 * Portfolio media is delivered by **a public R2 custom domain** on
 * the `MEDIA` bucket (`https://media.rebuildup.dev/<key>`) — the
 * accepted mechanism recorded in `docs/portfolio/decisions.md`
 * Decision 5. That attachment is a **release prerequisite owned by
 * the Cloudflare account, and this repository cannot confirm its
 * production state**. Conditional on it being attached, the custom
 * domain bypasses the Worker entirely: the Cloudflare edge serves the
 * object at its key, so *every* key that exists in the bucket is
 * anonymously fetchable by anyone who can guess or enumerate the key.
 * There is no session, no API key, no signed URL, and no Worker code
 * in that path.
 *
 * That is what makes the key namespace the security boundary. This
 * module owns the one rule the rest of the codebase may consult:
 *
 *   > A key is publicly servable only when it is a well-formed object
 *   > key that lives under an explicitly declared **public** prefix.
 *
 * Everything else fails closed:
 *
 *   - a key under a declared **private** prefix (`private/`, …) is
 *     refused because it was declared private,
 *   - a key under a prefix nobody declared (`draft-cover.webp`,
 *     `tmp/…`, a typo) is refused because it is **unlisted** — an
 *     allowlist must not grow by accident.
 *
 * Second rule — *public namespace ≠ published*. A key inside a public
 * namespace is only a candidate. Whether the object may actually be
 * served is the owner's call (a D1 row that says the project is
 * published, an uploaded image row, …), so the caller passes that
 * decision in as an approval check. The two gates compose:
 * namespace decides "may this class of object ever be public at all",
 * approval decides "is this particular object published right now".
 *
 * What is enforced where — read this before trusting the boundary
 * --------------------------------------------------------------
 * Production code enforces the rule on the two key-handling paths
 * that exist today: `composeMediaUrl` (portfolio URL composition) and
 * `getImageStream` (the reaction-image HTTP read). Those gates stop
 * the repository from *emitting* a URL for a non-public key and from
 * *reading* a non-public key back.
 *
 * The delivery adapter (`createPublicMediaDelivery`) and the listing
 * walk (`listPublicMediaKeys`) below are the **same boundary, modelled
 * for a caller that has to serve objects itself** (Issue #459's third
 * acceptance item asks for exactly that adapter/stub/test). They have
 * **no production caller today**, and this module does **not** claim
 * otherwise: the custom-domain edge serves bucket keys without running
 * any of this code. Closing the bucket-level half — split the bucket,
 * or move delivery behind the Worker / signed URLs — is an owner
 * decision that is deliberately *not* taken here; it is tracked as an
 * open residual in `docs/security/r2-media-visibility.md` and as
 * Issue #577.
 *
 * This module is pure: no `cloudflare:workers` import, no binding
 * access. `portfolio/` and `http/reactions/` consume the rule; none of
 * them may re-derive it.
 */

/**
 * Namespaces that may ever be served from the public delivery
 * surface. Keep this an explicit allowlist: a new producer (an
 * upload path, a migration, an operator script) that wants public
 * delivery adds its prefix here, in review, instead of relying on a
 * default that publishes whatever it happens to write.
 *
 * - `portfolio/` — published project media (`portfolio/<slug>/<file>`),
 *   the layout `scripts/upload-portfolio-media.mjs` writes.
 * - `reactions/` — reaction images (`reactions/<sha256>.<ext>`),
 *   public reaction data by design (`src/http/reactions/images.ts`).
 *
 * A prefix match also requires a non-empty remainder, so the bare
 * namespace marker itself (`portfolio/`, `reactions/`) never resolves
 * to "publicly servable" — see `matchesPublicPrefix`.
 *
 * Only prefixes with a real producer belong here. A producer that
 * lands later adds its prefix **in the same review that introduces it**
 * (AGENTS.md §3: no pre-declared namespaces), because an entry added
 * after the fact publishes every key written under it without anyone
 * re-reading this decision.
 */
export const PUBLIC_MEDIA_PREFIXES: readonly string[] = ['portfolio/', 'reactions/'];

/**
 * Namespaces that must never be served publicly. The deny check runs
 * **before** the allowlist, so a future entry added to both lists still
 * resolves to private.
 *
 * These are the prefixes the repository itself uses for material that
 * has not been approved for publication (WIP media, operator staging
 * uploads, local artefacts). Listing them explicitly buys nothing on
 * its own — the allowlist already refuses them — but it makes the
 * intent reviewable and lets the docs point at a concrete namespace
 * instead of "anything outside the allowlist".
 */
export const PRIVATE_MEDIA_PREFIXES: readonly string[] = [
	'private/',
	'draft/',
	'staging/',
	'internal/',
	'backup/',
	'tmp/',
];

/** Why a key is refused. Never surfaced to a public caller verbatim. */
export type MediaKeyRefusal = 'invalid_key' | 'private_namespace' | 'unlisted_namespace';

export type MediaKeyReason = 'public_namespace' | MediaKeyRefusal;

interface MediaKeyVerdictBase {
	/** The key exactly as supplied (never normalised). */
	key: string;
	/** First path segment, or `null` when the key is malformed. */
	namespace: string | null;
}

/**
 * Discriminated on `publiclyServable`, so narrowing on that boolean
 * also narrows `reason` to the refusal vocabulary. A caller cannot read
 * a `public_namespace` reason off a refused key.
 */
export interface MediaKeyPublicVerdict extends MediaKeyVerdictBase {
	publiclyServable: true;
	reason: 'public_namespace';
}

export interface MediaKeyRefusedVerdict extends MediaKeyVerdictBase {
	publiclyServable: false;
	reason: MediaKeyRefusal;
}

export type MediaKeyVerdict = MediaKeyPublicVerdict | MediaKeyRefusedVerdict;

/**
 * Conservative object-key grammar: ASCII, no query/fragment
 * characters, no whitespace, no leading `/`, no `..` segment, 1..512
 * characters. This is the single grammar for every R2 key the
 * application handles — `src/portfolio/media.ts` delegates its
 * historical `isValidR2Key` export here rather than keeping a second
 * copy that could drift.
 */
const MEDIA_KEY_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$/;

export function isValidMediaKey(key: string): boolean {
	if (!key) return false;
	if (key.includes('..')) return false;
	return MEDIA_KEY_REGEX.test(key);
}

/**
 * First path segment of a key (`portfolio/a/cover.webp` →
 * `portfolio`), or `null` when the key is malformed or has no
 * separator.
 */
export function mediaKeyNamespace(key: string): string | null {
	if (!isValidMediaKey(key)) return null;
	const separator = key.indexOf('/');
	return separator === -1 ? null : key.slice(0, separator);
}

function matchesPrefix(key: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => key.startsWith(prefix));
}

/**
 * Allowlist match: the prefix must be followed by at least one
 * character. R2 object keys are flat strings, so a key equal to the
 * prefix is a directory marker rather than an object any producer
 * writes; treating it as public would publish a name that should not
 * resolve at all. The deny direction needs no such guard because it
 * already refuses — only the allow direction can publish something.
 */
function matchesPublicPrefix(key: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => key.startsWith(prefix) && key.length > prefix.length);
}

/**
 * Classify one key against the visibility boundary. Total function:
 * every string is either publicly servable or refused for exactly one
 * documented reason, so callers can branch without a catch-all.
 */
export function classifyMediaKey(key: string): MediaKeyVerdict {
	if (!isValidMediaKey(key)) {
		return { key, namespace: null, publiclyServable: false, reason: 'invalid_key' };
	}
	if (matchesPrefix(key, PRIVATE_MEDIA_PREFIXES)) {
		return {
			key,
			namespace: mediaKeyNamespace(key),
			publiclyServable: false,
			reason: 'private_namespace',
		};
	}
	if (matchesPublicPrefix(key, PUBLIC_MEDIA_PREFIXES)) {
		return {
			key,
			namespace: mediaKeyNamespace(key),
			publiclyServable: true,
			reason: 'public_namespace',
		};
	}
	return {
		key,
		namespace: mediaKeyNamespace(key),
		publiclyServable: false,
		reason: 'unlisted_namespace',
	};
}

/** The predicate every delivery path must consult before a key is used. */
export function isPublicMediaKey(key: string): boolean {
	return classifyMediaKey(key).publiclyServable;
}

/**
 * Drop every non-public key from a candidate list. Used by listing
 * surfaces so an enumeration walk can never hand a private key to a
 * caller.
 */
export function filterPublicMediaKeys(keys: Iterable<string>): string[] {
	const out: string[] = [];
	for (const key of keys) {
		if (isPublicMediaKey(key)) out.push(key);
	}
	return out;
}

/* ------------------------------------------------------------------ *
 * Delivery adapter
 *
 * The public R2 custom domain is configured in the Cloudflare
 * account, so this repository cannot exercise it. What it can do —
 * and what the acceptance criteria of Issue #459 ask for — is model
 * the same delivery surface behind an adapter and run it against a
 * local fixture, so the 200/404 boundary is a real, executable
 * assertion rather than a claim in a document.
 * ------------------------------------------------------------------ */

/** The subset of `R2ObjectBody` the delivery path needs. */
export interface MediaObjectBody {
	body: ReadableStream | null;
	httpEtag?: string;
	httpMetadata?: { contentType?: string; cacheControl?: string };
}

/** The subset of `R2Bucket` the delivery path needs. `R2Bucket` satisfies it. */
export interface MediaObjectSource {
	get(key: string): Promise<MediaObjectBody | null>;
}

/** The subset of `R2Bucket.list` the listing helper needs. */
export interface MediaObjectLister {
	list(options?: {
		prefix?: string;
		cursor?: string;
		limit?: number;
	}): Promise<{ objects: Array<{ key: string }>; truncated?: boolean; cursor?: string }>;
}

/**
 * Owner-supplied publication decision for one key. Returns `false`
 * for "not published" (draft project, unapproved upload, deleted row).
 * A missing check means "the namespace gate is the only gate", which
 * is why every production caller passes one.
 */
export type MediaApprovalCheck = (key: string) => boolean | Promise<boolean>;

export interface PublicMediaDeliveryServed {
	status: 200;
	key: string;
	body: ReadableStream | null;
	contentType: string | null;
	cacheControl: string | null;
	etag: string | null;
}

/**
 * A refusal carries **no reason code**. Every refusal is the same
 * value, on purpose: if the result said "private namespace" or "not
 * published" it would be an existence oracle the moment a caller
 * serialised it into a response, a header, or a client-visible log.
 * Which gate refused is observable through instrumentation instead
 * (a refused key never reaches the bucket — see
 * `createPublicMediaDelivery`), not through the returned value.
 * `key` is echoed because the caller supplied it.
 */
export interface PublicMediaDeliveryRefused {
	status: 404;
	key: string;
}

export type PublicMediaDeliveryResult = PublicMediaDeliveryServed | PublicMediaDeliveryRefused;

export interface PublicMediaDelivery {
	/** Fetch one object through the visibility boundary. Never throws for a policy refusal. */
	fetch(key: string): Promise<PublicMediaDeliveryResult>;
}

/**
 * Build the gated delivery adapter.
 *
 * **No production caller today** (see the module header): the public
 * custom domain serves bucket keys without running Worker code, so
 * this adapter is the boundary *as modelled* for a caller that serves
 * objects itself, not a claim about the current delivery path.
 *
 * Order of checks (each one short-circuits, so a refused private key
 * never reaches the bucket and never differs observably from a
 * missing key):
 *
 *   1. malformed key            → 404
 *   2. private namespace        → 404
 *   3. unlisted namespace       → 404
 *   4. owner approval check     → 404
 *   5. bucket lookup            → 404 (`not found`)
 *   6. otherwise                → 200 + stored metadata
 *
 * Every refusal is the **same 404 value**, never a 403 and never a
 * reason code: a 403 — or a distinguishable 404 — would confirm that
 * the object exists, which is exactly the oracle an enumeration sweep
 * wants.
 */
export function createPublicMediaDelivery(
	source: MediaObjectSource,
	opts?: { isApproved?: MediaApprovalCheck },
): PublicMediaDelivery {
	return {
		fetch: async (key: string): Promise<PublicMediaDeliveryResult> => {
			const verdict = classifyMediaKey(key);
			if (!verdict.publiclyServable) return { status: 404, key };
			if (opts?.isApproved && !(await opts.isApproved(key))) return { status: 404, key };
			const object = await source.get(key);
			if (!object) return { status: 404, key };
			return {
				status: 200,
				key,
				body: object.body,
				contentType: object.httpMetadata?.contentType ?? null,
				cacheControl: object.httpMetadata?.cacheControl ?? null,
				etag: object.httpEtag ?? null,
			};
		},
	};
}

export interface PublicMediaKeyListing {
	/** Publicly servable (and approved) keys, in listing order. */
	keys: string[];
	/** True when the bucket had more pages than this walk read. */
	truncated: boolean;
}

/**
 * Walk a bucket listing and return only the publicly servable keys.
 *
 * This is the enumeration-safe counterpart of `R2Bucket.list()`: an
 * object-listing surface that uses it can page the whole bucket and
 * still never emit a private, unapproved, or undeclared key.
 *
 * The result deliberately carries **no scan count and no withheld
 * count**. A listing callback receives a `prefix` chosen by its
 * caller; if that caller forwards a visitor-supplied prefix, a count
 * of "objects the walk saw" or "objects it hid" answers whether a
 * guessed key exists — the same existence oracle a refused 404
 * avoids, delivered as a number instead of a key. Audit counters are
 * therefore **not part of this return value**: an operator that needs
 * them counts out of band against a prefix it controls, never on the
 * response path.
 */
export async function listPublicMediaKeys(
	source: MediaObjectLister,
	opts?: { prefix?: string; limit?: number; isApproved?: MediaApprovalCheck },
): Promise<PublicMediaKeyListing> {
	const limit = opts?.limit ?? 1000;
	let cursor: string | undefined;
	let truncated = false;
	const keys: string[] = [];

	do {
		const page = await source.list({ prefix: opts?.prefix, cursor, limit });
		for (const object of page.objects ?? []) {
			if (!isPublicMediaKey(object.key)) continue;
			if (opts?.isApproved && !(await opts.isApproved(object.key))) continue;
			keys.push(object.key);
		}
		truncated = page.truncated === true;
		cursor = truncated ? page.cursor : undefined;
	} while (truncated && cursor);

	return { keys, truncated };
}

/* ------------------------------------------------------------------ *
 * Publication audit (operator-side)
 *
 * `listPublicMediaKeys` is a *filter*: it receives a page of candidate
 * keys and returns the ones a delivery caller may serve. It answers
 * "what may I serve?" and therefore drops everything else silently.
 *
 * The remaining half of Issue #459's first acceptance item is the
 * opposite question: **does the bucket contain a publicly servable key
 * that the publication contract has not approved?** That is a
 * reconciliation between two sources the delivery path never holds at
 * the same time — the bucket listing and the D1 publication rows — so
 * it is modelled here as an operator-side adapter, exactly as Issue
 * #459's third acceptance item allows ("complete an external
 * capability as an independent adapter/stub/test").
 *
 * It is deliberately **not** wired to a request path or to a release
 * gate. Adopting it as a production gate would need a read-only D1
 * credential and an owner decision about release scope (the same
 * boundary Issue #577 had to cross for the key-set audit); this module
 * only supplies the executable model and its local-fixture test.
 * ------------------------------------------------------------------ */

/**
 * Why an audit could not reach a verdict. The operator reports the
 * code; it is never a public response.
 */
export type MediaPublicationAuditVerdict = 'ok' | 'violation' | 'undecidable';

/**
 * Counts only. No key, no key fragment, and no per-key verdict leaves
 * this result — an audit that named the unapproved key would itself
 * become the enumeration surface it exists to close. Counts are safe
 * **only** because the caller is an operator tool walking a prefix the
 * operator controls (the reasoning that shapes
 * `scripts/check-r2-media-key-set.mjs`); a request handler that
 * forwards a visitor-supplied prefix would turn them into an existence
 * oracle, which is why this function has no production caller.
 */
export interface MediaPublicationAuditResult {
	verdict: MediaPublicationAuditVerdict;
	/** In-namespace keys the walk saw (approved + unapproved). */
	publicKeys: number;
	approvedKeys: number;
	unapprovedKeys: number;
	/** `incomplete` when the source reported more pages but no cursor. */
	enumeration: 'complete' | 'incomplete';
}

/**
 * Reconcile a bucket listing against the owner's publication decision.
 *
 * - Every key that passes the namespace gate is counted.
 * - A key the approval check rejects is counted as unapproved.
 * - Out-of-namespace keys are **not** counted here: Issue #577's
 *   key-set audit (`scripts/check-r2-media-key-set.mjs`) owns that
 *   half, and duplicating it would create a second definition of the
 *   same rule.
 *
 * Fail-closed states mirror the key-set audit:
 *
 *   - an empty public key set is `undecidable` (a bucket that holds
 *     nothing in a public namespace is not evidence that publication
 *     is correct),
 *   - a truncated page without a cursor is `undecidable` (a partial
 *     walk cannot prove the absence of an unapproved key),
 *   - any unapproved key is `violation`.
 *
 * The approval check is required, not optional. Defaulting to
 * "everything is approved" would make the audit pass by forgetting to
 * pass the very decision it exists to verify.
 */
export async function auditPublicMediaPublication(
	source: MediaObjectLister,
	isApproved: MediaApprovalCheck,
	opts?: { prefix?: string; limit?: number },
): Promise<MediaPublicationAuditResult> {
	const limit = opts?.limit ?? 1000;
	let cursor: string | undefined;
	let publicKeys = 0;
	let approvedKeys = 0;

	for (;;) {
		const page = await source.list({ prefix: opts?.prefix, cursor, limit });
		for (const object of page.objects ?? []) {
			if (!isPublicMediaKey(object.key)) continue;
			publicKeys += 1;
			if (await isApproved(object.key)) approvedKeys += 1;
		}

		if (page.truncated !== true) break;
		cursor = page.cursor;
		if (!cursor) {
			return {
				verdict: 'undecidable',
				publicKeys,
				approvedKeys,
				unapprovedKeys: publicKeys - approvedKeys,
				enumeration: 'incomplete',
			};
		}
	}

	const unapprovedKeys = publicKeys - approvedKeys;
	const verdict: MediaPublicationAuditVerdict =
		publicKeys === 0 ? 'undecidable' : unapprovedKeys > 0 ? 'violation' : 'ok';

	return {
		verdict,
		publicKeys,
		approvedKeys,
		unapprovedKeys,
		enumeration: 'complete',
	};
}
