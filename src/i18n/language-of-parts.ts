/**
 * The language-of-parts policy and its fixture (Issue #409).
 *
 * What this owns
 * --------------
 * The **rule** for WCAG 2.2 SC 3.1.2 Language of Parts (level A):
 * when a run of text inside a document may carry its own BCP-47 `lang`,
 * and what may be written there. It is text POLICY, so it lives in the
 * text-policy obligation (`src/i18n/`) beside the Unicode and slug
 * rules: it imports nothing from the repository, so `home/`,
 * `portfolio/`, `editorial/` and every future surface can obey one rule
 * without depending on each other.
 *
 * It is DATA plus pure lookups, exactly like `./fixtures.ts` and
 * `./glyphs.fixture.ts`. The rendering lives in `src/editorial/`
 * (`language-of-parts.tsx`), which owns the visual language; the
 * fixture declares a language, never a font or a class.
 *
 * Four consumers, zero drift:
 *
 *   * `src/i18n/language-of-parts.test.ts` — the CI assertions (the
 *     tag grammar, the verdicts, the guards, byte-exact round trips).
 *   * `src/editorial/language-of-parts.tsx` + its Storybook gallery —
 *     the shipped rendering.
 *   * `scripts/check-language-of-parts.mjs` — the gate in
 *     `validate:fast`.
 *   * `scripts/capture-language-of-parts.mjs` — the browser capture
 *     behind `docs/verification/a11y/mixed-language-content.webp`.
 *
 * The anti-mechanical rule is the point
 * -------------------------------------
 * SC 3.1.2 asks for `lang` on a **passage** whose language differs
 * from the surrounding text. It does not ask for a `lang` on every
 * Latin word: a Japanese sentence containing the loanword `Dashboard`
 * is read by Japanese rules, and a code identifier is not a passage of
 * human language at all. A gate that tagged every ASCII run would
 * produce attributes that carry no pronunciation and would still miss
 * the run that actually changes the voice — the English quotation and
 * the Korean sentence. So the fixture authorises a tag for exactly
 * two kinds (`sentence`, `phrase`) and refuses it for the other two
 * (`code`, `loanword`), and the gate fails if a part contradicts its
 * own kind.
 *
 * 3.1.1 is the floor, not this Issue
 * ----------------------------------
 * The document language is published here as {@link DOCUMENT_LANGUAGE}
 * because a partial tag is only meaningful against a document
 * language: `lang="ja"` on a run inside `lang="ja"` tells a screen
 * reader nothing. The product declares that language on the document
 * element in `src/routes/__root.tsx`, and the gate asserts the two
 * agree, so a fixture can never claim a document language the shipped
 * pages contradict.
 *
 * Escapes, not literals
 * ---------------------
 * `./fixtures.ts` and `./glyphs.fixture.ts` write every non-ASCII
 * character as a `\uXXXX` escape because the thing being verified
 * there is an **invisible** difference: an NFC spelling and its NFD
 * twin render identically, so the reader cannot see which code point
 * is meant. That is not this fixture's problem. Everything that
 * distinguishes a row here is a **visible** script change — a
 * quotation, a Hangul sentence, a loanword — and a document written
 * in escapes could not be proof-read by the person who has to judge
 * whether the sentence actually changes the way it is read. The
 * byte-exactness concern survives instead as
 * {@link LanguagePart.guard}: `language-of-parts.test.ts` asserts
 * that each guard token is still present, character for character, so
 * a tool that "tidied" a row fails the suite instead of quietly
 * changing what the artefact claims.
 */

/**
 * The language the product declares on the document element.
 *
 * WCAG 2.2 SC 3.1.1 Language of Page (A). Owned here as POLICY; the
 * declaration itself lives in `src/routes/__root.tsx`, and
 * `scripts/check-language-of-parts.mjs` asserts the two agree.
 */
export const DOCUMENT_LANGUAGE = 'ja';

