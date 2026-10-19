/**
 * Pseudo-localisation fixtures and audit — `src/i18n/` (Issue #429).
 *
 * What this is
 * ------------
 * A *verification* surface for the two failures that break a UI
 * before anyone notices the words are wrong:
 *
 *   1. **Text expansion.** German runs ~30% longer than English, and
 *      a 1.5x pseudo-translation is the usual way to find the button,
 *      the badge and the card title that were sized to the source
 *      language.
 *   2. **Direction change.** A paragraph with a right-to-left base
 *      direction puts the digits and the Latin product name inside a
 *      mirrored run. The words still say what they said; the *layout*
 *      is what breaks.
 *
 * It expands text MECHANICALLY and reversibly, then reports what
 * survived. It never translates, never rewrites, and never ships.
 *
 * The mechanical contract (why "pseudo", not "translation")
 * ---------------------------------------------------------
 * `expandPseudoText` inserts exactly two kinds of character and
 * nothing else:
 *
 *   - a combining mark (U+0301 COMBINING ACUTE ACCENT or U+0304
 *     COMBINING MACRON) after a letter or after an existing mark, so
 *     stacked marks — the case that breaks naive NFC folding — are
 *     exercised too; and
 *   - U+00B7 MIDDLE DOT, a *width-bearing* filler, so the extra
 *     length is real on screen. Combining marks alone are almost
 *     always zero-advance-width, so a mark-only expansion would
 *     inflate the character count while the layout never changed —
 *     a fixture that cannot fail is not a fixture.
 *
 * Because the insertion set is closed and `assertExpandableText`
 * refuses a source that already contains one of those characters,
 * `collapsePseudoText(expandPseudoText(source)) === source` holds
 * byte-exactly. That identity is the whole "meaning is preserved"
 * claim: nothing was rewritten, so every negation (`must not`),
 * every permission (`read-only`), every number and every unit is
 * still in the string the reviewer reads. `auditPseudoText` asserts
 * the identity on every row rather than trusting it.
 *
 * Protected spans (the one place this is NOT uniform)
 * ---------------------------------------------------
 * A row may declare `meaningTokens` — the negations, permission
 * words, numbers and paths whose loss would silently change what
 * the UI says. Those spans are exempt from decoration, so
 * `read-only` stays `read-only` in the expanded string instead of
 * becoming `read\u00B7\u0301-only`. That exemption is a deliberate,
 * documented property of this fixture and it is the reason the
 * "the token survives" assertion is checkable **by eye** in the
 * screenshot rather than only after a collapse pass:
 *
 *   - It makes the fixture self-evident. A reviewer who sees a
 *     number, a permission word and a route path unchanged inside a
 *     visibly grown paragraph has seen the claim, without having to
 *     trust a reversibility proof.
 *   - It costs the stress nothing. The declared tokens are a small
 *     fraction of a paragraph, and the ratio target is measured over
 *     the WHOLE row, so the row still reaches 1.5x. A row whose
 *     tokens leave no expandable slot is reported as
 *     `expandable: false` rather than quietly shipping a fake pass.
 *
 * What it does NOT claim: that a real translation preserves these
 * tokens. It cannot — no mechanical transform can. See
 * {@link PSEUDO_LOCALE_LIMITS}.
 *
 * Numbers are never decorated and no filler is ever placed between a
 * digit and the separator that groups it, so `1,234,567` / `12:30` /
 * `2026-01-05` survive as the same maximal runs. That is checkable,
 * and it is checked (`digitRunsPreserved`).
 *
 * Direction handling (UAX #9)
 * ---------------------------
 * An RTL paragraph containing `2026` or `admin` is a bidi problem
 * waiting to happen: those runs are weak-typed and their placement is
 * resolved by the renderer's Unicode Bidirectional Algorithm. The
 * fixture wraps every Latin / digit run of an RTL sample in an
 * explicit LTR isolate (U+2066 LRI … U+2069 PDI), which is the
 * UAX #9-recommended way to keep such a run internally LTR, and
 * `auditBidiIsolation` reports any run left unisolated.
 *
 * What is deliberately NOT promised
 * ---------------------------------
 * This module is NOT RTL support and must never be read as one. It
 * does not negotiate a locale, does not register a locale, does not
 * translate, does not pluralise, does not mirror a layout (`dir`,
 * logical properties, icon mirroring are presentation decisions that
 * belong to `src/editorial/`), and does not evaluate text QUALITY.
 * See {@link PSEUDO_LOCALE_LIMITS} for the list the verification
 * artefact prints verbatim.
 *
 * Leaf obligation: it imports nothing from the repository, so
 * `src/editorial/` may render the fixtures without any obligation
 * depending on another (`scripts/check-architecture.mjs` enforces the
 * leaf rule for `i18n`). Import specifiers carry the `.ts` extension
 * for the same reason `./unicode.ts` does — see `./index.ts`.
 */

