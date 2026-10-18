/**
 * Display-text Unicode policy — `src/i18n/` (Issue #433).
 *
 * This module owns ONE half of the separation the platform needs:
 * what happens to text a human reads (titles, summaries, prose,
 * glyphs). The other half — what may appear in a URL path segment —
 * is `./slug-identity.ts`.
 *
 * Policy, in one sentence: **display text is preserved byte-exact as
 * authored; the only normalization the platform performs is a
 * read-only NFC fold used for comparison, never for output.**
 *
 * Why (UAX #15 / W3C i18n):
 *
 *   - Canonical forms (NFC / NFD) are *equivalent representations of
 *     the same word*. Choosing one for comparison is safe; choosing
 *     one for storage rewrites the author's bytes without changing
 *     what they meant, which is allowed only where we own the value.
 *   - Compatibility forms (NFKC / NFKD) are **lossy**. `ﬁ` (U+FB01)
 *     becomes `fi`, `µ` (U+00B5, MICRO SIGN) becomes `μ` (U+03BC,
 *     GREEK SMALL LETTER MU) — two different words — `①` becomes
 *     `1`, `Ⅳ` becomes `IV`, `Ａ` becomes `A`. Applying them to
 *     display text silently changes letters, numbers and units.
 *     Therefore this module never APPLIES a compatibility fold to a
 *     display field or to a URL; it only *reports* what such a fold
 *     would have destroyed, so a reviewer can see the risk instead of
 *     inheriting it silently. (The report itself does contain folded
 *     strings — \`replacement\` in \`CompatibilityFoldChange\`, the \`form\`
 *     detection in \`describeUnicode\` — as DIAGNOSTIC data attached to a
 *     character fact, never as output text.)
 *
 * Consequences enforced here:
 *
 *   1. `foldForComparison` is NFC and nothing else.
 *   2. `describeUnicode` reports the form, the non-ASCII code points,
 *      and the characters that a compatibility fold would change.
 *   3. `assertDisplayTextPreserved` is a cheap identity check
 *      (`===`, no normalization cost) for a seam that TRANSFORMS a
 *      display field: it compares the raw value captured before the
 *      transformation with the transformed one. Passing the same
 *      expression twice compares a value with itself and proves
 *      nothing — see its own docstring.
 *
 * This module is a leaf: it imports nothing from the repository, so
 * `home/`, `portfolio/`, `reactions/`, `admin/` and `routes/` may all
 * depend on it without creating a cycle (`scripts/check-architecture.mjs`
 * enforces the leaf rule for `i18n`).
 */

/** The four normalization forms of UAX #15, plus "none of them". */
export type NormalizationForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD' | 'none';

/** One code point, described without depending on an ICU build. */
export interface CodePointFact {
	/** UTF-16 code unit index where the character starts. */
	readonly index: number;
	readonly codePoint: number;
	/** `U+00E9` style identifier (uppercase, at least four digits). */
	readonly hex: string;
	/** The character itself (may be a combining mark on its own). */
	readonly char: string;
	/** Curated name, or `UNNAMED` when the table has no entry. */
	readonly label: string;
}

/** One character a compatibility fold (NFKC) would replace. */
export interface CompatibilityFoldChange {
	readonly from: CodePointFact;
	/** What NFKC would emit for that character instead. */
	readonly replacement: string;
	/**
	 * True when the replacement has a different code point count,
	 * i.e. the fold expands or contracts the text (ligature →
	 * letters, `㎡` → `m` + `2`). Both directions are meaning-bearing
	 * (`ﬁ` → `fi` loses the ligature; `µ` → `μ` swaps one letter for
	 * another).
	 */
	readonly changesLength: boolean;
}

/** Everything the platform is allowed to know about a display string. */
export interface UnicodeFacts {
	/** The text exactly as authored — never rewritten. */
	readonly text: string;
	readonly codeUnits: number;
	readonly codePoints: number;
	/** First form the text already satisfies, else `'none'`. */
	readonly form: NormalizationForm;
	/** True when `text === text.normalize('NFC')`. */
	readonly isNfc: boolean;
	/** True when `text === text.normalize('NFD')`. */
	readonly isNfd: boolean;
	/** NFC fold — comparison / dedupe only. NEVER a URL, never output. */
	readonly foldKey: string;
	/** Every code point above U+007F, in order. */
	readonly nonAscii: readonly CodePointFact[];
	/** Characters NFKC would change. Diagnostic only; never applied. */
	readonly compatibilityFoldChanges: readonly CompatibilityFoldChange[];
	/** Shorthand for `compatibilityFoldChanges.length > 0`. */
	readonly changesUnderCompatibilityFold: boolean;
}