/**
 * What kind of text a run is, which decides whether a `lang` may be
 * written on it.
 *
 *   - `sentence` — a whole sentence in another language. Tagged.
 *   - `phrase`   — a quotation, a title, a multi-word term read as
 *     another language. Tagged.
 *   - `code`     — an identifier (`architecture:check`). Never tagged:
 *     `<code>` already gives the non-text-presentational distinction,
 *     and a `lang` would mis-declare how a token that is not spoken
 *     should be spoken.
 *   - `loanword` — a single adopted word inside otherwise-document
 *     language text (`Dashboard`). Never tagged: the reader already
 *     uses the document language's rules for it.
 */
export type LanguagePartKind = 'sentence' | 'phrase' | 'code' | 'loanword';

/** Kinds a `lang` may be written on. */
const TAGGABLE_KINDS: readonly LanguagePartKind[] = ['sentence', 'phrase'];

/**
 * What the policy decided about one part.
 *
 * `tagged` is the only verdict that writes an attribute; every other
 * verdict is a refusal with a reason, and the renderer reports it as
 * `data-lang-verdict` so the capture can show the refusal instead of
 * hiding it.
 */
export type LanguagePartVerdict =
	| 'tagged'
	| 'not-a-passage'
	| 'tag-redundant'
	| 'malformed-tag'
	| 'empty-text';

/** Why a declared `lang` was refused. Reported, never guessed at. */
export type LanguageTagProblem =
	| 'empty-tag'
	| 'whitespace'
	| 'non-ascii'
	| 'underscore'
	| 'iso-639-3-code'
	| 'language-subtag'
	| 'script-subtag'
	| 'region-subtag'
	| 'variant-subtag';

/**
 * ISO 639-2/3 three-letter codes whose canonical HTML `lang` value is
 * the two-letter 639-1 code. `eng-US` is not a valid tag and never was
 * a documented HTML one: the platform refuses it rather than passing it
 * to a user agent that would treat it as an unknown language.
 *
 * Only the codes this repository's languages could plausibly be
 * written in are listed; the rule does not need to be a full ISO
 * registry, and a registry imported from a package would make the text
 * policy depend on that package.
 */
const ISO_639_3_CODES: ReadonlySet<string> = new Set([
	'chi',
	'deu',
	'eng',
	'fra',
	'ger',
	'ita',
	'jpn',
	'kor',
	'nld',
	'por',
	'rus',
	'spa',
	'zho',
]);

export interface LanguageTagInspection {
	readonly ok: boolean;
	/** Canonical form (`zh-Hant`, `en-US`) when `ok`. */
	readonly canonical: string | null;
	/** Why it was refused, when not `ok`. */
	readonly problem: LanguageTagProblem | null;
}

/**
 * Inspect a declared `lang` value (pure).
 *
 * This is a deliberately small, decidable subset of BCP-47: the tags
 * an HTML document may carry for human languages — a language subtag,
 * an optional script, an optional region, then variants. Private-use
 * (`x-…`) and grandfathered tags are refused rather than guessed at,
 * because a tag this module cannot canonicalise is a tag this
 * repository cannot claim to have verified.
 */
