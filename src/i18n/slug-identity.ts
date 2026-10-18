/**
 * URL slug identity policy — `src/i18n/` (Issue #433).
 *
 * This module owns the other half of the separation: **what may
 * appear in a URL path segment**. It does NOT own any slug grammar —
 * each obligation keeps its own (`src/reactions/slug-regex.ts` owns
 * the emoji slug, `src/portfolio/schema.ts` owns the portfolio slug).
 * What it owns is the rule those grammars are applied under:
 *
 *   > A slug is authored, never derived. A candidate is accepted only
 *   > when it already satisfies the owner's ASCII grammar byte-exactly.
 *   > Non-ASCII candidates are refused with a reason instead of being
 *   > transliterated, folded, or diacritic-stripped.
 *
 * Why refusing beats normalising (Issue #433, 完了条件「正規化で別語が
 * 衝突しない」):
 *
 *   Every common "slugify" pipeline ends with a lossy fold —
 *   `NFKD` / `NFKD + strip marks` / transliteration — and every one of
 *   them can map two different words onto one URL:
 *
 *     `café`  → `cafe`      (the accent is simply gone)
 *     `ﬁnance` → `finance` (ligature expanded; NFKC)
 *     `µm`    → `μm`        (MICRO SIGN → GREEK MU; NFKC)
 *     `Ａ`     → `A`        (fullwidth folded; NFKC)
 *     `Ⅳ`     → `IV`        (roman numeral folded; NFKC)
 *     `①`     → `1`         (circled digit folded; NFKC — a VALUE change)
 *
 *   Once two words share a URL, the collision is permanent: the URL is
 *   already published, in bookmarks, in other people's links, in
 *   screenshots. Refusing the candidate keeps the mapping injective —
 *   a slug either denotes exactly the entry that claims it, or nothing.
 *
 * The canonical-form case is different and is handled *without*
 * touching URLs: `café` in NFC and `café` in NFD are two spellings of
 * ONE word. Display keeps the author's bytes (see `./unicode.ts`) and
 * comparison uses an NFC fold (`foldForComparison`). Neither of those
 * can mint a URL, because non-ASCII candidates are refused first.
 *
 * Leaf module: imports nothing from the repository.
 */

import {
	type CodePointFact,
	describeCodePoint,
	findNonAscii,
	foldForComparison,
} from './unicode.ts'; // `.ts` on purpose: see `./index.ts` — the Node-side gate imports this module

/**
 * An owner's slug grammar. The pattern MUST be ASCII-only: a grammar
 * that admits non-ASCII would let a compatibility-confusable word
 * into a URL, which is exactly the collision this module exists to
 * prevent. `describeSlugGrammar` states that requirement where it is
 * declared, so a future relaxation has to argue with it.
 */
export interface SlugGrammar {
	/** Stable identifier used in messages, e.g. `emoji-slug`. */
	readonly name: string;
	/** ASCII-only anchored pattern owned by the calling obligation. */
	readonly pattern: RegExp;
	/** Maximum length in UTF-16 code units. */
	readonly maxLength: number;
}

/**
 * Why a candidate was refused. The order below is the order the checks
 * run in, from the most fundamental refusal to the most superficial,
 * so the reason a caller sees is always the one that actually decides
 * the outcome.
 */
export type SlugRejectionReason =
	| 'not-a-string'
	| 'empty'
	| 'non-ascii'
	| 'too-long'
	| 'grammar-mismatch';

export interface SlugAccepted {
	readonly ok: true;
	/** The candidate itself — classification never rewrites input. */
	readonly slug: string;
}

export interface SlugRejected {
	readonly ok: false;
	readonly reason: SlugRejectionReason;
	/** Code points that caused the refusal (empty for most reasons). */
	readonly offenders: readonly CodePointFact[];
}

export type SlugVerdict = SlugAccepted | SlugRejected;

/**
 * Classify one candidate against one grammar. Pure, total, and free of
 * side effects: the same input always yields the same verdict, and the
 * input is never modified.
 */
export function classifySlugCandidate(candidate: unknown, grammar: SlugGrammar): SlugVerdict {
	if (typeof candidate !== 'string') return { ok: false, reason: 'not-a-string', offenders: [] };
	if (candidate.length === 0) return { ok: false, reason: 'empty', offenders: [] };
	// Before any length or pattern test: a non-ASCII candidate is
	// refused as a policy decision, not as a grammar accident. This is
	// the check that keeps `café` (NFC) and `café` (NFD) — and their
	// lossy-fold relatives — out of the URL space entirely.
	const offenders = findNonAscii(candidate);
	if (offenders.length > 0) return { ok: false, reason: 'non-ascii', offenders };
	if (candidate.length > grammar.maxLength) return { ok: false, reason: 'too-long', offenders: [] };
	if (!grammar.pattern.test(candidate))
		return { ok: false, reason: 'grammar-mismatch', offenders: [] };
	return { ok: true, slug: candidate };
}