/** Paragraph direction of a sample. Presentation, not a shipped locale. */
export type PseudoDirection = 'ltr' | 'rtl';

/** Code points this fixture is allowed to insert. Nothing else, ever. */
export const DECORATION_MARKS: readonly string[] = ['\u0301', '\u0304'];

/** Width-bearing filler. See the module docstring for why it exists. */
export const PSEUDO_FILLER = '\u00B7';

/** Every character `collapsePseudoText` is allowed to remove. */
export const PSEUDO_INSERTABLE: readonly string[] = [...DECORATION_MARKS, PSEUDO_FILLER];

/** The default expansion the platform is stress-tested at (Issue #429). */
export const DEFAULT_EXPANSION_RATIO = 1.5;

/**
 * The pseudo-locale identifier.
 *
 * `qps-ploc` is CLDR's reserved pseudo-locale id (the one Chrome and
 * Firefox's pseudo-localisation use). It is recorded here so a report
 * can name the fixture the way a localisation engineer would — and
 * explicitly NOT registered anywhere the platform negotiates a
 * locale: `src/home/format.ts` still offers exactly the locales the
 * platform has approved copy for. `scripts/capture-pseudo-locale-stress.test.mjs`
 * fails if any shipped runtime module reaches for anything in this
 * module.
 */
export const PSEUDO_LOCALE_ID = 'qps-ploc';

/** Raised for input this fixture refuses rather than silently mangles. */
export type PseudoExpansionErrorCode =
	| 'reserved-decoration-character'
	| 'invalid-ratio'
	| 'not-a-string';

/** Thrown by {@link assertExpandableText}; carries a machine-readable code. */
export class PseudoExpansionError extends Error {
	readonly code: PseudoExpansionErrorCode;

	constructor(code: PseudoExpansionErrorCode, message: string) {
		super(message);
		this.name = 'PseudoExpansionError';
		this.code = code;
	}
}

/** One stress sample. Data only — no importing, no rendering. */
export interface PseudoSample {
	/** Stable id, referenced from the tests, the report and the PR. */
	readonly id: string;
	/** What the row demonstrates. English: this is source-adjacent data. */
	readonly subject: string;
	/** BCP 47 tag the sample is written in. */
	readonly lang: string;
	readonly direction: PseudoDirection;
	/** The display body exactly as it would be authored. */
	readonly text: string;
	/**
	 * Meaning-bearing fragments that must survive expansion verbatim:
	 * negations, permission words and capability vocabulary. They are
	 * not a translation; they are the words whose loss would silently
	 * change what the UI says.
	 */
	readonly meaningTokens?: readonly string[];
	/** True for a row that exists to document a limit, not a pass. */
	readonly documentsLimit?: boolean;
	/** Why the platform behaves this way. */
	readonly note: string;
}

/** Did a meaning-bearing fragment survive the expansion verbatim? */
export interface MeaningTokenAudit {
	readonly token: string;
	readonly preserved: boolean;
}

/** What the Unicode Bidirectional Algorithm is being asked to resolve. */
export interface BidiIsolationFacts {
	readonly rtlStrong: number;
	readonly ltrStrong: number;
	/** Maximal digit runs, separators included (`1,234.56`, `2026-01-05`). */
	readonly digitRuns: readonly string[];
	/** Digit runs wrapped in an explicit LTR isolate. */
	readonly isolatedDigitRuns: number;
	/** Digit runs left to the renderer's UBA resolution. */
	readonly unisolatedDigitRuns: readonly string[];
	readonly isolates: { readonly lri: number; readonly pdi: number };
	readonly balanced: boolean;
	/** Deprecated embedding controls (U+202A–U+202E / U+2066–2069 misuse). */
	readonly deprecatedControls: readonly string[];
}