export function inspectLanguageTag(tag: string | null | undefined): LanguageTagInspection {
	if (tag === null || tag === undefined || tag === '') {
		return { ok: false, canonical: null, problem: 'empty-tag' };
	}
	if (tag !== tag.trim()) {
		return { ok: false, canonical: null, problem: 'whitespace' };
	}
	if (!/^[\x20-\x7e]+$/.test(tag)) {
		return { ok: false, canonical: null, problem: 'non-ascii' };
	}
	if (tag.includes('_')) {
		return { ok: false, canonical: null, problem: 'underscore' };
	}

	const subtags = tag.split('-');
	const language = subtags[0] ?? '';
	if (!/^[a-z]{2,8}$/.test(language)) {
		return { ok: false, canonical: null, problem: 'language-subtag' };
	}
	if (language.length === 3 && ISO_639_3_CODES.has(language)) {
		return { ok: false, canonical: null, problem: 'iso-639-3-code' };
	}

	let index = 1;
	let script: string | null = null;
	const next = subtags[index];
	if (next !== undefined && /^[A-Za-z]{4}$/.test(next)) {
		const titlecase = `${next[0]?.toUpperCase()}${next.slice(1).toLowerCase()}`;
		if (next !== titlecase && next !== next.toLowerCase()) {
			// `zh-hant` is accepted and canonicalised to `zh-Hant`; `zh-hAnt`
			// is a script written in a case BCP-47 never defines, so it is
			// refused rather than repaired behind the author's back.
			return { ok: false, canonical: null, problem: 'script-subtag' };
		}
		script = titlecase;
		index += 1;
	}

	let region: string | null = null;
	const regionTag = subtags[index];
	if (regionTag !== undefined && (/^[A-Z]{2}$/.test(regionTag) || /^[0-9]{3}$/.test(regionTag))) {
		region = regionTag;
		index += 1;
	} else if (regionTag !== undefined && /^[A-Za-z]{2}$/.test(regionTag)) {
		return { ok: false, canonical: null, problem: 'region-subtag' };
	}

	const variants = subtags.slice(index);
	for (const variant of variants) {
		if (!/^(?:[0-9][a-z0-9]{3,7}|[a-z0-9]{5,8})$/.test(variant)) {
			return { ok: false, canonical: null, problem: 'variant-subtag' };
		}
	}

	return {
		ok: true,
		canonical: [language, script, region, ...variants].filter(Boolean).join('-'),
		problem: null,
	};
}

export interface LanguagePart {
	/** Stable id — referenced from the tests, the gate report and the capture. */
	readonly id: string;
	readonly kind: LanguagePartKind;
	/** The BCP-47 tag the author declared, or `null` for a part that declares none. */
	readonly tag: string | null;
	/** The run exactly as it appears in the body. */
	readonly text: string;
	/** Why this part exists, and why it does or does not carry a tag. */
	readonly note: string;
	/**
	 * A substring that has to survive into the rendering. A quotation
	 * that lost its citation, or a sentence that lost its negation, is
	 * no longer the sentence the artefact claims to have verified.
	 */
	readonly guard: string;
}

/** One run of a body. `part` names the row in {@link LANGUAGE_PARTS}. */
export interface LanguageRun {
	readonly text: string;
	readonly part?: string;
}

/**
 * A body document. `runs` is the authored sequence, so a document can
 * interleave document-language prose and foreign-language passages
 * without the policy module having to parse anything.
 */
export interface LanguageDocument {
	readonly id: string;
	/**
	 * Which state the fixture is here for: a mixed-language body, a
	 * body with no foreign run at all, or a body whose parts the
	 * policy refuses. The Storybook gallery and the capture render each
	 * of them, and `04-compact` re-renders `normal` in a narrow column.
	 */
	readonly case: 'normal' | 'empty' | 'failure';
	readonly title: string;
	readonly note: string;
	readonly runs: readonly LanguageRun[];
}

/**
 * The part registry. Every run that names a part resolves here, so a
 * run can never invent a tag at the call site.
 */