/**
 * Curated Unicode names for the characters this platform actually
 * shows in fixtures, reports and admin surfaces.
 *
 * Deliberately a repo-owned table rather than an ICU lookup: a
 * character name is presentation, and presentation must not vary with
 * the runtime's ICU data (a different Node build must not change a
 * validation message or a verification artefact). Anything missing
 * renders as `U+XXXX UNNAMED`, which is still unambiguous.
 *
 * Keyed by the uppercase hex code point rather than a number so the
 * table reads the same way the messages it produces do, and so a new
 * row cannot be silently mistyped as a decimal.
 */
const CHARACTER_LABELS: Readonly<Record<string, string>> = {
	'0000': 'NULL',
	'00B5': 'MICRO SIGN',
	'00C5': 'LATIN CAPITAL LETTER A WITH RING ABOVE',
	'00D6': 'LATIN CAPITAL LETTER O WITH DIAERESIS',
	'00D7': 'MULTIPLICATION SIGN',
	'00E5': 'LATIN SMALL LETTER A WITH RING ABOVE',
	'00E8': 'LATIN SMALL LETTER E WITH GRAVE',
	'00E9': 'LATIN SMALL LETTER E WITH ACUTE',
	'00F1': 'LATIN SMALL LETTER N WITH TILDE',
	'00FC': 'LATIN SMALL LETTER U WITH DIAERESIS',
	'0301': 'COMBINING ACUTE ACCENT',
	'03BC': 'GREEK SMALL LETTER MU',
	'200B': 'ZERO WIDTH SPACE',
	'2044': 'FRACTION SLASH',
	'212B': 'ANGSTROM SIGN',
	'2163': 'ROMAN NUMERAL FOUR',
	'2260': 'NOT EQUAL TO',
	'2264': 'LESS-THAN OR EQUAL TO',
	'2460': 'CIRCLED DIGIT ONE',
	'3042': 'HIRAGANA LETTER A',
	'304C': 'HIRAGANA LETTER GA',
	'30A2': 'KATAKANA LETTER A',
	'30FC': 'KATAKANA-HIRAGANA PROLONGED SOUND MARK',
	'33A1': 'SQUARE M SQUARED',
	FB01: 'LATIN SMALL LIGATURE FI',
	FF01: 'FULLWIDTH EXCLAMATION MARK',
	FF11: 'FULLWIDTH DIGIT ONE',
	FF21: 'FULLWIDTH LATIN CAPITAL LETTER A',
	FF4D: 'FULLWIDTH LATIN CAPITAL LETTER M',
	'1F44D': 'THUMBS UP SIGN',
	'1FAF6': 'BROKEN HEART',
};

/** `U+00E9` style identifier, always at least four hex digits. */
export function toCodePointHex(codePoint: number): string {
	return `U+${toCodePointKey(codePoint)}`;
}

/** Bare hex key (`00E9`) used to look a label up in the table above. */
function toCodePointKey(codePoint: number): string {
	return codePoint.toString(16).toUpperCase().padStart(4, '0');
}

/** `U+00E9 LATIN SMALL LETTER E WITH ACUTE` (or `… UNNAMED`). */
export function describeCodePoint(codePoint: number): string {
	const label = CHARACTER_LABELS[toCodePointKey(codePoint)];
	return label ? `${toCodePointHex(codePoint)} ${label}` : `${toCodePointHex(codePoint)} UNNAMED`;
}

function toCodePointFact(index: number, codePoint: number): CodePointFact {
	return {
		index,
		codePoint,
		hex: toCodePointHex(codePoint),
		char: String.fromCodePoint(codePoint),
		label: CHARACTER_LABELS[toCodePointKey(codePoint)] ?? 'UNNAMED',
	};
}