/** One-line rendering of a refusal, for error messages and reports. */
export function describeSlugRejection(verdict: SlugRejected, grammar: SlugGrammar): string {
	switch (verdict.reason) {
		case 'not-a-string':
			return 'must be a string';
		case 'empty':
		case 'too-long':
			return `must be 1..${grammar.maxLength} chars`;
		case 'non-ascii': {
			const found = verdict.offenders.map((fact) => describeCodePoint(fact.codePoint)).join(', ');
			return `must be ASCII (${grammar.name}): found ${found} — transliteration and diacritic stripping are refused (Issue #433)`;
		}
		case 'grammar-mismatch':
			return `must match ${grammar.pattern.source}`;
	}
}

/** Document the ASCII-only requirement next to the grammar itself. */
export function describeSlugGrammar(grammar: SlugGrammar): string {
	return `${grammar.name}: /${grammar.pattern.source}/ , 1..${grammar.maxLength} chars, ASCII only`;
}

/**
 * A catalog entry whose identity is published as a URL. `displayText`
 * is the human-facing title/summary for the same entry — optional,
 * because a caller may only have slugs (e.g. the reactions API).
 */
export interface SlugIdentityEntry {
	readonly id: string;
	readonly slug: string;
	readonly displayText?: string;
}

/**
 * The two ways a catalog can break the injectivity of its URL space
 * without anybody typing a bad slug.
 */
export type SlugCollisionKind =
	/** Two entries claim the same URL. Only one can ever be reachable. */
	| 'duplicate-url'
	/** One word, two URLs: two canonically equivalent display texts
	 *  (`café` in NFC vs in NFD) filed under different slugs. */
	| 'normalization-alias';

export interface SlugCollision {
	readonly kind: SlugCollisionKind;
	/** The colliding key — the slug, or the NFC fold of the display text. */
	readonly key: string;
	readonly ids: readonly string[];
	readonly slugs: readonly string[];
	/** Human-readable explanation, safe to show in a report. */
	readonly detail: string;
}

/**
 * Audit a catalog for URL collisions. Pure and order-preserving: the
 * returned list is sorted by kind then key so a report and a test see
 * the same sequence.
 *
 * This is an authoring-time audit, not a runtime guard — D1's PRIMARY
 * KEY already refuses a literal duplicate slug at write time. What D1
 * cannot see is the normalization alias, because the two rows are
 * byte-distinct: `Café` (NFC) and `Café` (NFD) are different strings
 * that a reader cannot tell apart in a catalog listing.
 */
export function findSlugCollisions(
	entries: readonly SlugIdentityEntry[],
): readonly SlugCollision[] {
	const collisions: SlugCollision[] = [];

	const bySlug = new Map<string, SlugIdentityEntry[]>();
	for (const entry of entries) {
		const bucket = bySlug.get(entry.slug);
		if (bucket) bucket.push(entry);
		else bySlug.set(entry.slug, [entry]);
	}
	for (const [slug, bucket] of bySlug) {
		if (bucket.length < 2) continue;
		collisions.push({
			kind: 'duplicate-url',
			key: slug,
			ids: bucket.map((entry) => entry.id),
			slugs: [slug],
			detail: `${bucket.length} entries claim /${slug}`,
		});
	}

	// One word, two URLs: group the display texts by their NFC fold and
	// report any group whose members are spelled differently but do not
	// share a slug.
	const byFoldKey = new Map<string, SlugIdentityEntry[]>();
	for (const entry of entries) {
		if (typeof entry.displayText !== 'string') continue;
		const key = foldForComparison(entry.displayText);
		const bucket = byFoldKey.get(key);
		if (bucket) bucket.push(entry);
		else byFoldKey.set(key, [entry]);
	}
	for (const [key, bucket] of byFoldKey) {
		if (bucket.length < 2) continue;
		const slugs = new Set(bucket.map((entry) => entry.slug));
		if (slugs.size < 2) continue;
		const spellings = new Set(bucket.map((entry) => entry.displayText as string));
		collisions.push({
			kind: 'normalization-alias',
			key,
			ids: bucket.map((entry) => entry.id),
			slugs: [...slugs],
			detail:
				spellings.size > 1
					? `NFC/NFD spellings of one title are filed under ${slugs.size} URLs`
					: `one title is filed under ${slugs.size} URLs`,
		});
	}

	const kindOrder: Record<SlugCollisionKind, number> = {
		'duplicate-url': 0,
		'normalization-alias': 1,
	};
	return collisions.sort(
		(a, b) =>
			kindOrder[a.kind] - kindOrder[b.kind] ||
			// Code-point order, not `localeCompare`: the report must not depend on
			// the runtime's locale. Keys are ASCII (the grammars reject the rest).
			(a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
	);
}

/** Render collisions as one message per line (empty string when none). */
export function formatSlugCollisions(collisions: readonly SlugCollision[]): string {
	return collisions.map((collision) => `${collision.kind}: ${collision.detail}`).join('; ');
}

/** Throw when a catalog would publish an ambiguous URL. */
export function assertNoSlugCollisions(entries: readonly SlugIdentityEntry[]): void {
	const collisions = findSlugCollisions(entries);
	if (collisions.length > 0) {
		throw new Error(`slug identity audit failed (Issue #433): ${formatSlugCollisions(collisions)}`);
	}
}