export const LANGUAGE_PARTS: readonly LanguagePart[] = [
	{
		id: 'code-architecture-check',
		kind: 'code',
		tag: null,
		text: 'architecture:check',
		note: 'コード名。読み上げ対象の文ではなく、`<code>` が非テキスト表現である旨を示しているため `lang` を付けない。',
		guard: 'architecture:check',
	},
	{
		id: 'loanword-dashboard',
		kind: 'loanword',
		tag: null,
		text: 'Dashboard',
		note: '英単語 1 語だけ日本語の文に埋め込まれた形。文書言語の規則で読まれるため `lang` を付けない（全英単語への機械付与の反例）。',
		guard: 'Dashboard',
	},
	{
		id: 'quote-english',
		kind: 'phrase',
		tag: 'en',
		text: '"The language of parts" is the technique that WCAG 3.1.2 describes.',
		note: '英語の引用。日本語の文中で読み方が変わる最初の run であり、`lang="en"` を書く対象。',
		guard: 'WCAG 3.1.2',
	},
	{
		id: 'sentence-korean',
		kind: 'sentence',
		tag: 'ko',
		text: '한국어 문장은 음성이 다른 언어의 규칙으로 읽혀야 합니다.',
		note: '韓国語の 1 文。文書言語（日本語）と音体系が違い、`lang="ko"` を書く対象。',
		guard: '음성이 다른',
	},
	{
		id: 'rejected-iso-639-3',
		kind: 'phrase',
		tag: 'eng-US',
		text: 'The tag "eng-US" is a three-letter code with a region appended.',
		note: '拒否例 1: ISO 639-2/3 の 3 文字コードに地域を付けた形。正しくは `en-US`。契約は検証できない tag を user agent に渡さない。',
		guard: 'eng-US',
	},
	{
		id: 'rejected-redundant',
		kind: 'phrase',
		tag: DOCUMENT_LANGUAGE,
		text: '文書言語と同じ言語の run。',
		note: `拒否例 2: 文書言語（\`${DOCUMENT_LANGUAGE}\`）と同じ tag。支援技術に何も伝わらない情報になるため付けない。`,
		guard: '文書言語',
	},
	{
		id: 'rejected-empty',
		kind: 'sentence',
		tag: 'en',
		text: '',
		note: '拒否例 3: 本文が空。`lang` の対象になる語が存在しないので付けない（要素自体は verdict を観測するため残る）。',
		guard: '',
	},
];

/**
 * The mixed-language fixture bodies.
 *
 * These are VERIFICATION strings. None of them is approved site copy, no
 * product fact is stated in them, and none of them describes a page the
 * platform publishes. `docs/domain/i18n.md` §5 draws the line between
 * copy quality (the editor's job) and a decidable contract (this
 * module's job): the sentences exist so a screen reader switches voice
 * on exactly the runs the policy tagged, and the gate — not a person
 * reading this file — decides whether the tagging is correct.
 */
export const LANGUAGE_DOCUMENTS: readonly LanguageDocument[] = [
	{
		id: 'article',
		case: 'normal',
		title: '混在本文（正常）',
		note: '日本語の本文に、コード名・英単語・英語の引用・韓国語の文が混在します。`lang` が付くのは引用と韓国語の文だけで、コード名と英単語 1 語には付きません。',
		runs: [
			{
				text: '検証用の本文です。日本語の文に、',
			},
			{ text: 'architecture:check', part: 'code-architecture-check' },
			{
				text: ' というコード名と、',
			},
			{ text: 'Dashboard', part: 'loanword-dashboard' },
			{
				text: ' という英単語 1 語を埋め込みました。どちらも日本語の規則で読まれるので部分 lang は付けません。続いて英語の引用 ',
			},
			{
				text: '"The language of parts" is the technique that WCAG 3.1.2 describes.',
				part: 'quote-english',
			},
			{
				text: ' を挟み、',
			},
			{ text: '한국어 문장은 음성이 다른 언어의 규칙으로 읽혀야 합니다.', part: 'sentence-korean' },
			{
				text: ' という韓国語の文を 1 文置きます。支援技術はこの 2 か所でだけ言語を切り替えるはずです。',
			},
		],
	},
	{
		id: 'plain',
		case: 'empty',
		title: '混在なし（空）',
		note: '文書言語だけで書かれた本文。ポリシーは `lang` を 1 つも書きません。属性が 0 個であることがこの state の期待値です。',
		runs: [
			{
				text: 'この段落は日本語だけで書かれています。部分 lang が 1 つも無いこと、それ自体が検証項目です。属性を機械的に増やす実装にすると、この段落の 0 個という期待値が壊れます。',
			},
		],
	},
	{
		id: 'refusals',
		case: 'failure',
		title: '拒否例（失敗）',
		note: '契約に拒否される 3 例。いずれも `lang` を書きません。拒否理由（verdict）は要素の `data-lang-verdict` に残るので、隠さずに観測できます。',
		runs: [
			{
				text: '拒否例 1（tag が検証不能）: ',
			},
			{
				text: 'The tag "eng-US" is a three-letter code with a region appended.',
				part: 'rejected-iso-639-3',
			},
			{
				text: ' / 拒否例 2（文書言語と同じ tag）: ',
			},
			{ text: '文書言語と同じ言語の run。', part: 'rejected-redundant' },
			{
				text: ' / 拒否例 3（本文が空）: ',
			},
			{ text: '', part: 'rejected-empty' },
			{
				text: '（空の run の要素は verdict だけが残り、lang は書きません）。',
			},
		],
	},
];