/**
 * The ONLY fold this platform performs: NFC, for comparison.
 *
 * Callers must treat the result as a lookup key. Writing it back to a
 * display field or into a URL is the bug this module exists to
 * prevent — `src/i18n/slug-identity.ts` refuses non-ASCII candidates
 * long before a fold could mint a URL out of them.
 */
export function foldForComparison(text: string): string {
	return text.normalize('NFC');
}

/** Every code point above U+007F, in order, with its position. */
export function findNonAscii(text: string): readonly CodePointFact[] {
	const facts: CodePointFact[] = [];
	for (let index = 0; index < text.length; ) {
		const codePoint = text.codePointAt(index);
		if (codePoint === undefined) break;
		if (codePoint > 0x7f) facts.push(toCodePointFact(index, codePoint));
		index += codePoint > 0xffff ? 2 : 1;
	}
	return facts;
}

/**
 * Characters that an NFKC compatibility fold would change.
 *
 * Diagnostic only. The platform never applies the fold: the point of
 * this function is to make the damage visible (`ﬁ` → `fi`, `µ` → `μ`,
 * `①` → `1`) before somebody proposes it as a "normalisation".
 *
 * Per-character rather than whole-text comparison, so a multi-character
 * canonical decomposition (Hangul syllables, for example) is reported
 * as "unchanged" here even though a whole-text fold would reorder it.
 * That under-report is intentional: the platform's own display
 * pipeline never folds, so the exhaustive case does not exist.
 */
export function findCompatibilityFoldChanges(text: string): readonly CompatibilityFoldChange[] {
	const changes: CompatibilityFoldChange[] = [];
	for (let index = 0; index < text.length; ) {
		const codePoint = text.codePointAt(index);
		if (codePoint === undefined) break;
		const width = codePoint > 0xffff ? 2 : 1;
		const char = text.slice(index, index + width);
		const folded = char.normalize('NFKC');
		if (folded !== char) {
			changes.push({
				from: toCodePointFact(index, codePoint),
				replacement: folded,
				changesLength: Array.from(folded).length !== 1,
			});
		}
		index += width;
	}
	return changes;
}

/** Classify a display string without modifying it. */
export function describeUnicode(text: string): UnicodeFacts {
	const compatibilityFoldChanges = findCompatibilityFoldChanges(text);
	const form: NormalizationForm =
		text.normalize('NFC') === text
			? 'NFC'
			: text.normalize('NFD') === text
				? 'NFD'
				: text.normalize('NFKC') === text
					? 'NFKC'
					: text.normalize('NFKD') === text
						? 'NFKD'
						: 'none';
	return {
		text,
		codeUnits: text.length,
		codePoints: Array.from(text).length,
		form,
		isNfc: form === 'NFC',
		isNfd: form === 'NFD',
		foldKey: foldForComparison(text),
		nonAscii: findNonAscii(text),
		compatibilityFoldChanges,
		changesUnderCompatibilityFold: compatibilityFoldChanges.length > 0,
	};
}

/**
 * Prove that a display field crossed a TRANSFORMING boundary unmodified.
 *
 * This is an identity check (`===`), not a normalization check: it
 * costs nothing and it fails loudly if a loader, a mapper or an editor
 * ever rewrote the author's bytes. `field` names the property in the
 * thrown error so the message points at the row → model mapping.
 *
 * It deliberately does NOT compare `foldKey`s. Two canonically
 * equivalent spellings are the same word, but they are not the same
 * bytes, and this contract is about the bytes reaching the renderer.
 *
 * `original` and `current` MUST be two distinct values — the raw input
 * and the transformed output. Calling this with one expression twice
 * (e.g. `assertDisplayTextPreserved(row.title, row.title, 'title')`)
 * compares a value with itself, can never throw, and reads like a
 * boundary check while checking nothing. If a mapping is already an
 * identity by construction, do not call this at all; pin the property
 * with a test instead.
 */
export function assertDisplayTextPreserved(
	original: string,
	current: string,
	field: string,
): string {
	if (current !== original) {
		throw new Error(
			`display text for ${field} was rewritten in transit (Issue #433): ` +
				`${JSON.stringify(original)} → ${JSON.stringify(current)}`,
		);
	}
	return current;
}