/** Everything the audit can say about one sample. */
export interface PseudoSampleAudit {
	readonly id: string;
	readonly subject: string;
	readonly direction: PseudoDirection;
	readonly sourceCodePoints: number;
	readonly expandedCodePoints: number;
	/** Code points the expansion itself added (bidi isolates excluded). */
	readonly expandedTextCodePoints: number;
	readonly ratio: number;
	readonly ratioTarget: number;
	/** False when the source has no decorable base character. */
	readonly expandable: boolean;
	/** Insertion positions this row offers the expander. */
	readonly expandableSlots: number;
	/**
	 * Code points inside declared `meaningTokens` spans, which the
	 * expander leaves alone so the token survives verbatim. Printed by
	 * the artefact: the ratio target is measured over the whole row,
	 * so a reader can see how much of it was exempt and why.
	 */
	readonly protectedCodePoints: number;
	readonly whitespacePreserved: boolean;
	readonly digitRunsPreserved: boolean;
	/** The source's maximal digit runs — what had to survive. */
	readonly digitRuns: readonly string[];
	readonly collapsesToSource: boolean;
	readonly meaningTokens: readonly MeaningTokenAudit[];
	readonly bidi: BidiIsolationFacts;
	readonly longestWord: number;
	readonly expandedLongestWord: number;
	/**
	 * Expected observations a row declares about itself (a row that
	 * exists to document a limit). Printed by the artefact, never a
	 * failure: a documented limit and a broken fixture are different
	 * things and the verdict has to be able to tell them apart.
	 */
	readonly documentedLimits: readonly string[];
	/** Empty on a passing row. */
	readonly findings: readonly string[];
	readonly ok: boolean;
}

/** The table + verdict the verification artefact and the gate print. */
export interface PseudoAuditReport {
	readonly samples: readonly PseudoSampleAudit[];
	readonly passing: number;
	readonly failing: number;
	readonly ok: boolean;
}