/** Every part id, in declaration order (used by the gate's coverage rule). */
export const LANGUAGE_PART_IDS: readonly string[] = LANGUAGE_PARTS.map((part) => part.id);

/** Look one part up by id. `undefined` for an id the registry does not declare. */
export function findLanguagePart(id: string): LanguagePart | undefined {
	return LANGUAGE_PARTS.find((part) => part.id === id);
}

/** Look one document up by id. */
export function findLanguageDocument(id: string): LanguageDocument | undefined {
	return LANGUAGE_DOCUMENTS.find((document) => document.id === id);
}

/** Every document whose `case` is the given state. */
export function languageDocumentsByCase(
	state: LanguageDocument['case'],
): readonly LanguageDocument[] {
	return LANGUAGE_DOCUMENTS.filter((document) => document.case === state);
}

/**
 * Decide what happens to one part (pure).
 *
 * The order is the contract, and it is deliberately "structural
 * objections first": a part with no text cannot be a passage whatever
 * its tag, and a tag this module cannot canonicalise is refused
 * before the author-intent questions (`is this a passage?`, `is the
 * tag redundant?`) are asked. Two parts can therefore never be
 * classified by two different readers in two different orders.
 */
export function classifyLanguagePart(
	part: LanguagePart,
	documentLanguage: string = DOCUMENT_LANGUAGE,
): LanguagePartVerdict {
	if (part.text.trim() === '') {
		return 'empty-text';
	}
	const inspection = inspectLanguageTag(part.tag);
	if (inspection.problem === 'empty-tag' && !TAGGABLE_KINDS.includes(part.kind)) {
		// No tag was declared, and the kind does not need one: this is
		// the code / loanword case, not a missing declaration.
		return 'not-a-passage';
	}
	if (!inspection.ok) {
		return 'malformed-tag';
	}
	if (!TAGGABLE_KINDS.includes(part.kind)) {
		return 'not-a-passage';
	}
	const canonical = inspection.canonical ?? '';
	const document = inspectLanguageTag(documentLanguage);
	if (canonical === (document.canonical ?? documentLanguage)) {
		return 'tag-redundant';
	}
	return 'tagged';
}

/**
 * The `lang` value the renderer writes for one part, or `null` (pure).
 *
 * `null` means "write no attribute at all", never an empty string: an
 * empty `lang=""` is invalid HTML and tells a user agent to treat the
 * run as an unknown language.
 */
export function languageAttributeFor(
	part: LanguagePart,
	documentLanguage: string = DOCUMENT_LANGUAGE,
): string | null {
	if (classifyLanguagePart(part, documentLanguage) !== 'tagged') {
		return null;
	}
	return inspectLanguageTag(part.tag).canonical;
}

/** A run resolved to what it renders. */
export interface ResolvedLanguageRun {
	readonly text: string;
	readonly part: LanguagePart | null;
	readonly verdict: LanguagePartVerdict | null;
	/** `null` for document-language prose and for every refused part. */
	readonly lang: string | null;
}