/** Options for {@link expandPseudoText}. */
export interface PseudoExpansionOptions {
	/** Target length as a multiple of the source length. Default 1.5. */
	readonly ratio?: number;
	/**
	 * Spans the expander must not decorate (see "Protected spans" in
	 * the module docstring). The declared `meaningTokens` of a
	 * {@link PseudoSample} are passed in by {@link auditPseudoText}; a
	 * caller expanding raw text passes none.
	 */
	readonly protectedTokens?: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Bidi isolate constants (UAX #9 / Unicode 6.3+)
 * ------------------------------------------------------------------ */

/** LEFT-TO-RIGHT ISOLATE — opens an explicitly LTR region. */
export const LRI = '\u2066';
/** FIRST STRONG ISOLATE — direction decided by the first strong char. */
export const FSI = '\u2068';
/** POP DIRECTIONAL ISOLATE — closes the innermost isolate. */
export const PDI = '\u2069';

/**
 * A Latin / digit run: an optional currency sign, then letters and
 * digits, optionally joined by an internal grouping separator
 * (`1,234.56`), optionally closed by a percent sign. Sentence
 * punctuation is not part of the run, so it stays outside the isolate.
 *
 * The currency sign and the percent sign belong INSIDE the isolate:
 * `$12.50` and `99.9%` are one unit, and splitting them leaves the
 * symbol to be resolved by the paragraph direction.
 */
const LTR_RUN_PATTERN =
	/[$\u20AC\u00A3\u00A5]?[\p{Script=Latin}\p{Nd}]+(?:[.,:/\u002D][\p{Nd}\p{Script=Latin}]+)*%?/gu;

/**
 * A digit run, separators included.
 *
 * U+002D HYPHEN-MINUS groups digits in exactly the way `.` and `,`
 * do — `2026-01-05` is one value, not three — and splitting it would
 * mean the audit compared `2026-01-05` against `2026` / `01` / `05`
 * while the fixture claimed the date survived. The pattern requires a
 * digit on BOTH sides of the separator, so a hyphen used as
 * punctuation (or as a minus sign between two numbers) is not pulled
 * in.
 */
const DIGIT_RUN_PATTERN = /\p{Nd}+(?:[.,:/\u002D]\p{Nd}+)*/gu;

/** A maximal run of whitespace, kept byte-exact by the audit. */
const WHITESPACE_RUN_PATTERN = /\s+/gu;

/**
 * Deprecated directional formatting characters (U+202A LRE …
 * U+202E RLO, U+2066–U+2069 when used without pairing). Isolates
 * replaced them in Unicode 6.3; shipping the deprecated forms is how
 * bidi bugs get shipped.
 */
const DEPRECATED_BIDI_CONTROLS: Readonly<Record<string, string>> = {
	'\u202A': 'LRE',
	'\u202B': 'RLE',
	'\u202C': 'PDF',
	'\u202D': 'LRO',
	'\u202E': 'RLO',
};

/** Code-point count (not UTF-16 units): astral characters count once. */
export function codePointLength(text: string): number {
	return [...text].length;
}

/**
 * Reject text this fixture must not touch.
 *
 * A source that already contains a decoration character would make
 * `collapsePseudoText` ambiguous: it could not tell an inserted mark
 * from an authored one, and the reversibility claim would quietly stop
 * holding. Refusing is the honest answer — such a sample is a fixture
 * authoring bug, not a runtime condition.
 */
export function assertExpandableText(text: string, ratio: number): void {
	if (typeof text !== 'string') {
		throw new PseudoExpansionError('not-a-string', `text must be a string, saw ${typeof text}`);
	}
	if (!Number.isFinite(ratio) || ratio < 1) {
		throw new PseudoExpansionError(
			'invalid-ratio',
			`expansion ratio must be a finite number >= 1, saw ${String(ratio)}`,
		);
	}
	for (const char of text) {
		if (PSEUDO_INSERTABLE.includes(char)) {
			throw new PseudoExpansionError(
				'reserved-decoration-character',
				`source text already contains a reserved pseudo decoration (U+${char
					.codePointAt(0)
					?.toString(16)
					.toUpperCase()
					.padStart(4, '0')}); expansion would not be reversible`,
			);
		}
	}
}

/**
 * Decoratable base characters: a letter, or a mark that can carry
 * another mark (the stacked-mark case). Digits, punctuation, symbols
 * and whitespace are NOT decoratable — that is what keeps numbers,
 * separators and break opportunities intact.
 */
function isDecoratableBase(char: string): boolean {
	return /\p{L}|\p{M}/u.test(char);
}

/**
 * Code-point indices covered by any protected token.
 *
 * The search runs over the CODE-POINT array, not over UTF-16 offsets,
 * because that array is what the expander indexes. An astral code
 * point in a token would silently shift every later index otherwise.
 */
function protectedIndices(chars: readonly string[], tokens: readonly string[]): Set<number> {
	const indices = new Set<number>();
	if (tokens.length === 0) return indices;
	for (const token of tokens) {
		const needle = [...token];
		if (needle.length === 0 || needle.length > chars.length) continue;
		for (let start = 0; start + needle.length <= chars.length; start += 1) {
			if (needle.every((char, offset) => chars[start + offset] === char)) {
				for (let offset = 0; offset < needle.length; offset += 1) {
					indices.add(start + offset);
				}
			}
		}
	}
	return indices;
}

/**
 * Insertion positions a row offers: decorable base characters that are
 * not inside a protected token.
 *
 * `auditPseudoText` reports this count instead of a bare yes/no, so a
 * row that stopped being expandable (a digits-only string, or a string
 * that is nothing but protected tokens) says how much room it had.
 */
export function expandableSlots(text: string, options: PseudoExpansionOptions = {}): number {
	const protectedSet = protectedIndices([...text], options.protectedTokens ?? []);
	return [...text].filter((char, index) => isDecoratableBase(char) && !protectedSet.has(index))
		.length;
}

/** Code points inside protected tokens — the artefact's exemption count. */
export function protectedCodePointCount(
	text: string,
	options: PseudoExpansionOptions = {},
): number {
	return protectedIndices([...text], options.protectedTokens ?? []).size;
}

/**
 * Expand text to a target length ratio, mechanically.
 *
 * Decorations are distributed round-robin over the decorable
 * positions, so the growth is spread through the string rather than
 * dumped at the end — a tail-heavy expansion would only widen the last
 * line and would not stress the headings, buttons and badges, which is
 * where an over-long string actually breaks.
 *
 * Insertion stops as soon as the target length is reached, so the
 * achieved ratio is `ceil(source * ratio) / source`, i.e. the target
 * plus at most one code point of slack. Positions covered by
 * `protectedTokens` are skipped (see "Protected spans" in the module
 * docstring).
 *
 * Returns the source unchanged when it has no decorable base
 * character left (a digits-only row, for instance). That is a
 * documented limit, not a pass: `auditPseudoText` records
 * `expandable: false` plus a finding.
 */
export function expandPseudoText(text: string, options: PseudoExpansionOptions = {}): string {
	const ratio = options.ratio ?? DEFAULT_EXPANSION_RATIO;
	assertExpandableText(text, ratio);

	const sourceLength = codePointLength(text);
	if (sourceLength === 0) return text;

	const slots: number[] = [];
	const chars = [...text];
	const protectedSet = protectedIndices(chars, options.protectedTokens ?? []);
	chars.forEach((char, index) => {
		if (isDecoratableBase(char) && !protectedSet.has(index)) slots.push(index);
	});
	if (slots.length === 0) return text;

	const needed = Math.max(0, Math.ceil(sourceLength * ratio) - sourceLength);
	const perSlot = new Map<number, number>();
	for (let inserted = 0; inserted < needed; inserted += 1) {
		const slot = slots[inserted % slots.length];
		perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1);
	}

	let decorationIndex = 0;
	const out: string[] = [];
	chars.forEach((char, index) => {
		out.push(char);
		const count = perSlot.get(index) ?? 0;
		for (let repeat = 0; repeat < count; repeat += 1) {
			// Alternate mark / filler so both stress types are always
			// present, and alternate the mark so a stacked pair is two
			// DIFFERENT marks (U+0301 then U+0304) rather than a doubled
			// one, which is the shape a normaliser actually has to keep.
			out.push(
				decorationIndex % 2 === 0
					? DECORATION_MARKS[Math.floor(decorationIndex / 2) % DECORATION_MARKS.length]
					: PSEUDO_FILLER,
			);
			decorationIndex += 1;
		}
	});
	return out.join('');
}

/** Remove every character `expandPseudoText` is allowed to insert. */
export function collapsePseudoText(text: string): string {
	return [...text].filter((char) => !PSEUDO_INSERTABLE.includes(char)).join('');
}

/** Remove directional isolates, restoring the bare text. */
export function stripIsolates(text: string): string {
	return [...text].filter((char) => char !== LRI && char !== FSI && char !== PDI).join('');
}

/**
 * Wrap every Latin / digit run of an RTL paragraph in an explicit LTR
 * isolate (U+2066 LRI … U+2069 PDI).
 *
 * A no-op for an LTR paragraph: the whole paragraph is already LTR, so
 * there is nothing to isolate and adding markers would only add
 * invisible noise to the fixture.
 *
 * Returns the text unchanged when it contains no RTL character — an
 * "RTL" sample that is not actually RTL is a fixture bug, and
 * `auditPseudoText` reports it rather than this function guessing.
 */
export function isolateEmbeddedRuns(text: string): string {
	if (!/\p{Script=Arabic}|\p{Script=Hebrew}/u.test(text)) return text;
	return text.replace(LTR_RUN_PATTERN, (run) => `${LRI}${run}${PDI}`);
}

/** Expand, then isolate — the composite a preview surface renders. */
export function pseudoLocalize(
	text: string,
	direction: PseudoDirection,
	options: PseudoExpansionOptions = {},
): string {
	const expanded = expandPseudoText(text, options);
	return direction === 'rtl' ? isolateEmbeddedRuns(expanded) : expanded;
}

/** Maximal digit runs, separators included, in order. */
export function digitRuns(text: string): readonly string[] {
	return text.match(DIGIT_RUN_PATTERN) ?? [];
}

/** Whether the LTR isolate currently open at `index` is closed after `run`. */
function isIsolatedRun(text: string, start: number, end: number): boolean {
	const opened = text.slice(0, start);
	const closed = text.slice(end);
	const lastOpen = Math.max(opened.lastIndexOf(LRI), opened.lastIndexOf(FSI));
	return lastOpen !== -1 && closed.indexOf(PDI) !== -1 && lastOpen > opened.lastIndexOf(PDI);
}

/** The whole set of directional facts the artefact prints for one string. */
export function auditBidiIsolation(text: string): BidiIsolationFacts {
	const rtlStrong = (text.match(/\p{Script=Arabic}|\p{Script=Hebrew}/gu) ?? []).length;
	const ltrStrong = (text.match(/\p{Script=Latin}/gu) ?? []).length;
	const runs = [...text.matchAll(DIGIT_RUN_PATTERN)];
	const unisolated: string[] = [];
	let isolatedDigitRuns = 0;
	for (const run of runs) {
		const start = run.index ?? 0;
		const end = start + run[0].length;
		if (isIsolatedRun(text, start, end)) isolatedDigitRuns += 1;
		else unisolated.push(run[0]);
	}
	const isolates = {
		lri: (text.match(new RegExp(LRI, 'gu')) ?? []).length,
		pdi: (text.match(new RegExp(PDI, 'gu')) ?? []).length,
	};
	const deprecatedControls = [...text]
		.filter((char) => char in DEPRECATED_BIDI_CONTROLS)
		.map((char) => DEPRECATED_BIDI_CONTROLS[char]);
	return {
		rtlStrong,
		ltrStrong,
		digitRuns: runs.map((run) => run[0]),
		isolatedDigitRuns,
		unisolatedDigitRuns: unisolated,
		isolates,
		balanced: isolates.lri === isolates.pdi,
		deprecatedControls,
	};
}

function longestWord(text: string): number {
	const words = text.split(/\s+/u).filter((word) => word.length > 0);
	return words.reduce((longest, word) => Math.max(longest, codePointLength(word)), 0);
}

function whitespaceRuns(text: string): readonly string[] {
	return text.match(WHITESPACE_RUN_PATTERN) ?? [];
}

/**
 * Audit one sample: what the expansion did, and what survived.
 *
 * Every finding is a string, so the verification artefact and the
 * PR can print the same verdict the test asserts.
 *
 * `ratio` is measured on the expansion only (see the note at its
 * computation); `expandedCodePoints` includes the bidi isolate markers
 * an RTL row additionally carries.
 */
export function auditPseudoText(
	sample: PseudoSample,
	options: PseudoExpansionOptions = {},
): PseudoSampleAudit {
	const ratio = options.ratio ?? DEFAULT_EXPANSION_RATIO;
	const protectedTokens = sample.meaningTokens ?? [];
	const expansion = { ratio, protectedTokens };
	const expanded = pseudoLocalize(sample.text, sample.direction, expansion);
	const collapsed = collapsePseudoText(stripIsolates(expanded));
	const sourceLength = codePointLength(sample.text);
	const expandedLength = codePointLength(expanded);
	// The ratio is measured on the EXPANSION alone. An RTL row also gains
	// U+2066 / U+2069 isolate markers, which are not expansion, so counting
	// them would let a row pass a 1.5x target it never reached.
	const expandedLengthOnly = codePointLength(stripIsolates(expanded));
	const achieved = sourceLength === 0 ? 0 : expandedLengthOnly / sourceLength;
	const slots = expandableSlots(sample.text, expansion);
	const expandable = slots > 0;
	const protectedCodePoints = protectedCodePointCount(sample.text, expansion);
	const findings: string[] = [];
	const documentedLimits: string[] = [];

	const collapsesToSource = collapsed === sample.text;
	if (!collapsesToSource) findings.push('expanded text does not collapse back to the source');

	const digitsPreserved =
		JSON.stringify(digitRuns(stripIsolates(expanded))) === JSON.stringify(digitRuns(sample.text));
	if (!digitsPreserved) findings.push('a digit run changed during expansion');

	const whitespacePreserved =
		JSON.stringify(whitespaceRuns(expanded)) === JSON.stringify(whitespaceRuns(sample.text));
	if (!whitespacePreserved) findings.push('expansion introduced or removed whitespace');

	if (sample.direction === 'rtl' && auditBidiIsolation(sample.text).rtlStrong === 0) {
		findings.push('sample declares rtl but contains no RTL character');
	}
	if (expandable && achieved < ratio) {
		findings.push(`expansion reached ${achieved.toFixed(3)}x, below the ${ratio}x target`);
	}
	if (!expandable) {
		const message = 'no decorable base character: this string cannot be expanded';
		if (sample.documentsLimit) documentedLimits.push(message);
		else findings.push(message);
	}

	const bidi = auditBidiIsolation(expanded);
	if (sample.direction === 'rtl' && bidi.unisolatedDigitRuns.length > 0) {
		findings.push(`unisolated digit run(s): ${bidi.unisolatedDigitRuns.join(' ')}`);
	}
	if (!bidi.balanced) findings.push('directional isolates are unbalanced');
	if (bidi.deprecatedControls.length > 0) {
		findings.push(`deprecated bidi control(s): ${bidi.deprecatedControls.join(' ')}`);
	}

	const meaningTokens = protectedTokens.map((token) => ({
		token,
		preserved: expanded.includes(token),
	}));
	for (const fact of meaningTokens) {
		if (!fact.preserved) findings.push(`meaning-bearing token lost: ${fact.token}`);
	}

	return {
		id: sample.id,
		subject: sample.subject,
		direction: sample.direction,
		sourceCodePoints: sourceLength,
		expandedCodePoints: expandedLength,
		/** Code points the expansion itself added (isolates excluded). */
		expandedTextCodePoints: expandedLengthOnly,
		ratio: achieved,
		ratioTarget: ratio,
		expandable,
		expandableSlots: slots,
		protectedCodePoints,
		whitespacePreserved,
		digitRunsPreserved: digitsPreserved,
		digitRuns: digitRuns(sample.text),
		collapsesToSource,
		meaningTokens,
		bidi,
		longestWord: longestWord(sample.text),
		expandedLongestWord: longestWord(stripIsolates(expanded)),
		documentedLimits,
		findings,
		ok: findings.length === 0,
	};
}

/** Audit the whole table. `ok === false` means the artefact must not ship. */
export function auditPseudoSamples(
	samples: readonly PseudoSample[] = PSEUDO_STRESS_SAMPLES,
	options: PseudoExpansionOptions = {},
): PseudoAuditReport {
	const rows = samples.map((sample) => auditPseudoText(sample, options));
	const failing = rows.filter((row) => !row.ok).length;
	return { samples: rows, passing: rows.length - failing, failing, ok: failing === 0 };
}

/**
 * What this fixture does NOT establish. Printed verbatim by the
 * verification artefact, because "the stress test passed" is only
 * meaningful next to the list of things it was never measuring.
 */
export const PSEUDO_LOCALE_LIMITS: readonly string[] = [
	'Not a translation. The wording is a stress string, not approved copy: no sentence here has been translated, reviewed or proofread, and no word of it may be published.',
	'Not RTL support. Direction handling is verified only as far as "digit and Latin runs stay internally LTR and the layout does not break". Mirroring (`dir`, logical properties, icon flip), an RTL locale entry and RTL copy remain undecided owner decisions.',
	"Not text quality. Nothing here scores prose. Proofreading stays an editor's job (ADR-0017 records that no automatic gate is a translation-quality guarantee).",
	'Not a layout guarantee. A browser pass at 320 px shows this build does not break; it is not a proof for fonts, viewports or surfaces nobody measured.',
	'Not a plural / unit / number-format contract. Those belong to the home format adapter (Issue #430) and to the locale data itself.',
	'Not a performance budget. A 1.5x expansion is a worst-case guess, not a measurement of any real locale.',
];

/* ------------------------------------------------------------------ *
 * The sample table
 * ------------------------------------------------------------------ */

/**
 * The stress table (Issue #429).
 *
 * Escapes, not literals, for every non-ASCII character — the same
 * convention `fixtures.ts` uses, because an NFC / NFD pair renders
 * identically and differs only in invisible marks. A formatter must
 * not be able to silently normalise this file into a different set of
 * code points.
 *
 * The words in the Arabic and Hebrew rows are deliberately plain
 * neutral phrases. They are stress strings: the point of the row is
 * the embedded `2026` / `admin` / `$12.50` / `99.9%` runs and the
 * way the renderer resolves them, not the prose.
 */
export const PSEUDO_STRESS_SAMPLES: readonly PseudoSample[] = [
	{
		id: 'en-baseline',
		subject: 'ordinary LTR copy — the control row every other row is compared against',
		lang: 'en',
		direction: 'ltr',
		text: 'The home page reads the platform status once per visit.',
		note: 'Control row: 1.5x must not change which line the reader sees first.',
	},
	{
		id: 'en-negation-permission',
		subject: 'negation and permission vocabulary',
		lang: 'en',
		direction: 'ltr',
		text: 'This view is read-only: do not publish it, and do not grant admin access to anyone else.',
		meaningTokens: ['read-only', 'do not publish', 'admin access'],
		note: 'The words whose loss would change what the UI permits. Expansion may only add characters around them.',
	},
	{
		id: 'en-numbers',
		subject: 'digits, grouping, separators and units',
		lang: 'en',
		direction: 'ltr',
		text: 'Requests 1,234,567; 12:30; 2026-01-05; 99.9%; /api/v1/reactions; v1.2; 1024x768',
		meaningTokens: ['1,234,567', '12:30', '2026-01-05', '99.9%', '/api/v1/reactions'],
		note: 'A pseudo-localisation that renumbers a table is worse than no pseudo-localisation: the digits are the payload.',
	},
	{
		id: 'de-compound',
		subject: 'unbreakable long word (German compound)',
		lang: 'de',
		direction: 'ltr',
		text: 'Der Schutz der Donaudampfschifffahrtsgesellschaftskapit\u00E4nswitwenversicherungspolice wurde 1886 geregelt.',
		note: 'A 68-character compound with no break opportunity. This is the row that finds a container narrower than its content.',
	},
	{
		id: 'ja-mixed',
		subject: 'Japanese with ASCII digits and a timestamp',
		lang: 'ja',
		direction: 'ltr',
		text: '\u30B9\u30C6\u30FC\u30BF\u30B9: 12 \u4EF6\u306E\u30A2\u30A4\u30C6\u30E0\u3092\u8868\u793A\u3057\u307E\u3059\uFF082026-01-05 09:00 JST\u3001\u7BC4\u56F2 1\u301C3\uFF09\u3002',
		note: 'CJK has no word spacing, so expansion lands between ideographs: the line-break row of Issue #431 covers the typography half.',
	},
	{
		id: 'combining-marks',
		subject: 'decomposed spellings — NFC vs NFD rendered alike',
		lang: 'de',
		direction: 'ltr',
		text: 'Nai\u0308ve Sen\u0303or Gar\u0327on U\u0308ber',
		note: 'The source is NFD. Expansion stacks a second mark on top of each one, which is the case a normaliser would have to preserve (and ADR-0017 refuses to fold).',
	},
	{
		id: 'digits-variant',
		subject: 'fullwidth and Arabic-Indic digits side by side',
		lang: 'und',
		direction: 'ltr',
		text: 'Fullwidth \uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18\uFF19 / Arabic-Indic \u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669 / ASCII 123456789 / grouped 1.234.567',
		meaningTokens: ['\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18\uFF19', '1.234.567'],
		note: 'Digits are digits: p{Nd} covers all three sets, and none of them may be decorated or regrouped.',
	},
	{
		id: 'ar-rtl-embedded',
		subject: 'Arabic paragraph with embedded Latin, digits and a currency symbol',
		lang: 'ar',
		direction: 'rtl',
		text: '\u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629 \u062A\u0639\u0631\u0636 12 \u0639\u0646\u0635\u0631\u064B\u0627 \u0641\u064A \u0639\u0627\u0645 2026 (admin) $12.50\u060C \u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0639\u062F\u064A\u0644\u0647\u0627.',
		meaningTokens: ['12', '2026', 'admin', '$12.50'],
		note: 'A neutral stress string, not approved copy. The embedded Latin and currency runs are what the isolate audit checks.',
	},
	{
		id: 'he-rtl-acronym',
		subject: 'Hebrew paragraph with an acronym and a percentage',
		lang: 'he',
		direction: 'rtl',
		text: '\u05E2\u05DE\u05D5\u05D3 \u05D6\u05D4 \u05DE\u05E6\u05D9\u05D2 12 \u05E4\u05E8\u05D9\u05D8\u05D9\u05DD \u05D1\u05E9\u05E0\u05EA 2026 (SLA 99.9%)',
		meaningTokens: ['12', '2026', 'SLA', '99.9%'],
		note: 'An acronym inside an RTL run is the case where a naive concatenation flips the reading order.',
	},
	{
		id: 'digits-only',
		subject: 'a string with no letter at all',
		lang: 'und',
		direction: 'ltr',
		text: '2026-01-05 09:00',
		documentsLimit: true,
		note: 'Documented limit: nothing here may be decorated, so this row cannot reach the 1.5x target and reports expandable: false rather than a fake pass.',
	},
];

/** Look a sample up by id; throws rather than returning `undefined`. */
export function pseudoSampleById(id: string): PseudoSample {
	const sample = PSEUDO_STRESS_SAMPLES.find((row) => row.id === id);
	if (!sample) throw new Error(`unknown pseudo-locale sample: ${id}`);
	return sample;
}