/**
 * Resolve one document into the runs the renderer writes (pure).
 *
 * An unresolvable `part` reference resolves to a `verdict: null` run
 * with no attribute: a dangling reference must not invent a tag, and
 * the gate reports the dangling id separately.
 */
export function resolveLanguageRuns(
	document: LanguageDocument,
	documentLanguage: string = DOCUMENT_LANGUAGE,
): ResolvedLanguageRun[] {
	return document.runs.map((run) => {
		const part = run.part === undefined ? undefined : findLanguagePart(run.part);
		if (run.part === undefined) {
			return { text: run.text, part: null, verdict: null, lang: null };
		}
		if (part === undefined) {
			return { text: run.text, part: null, verdict: null, lang: null };
		}
		const verdict = classifyLanguagePart(part, documentLanguage);
		return {
			text: part.text,
			part,
			verdict,
			lang: verdict === 'tagged' ? inspectLanguageTag(part.tag).canonical : null,
		};
	});
}

/** Every `lang` value a document is expected to emit, in document order. */
export function expectedLanguageAttributes(
	document: LanguageDocument,
	documentLanguage: string = DOCUMENT_LANGUAGE,
): string[] {
	return resolveLanguageRuns(document, documentLanguage)
		.map((run) => run.lang)
		.filter((lang): lang is string => lang !== null);
}

/**
 * The WCAG 2.2 mapping this fixture and its gate stand behind, with
 * the machine / human split the Issue asks for.
 *
 * The split is the point: a green gate proves the ATTRIBUTES are what
 * the contract says, and it cannot prove that a screen reader actually
 * changed voice. `checked: 'human'` rows are reported as open, never
 * as satisfied.
 */
export const LANGUAGE_WCAG_MAPPING: readonly {
	readonly criterion: string;
	readonly level: 'A' | 'AA';
	readonly claim: string;
	readonly checked: 'machine' | 'human';
	readonly how: string;
}[] = [
	{
		criterion: '3.1.2 Language of Parts',
		level: 'A',
		claim: 'a passage whose language differs from the surrounding text carries its own `lang`',
		checked: 'machine',
		how: '`classifyLanguagePart` + `src/editorial/language-of-parts.test.tsx` (SSR markup) + the capture reading `lang` off the live DOM',
	},
	{
		criterion: '3.1.1 Language of Page',
		level: 'A',
		claim: 'the document declares a language, and the fixture never contradicts it',
		checked: 'machine',
		how: '`scripts/check-language-of-parts.mjs` compares `DOCUMENT_LANGUAGE` with the `lang` on `<html>` in `src/routes/__root.tsx`, and the capture records `document.documentElement.lang`',
	},
	{
		criterion: '3.1.2 Language of Parts (anti-mechanical half)',
		level: 'A',
		claim:
			'no `lang` is written on a code identifier, a loanword, or a run in the document language',
		checked: 'machine',
		how: 'the same gate: `language-tag-on-non-language` / `language-tag-redundant`, computed from the classifier rather than from a regex over the fixture',
	},
	{
		criterion: '4.1.2 Name, Role, Value',
		level: 'A',
		claim:
			'a tagged run stays a text run — the attribute changes the voice, never the role or the content',
		checked: 'machine',
		how: 'the renderer emits a plain `<span lang>` with no role and no ARIA; the capture stores the Chromium accessibility snapshot of each panel',
	},
	{
		criterion: '3.1.2 in a real screen reader',
		level: 'A',
		claim:
			'VoiceOver / NVDA / Orca actually switch voice on the tagged runs and stay in Japanese on the untagged ones',
		checked: 'human',
		how: 'NOT checked here — no assistive technology was run. Recorded as open, not as satisfied',
	},
	{
		criterion: '1.4.5 / 1.4.10 reflow of a tagged run',
		level: 'AA',
		claim: 'a tagged quotation or Hangul sentence reflows at 320 px without being cut',
		checked: 'human',
		how: 'NOT a conformance claim: the 04-compact panel renders the fixture at 320 px, but reflow is judged by a person, not by this gate',
	},
];
