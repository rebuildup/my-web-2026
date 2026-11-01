#!/usr/bin/env node

/**
 * check-a11y-wcag-review-matrix — keep the WCAG 2.2 A/AA manual review
 * matrix honest (Issue #410).
 *
 * What this gate is for
 * ---------------------
 * The automated a11y gates in this repository decide what a machine can
 * decide: names, roles, contrast ratios, heading structure, alt text.
 * They cannot decide whether a screen reader announces a status message
 * in a useful order, whether the keyboard path is complete, or whether
 * the page is still readable at 200 % zoom. Those judgements are made by
 * a person, and this gate manages the RECORD of that judgement:
 *
 *   - which WCAG 2.2 A/AA criteria this repository considers at all,
 *     and — for every criterion it does not cover — **why**;
 *   - which surface and which **state** of that surface the review is
 *     about;
 *   - whether the criterion is decided by a **machine** or by a **person**;
 *   - who performed the review, when, in which environment, and what
 *     the result was.
 *
 * The central rule
 * -----------------
 * **An automatic pass is not a human verification, and the two can never
 * be confused.** A criterion that a machine gate covers is recorded as
 * `auto-pass`; a criterion a person looked at is recorded as
 * `human-verified` (or `human-failed`). There is no code path that turns
 * an `auto-pass` into a `human-verified`, and a document that claims the
 * site conforms to WCAG 2.2 AA is a **violation** unless a human
 * verification exists and the document points at this matrix. A green run
 * of this gate therefore never means "the site is AA compliant"; it
 * means "the table that records the manual reviews is intact".
 *
 * The rules
 * ---------
 *   item-field-missing
 *       A required field of an item is missing or empty.
 *   item-duplicate-id
 *       Two items share an id.
 *   item-sc-unknown
 *       An item names a success criterion that is not a WCAG 2.2 A/AA
 *       criterion in {@link WCAG_22_CRITERIA}. An unknown number is
 *       never assumed to be covered.
 *   item-state-unknown
 *       An item names a state that is not in {@link REVIEW_STATES}.
 *   item-method-invalid
 *       An item does not say whether a machine or a person decides it.
 *   item-review-state-invalid
 *       The recorded review state does not fit the method (a machine
 *       item cannot be `human-verified`; a human item cannot be
 *       `auto-pass`; `not-reviewed` may not carry evidence).
 *   item-evidence-missing
 *       A performed review is missing the reviewer, the date, the
 *       environment or the result — or carries a result that disagrees
 *       with the recorded state.
 *   item-evidence-stale
 *       The evidence is older than the review window, or dated in the
 *       future. A stale record is a record that has to be made again.
 *   item-auto-gate-missing
 *       An item names an npm script that does not exist, so the machine
 *       half of the record points at nothing.
 *   surface-missing
 *       A surface points at a file or a story export that does not
 *       exist. A review of a surface that is gone proves nothing.
 *   surface-state-missing
 *       The (surface, state) pair is not available, or the state marker
 *       the surface declares is not in the source any more — the fixture
 *       no longer reproduces the state the table reviews.
 *   state-undisposed
 *       A state of the vocabulary is not enumerated in the matrix.
 *   state-uncovered
 *       An enumerated state has no item at all.
 *   criterion-undisposed
 *       A criterion is neither covered by an item nor excluded with a
 *       reason. "We did not look at it" is a decision, not a silence.
 *   criterion-exclusion-reason-missing
 *       A criterion is excluded without a reason.
 *   criterion-conflict
 *       A criterion is both covered by an item and excluded.
 *   criterion-universe-mismatch
 *       The criterion universe does not match: a WCAG 2.2 A/AA
 *       criterion is decided by neither the table's vocabulary nor the
 *       scope decisions, one of the two lists holds a criterion that is
 *       not part of an A/AA claim, or a criterion is decided twice.
 *   compliance-claim-unbacked
 *       A document claims that the site conforms to WCAG 2.2 AA while no
 *       human verification exists, or without pointing at this matrix.
 *   scope-decision-doc-mismatch
 *       The scope decisions (the A/AA criteria this table does not
 *       carry) and the documentation that states them disagree — in
 *       any field, including a field the documentation does not have.
 *   scope-disposition-invalid
 *       A scope decision has no disposition, a disposition outside the
 *       vocabulary, or the fields its disposition requires are
 *       missing / the ones it forbids are present.
 *   scope-exclusion-not-a-product-fact
 *       A `not-applicable` decision whose reason or evidence says "this
 *       table has no item for it" / "no owner" instead of naming a fact
 *       about the published product. "We did not look at it" is not an
 *       applicability argument.
 *   scope-unverified-missing-review-plan
 *       An `applicable-unverified` decision that does not say who has
 *       to review it and how to reproduce the check.
 *   scope-verified-without-review-record
 *       An `applicable-and-verified` decision without a human review
 *       record. The repository holds no such record.
 *   release-assessment-unbacked
 *       The ledger's release assessment claims the AA audit is complete
 *       while the record says otherwise.
 *   fixture-expectation-mismatch
 *       A fixture does not behave the way its own expectation says.
 *   fixture-contract-missing
 *       A fixture file is missing, unparsable, or its directory is empty.
 *
 * Exit codes: 0 = the table is intact, 1 = at least one violation,
 * 2 = the gate cannot decide (the matrix cannot be read).
 *
 * Usage:
 *   node scripts/check-a11y-wcag-review-matrix.mjs [--quiet] [--json=FILE]
 *   node scripts/check-a11y-wcag-review-matrix.mjs --today=2026-10-23
 *   node scripts/check-a11y-wcag-review-matrix.mjs --today 2026-10-23
 *   node scripts/check-a11y-wcag-review-matrix.mjs --matrix=<path>
 *   node scripts/check-a11y-wcag-review-matrix.mjs --scope-decisions=<path>
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed matrix. Static data, read-only for the gate. */
export const MATRIX_PATH = 'quality/wcag-review-matrix.json';

/** Where the gate's own fixtures live. */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-wcag-review-matrix';
export const FIXTURE_PASS_DIR = `${FIXTURE_ROOT}/pass`;
export const FIXTURE_FAIL_DIR = `${FIXTURE_ROOT}/fail`;

/**
 * The fixture files this gate expects in each directory.
 *
 * The set is EXACT: a fixture that quietly lost a file would verify
 * less than it claims, and a file nobody registered would verify
 * something unread.
 */
export const EXPECTED_FIXTURE_FILES = {
	pass: ['01-intact-matrix.json', '02-claim-with-human-verification.json'],
	fail: [
		'01-review-without-reviewer.json',
		'02-unknown-state.json',
		'03-not-reviewed-with-evidence.json',
		'04-missing-surface.json',
		'05-unbacked-claim.json',
		'06-exclusion-without-reason.json',
		'07-unknown-auto-gate.json',
		'08-stale-evidence.json',
		'09-uncovered-state.json',
		'10-conflicting-criterion.json',
		'11-claim-predicate-without-qualifier.json',
		'12-claim-negated-in-another-clause.json',
		'13-release-assessment-unbacked.json',
	],
};

/**
 * The official WCAG 2.2 Level A / AA success criteria.
 *
 * This is the **criterion universe**: the single source of truth for
 * what a Level A/AA conformance claim covers. It was transcribed from
 * the WCAG 2.2 specification (W3C, <https://www.w3.org/TR/WCAG22/>)
 * and checked against it on 2026-10-23: **55 criteria — 31 at Level A
 * and 24 at Level AA**.
 *
 * The table's own vocabulary ({@link WCAG_22_CRITERIA}) and the scope
 * decisions ({@link SCOPE_DECISIONS}) both take their level and name
 * from here, and the gate checks that their union is exactly this set
 * (`criterion-universe-mismatch`), so a criterion can neither be lost
 * nor invented.
 *
 * The gate itself is offline: this constant is a transcription, and the
 * transcription is only as good as the last manual check against the
 * specification. The write-up records the date of that check.
 */
export const WCAG_22_A_AA_UNIVERSE = {
	'1.1.1': { level: 'A', name: 'Non-text Content' },
	'1.2.1': { level: 'A', name: 'Audio-only and Video-only (Prerecorded)' },
	'1.2.2': { level: 'A', name: 'Captions (Prerecorded)' },
	'1.2.3': { level: 'A', name: 'Audio Description or Media Alternative (Prerecorded)' },
	'1.2.4': { level: 'AA', name: 'Captions (Live)' },
	'1.2.5': { level: 'AA', name: 'Audio Description (Prerecorded)' },
	'1.3.1': { level: 'A', name: 'Info and Relationships' },
	'1.3.2': { level: 'A', name: 'Meaningful Sequence' },
	'1.3.3': { level: 'A', name: 'Sensory Characteristics' },
	'1.3.4': { level: 'AA', name: 'Orientation' },
	'1.3.5': { level: 'AA', name: 'Identify Input Purpose' },
	'1.4.1': { level: 'A', name: 'Use of Color' },
	'1.4.2': { level: 'A', name: 'Audio Control' },
	'1.4.3': { level: 'AA', name: 'Contrast (Minimum)' },
	'1.4.4': { level: 'AA', name: 'Resize Text' },
	'1.4.5': { level: 'AA', name: 'Images of Text' },
	'1.4.10': { level: 'AA', name: 'Reflow' },
	'1.4.11': { level: 'AA', name: 'Non-text Contrast' },
	'1.4.12': { level: 'AA', name: 'Text Spacing' },
	'1.4.13': { level: 'AA', name: 'Content on Hover or Focus' },
	'2.1.1': { level: 'A', name: 'Keyboard' },
	'2.1.2': { level: 'A', name: 'No Keyboard Trap' },
	'2.1.4': { level: 'A', name: 'Character Key Shortcuts' },
	'2.2.1': { level: 'A', name: 'Timing Adjustable' },
	'2.2.2': { level: 'A', name: 'Pause, Stop, Hide' },
	'2.3.1': { level: 'A', name: 'Three Flashes or Below Threshold' },
	'2.4.1': { level: 'A', name: 'Bypass Blocks' },
	'2.4.2': { level: 'A', name: 'Page Titled' },
	'2.4.3': { level: 'A', name: 'Focus Order' },
	'2.4.4': { level: 'A', name: 'Link Purpose (In Context)' },
	'2.4.5': { level: 'AA', name: 'Multiple Ways' },
	'2.4.6': { level: 'AA', name: 'Headings and Labels' },
	'2.4.7': { level: 'AA', name: 'Focus Visible' },
	'2.4.11': { level: 'AA', name: 'Focus Not Obscured (Minimum)' },
	'2.5.1': { level: 'A', name: 'Pointer Gestures' },
	'2.5.2': { level: 'A', name: 'Pointer Cancellation' },
	'2.5.3': { level: 'A', name: 'Label in Name' },
	'2.5.4': { level: 'A', name: 'Motion Actuation' },
	'2.5.7': { level: 'AA', name: 'Dragging Movements' },
	'2.5.8': { level: 'AA', name: 'Target Size (Minimum)' },
	'3.1.1': { level: 'A', name: 'Language of Page' },
	'3.1.2': { level: 'AA', name: 'Language of Parts' },
	'3.2.1': { level: 'A', name: 'On Focus' },
	'3.2.2': { level: 'A', name: 'On Input' },
	'3.2.3': { level: 'AA', name: 'Consistent Navigation' },
	'3.2.4': { level: 'AA', name: 'Consistent Identification' },
	'3.2.6': { level: 'A', name: 'Consistent Help' },
	'3.3.1': { level: 'A', name: 'Error Identification' },
	'3.3.2': { level: 'A', name: 'Labels or Instructions' },
	'3.3.3': { level: 'AA', name: 'Error Suggestion' },
	'3.3.4': { level: 'AA', name: 'Error Prevention (Legal, Financial, Data)' },
	'3.3.7': { level: 'A', name: 'Redundant Entry' },
	'3.3.8': { level: 'AA', name: 'Accessible Authentication (Minimum)' },
	'4.1.2': { level: 'A', name: 'Name, Role, Value' },
	'4.1.3': { level: 'AA', name: 'Status Messages' },
};

/**
 * The Level A criteria WCAG 2.2 removed.
 *
 * `4.1.1 Parsing` is marked "Obsolete and removed" in the WCAG 2.2
 * specification: it is no longer part of a Level A conformance claim,
 * so it is deliberately **not** in {@link WCAG_22_A_AA_UNIVERSE}. It
 * is listed here so that it is not dropped silently — an item or a
 * scope decision that names it is reported with this reason instead of
 * a bare "unknown criterion".
 */
export const WCAG_22_OBSOLETE_CRITERIA = {
	'4.1.1': { name: 'Parsing', note: 'obsolete and removed in WCAG 2.2' },
};

/**
 * The criteria this matrix may speak about.
 *
 * Only Level A and Level AA criteria are listed: a Level AAA criterion
 * is not part of a conformance claim this repository makes, and mixing
 * the levels would blur the claim. The table is the vocabulary — an SC
 * number that is not in it is reported, never assumed.
 *
 * The level and the name are taken from {@link WCAG_22_A_AA_UNIVERSE},
 * so the two can never disagree about what a criterion is.
 */
export const WCAG_22_CRITERIA = Object.fromEntries(
	[
		'1.1.1',
		'1.2.2',
		'1.2.4',
		'1.3.1',
		'1.3.2',
		'1.3.4',
		'1.3.5',
		'1.4.1',
		'1.4.3',
		'1.4.4',
		'1.4.10',
		'1.4.11',
		'1.4.12',
		'1.4.13',
		'2.1.1',
		'2.1.2',
		'2.4.1',
		'2.4.2',
		'2.4.3',
		'2.4.6',
		'2.4.7',
		'2.4.11',
		'2.5.8',
		'3.1.1',
		'3.1.2',
		'3.3.1',
		'3.3.2',
		'3.3.7',
		'4.1.2',
		'4.1.3',
	].map((sc) => [sc, WCAG_22_A_AA_UNIVERSE[sc]]),
);

/**
 * The dispositions a scope decision may carry.
 *
 * A scope decision is a DECISION about a WCAG 2.2 A/AA criterion this
 * table does not carry as an item. A decision has to say something
 * about the published product — there is no third, blank answer:
 *
 *   - `not-applicable`
 *       The published product provably lacks the feature the criterion
 *       is about ("the site ships no prerecorded audio-only content").
 *       The evidence is a FACT about the product, checkable from the
 *       repository. A decision whose reason says "this table has no
 *       item for it" is NOT this: it is an admission that nobody
 *       looked, and the gate rejects it
 *       (`scope-exclusion-not-a-product-fact`).
 *   - `applicable-unverified`
 *       The criterion applies to the published site, but no person has
 *       checked it. Such a decision MUST name who has to review it
 *       (`reviewer` — a role, never an agent) and how to reproduce the
 *       check (`steps`). Without them it is an open hole, not a
 *       decision (`scope-unverified-missing-review-plan`).
 *   - `applicable-and-verified`
 *       The criterion applies AND a person has measured it. This
 *       disposition requires a human review record
 *       (`scope-verified-without-review-record`). The repository holds
 *       **no** such record: no owner measurement exists, and an agent
 *       may not fabricate one.
 *
 * The three are different statements, and the release assessment has
 * to report them separately: "the ledger's structure is green" says
 * nothing about "the audited quality passes".
 */
export const SCOPE_DISPOSITIONS = [
	'not-applicable',
	'applicable-unverified',
	'applicable-and-verified',
];

/**
 * What each disposition has to carry.
 *
 * `requires` are fields that must be present and non-empty;
 * `forbids` are fields that must be absent (a `not-applicable`
 * decision has no reviewer and no reproduction plan — there is nothing
 * left to review).
 */
export const SCOPE_DISPOSITION_CONTRACT = {
	'not-applicable': {
		requires: ['reason', 'evidence'],
		forbids: ['reviewer', 'steps', 'verifiedBy', 'verifiedAt'],
	},
	'applicable-unverified': {
		requires: ['reason', 'evidence', 'reviewer', 'steps'],
		forbids: ['verifiedBy', 'verifiedAt'],
	},
	'applicable-and-verified': {
		requires: ['reason', 'evidence', 'reviewer', 'steps', 'verifiedBy', 'verifiedAt'],
		forbids: [],
	},
};

/**
 * The wording that turns an exclusion into an admission that nobody
 * looked.
 *
 * "We have no item for it in this table" and "no owner" are NOT
 * applicability arguments: they describe the ledger, not the product.
 * A `not-applicable` decision whose reason or evidence uses one of
 * these patterns is refused (`scope-exclusion-not-a-product-fact`).
 *
 * The check is a PATTERN over the reason text, so it also catches the
 * phrasings nobody anticipated. The negative control is the fixture
 * `scripts/fixtures/a11y-wcag-review-matrix/scope/fail/01-table-coverage-exclusion.json`,
 * which reproduces the wording this issue removed.
 */
export const TABLE_COVERAGE_PATTERNS = [
	// 「…をこの表に持たない」 / 「この表に持たない」
	/この表に(?:は)?(?:[^。、]{0,12})?(?:持|もた)ない/,
	// 「検査する項目」「検査項目」「レビュー項目」
	/(?:検査|レビュー|チェック)(?:する|項目|用の項目)/,
	// 「検査項目が無い」「項目が無い」
	/(?:検査|レビュー)?項目(?:が|は|を)?(?:無い|ない|ありません)/,
	// 「表に項目が無い」
	/表(?:の|に)(?:[^。、]{0,8})?(?:項目|基準)(?:が|は|を)?(?:無い|ない)/,
	// 「表の外側にある」
	/表(?:の|の)?外(?:側)?(?:の|に)(?:ある|いる|あるもの)/,
	// "no item in this table" / "no review item for"
	/(?:no|not any) (?:item|items|criterion|criteria|review|check)(?:s)? (?:in|for|of) (?:this|the) (?:table|matrix)/i,
	// "no owner" / "nobody is assigned"
	/no (?:owner|assignee|reviewer|responsib\w*)/i,
	// "not covered by this table" / "not checked"
	/not (?:have|has|covered|reviewed|checked|audited)(?:ed)? (?:an? |any )?(?:item|entry|coverage|record)/i,
];

/**
 * Does the text read like an admission that nobody looked?
 *
 * The patterns are matched over the reason AND the evidence, because
 * either one can carry the admission.
 */
export function looksLikeTableCoverageReason(text) {
	const value = String(text ?? '');
	return TABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * The A/AA criteria this table does NOT carry, and what was decided
 * about each of them.
 *
 * WCAG 2.2 has 55 Level A / AA criteria (31 at Level A, 24 at Level
 * AA; see {@link WCAG_22_A_AA_UNIVERSE}). {@link WCAG_22_CRITERIA}
 * holds the 30 this repository's table speaks about; the remaining 25
 * are decided HERE, as a scope decision rather than as a table item.
 *
 * They are deliberately NOT `excluded` entries: `excluded` accepts the
 * criteria of the table's own vocabulary only, so a number outside it
 * (a Level AAA criterion, for instance) is reported as
 * `item-sc-unknown` instead of being quietly accepted. That is why the
 * two lists never overlap.
 *
 * The level and the name are taken from {@link WCAG_22_A_AA_UNIVERSE};
 * only the decision itself is written here. Every decision carries:
 *
 *   - `disposition` — one of {@link SCOPE_DISPOSITIONS};
 *   - `reason` — what the decision is about;
 *   - `evidence` — the product fact that closes it (`not-applicable`),
 *     or what would close it (`applicable-unverified`);
 *   - `reviewer` / `steps` — who has to do the remaining work and how
 *     to reproduce it (`applicable-unverified` only).
 *
 * The reason / evidence / steps text is Japanese because the
 * documentation table carries the same text and the gate compares the
 * two (`scope-decision-doc-mismatch`); the rest of this file stays
 * English.
 */
export const SCOPE_DECISIONS = [
	{
		sc: '1.2.1',
		disposition: 'not-applicable',
		reason: '事前録音の音声・動画だけのコンテンツを出荷していない。',
		evidence:
			'`src/**` に `<audio>` / `<video>` 要素も `autoplay` 属性も無く（`src/editorial/reduced-motion.ts` の該当箇所は将来の自動再生メディアを検出する条文）、事前録音のメディアを同梱する Tool も無い（`src/tools/manifest.json` にメディアの記載が無い）。',
	},
	{
		sc: '1.2.3',
		disposition: 'not-applicable',
		reason: '事前録音の映像を出荷していない（1.2.1 と同じ理由）。',
		evidence:
			'1.2.1 と同じ。`src/**` に `<video>` 要素が無く、事前録音の映像を同梱する Tool も無い。',
	},
	{
		sc: '1.2.5',
		disposition: 'not-applicable',
		reason:
			'事前録音の映像・音声を出荷していないため、音声説明の代替手段を用意しない（1.2.1 と同じ理由）。',
		evidence:
			'1.2.1 と同じ。`src/**` に `<video>` / `<audio>` 要素が無く、事前録音の映像・音声を同梱する Tool も無い。',
	},
	{
		sc: '1.3.3',
		disposition: 'applicable-unverified',
		reason:
			'感覚的な特徴（位置・形・色・音）に依存した指示の候補が 1 件ある。ホームのリアクション欄の空表示は「下のボタンから送ってみましょう」と位置で指示している（`src/home/reactions/widget.tsx`）。ただしコントロールの種類「ボタン」も併記しているため、位置だけに依存しているかは未判定。',
		evidence:
			'公開画面の指示文を人が読み、感覚的な特徴だけで操作を特定している文が 1 件も無いことを確認する。候補は上記の空表示文と、各フォームの説明文。',
		reviewer: 'owner',
		steps: [
			'開発サーバーを起動して `/` を開き、リアクション欄が空のときの文言を読む（`src/home/reactions/widget.tsx`）。',
			'`/about`・`/contact`・`/portfolio`・`/tools` を開き、指示文が位置・形・色・音のどれか 1 つにだけ依存していないか読む。',
			'位置だけに依存する文があれば、その文がコントロールの種類や役割を併記しているかを判断する。',
			'判定と根拠（該当した文と併記の有無）を記録する。',
		],
	},
	{
		sc: '1.4.2',
		disposition: 'not-applicable',
		reason: '2 秒以上鳴り止まない音が自動再生する UI を持たない。',
		evidence:
			'`src/**` に `<audio>` / `<video>` 要素も `autoplay` 属性も無く、音声を自動再生するコードも無い。',
	},
	{
		sc: '1.4.5',
		disposition: 'applicable-unverified',
		reason:
			'文字を画像として描画している箇所がある。ホームのアクセスカウンタは数字を WebP の 1 枚ずつ（`src/home/digits/*.webp`）で描画している。',
		evidence:
			'カウンタの桁を実際のテキスト（等幅数字）に置き換えられるか、例外（特定の表示上の必然性）が成立するかを人が判断する。',
		reviewer: 'owner',
		steps: [
			'`/` を開き、アクセスカウンタの桁が `<img>` 画像で描画されていることを確認する（`src/home/digits/*.webp`）。',
			'桁を囲む `role="img"` の `aria-label` が数値を読み上げられることを確認する。',
			'桁をテキスト描画（`font-variant-numeric: tabular-nums`）に置き換えられるかを判断する。',
			'置き換え可能なら例外は成立しない。判定と根拠を記録する。',
		],
	},
	{
		sc: '2.1.4',
		disposition: 'not-applicable',
		reason: '1 文字のショートカットキーを使う操作を用意していない。',
		evidence:
			'`src/**` の keydown ハンドラは `Escape`・矢印キー・`Home` / `End` のみで、単一文字のショートカットは無い（`src/editorial/nav/PublicNav.tsx`、`src/keyboard/components/KeyboardPage.tsx`、`src/home/reactions/widget.tsx`）。',
	},
	{
		sc: '2.2.1',
		disposition: 'applicable-unverified',
		reason:
			'時間の制限のある操作を 1 つ出荷している。管理画面の API キー発行には 5 分の step-up 確認窓（`STEP_UP_MAX_AGE_SECONDS` = 300）が残り、窓が切れると発行できなくなる。公開画面には時間制限が無いが、管理画面を適合の主張の範囲に含めるかどうかの判断がまだ無い。',
		evidence:
			'step-up 窓が SC 2.2.1 の「内容による時間の制限」に当たるかどうかと、管理画面を適合の主張の範囲に含めるかどうかを判断する。',
		reviewer: 'owner',
		steps: [
			'管理画面にログインして `/admin/keys` を開き、step-up 確認（パスワード確認）の窓が 5 分であることを表示していることを確認する（`src/admin/keys/step-up-panel.tsx`）。',
			'窓が切れたあとの挙動（step-up が失われ、発行できなくなる等）を確認する。',
			'認証前の画面（`/`・`/about`・`/contact`・`/portfolio`・`/tools`・`/admin/login`・`/admin/invitations_/accept`）に時間制限のある操作が無いかを確認する。',
			'管理画面を適合の主張に含めるかどうか、含める場合はこの窓が SC 2.2.1 に当たるかを判断し、判定と根拠を記録する。',
		],
	},
	{
		sc: '2.2.2',
		disposition: 'not-applicable',
		reason: '2 秒以上動き続ける自動更新アニメーションを使っていない。',
		evidence:
			'`src/**` で発行される `animation-name` はカウンタの桁ロールアップ（320 ms）のみで、無限ループも 5 秒を超える自動更新も無い（`src/home/access/tiles.tsx`）。',
	},
	{
		sc: '2.3.1',
		disposition: 'not-applicable',
		reason: '1 秒間に 3 回以上点滅する表現を使っていない。',
		evidence:
			'`src/**` に点滅するアニメーションが無く、唯一のアニメーション（カウンタの桁ロールアップ）は 320 ms で 1 回だけ再生される（`src/home/access/tiles.tsx`）。',
	},
	{
		sc: '2.4.4',
		disposition: 'applicable-unverified',
		reason:
			'リンクの目的が文脈だけでは判断しにくい可能性がある。リンク文言だけの記録はできるが、文脈ごとの判断は人がする必要がある（例: 「Portfolio を開く」「記録を開く / Open the record」「← Previous」）。',
		evidence:
			'各公開画面のリンク文言を、リンク先を見ずに記録し、直前の文・ページの主題・リンク文言だけで目的が分かるかを判断する。',
		reviewer: 'owner',
		steps: [
			'公開画面（`/`・`/about`・`/contact`・`/portfolio`・`/portfolio/my-web-2026`・`/tools`・`/design-system`・`/keyboard`・`/projects/dotfiles`）を 1 枚ずつ開く。',
			'各ページのリンク文言を、リンク先を見ずにそのまま記録する。',
			'各リンクが「リンク文言 + 直前の文 + ページの主題」だけで目的が分かるかを判断する。',
			'判断できないリンクがあれば、文言と前後の文を添えて報告し、判定を記録する。',
		],
	},
	{
		sc: '2.4.5',
		disposition: 'applicable-unverified',
		reason:
			'複数の到達経路を出す必要がある。公開ナビ（`src/editorial/nav/PublicNav.tsx`）と `GET /sitemap.xml` は同じ URL 群を advertise するが、公開ナビを表示しない画面がある（`/`・`/tools`・`/tools/<slug>`）。公開ナビからも内部リンクからも到達できず、Sitemap にも無い URL があれば、到達経路は 1 通りしかない。',
		evidence:
			'各公開 URL について、公開ナビ・内部リンク・サイトマップの何通りで到達できるかを数え、1 通りしかない URL を洗い出す。',
		reviewer: 'owner',
		steps: [
			'`GET /sitemap.xml` を取得し、掲載されている URL を記録する。',
			'各公開 URL について、(a) 公開ナビ、(b) 内部リンク、(c) サイトマップ のうち何通りで到達できるかを記録する。',
			'1 通りしかない URL を洗い出す（`/projects/dotfiles` が候補）。',
			'判定と、1 通りしかない URL が有ればその URL を記録する。',
		],
	},
	{
		sc: '2.5.1',
		disposition: 'not-applicable',
		reason: 'パス操作（スワイプなど）を使う操作を用意していない。',
		evidence: '`src/**` に `touchstart` / `touchmove` やパスベクトルのハンドラが無い。',
	},
	{
		sc: '2.5.2',
		disposition: 'not-applicable',
		reason: '単一のポインタ操作だけで操作できる UI に絞っている。',
		evidence:
			'`src/**` に複数ポインタ（マルチタッチ）の操作が無い。`onPointer*` と `touch*` のハンドラ自体が無い。',
	},
	{
		sc: '2.5.3',
		disposition: 'applicable-unverified',
		reason:
			'可視ラベルとアクセシブル名の不一致が既知の違反として残っている。`/` の capability リンクは可視テキストが「Portfolio を開く」で `aria-label` は「ポートフォリオ を開く」、`/portfolio` の facet ボタンも可視テキストと `aria-label` が食い違う（`e2e/a11y/axe-baseline.json` の `label-content-name-mismatch`）。',
		evidence:
			'可視テキストが `aria-label` に含まれるかを全リンク・ボタンで判断し、食い違う箇所を洗い出す。',
		reviewer: 'owner',
		steps: [
			'`pnpm run a11y:axe:check` を実行し、`e2e/a11y/axe-baseline.json` の `label-content-name-mismatch` 記録（`/` の `a[aria-label="ポートフォリオ を開く"]` と `/portfolio` の facet ボタン）を確認する。',
			'`/` の capability リンクごとに、可視テキストと `aria-label` を突き合わせる。',
			'`/portfolio` の facet ボタンごとに、可視テキストと `aria-label` を突き合わせる。',
			'不一致ごとに `aria-label` を直すか可視テキストを直すかを判断し、判定と該当箇所を記録する。',
		],
	},
	{
		sc: '2.5.4',
		disposition: 'not-applicable',
		reason: '端末を振って操作する機能を持たない。',
		evidence: '`src/**` に `DeviceMotion` / `DeviceOrientation` を使うコードが無い。',
	},
	{
		sc: '2.5.7',
		disposition: 'not-applicable',
		reason: 'ドラッグで操作する UI（スライダーなど）を持たない。',
		evidence:
			'`src/**` にドラッグ操作のハンドラが無い。`draggable="false"`（`src/home/access/tiles.tsx`）は画像のドラッグ抑止で、ドラッグ操作の提供ではない。',
	},
	{
		sc: '3.2.1',
		disposition: 'not-applicable',
		reason: 'フォーカスしただけで自動で開く UI を持たない。',
		evidence: '`src/**` に `onFocus` / `onFocusCapture` のハンドラが無い。',
	},
	{
		sc: '3.2.2',
		disposition: 'not-applicable',
		reason: '入力値の変更で画面が自動で切り替わる UI を持たない。',
		evidence:
			'`src/**` の `onChange` は制御された入力の状態更新だけで、ページ遷移・フォーカス移動・別の表示の生成を起こさない（`src/routes/admin.emoji-catalog.tsx`、`src/routes/admin.keys.tsx`、`src/admin/invitations/accept-view.tsx`）。',
	},
	{
		sc: '3.2.3',
		disposition: 'applicable-unverified',
		reason:
			'ページを越えたナビゲーションがある。公開ナビは全画面で共通の 1 つのコンポーネント（`src/editorial/nav/PublicNav.tsx`）だが、公開ナビを表示しない画面もある（`/`・`/tools`・`/tools/<slug>`）。順序が全画面で一致するかは未判定。',
		evidence: '公開ナビを表示する全画面でリンクの相対順序を記録し、一致するかを確認する。',
		reviewer: 'owner',
		steps: [
			'公開ナビを表示する画面（`/about`・`/contact`・`/portfolio`・`/portfolio/my-web-2026`・`/design-system`・`/keyboard`・`/projects/dotfiles`）を開く。',
			'各画面の `<nav>` 内のリンク順序を左から右へ記録する。',
			'記録した順序が全画面で一致するかを確認する。',
			'公開ナビを表示しない画面（`/`・`/tools`・`/tools/<slug>`）が他の画面と同じ順序の経路を提供しているかを確認する。',
			'順序が異なる画面があれば、その画面と該当箇所を記録する。',
		],
	},
	{
		sc: '3.2.4',
		disposition: 'applicable-unverified',
		reason:
			'同じ機能の名称がページを越えて揃っているかを確認する必要がある。公開ナビのラベルとパンくずのラベルは複数の画面で使われる（`src/editorial/nav/route-labels.ts`）。揃っているかは未判定。',
		evidence:
			'同じ機能に付けられる名称（例: 「お問い合わせ / Contact」「Portfolio」）を画面間で突き合わせ、揃っていない機能を洗い出す。',
		reviewer: 'owner',
		steps: [
			'公開ナビを表示する全画面を開く。',
			'同じ機能（ナビ項目・パンくず・ページの主題）が画面を越えて同じ名称で示されているかを比較する。',
			'名称が異なる機能があれば、その機能名と画面を記録する。',
		],
	},
	{
		sc: '3.2.6',
		disposition: 'applicable-unverified',
		reason:
			'助け（問い合わせ）の入口がある。`/contact` への入口がホームの Contact 節と公開ナビにあり、その位置が画面によって異なる可能性がある。相対順序が揃っているかは未判定。',
		evidence:
			'各公開画面に助けの入口があるか、ある場合その位置（何番目のリンクか・何の直後か）を記録して比較する。',
		reviewer: 'owner',
		steps: [
			'公開画面（`/`・`/about`・`/contact`・`/portfolio`・`/tools`・`/design-system`・`/keyboard`・`/projects/dotfiles`）を開き、助けの入口（`/contact` へのリンク）があるかを記録する。',
			'入口がある画面について、その位置（何番目のリンクか・何の直後か）を記録する。',
			'位置が画面間で揃っているかを確認する。',
			'揃っていない画面があれば、その画面と位置を記録する。',
		],
	},
	{
		sc: '3.3.3',
		disposition: 'applicable-unverified',
		reason:
			'入力の拒否メッセージを持つフォームがある。`/admin/invitations_/accept` は `FAILURE_COPY`（`src/admin/invitations/accept-view.tsx`）で修正の提案を含む文言を持つが、`/admin/login` は Better Auth の 401 を受けて独自のパスワードエラーを描かない。すべての拒否に提案が揃っているかは未判定。',
		evidence:
			'各拒否状態のメッセージが修正の提案を含むかを確認し、提案が欠けている拒否を洗い出す。',
		reviewer: 'owner',
		steps: [
			'`/admin/invitations_/accept` を開き、無効なトークン・期限切れ・使用済み・メールアドレス重複・パスワード不足の各状態を再現する（`FAILURE_COPY` の各文言）。',
			'各メッセージが修正の提案を含むか（例: 「管理者から再発行を受けてください」「8 文字以上」）を記録する。',
			'`/admin/login` で誤ったパスワードを投入し、画面のフィードバックを記録する（`src/routes/admin.login.tsx` は Better Auth の 401 を受けて独自のエラーを描かない）。',
			'提案が欠けている拒否があれば、判定と該当文言を記録する。',
		],
	},
	{
		sc: '3.3.4',
		disposition: 'applicable-unverified',
		reason:
			'データを送信する入力がある。管理画面の招待作成・API キー発行・画像登録はデータを変更するが、送信前の確認・送信後の取り消し・入力値の確認のいずれかが SC 3.3.4 の例外に当たるかは未判定。',
		evidence:
			'各送信が SC 3.3.4 の対象（法的・財務・利用者制御可能データ）に当たるかを確認し、3 つの例外のいずれかで満たされるかを判断する。',
		reviewer: 'owner',
		steps: [
			'管理画面のデータ送信面（`/admin/invitations` の招待作成、`/admin/keys` の API キー発行、`/admin/images` の画像登録）を開く。',
			'各送信が SC 3.3.4 の対象に当たるか（法的・財務・利用者制御可能データの変更か）を判断する。',
			'変更前の確認・変更後の取り消し（招待の revoke、キーと画像の削除）が用意されているかを画面上で確認する。',
			'3 つの例外のいずれかで満たされるかを判断し、判定と根拠を記録する。',
		],
	},
	{
		sc: '3.3.8',
		disposition: 'applicable-unverified',
		reason:
			'認証の画面を公開している。`/admin/login` はメールアドレスとパスワードの認証で、記憶テストや謎解きは無いが、貼り付け可否とパスワードマネージャ対応は未判定。',
		evidence: '貼り付け可否・パスワードマネージャの挿入可否・認知機能テストの有無を人が確認する。',
		reviewer: 'owner',
		steps: [
			'`/admin/login` を開く。',
			'パスワード欄とメールアドレス欄をそれぞれクリックして貼り付け（Cmd / Ctrl + V）し、貼り付けが拒否されないことを確認する。',
			'パスワードマネージャが値を挿入できるかを確認する（`autoComplete="username"` / `current-password`）。',
			'記憶テスト・謎解きのような認知機能テストが要求されていないことを確認する。',
			'3 点が満たされているかを判断し、判定と根拠を記録する。',
		],
	},
].map((decision) => ({
	sc: decision.sc,
	level: WCAG_22_A_AA_UNIVERSE[decision.sc].level,
	name: WCAG_22_A_AA_UNIVERSE[decision.sc].name,
	disposition: decision.disposition,
	reason: decision.reason,
	evidence: decision.evidence,
	...(decision.reviewer ? { reviewer: decision.reviewer } : {}),
	...(decision.steps ? { steps: decision.steps } : {}),
	...(decision.verifiedBy ? { verifiedBy: decision.verifiedBy } : {}),
	...(decision.verifiedAt ? { verifiedAt: decision.verifiedAt } : {}),
}));

/**
 * The documentation that mirrors {@link SCOPE_DECISIONS}.
 *
 * The gate reads the table out of this file and compares it with the
 * constant, so the two can never drift apart silently.
 */
export const SCOPE_DECISION_DOC = 'docs/verification/a11y/wcag-review-matrix.md';

/**
 * Where the scope decisions live.
 *
 * The decisions are the GATE's source of truth (Issue #722): the
 * documentation is their mirror, and the ledger (`quality/…json`) does
 * not hold a second copy.
 */
export const SCOPE_DECISION_SOURCE = 'scripts/check-a11y-wcag-review-matrix.mjs';

/**
 * Compare the criterion universe with the two lists that partition it.
 *
 * The table's vocabulary ({@link WCAG_22_CRITERIA}) and the scope
 * decisions ({@link SCOPE_DECISIONS}) have to cover the official
 * Level A/AA list ({@link WCAG_22_A_AA_UNIVERSE}) **exactly**:
 *
 *   - a criterion of the official list that neither list decides is
 *     undecided — the record would silently skip it;
 *   - a criterion in one of the two lists that is not in the official
 *     list is a typo, a Level AAA criterion, or a criterion WCAG 2.2
 *     removed — it must not be part of an A/AA claim;
 *   - a criterion in both lists is decided twice.
 *
 * Both directions are checked: a missing criterion and an invented one
 * are the same defect (the universe is not covered).
 */
export function compareCriterionUniverse() {
	return compareCriterionSets({
		universe: WCAG_22_A_AA_UNIVERSE,
		table: WCAG_22_CRITERIA,
		scope: SCOPE_DECISIONS.map((decision) => ({
			sc: decision.sc,
			level: decision.level,
			name: decision.name,
		})),
	});
}

/**
 * Compare three criterion lists with each other.
 *
 * The lists are given as data so that the comparison can be exercised
 * with a list that has a hole in it.
 */
export function compareCriterionSets({ universe, table, scope }) {
	const problems = [];
	const tableSc = Object.keys(table);
	const scopeSc = scope.map((decision) => decision.sc);
	const universeSc = Object.keys(universe);

	for (const sc of universeSc) {
		if (!tableSc.includes(sc) && !scopeSc.includes(sc)) {
			problems.push(
				`SC ${sc} (${universe[sc].level}) is a WCAG 2.2 A/AA criterion, but neither the table's vocabulary nor the scope decisions decide it`,
			);
		}
	}
	const describe = (sc) => {
		if (WCAG_22_OBSOLETE_CRITERIA[sc]) {
			return `SC ${sc} is obsolete in WCAG 2.2 (${WCAG_22_OBSOLETE_CRITERIA[sc].note}), so it is not part of an A/AA claim`;
		}
		return `SC ${sc} is not a WCAG 2.2 Level A/AA criterion`;
	};
	for (const sc of tableSc) {
		if (!universe[sc]) problems.push(describe(sc));
	}
	for (const sc of scopeSc) {
		if (!universe[sc]) problems.push(describe(sc));
	}
	for (const sc of tableSc) {
		if (scopeSc.includes(sc)) {
			problems.push(`SC ${sc} is both a criterion of the table's vocabulary and a scope decision`);
		}
	}
	for (const sc of tableSc) {
		const source = universe[sc];
		if (!source) continue;
		if (table[sc].level !== source.level || table[sc].name !== source.name) {
			problems.push(
				`SC ${sc} is described as "${table[sc].name}" (${table[sc].level}), not "${source.name}" (${source.level})`,
			);
		}
	}
	for (const decision of scope) {
		const source = universe[decision.sc];
		if (!source) continue;
		if (decision.level !== source.level || decision.name !== source.name) {
			problems.push(
				`SC ${decision.sc} is described as "${decision.name}" (${decision.level}), not "${source.name}" (${source.level})`,
			);
		}
	}
	return problems;
}

/**
 * Audit the criterion universe.
 *
 * The universe is a property of the gate's own constants, not of the
 * matrix, so it is checked once per run and reported whatever the
 * matrix says.
 */
export function auditCriterionUniverse() {
	return compareCriterionUniverse().map((message) => ({
		rule: 'criterion-universe-mismatch',
		file: 'scripts/check-a11y-wcag-review-matrix.mjs',
		message,
	}));
}

/**
 * The state vocabulary.
 *
 * `default` is the surface in its shipped condition. `markup` states are
 * rendered by the surface itself, so the surface declares a marker that
 * has to be found in its source. `interaction` states are applied by the
 * reviewer (a zoom, a keyboard walk, a focus ring, a screen reader), so
 * they need no marker — they are an operation on any surface.
 */
export const REVIEW_STATES = [
	{ id: 'normal', kind: 'default', description: 'the surface in its shipped condition' },
	{ id: 'empty', kind: 'markup', description: 'the surface with nothing in it yet' },
	{ id: 'error', kind: 'markup', description: 'the surface in its failure state' },
	{ id: 'narrow', kind: 'markup', description: 'the surface at 320 CSS px' },
	{
		id: 'zoomed',
		kind: 'interaction',
		description: 'the surface at 200 % text zoom',
	},
	{
		id: 'text-spacing',
		kind: 'interaction',
		description: 'the surface with the SC 1.4.12 text spacing override applied',
	},
	{
		id: 'keyboard-only',
		kind: 'interaction',
		description: 'the surface operated with the keyboard alone',
	},
	{
		id: 'focus-visible',
		kind: 'interaction',
		description: 'the surface with a control holding the focus ring',
	},
	{
		id: 'screen-reader',
		kind: 'interaction',
		description: 'the surface read out by a screen reader',
	},
];

/** Who decides a criterion. Both values are mandatory, neither is a default. */
export const REVIEW_METHODS = ['machine', 'human'];

/**
 * The recorded state of a review, and what each state requires.
 *
 * `auto-pass` and `human-verified` are different states with different
 * requirements on purpose: the machine half never carries a reviewer,
 * a date or an environment, because nobody looked at it, and the human
 * half never carries an npm script, because a script did not look at it.
 */
export const REVIEW_RECORD_STATES = {
	'auto-pass': {
		method: 'machine',
		requires: [],
		forbids: ['assignedTo', 'reviewer', 'performedAt', 'environment', 'result'],
		result: null,
	},
	'human-verified': {
		method: 'human',
		requires: ['assignedTo', 'reviewer', 'performedAt', 'environment', 'result'],
		forbids: [],
		result: 'pass',
	},
	'human-failed': {
		method: 'human',
		requires: ['assignedTo', 'reviewer', 'performedAt', 'environment', 'result'],
		forbids: [],
		result: 'fail',
	},
	'not-reviewed': {
		method: 'human',
		requires: ['assignedTo'],
		forbids: ['reviewer', 'performedAt', 'environment', 'result'],
		result: null,
	},
};

/**
 * The patterns that turn a document into a conformance claim.
 *
 * A claim is a **combination**, not a fixed sentence: the level (AA),
 * the standard (WCAG 2.2) and the assertion (conforms to / 適合する)
 * may appear in any order and in any wording. A list of finished
 * phrases would miss every phrasing it did not anticipate — "WCAG 2.2
 * AA に適合しています" and "conforms to WCAG 2.2 AA" say the same thing
 * as "AA 適合済み" — so the gate matches the combination instead.
 *
 * Every pattern is matched per line; the qualifier rule
 * ({@link claimIsQualified}) decides whether a match is a claim or a
 * mention of the claim.
 */
export const CLAIM_PATTERNS = [
	{
		id: 'ja-level',
		// "AA 準拠", "AA に適合", "AA 適合済み" — the level and the
		// assertion next to each other.
		pattern: /AA\s*(?:に\s*)?(?:準拠|適合)(?!性|度|基準|判定|状況|範囲)/g,
	},
	{
		id: 'en-level',
		// "AA compliant", "WCAG 2.2 AA compliant".
		pattern: /\bAA[\s-]+compliant\b/gi,
	},
	{
		id: 'en-standard',
		// "conforms to WCAG 2.2 AA", "conforms to the WCAG 2.2".
		pattern: /\bconforms?\s+to\s+(?:the\s+)?WCAG\s*2\.\d(?:\s*AA)?/gi,
	},
	{
		id: 'en-meets',
		// "meets WCAG 2.2 AA", "satisfies the WCAG".
		pattern: /\b(?:meets|satisfies)\s+(?:the\s+)?WCAG\b/gi,
	},
	{
		id: 'en-noun',
		// "WCAG 2.2 AA conformance" as a noun phrase.
		pattern: /\bWCAG\s*2\.\d(?:\s*AA)?\s+conformance\b/gi,
	},
	{
		id: 'ja-standard',
		// "WCAG 2.2 AA に適合しています", "WCAG 2.2 に準拠する".
		pattern: /WCAG\s*2\.\d[^\n]{0,16}?(?:に\s*)?(?:準拠|適合)(?!性|度|基準|判定|状況|範囲)/g,
	},
];

/**
 * A qualifier next to the claim turns it into a mention.
 *
 * A qualifier that stands somewhere else does NOT: "根拠がないが、
 * このサイトは WCAG 2.2 AA 適合済みです" is a claim, and the negation
 * belongs to a different clause. The proximity rule is in
 * {@link claimIsQualified}.
 */
export const CLAIM_QUALIFIERS = [
	'ない',
	'ません',
	'しない',
	'とは',
	'主張',
	'根拠',
	'禁止',
	'使わない',
	'書かない',
	'できません',
	'ではない',
	'ありません',
	'避免',
];

/**
 * The English negation words that turn a claim into a mention.
 *
 * English puts the negation in front of the verb ("does **not** mean
 * the site conforms to WCAG 2.2 AA"), so the word window in
 * {@link QUALIFIER_LEAD_WORDS} is used instead of the Japanese
 * character window.
 */
export const CLAIM_NEGATIONS = ['not', 'never', 'no', 'cannot', "n't"];

/** The characters that end a sentence. */
const SENTENCE_TERMINATORS = '。！？!?';

/** The characters that separate one clause from the next. */
const CLAUSE_SEPARATORS = '、，,；;：:';

/**
 * How far a qualifier may stand IN FRONT of the claim phrase and still
 * frame it. A qualifier further away, or separated from the phrase by
 * a clause separator, belongs to another clause and does not.
 */
export const QUALIFIER_LEAD_WINDOW = 10;

/**
 * How many English words may stand between the negation and the claim
 * for the negation to frame it.
 */
export const QUALIFIER_LEAD_WORDS = 6;

/**
 * The documents a conformance claim may cite.
 *
 * A claim is only backed when it points at the **record**: the matrix
 * itself or its write-up. A line that names something else
 * ("wcag-review-matrix-old.md") points at nothing that exists.
 */
export const MATRIX_CITATIONS = [MATRIX_PATH, 'docs/verification/a11y/wcag-review-matrix.md'];

/**
 * Where a site-level conformance claim may be written.
 *
 * The documentation is where such a claim is made; a source comment
 * about one token pair is a different kind of statement and is not
 * scanned.
 */
export const CLAIM_SURFACE_ROOTS = ['README.md', 'docs'];

/** The rules this gate can report. */
export const RULES = [
	'item-field-missing',
	'item-duplicate-id',
	'item-sc-unknown',
	'item-state-unknown',
	'item-method-invalid',
	'item-review-state-invalid',
	'item-evidence-missing',
	'item-evidence-stale',
	'item-auto-gate-missing',
	'surface-missing',
	'surface-state-missing',
	'state-undisposed',
	'state-uncovered',
	'criterion-undisposed',
	'criterion-exclusion-reason-missing',
	'criterion-conflict',
	'criterion-universe-mismatch',
	'compliance-claim-unbacked',
	'scope-decision-doc-mismatch',
	'scope-disposition-invalid',
	'scope-exclusion-not-a-product-fact',
	'scope-unverified-missing-review-plan',
	'scope-verified-without-review-record',
	'release-assessment-unbacked',
	'fixture-expectation-mismatch',
	'fixture-contract-missing',
];

/* ------------------------------------------------------------------ *
 * small pure helpers
 * ------------------------------------------------------------------ */

/** A non-empty trimmed string, or `null`. */
function filledString(value) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** An ISO date (`YYYY-MM-DD`) that names a real day, or `null`. */
export function isIsoDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return false;
	// `Date` silently rolls 2026-10-32 over to November, so the round trip
	// is what tells a real day from a well-shaped number.
	return parsed.toISOString().slice(0, 10) === value;
}

/** Whole days between two ISO dates (`to - from`). */
export function daysBetween(fromIso, toIso) {
	const from = Date.parse(`${fromIso}T00:00:00Z`);
	const to = Date.parse(`${toIso}T00:00:00Z`);
	if (Number.isNaN(from) || Number.isNaN(to)) return null;
	return Math.round((to - from) / 86_400_000);
}

/** The UTC date of "now", as `YYYY-MM-DD`. */
export function todayIso(now = new Date()) {
	return now.toISOString().slice(0, 10);
}

/** Read and parse a JSON file. Throws when it cannot be read. */
export function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/* ------------------------------------------------------------------ *
 * the matrix shape
 * ------------------------------------------------------------------ */

/**
 * The problems that make the matrix impossible to judge.
 *
 * A shape problem is not a violation: the gate cannot decide, so it
 * exits 2 rather than pretending the table is fine.
 */
export function validateShape(matrix) {
	const problems = [];
	if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
		return ['the matrix is not a JSON object'];
	}
	if (matrix.version !== 1) {
		problems.push(`version must be 1 (found ${JSON.stringify(matrix.version)})`);
	}
	if (!Array.isArray(matrix.items)) {
		problems.push('items must be an array');
	}
	if (!Array.isArray(matrix.surfaces)) {
		problems.push('surfaces must be an array');
	}
	if (!Array.isArray(matrix.states)) {
		problems.push('states must be an array');
	}
	if (!Array.isArray(matrix.excluded)) {
		problems.push('excluded must be an array');
	}
	if (
		typeof matrix.reviewWindowDays !== 'number' ||
		!Number.isInteger(matrix.reviewWindowDays) ||
		matrix.reviewWindowDays <= 0
	) {
		problems.push('reviewWindowDays must be a positive integer');
	}
	return problems;
}

/* ------------------------------------------------------------------ *
 * the audit
 * ------------------------------------------------------------------ */

/**
 * Audit one matrix.
 *
 * Returns the violations plus the summary the report prints. Every
 * function it calls is pure, so the fixtures can be audited the same
 * way the repository's own matrix is.
 */
export function auditMatrix(
	matrix,
	{ today, repoRoot = REPO_ROOT, packageScripts = null, claimSurfaces = null } = {},
) {
	const violations = [];
	const scripts = packageScripts ?? readPackageScripts(repoRoot);
	const add = (rule, file, message) => {
		violations.push({ rule, file, message });
	};

	const surfaces = new Map();
	for (const surface of Array.isArray(matrix.surfaces) ? matrix.surfaces : []) {
		if (surface && typeof surface.id === 'string') surfaces.set(surface.id, surface);
	}

	/* --- the surfaces --------------------------------------------- */
	// Every surface is checked BEFORE any state is looked at: a review
	// of a surface that is gone — a deleted route, a renamed story —
	// proves nothing, so the file and the story export have to exist
	// whatever state the review is about.
	for (const surface of surfaces.values()) {
		const problem = auditSurfaceTarget(surface, { repoRoot });
		if (problem) {
			add('surface-missing', MATRIX_PATH, problem);
		}
	}

	/* --- the state enumeration ------------------------------------ */
	const vocabulary = new Set(REVIEW_STATES.map((state) => state.id));
	const stateKinds = new Map(REVIEW_STATES.map((state) => [state.id, state.kind]));
	const enumerated = new Set();
	for (const entry of Array.isArray(matrix.states) ? matrix.states : []) {
		const id = entry && typeof entry.id === 'string' ? entry.id : null;
		if (!id) {
			add('state-undisposed', MATRIX_PATH, 'every state entry needs an id');
			continue;
		}
		if (!vocabulary.has(id)) {
			add(
				'item-state-unknown',
				MATRIX_PATH,
				`the state "${id}" is not one of the vocabulary (${[...vocabulary].join(', ')})`,
			);
			continue;
		}
		if (!filledString(entry.description)) {
			add('state-undisposed', MATRIX_PATH, `the state "${id}" needs a description`);
		}
		enumerated.add(id);
	}
	for (const state of REVIEW_STATES) {
		if (!enumerated.has(state.id)) {
			add(
				'state-undisposed',
				MATRIX_PATH,
				`the state "${state.id}" is not enumerated in the matrix; every state of the vocabulary must be enumerated here (the vocabulary is the gate's, so a state cannot be added by editing the table alone)`,
			);
		}
	}

	/* --- the items ------------------------------------------------ */
	const items = Array.isArray(matrix.items) ? matrix.items : [];
	const ids = new Set();
	const coveredCriteria = new Map();
	const usedStates = new Set();

	for (const item of items) {
		const label = item && typeof item.id === 'string' ? item.id : '(no id)';
		if (!item || typeof item !== 'object') {
			add('item-field-missing', MATRIX_PATH, 'every item must be an object');
			continue;
		}
		for (const field of ['id', 'subject', 'scope', 'surface', 'state', 'method']) {
			if (!filledString(item[field])) {
				add(
					'item-field-missing',
					MATRIX_PATH,
					`item ${label}: ${field} must be a non-empty string`,
				);
			}
		}
		if (filledString(item.id)) {
			if (ids.has(item.id)) {
				add('item-duplicate-id', MATRIX_PATH, `item ${label}: the id is used twice`);
			}
			ids.add(item.id);
		}

		/* the success criteria */
		if (!Array.isArray(item.sc) || item.sc.length === 0) {
			add(
				'item-field-missing',
				MATRIX_PATH,
				`item ${label}: sc must be a non-empty array of WCAG 2.2 A/AA criteria`,
			);
		} else {
			for (const sc of item.sc) {
				if (typeof sc !== 'string' || !WCAG_22_CRITERIA[sc]) {
					add(
						'item-sc-unknown',
						MATRIX_PATH,
						`item ${label}: "${sc}" is not a WCAG 2.2 A/AA criterion this matrix knows; an unknown criterion is never assumed to be covered`,
					);
					continue;
				}
				if (!coveredCriteria.has(sc)) coveredCriteria.set(sc, []);
				coveredCriteria.get(sc).push(label);
			}
		}

		/* the state */
		const state = filledString(item.state);
		if (state) {
			if (!vocabulary.has(state)) {
				add(
					'item-state-unknown',
					MATRIX_PATH,
					`item ${label}: the state "${state}" is not one of the vocabulary (${[...vocabulary].join(', ')})`,
				);
			} else {
				usedStates.add(state);
			}
		}

		/* the method */
		const method = filledString(item.method);
		if (method && !REVIEW_METHODS.includes(method)) {
			add(
				'item-method-invalid',
				MATRIX_PATH,
				`item ${label}: method must be one of ${REVIEW_METHODS.join(' / ')} (found ${JSON.stringify(item.method)})`,
			);
		}

		/* the machine half */
		const autoGates = item.autoGates ?? [];
		if (!Array.isArray(autoGates)) {
			add('item-field-missing', MATRIX_PATH, `item ${label}: autoGates must be an array`);
		} else {
			for (const script of autoGates) {
				if (!filledString(script)) {
					add(
						'item-field-missing',
						MATRIX_PATH,
						`item ${label}: every autoGates entry must be a non-empty string`,
					);
					continue;
				}
				if (scripts && !Object.hasOwn(scripts, script)) {
					add(
						'item-auto-gate-missing',
						MATRIX_PATH,
						`item ${label}: the npm script "${script}" does not exist in package.json, so the machine half of the record points at nothing`,
					);
				}
			}
		}

		/* the review record */
		const review = item.review;
		if (!review || typeof review !== 'object' || Array.isArray(review)) {
			add(
				'item-field-missing',
				MATRIX_PATH,
				`item ${label}: review must be an object with a state`,
			);
			continue;
		}
		const recordState = filledString(review.state);
		const record = recordState ? REVIEW_RECORD_STATES[recordState] : null;
		if (!record) {
			add(
				'item-review-state-invalid',
				MATRIX_PATH,
				`item ${label}: the review state must be one of ${Object.keys(REVIEW_RECORD_STATES).join(' / ')} (found ${JSON.stringify(review.state)})`,
			);
			continue;
		}
		if (method && method !== record.method) {
			add(
				'item-review-state-invalid',
				MATRIX_PATH,
				`item ${label}: the review state "${recordState}" belongs to a ${record.method} review, but the item says the method is "${method}"`,
			);
		}
		for (const field of record.requires) {
			if (!filledString(review[field])) {
				add(
					'item-evidence-missing',
					MATRIX_PATH,
					`item ${label}: a "${recordState}" review needs ${field}`,
				);
			}
		}
		for (const field of record.forbids) {
			if (review[field] !== undefined && review[field] !== null && review[field] !== '') {
				add(
					'item-review-state-invalid',
					MATRIX_PATH,
					`item ${label}: a "${recordState}" review must not carry ${field}; nobody looked at it, so there is no evidence to record`,
				);
			}
		}
		if (record.result && review.result !== record.result) {
			add(
				'item-evidence-missing',
				MATRIX_PATH,
				`item ${label}: a "${recordState}" review must record the result "${record.result}" (found ${JSON.stringify(review.result)})`,
			);
		}
		if (recordState === 'auto-pass' && method === 'machine' && autoGates.length === 0) {
			add(
				'item-review-state-invalid',
				MATRIX_PATH,
				`item ${label}: an "auto-pass" review must name the npm script that produced the pass`,
			);
		}

		/* the freshness of the evidence */
		const performedAt = filledString(review.performedAt);
		if (performedAt) {
			if (!isIsoDate(performedAt)) {
				add(
					'item-evidence-missing',
					MATRIX_PATH,
					`item ${label}: performedAt must be an ISO date (YYYY-MM-DD)`,
				);
			} else if (isIsoDate(today)) {
				const age = daysBetween(performedAt, today);
				if (age === null) {
					add(
						'item-evidence-missing',
						MATRIX_PATH,
						`item ${label}: performedAt (${performedAt}) cannot be compared with today (${today})`,
					);
				} else if (age < 0) {
					add(
						'item-evidence-stale',
						MATRIX_PATH,
						`item ${label}: performedAt (${performedAt}) is later than today (${today})`,
					);
				} else if (age > matrix.reviewWindowDays) {
					add(
						'item-evidence-stale',
						MATRIX_PATH,
						`item ${label}: the review is ${age} day(s) old, over the ${matrix.reviewWindowDays} day window; the review has to be made again`,
					);
				}
			}
		}

		/* the surface and the state it is reviewed in */
		const surfaceId = filledString(item.surface);
		if (surfaceId) {
			const surface = surfaces.get(surfaceId);
			if (!surface) {
				add(
					'surface-missing',
					MATRIX_PATH,
					`item ${label}: the surface "${surfaceId}" is not declared in surfaces`,
				);
			} else if (state) {
				const problem = auditSurfaceState(surface, state, { repoRoot });
				if (problem) {
					add('surface-state-missing', MATRIX_PATH, `item ${label}: ${problem}`);
				}
			}
		}
	}

	for (const state of enumerated) {
		if (!usedStates.has(state)) {
			add(
				'state-uncovered',
				MATRIX_PATH,
				`the state "${state}" is enumerated but no item reviews it`,
			);
		}
	}

	/* --- the excluded criteria ------------------------------------ */
	const excluded = new Map();
	for (const entry of Array.isArray(matrix.excluded) ? matrix.excluded : []) {
		const sc = entry && typeof entry.sc === 'string' ? entry.sc : null;
		if (!sc) {
			add('criterion-exclusion-reason-missing', MATRIX_PATH, 'every excluded entry needs an sc');
			continue;
		}
		if (!WCAG_22_CRITERIA[sc]) {
			add(
				'item-sc-unknown',
				MATRIX_PATH,
				`the excluded criterion "${sc}" is not a WCAG 2.2 A/AA criterion this matrix knows`,
			);
			continue;
		}
		if (!filledString(entry.reason)) {
			add(
				'criterion-exclusion-reason-missing',
				MATRIX_PATH,
				`the excluded criterion ${sc} needs a reason; an unexplained exclusion is an omission, not a decision`,
			);
			continue;
		}
		// The same rule the scope decisions obey: "this table has no
		// item for it" is an admission that nobody looked, not a fact
		// about the published product.
		if (looksLikeTableCoverageReason(entry.reason)) {
			add(
				'scope-exclusion-not-a-product-fact',
				MATRIX_PATH,
				`the excluded criterion ${sc} is excluded with a reason that reads like an admission that nobody looked ("${entry.reason}"); an exclusion needs a fact about the published product`,
			);
		}
		if (coveredCriteria.has(sc)) {
			add(
				'criterion-conflict',
				MATRIX_PATH,
				`the criterion ${sc} is both excluded and covered by ${coveredCriteria.get(sc).join(', ')}`,
			);
		}
		excluded.set(sc, entry.reason);
	}

	/* every criterion is either covered or excluded with a reason */
	for (const sc of Object.keys(WCAG_22_CRITERIA)) {
		if (!coveredCriteria.has(sc) && !excluded.has(sc)) {
			add(
				'criterion-undisposed',
				MATRIX_PATH,
				`the criterion ${sc} (${WCAG_22_CRITERIA[sc].level}) is neither covered by an item nor excluded with a reason`,
			);
		}
	}

	/* --- the conformance claim ------------------------------------ */
	const humanItems = items.filter((item) => item?.review?.state !== 'auto-pass');
	const humanVerified = humanItems.filter((item) => item?.review?.state === 'human-verified');
	const humanFailed = humanItems.filter((item) => item?.review?.state === 'human-failed');
	const outstanding = humanItems.filter((item) => item?.review?.state === 'not-reviewed');
	// The repository's own documentation is always scanned. A matrix may
	// ADD claims (the fixtures do, so the rule can be exercised without a
	// document in the tree), but it can never switch the scan off.
	const claims = [
		...(claimSurfaces ?? scanClaimSurfaces({ repoRoot })),
		...(Array.isArray(matrix.$claims)
			? matrix.$claims.map((claim) => ({
					...claim,
					// The citation is recomputed: a claim may not declare
					// that it points at the record — the line itself has to
					// name the record, and the record has to exist.
					citesMatrix: citesCanonicalMatrix(String(claim?.text ?? ''), { repoRoot }),
				}))
			: []),
		...(Array.isArray(matrix.$documents)
			? matrix.$documents.flatMap((document) =>
					findClaims(document?.text ?? '', { file: document?.file ?? null, repoRoot }),
				)
			: []),
	];
	for (const claim of claims) {
		// A site-level Level AA claim needs EVERY manual item of the
		// matrix to be verified: one verified item while the rest is
		// outstanding or failed proves nothing about the site. The claim
		// also has to cite the record itself.
		const missing = [];
		if (humanVerified.length === 0) missing.push('no human verification exists');
		if (outstanding.length > 0) {
			missing.push(`${outstanding.length} manual item(s) are still outstanding`);
		}
		if (humanFailed.length > 0) {
			missing.push(`${humanFailed.length} manual item(s) failed the review`);
		}
		if (!claim.citesMatrix) missing.push('the claim does not point at the review matrix');
		if (missing.length > 0) {
			add(
				'compliance-claim-unbacked',
				claim.file,
				`${claim.phrase} is claimed on line ${claim.line}, but ${missing.join('; ')}`,
			);
		}
	}

	/* --- the release assessment ------------------------------------ */
	// The ledger may state what the release assessment is. It may not
	// state that the AA audit is COMPLETE while the record says
	// otherwise: an overclaim in the ledger is the same defect as an
	// overclaim in a document.
	const assessment = matrix.releaseAssessment;
	if (assessment && typeof assessment === 'object' && !Array.isArray(assessment)) {
		if (assessment.aaAuditComplete === true) {
			const missing = [];
			if (humanVerified.length === 0) missing.push('no human verification exists');
			if (outstanding.length > 0) {
				missing.push(`${outstanding.length} manual item(s) are still outstanding`);
			}
			if (humanFailed.length > 0) {
				missing.push(`${humanFailed.length} manual item(s) failed the review`);
			}
			const unverified = SCOPE_DECISIONS.filter(
				(decision) => decision.disposition === 'applicable-unverified',
			);
			if (unverified.length > 0) {
				missing.push(`${unverified.length} criterion/criteria are applicable but unverified`);
			}
			if (missing.length > 0) {
				add(
					'release-assessment-unbacked',
					MATRIX_PATH,
					`the release assessment claims the WCAG 2.2 AA audit is complete, but ${missing.join('; ')}`,
				);
			}
		}
	}

	return {
		violations,
		items,
		surfaces: [...surfaces.values()],
		states: [...enumerated],
		excluded: [...excluded.entries()].map(([sc, reason]) => ({ sc, reason })),
		coveredCriteria: [...coveredCriteria.entries()].map(([sc, ids]) => ({ sc, items: ids })),
		claims,
		humanVerified: humanVerified.length,
		outstanding: outstanding.length,
		machineChecked: items.filter((item) => item?.review?.state === 'auto-pass').length,
	};
}

/**
 * Audit the target of one surface.
 *
 * A surface points at a file (a route, a story) and — for a story — at
 * the export that renders it. Both have to exist: a review of a
 * surface that is gone proves nothing, and the state markers of a
 * deleted surface cannot be found either.
 */
export function auditSurfaceTarget(surface, { repoRoot = REPO_ROOT } = {}) {
	const path = filledString(surface?.path);
	if (!path) {
		return `the surface "${surface?.id ?? '(no id)'}" does not name a file to review`;
	}
	const absolute = resolve(repoRoot, path);
	if (!existsSync(absolute)) {
		return `the surface "${surface.id}" points at ${path}, which does not exist`;
	}
	const exported = filledString(surface?.export);
	if (!exported) return null;
	const source = readFileSync(absolute, 'utf8');
	if (!new RegExp(`export\\s+const\\s+${exported}\\b`).test(source)) {
		return `the surface "${surface.id}" no longer exports "${exported}", so the surface it reviews is gone`;
	}
	return null;
}

/**
 * Audit one (surface, state) pair.
 *
 * `default` states are always available; `interaction` states are an
 * operation the reviewer applies to any surface; `markup` states have
 * to be declared by the surface, with a marker that is still in the
 * source.
 */
export function auditSurfaceState(surface, state, { repoRoot = REPO_ROOT } = {}) {
	const kind = stateKindsOf(state);
	if (kind === 'default' || kind === 'interaction') return null;

	const reproduces = surface.reproduces ?? {};
	const markers = reproduces[state];
	if (!Array.isArray(markers) || markers.length === 0) {
		return `the surface "${surface.id}" does not declare the state "${state}"`;
	}

	const path = resolve(repoRoot, surface.path ?? '');
	if (!existsSync(path)) {
		return `the surface "${surface.id}" points at ${surface.path}, which does not exist`;
	}
	const source = readFileSync(path, 'utf8');
	for (const marker of markers) {
		if (typeof marker !== 'string' || marker.length === 0) {
			return `the surface "${surface.id}" declares an empty marker for the state "${state}"`;
		}
		if (marker.startsWith('export:')) {
			const name = marker.slice('export:'.length);
			if (!new RegExp(`export\\s+const\\s+${name}\\b`).test(source)) {
				return `the surface "${surface.id}" no longer exports "${name}", so it no longer reproduces the state "${state}"`;
			}
			continue;
		}
		if (!source.includes(marker)) {
			return `the surface "${surface.id}" no longer contains "${marker}", so it no longer reproduces the state "${state}"`;
		}
	}
	return null;
}

/** The kind of a state in the vocabulary. */
function stateKindsOf(state) {
	return REVIEW_STATES.find((entry) => entry.id === state)?.kind ?? null;
}

/* ------------------------------------------------------------------ *
 * the claim surfaces
 * ------------------------------------------------------------------ */

/** Every markdown file the claim scan reads. */
export function collectClaimSurfaceFiles({ repoRoot = REPO_ROOT } = {}) {
	const files = [];
	for (const root of CLAIM_SURFACE_ROOTS) {
		const absolute = resolve(repoRoot, root);
		if (!existsSync(absolute)) continue;
		if (statSync(absolute).isFile()) {
			files.push(root);
			continue;
		}
		for (const file of walkMarkdown(absolute, repoRoot)) files.push(file);
	}
	return files.sort();
}

/** Every `.md` file under a directory, as repo-relative paths. */
function walkMarkdown(directory, repoRoot) {
	const found = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(...walkMarkdown(absolute, repoRoot));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith('.md')) {
			found.push(relative(repoRoot, absolute));
		}
	}
	return found;
}

/**
 * Find the conformance claims in the documentation.
 *
 * A claim is a match of one of the {@link CLAIM_PATTERNS} that no
 * qualifier frames. A match a qualifier stands next to is a mention of
 * the claim, not a claim — that is what lets this repository document
 * the patterns without tripping over them.
 *
 * The context of a match is its **paragraph**, not its line: an
 * English sentence wraps across lines, so the negation of "It does
 * not mean the site conforms to WCAG 2.2 AA" stands on the line above
 * the claim.
 */
export function findClaims(text, { file = null, repoRoot = REPO_ROOT } = {}) {
	const claims = [];
	const lines = String(text).split('\n');
	for (const [from, to] of paragraphRanges(lines)) {
		const paragraph = lines.slice(from, to).join('\n');
		let offset = 0;
		for (let index = from; index < to; index += 1) {
			const line = lines[index];
			for (const match of findClaimMatches(line)) {
				const at = offset + match.at;
				if (!claimIsQualified(paragraph, at, match.phrase)) {
					claims.push({
						file,
						line: index + 1,
						phrase: match.phrase,
						text: line.trim(),
						citesMatrix: citesCanonicalMatrix(paragraph, { repoRoot }),
					});
				}
			}
			offset += line.length + 1;
		}
	}
	return claims;
}

/**
 * Every claim pattern match in one line.
 *
 * A match that is contained in a longer match of the same line is
 * dropped: "WCAG 2.2 AA に適合" is one claim, not two.
 */
export function findClaimMatches(line) {
	const matches = [];
	for (const { id, pattern } of CLAIM_PATTERNS) {
		const scanner = new RegExp(pattern.source, pattern.flags);
		let match = scanner.exec(line);
		while (match !== null) {
			matches.push({ id, at: match.index, phrase: match[0] });
			match = scanner.exec(line);
		}
	}
	matches.sort((left, right) => left.at - right.at || right.phrase.length - left.phrase.length);
	const kept = [];
	for (const match of matches) {
		const covered = kept.some(
			(other) =>
				match.at >= other.at && match.at + match.phrase.length <= other.at + other.phrase.length,
		);
		if (!covered) kept.push(match);
	}
	return kept;
}

/**
 * Does the claim cite the record it claims to be based on?
 *
 * The citation has to name the matrix itself
 * ({@link MATRIX_CITATIONS}) and that file has to exist: a line that
 * points at "wcag-review-matrix-old.md" points at nothing, so it is
 * not a citation.
 */
export function citesCanonicalMatrix(text, { repoRoot = REPO_ROOT } = {}) {
	for (const target of MATRIX_CITATIONS) {
		const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = new RegExp(`${escaped}(?![\\w.-])`);
		if (!pattern.test(text)) continue;
		if (!existsSync(resolve(repoRoot, target))) continue;
		return true;
	}
	return false;
}

/**
 * Does a qualifier frame the claim phrase at `at`?
 *
 * The qualifier has to be **attached** to the phrase:
 *
 *   - behind it, inside the same sentence — "AA 適合済みの記録がある"
 *     is a mention of the phrase, "AA 適合を主張しない" mentions it too;
 *   - or in front of it, close enough ({@link QUALIFIER_LEAD_WINDOW}
 *     characters for Japanese, {@link QUALIFIER_LEAD_WORDS} words for
 *     English) and without a clause separator in between — "禁止: AA
 *     適合" mentions it.
 *
 * A qualifier somewhere else does not frame the phrase: "根拠がない
 * が、このサイトは WCAG 2.2 AA 適合済みです" is a claim, because the
 * negation belongs to a different clause.
 */
export function claimIsQualified(context, at, phrase) {
	const end = at + phrase.length;
	const behind = context.slice(end, sentenceEndOf(context, end));
	if (CLAIM_QUALIFIERS.some((qualifier) => behind.includes(qualifier))) return true;
	if (CLAIM_NEGATIONS.some((negation) => hasWordBehind(behind, negation))) return true;
	const ahead = context.slice(sentenceStartOf(context, at), at);
	for (const qualifier of CLAIM_QUALIFIERS) {
		let index = ahead.lastIndexOf(qualifier);
		while (index !== -1) {
			const gap = ahead.slice(index + qualifier.length);
			if (gap.length <= QUALIFIER_LEAD_WINDOW && !hasClauseSeparator(gap)) return true;
			// `lastIndexOf` clamps a negative position to 0, so searching from
			// `index - 1` would return `index` again and never terminate.
			index = index === 0 ? -1 : ahead.lastIndexOf(qualifier, index - 1);
		}
	}
	return hasNegationInFront(ahead);
}

/**
 * Is an English negation word in front of the claim, close enough and
 * in the same clause?
 */
function hasNegationInFront(ahead) {
	const words = ahead.split(/\s+/).filter((word) => word.length > 0);
	for (let index = words.length - 1; index >= 0; index -= 1) {
		const word = words[index].toLowerCase().replace(/[^a-z']/g, '');
		if (!CLAIM_NEGATIONS.includes(word)) continue;
		const gap = words.slice(index + 1).join(' ');
		const between = gap.split(/\s+/).filter((entry) => entry.length > 0).length;
		if (between > QUALIFIER_LEAD_WORDS) return false;
		return !hasClauseSeparator(gap);
	}
	return false;
}

/** Is an English negation word anywhere in the text behind the claim? */
function hasWordBehind(text, word) {
	const pattern = new RegExp(`(^|[^A-Za-z'])${word}([^A-Za-z']|$)`, 'i');
	return pattern.test(text);
}

/**
 * The line ranges of the paragraphs of a text.
 *
 * A paragraph is a run of non-empty lines; a blank line ends it.
 */
function paragraphRanges(lines) {
	const ranges = [];
	let start = 0;
	for (let index = 0; index <= lines.length; index += 1) {
		const atEnd = index === lines.length;
		if (!atEnd && lines[index].trim() !== '') continue;
		if (index > start) ranges.push([start, index]);
		start = index + 1;
	}
	return ranges;
}

/** The index just after the last sentence terminator before `index`. */
function sentenceStartOf(text, index) {
	for (let at = index - 1; at >= 0; at -= 1) {
		if (isSentenceEnd(text, at)) return at + 1;
	}
	return 0;
}

/** The index of the next sentence terminator after `index`, or the text length. */
function sentenceEndOf(text, index) {
	for (let at = index; at < text.length; at += 1) {
		if (isSentenceEnd(text, at)) return at;
	}
	return text.length;
}

/**
 * Does the character at `index` end a sentence?
 *
 * An ASCII period ends a sentence when a space follows it; the period
 * inside a version number ("WCAG 2.2") does not.
 */
function isSentenceEnd(text, index) {
	const character = text[index];
	if (SENTENCE_TERMINATORS.includes(character)) return true;
	if (character !== '.') return false;
	const next = text[index + 1];
	return next === undefined || /\s/.test(next);
}

/** Does the text carry a character that separates one clause from the next? */
function hasClauseSeparator(text) {
	for (const character of text) {
		if (CLAUSE_SEPARATORS.includes(character)) return true;
	}
	return false;
}

/** Read every claim surface and collect the claims. */
export function scanClaimSurfaces({ repoRoot = REPO_ROOT } = {}) {
	const claims = [];
	for (const file of collectClaimSurfaceFiles({ repoRoot })) {
		const text = readFileSync(resolve(repoRoot, file), 'utf8');
		claims.push(...findClaims(text, { file }));
	}
	return claims;
}

/* ------------------------------------------------------------------ *
 * the fixtures
 * ------------------------------------------------------------------ */

/** The fixture files of one directory, sorted by name. */
export function collectFixtureFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name) => join(directory, name));
}

/**
 * Compare the rules a fixture produced with the rules it declares.
 *
 * A `fail` fixture must declare **exactly** the rules it produces: a
 * rule that is missing from `$expects` and a rule that is produced but
 * not declared are both a mismatch, so a fixture can never quietly
 * verify less than it does.
 */
export function compareFixtureExpectations(expectation, expects, produced) {
	const problems = [];
	const expected = new Set(expects);
	const actual = new Set(produced);
	if (expectation === 'pass') {
		if (actual.size > 0) {
			problems.push(
				`the pass fixture reports ${actual.size} violation(s): ${[...actual].join(', ')}`,
			);
		}
		return problems;
	}
	for (const rule of expected) {
		if (!actual.has(rule)) {
			problems.push(`the fail fixture expects "${rule}" and the audit did not report it`);
		}
	}
	for (const rule of actual) {
		if (!expected.has(rule)) {
			problems.push(
				`the fail fixture produces "${rule}" but does not declare it in $expects (${
					[...expected].join(', ') || 'nothing'
				})`,
			);
		}
	}
	if (expected.size === 0) {
		problems.push('a fail fixture must declare the rules it expects ($expects)');
	}
	return problems;
}

/**
 * The date a fixture is judged on.
 *
 * A fixture has to give the same verdict today and in a year, so the
 * freshness of its evidence is measured against a FIXED date instead
 * of the day the gate happens to run. The run date decides whether
 * the repository's own matrix is fresh — it must not decide whether a
 * fixture still passes.
 */
export const FIXTURE_REFERENCE_DATE = '2026-10-23';

/**
 * Audit every fixture of the repository.
 *
 * A `pass` fixture must produce no violation at all; a `fail` fixture
 * must produce **exactly** the rules it declares (`$expects`) — a rule
 * the fixture produces but does not declare is a mismatch as well, so
 * a fixture cannot quietly verify less than it does. The set of fixture
 * files is exact, so a fixture that quietly lost a file cannot "verify"
 * less than it claims.
 *
 * A fixture is judged **on its own**: the repository's documentation is
 * not scanned while a fixture is audited, so the fixture's verdict can
 * never depend on what the documentation happens to say that day. Its
 * evidence is judged against {@link FIXTURE_REFERENCE_DATE}, so the
 * verdict does not depend on the day either.
 */
export function auditFixtures({ repoRoot = REPO_ROOT, packageScripts = null } = {}) {
	const violations = [];
	const files = [];
	const scripts = packageScripts ?? readPackageScripts(repoRoot);

	for (const [directory, expectation] of [
		[FIXTURE_PASS_DIR, 'pass'],
		[FIXTURE_FAIL_DIR, 'fail'],
	]) {
		const absolute = resolve(repoRoot, directory);
		const found = collectFixtureFiles(absolute);
		if (found.length === 0) {
			violations.push({
				rule: 'fixture-contract-missing',
				file: directory,
				message: `${directory} holds no fixture file; the ${expectation} fixture has no source`,
			});
			continue;
		}
		const expected = EXPECTED_FIXTURE_FILES[expectation] ?? [];
		const foundNames = found.map((path) => path.slice(path.lastIndexOf('/') + 1));
		for (const name of expected) {
			if (!foundNames.includes(name)) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file: `${directory}/${name}`,
					message: `the ${expectation} fixture ${name} is missing; the expected fixture set is ${expected.join(', ')}`,
				});
			}
		}
		for (const name of foundNames) {
			if (!expected.includes(name)) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file: `${directory}/${name}`,
					message: `the ${expectation} fixture ${name} is not part of the expected fixture set (${expected.join(', ')})`,
				});
			}
		}
		for (const path of found) {
			const relativePath = path.slice(repoRoot.length + 1);
			let fixture = null;
			try {
				fixture = readJson(path);
			} catch (error) {
				violations.push({
					rule: 'fixture-contract-missing',
					file: relativePath,
					message: `the fixture cannot be parsed: ${error.message}`,
				});
				continue;
			}
			const shapeProblems = validateShape(fixture);
			if (shapeProblems.length > 0) {
				violations.push({
					rule: 'fixture-contract-missing',
					file: relativePath,
					message: `the fixture is not a matrix: ${shapeProblems.join('; ')}`,
				});
				continue;
			}
			const audited = auditMatrix(fixture, {
				today: FIXTURE_REFERENCE_DATE,
				repoRoot,
				packageScripts: scripts,
				// A fixture is judged on its own: the repository's
				// documentation is not part of its verdict.
				claimSurfaces: [],
			});
			const produced = new Set(audited.violations.map((violation) => violation.rule));
			const expects = Array.isArray(fixture.$expects) ? fixture.$expects : [];
			for (const message of compareFixtureExpectations(expectation, expects, produced)) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file: relativePath,
					message,
				});
			}
			files.push({
				path: relativePath,
				expectation,
				expects,
				produced: [...produced],
				claims: audited.claims,
				violations: audited.violations,
			});
		}
	}

	return { files, violations };
}

/* ------------------------------------------------------------------ *
 * the scope decisions
 * ------------------------------------------------------------------ */

/**
 * The header of the scope-decision table in the documentation.
 *
 * Every field of a scope decision is mirrored: the disposition, the
 * reason, the evidence (or what would close it), the reviewer and the
 * reproduction steps. A field that is missing in the document is a
 * mismatch, exactly like a field that differs.
 */
export const SCOPE_DECISION_TABLE_HEADER = [
	'SC',
	'レベル',
	'名前',
	'区分',
	'理由',
	'証跡',
	'検査者',
	'手順',
];

/** The cell that stands for "this field is not present". */
export const EMPTY_CELL = '—';

/** The separator the documentation uses between two reproduction steps. */
export const STEP_SEPARATOR = '<br>';

/**
 * Read the scope-decision table out of the documentation.
 *
 * The table is found by its header row, so the surrounding prose may
 * move without breaking the gate.
 */
export function parseScopeDecisionTable(text) {
	const rows = [];
	const lines = String(text).split('\n');
	let inTable = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('|')) {
			if (inTable) break;
			continue;
		}
		const cells = trimmed
			.split('|')
			.slice(1, -1)
			.map((cell) => cell.trim());
		if (!inTable) {
			if (cells.length !== SCOPE_DECISION_TABLE_HEADER.length) continue;
			if (!cells.every((cell, index) => cell === SCOPE_DECISION_TABLE_HEADER[index])) continue;
			inTable = true;
			continue;
		}
		if (cells.every((cell) => /^-+$/.test(cell))) continue;
		rows.push({
			sc: cells[0],
			level: cells[1],
			name: cells[2],
			disposition: cells[3],
			reason: cells[4],
			evidence: cells[5],
			reviewer: cells[6] === EMPTY_CELL || cells[6] === '' ? null : cells[6],
			steps:
				cells[7] === EMPTY_CELL || cells[7] === ''
					? []
					: cells[7].split(STEP_SEPARATOR).map((step) => step.trim()),
		});
	}
	return rows;
}

/**
 * Compare the documented scope decisions with the constant.
 *
 * Every criterion of the constant must be documented with the same
 * level, the same name, the same disposition, the same reason, the
 * same evidence, the same reviewer and the same reproduction steps,
 * and the documentation must not list a criterion the constant does
 * not hold. A drift is a violation: the script and the document are
 * two views of one decision.
 */
export function compareScopeDecisions(rows, decisions = SCOPE_DECISIONS) {
	const problems = [];
	const documented = new Map(rows.map((row) => [row.sc, row]));
	if (rows.length !== decisions.length) {
		problems.push(
			`the documentation lists ${rows.length} scope decision(s) while the gate holds ${decisions.length}`,
		);
	}
	for (const decision of decisions) {
		const row = documented.get(decision.sc);
		if (!row) {
			problems.push(`SC ${decision.sc} (${decision.level}) is not documented`);
			continue;
		}
		if (row.level !== decision.level) {
			problems.push(`SC ${decision.sc} is documented as level ${row.level}, not ${decision.level}`);
		}
		if (row.name !== decision.name) {
			problems.push(`SC ${decision.sc} is documented as "${row.name}", not "${decision.name}"`);
		}
		if (row.disposition !== decision.disposition) {
			problems.push(
				`SC ${decision.sc} is documented with the disposition "${row.disposition}", not "${decision.disposition}"`,
			);
		}
		if (row.reason !== decision.reason) {
			problems.push(`SC ${decision.sc} is documented with another reason`);
		}
		if (row.evidence !== decision.evidence) {
			problems.push(`SC ${decision.sc} is documented with another evidence`);
		}
		const reviewer = decision.reviewer ?? null;
		if ((row.reviewer ?? null) !== reviewer) {
			problems.push(
				`SC ${decision.sc} is documented with the reviewer "${row.reviewer ?? EMPTY_CELL}", not "${reviewer ?? EMPTY_CELL}"`,
			);
		}
		const steps = decision.steps ?? [];
		if (
			row.steps.length !== steps.length ||
			row.steps.some((step, index) => step !== steps[index])
		) {
			problems.push(`SC ${decision.sc} is documented with another reproduction plan`);
		}
	}
	for (const row of rows) {
		if (!decisions.some((decision) => decision.sc === row.sc)) {
			problems.push(`SC ${row.sc} is documented but the gate does not hold it`);
		}
	}
	return problems;
}

/**
 * Audit the scope decisions against the documentation.
 *
 * The gate holds the decision; the documentation states it. The two
 * have to agree, or the record is not trustworthy.
 */
export function auditScopeDecisions({ repoRoot = REPO_ROOT, decisions = SCOPE_DECISIONS } = {}) {
	const path = resolve(repoRoot, SCOPE_DECISION_DOC);
	if (!existsSync(path)) {
		return [
			{
				rule: 'scope-decision-doc-mismatch',
				file: SCOPE_DECISION_DOC,
				message: `the scope decision documentation ${SCOPE_DECISION_DOC} does not exist`,
			},
		];
	}
	const rows = parseScopeDecisionTable(readFileSync(path, 'utf8'));
	return compareScopeDecisions(rows, decisions).map((message) => ({
		rule: 'scope-decision-doc-mismatch',
		file: SCOPE_DECISION_DOC,
		message,
	}));
}

/**
 * Audit the DISPOSITIONS of the scope decisions.
 *
 * This is the rule that stops "we have no item for it in this table"
 * from counting as "this criterion does not apply":
 *
 *   - `scope-disposition-invalid`
 *       The decision has no disposition, or a disposition that is not
 *       one of the three, or the fields its disposition requires are
 *       missing, or it carries fields its disposition forbids.
 *   - `scope-exclusion-not-a-product-fact`
 *       A `not-applicable` decision whose reason or evidence says
 *       "this table has no item for it" / "no owner" instead of naming
 *       a fact about the published product.
 *   - `scope-unverified-missing-review-plan`
 *       An `applicable-unverified` decision that does not say who has
 *       to review it and how to reproduce the check.
 *   - `scope-verified-without-review-record`
 *       An `applicable-and-verified` decision without a human review
 *       record. The repository holds no such record, and an agent may
 *       not produce one.
 *
 * The decisions are taken as DATA so that the rules can be exercised
 * with a decision that breaks them.
 */
export function auditScopeDispositions(
	decisions = SCOPE_DECISIONS,
	{ file = SCOPE_DECISION_SOURCE } = {},
) {
	const violations = [];
	const list = Array.isArray(decisions) ? decisions : [];
	for (const decision of list) {
		const sc = decision?.sc ?? '(no sc)';
		const disposition = decision?.disposition;
		if (!SCOPE_DISPOSITIONS.includes(disposition)) {
			violations.push({
				rule: 'scope-disposition-invalid',
				file,
				message: `SC ${sc}: the disposition must be one of ${SCOPE_DISPOSITIONS.join(' / ')} (found ${JSON.stringify(disposition)})`,
			});
			continue;
		}
		const contract = SCOPE_DISPOSITION_CONTRACT[disposition];
		for (const field of contract.requires) {
			if (!scopeFieldPresent(decision[field], field)) {
				const rule =
					disposition === 'applicable-unverified' && (field === 'reviewer' || field === 'steps')
						? 'scope-unverified-missing-review-plan'
						: disposition === 'applicable-and-verified' &&
								(field === 'verifiedBy' || field === 'verifiedAt')
							? 'scope-verified-without-review-record'
							: 'scope-disposition-invalid';
				violations.push({
					rule,
					file,
					message: `SC ${sc}: a "${disposition}" decision needs ${field}`,
				});
			}
		}
		for (const field of contract.forbids) {
			if (decision[field] !== undefined && decision[field] !== null && decision[field] !== '') {
				violations.push({
					rule: 'scope-disposition-invalid',
					file,
					message: `SC ${sc}: a "${disposition}" decision must not carry ${field}`,
				});
			}
		}
		if (disposition === 'not-applicable') {
			for (const field of ['reason', 'evidence']) {
				if (!looksLikeTableCoverageReason(decision[field])) continue;
				violations.push({
					rule: 'scope-exclusion-not-a-product-fact',
					file,
					message: `SC ${sc}: the ${field} reads like an admission that nobody looked ("${decision[field]}"); a "not-applicable" decision needs a fact about the published product, not a statement about the table`,
				});
			}
		}
	}
	return violations;
}

/**
 * Is a scope-decision field present?
 *
 * `steps` is an array of non-empty strings; every other field is a
 * non-empty string.
 */
export function scopeFieldPresent(value, field) {
	if (field === 'steps') {
		return Array.isArray(value) && value.length > 0 && value.every((entry) => filledString(entry));
	}
	return filledString(value) !== null;
}

/**
 * The scope-decision fixtures: negative controls and the positive
 * control beside them.
 *
 * The set is EXACT, for the same reason the matrix fixture set is:
 * a fixture that quietly lost a file would verify less than it claims.
 */
export const SCOPE_FIXTURE_ROOT = `${FIXTURE_ROOT}/scope`;
export const EXPECTED_SCOPE_FIXTURE_FILES = {
	pass: ['01-product-fact-exclusion.json'],
	fail: [
		'01-table-coverage-exclusion.json',
		'02-unverified-without-steps.json',
		'03-verified-without-review-record.json',
	],
};

/**
 * Audit every scope-decision fixture.
 *
 * A `pass` fixture must produce no violation; a `fail` fixture must
 * produce **exactly** the rules it declares — the same contract the
 * matrix fixtures use.
 */
export function auditScopeFixtures({ repoRoot = REPO_ROOT } = {}) {
	const violations = [];
	const files = [];
	for (const [expectation, directory] of [
		['pass', `${SCOPE_FIXTURE_ROOT}/pass`],
		['fail', `${SCOPE_FIXTURE_ROOT}/fail`],
	]) {
		const absolute = resolve(repoRoot, directory);
		const found = collectFixtureFiles(absolute);
		if (found.length === 0) {
			violations.push({
				rule: 'fixture-contract-missing',
				file: directory,
				message: `${directory} holds no fixture file; the ${expectation} fixture has no source`,
			});
			continue;
		}
		const expected = EXPECTED_SCOPE_FIXTURE_FILES[expectation] ?? [];
		const foundNames = found.map((path) => path.slice(path.lastIndexOf('/') + 1));
		for (const name of expected) {
			if (!foundNames.includes(name)) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file: `${directory}/${name}`,
					message: `the ${expectation} scope fixture ${name} is missing; the expected fixture set is ${expected.join(', ')}`,
				});
			}
		}
		for (const name of foundNames) {
			if (!expected.includes(name)) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file: `${directory}/${name}`,
					message: `the ${expectation} scope fixture ${name} is not part of the expected fixture set (${expected.join(', ')})`,
				});
			}
		}
		for (const path of found) {
			const relativePath = path.slice(repoRoot.length + 1);
			let fixture = null;
			try {
				fixture = readJson(path);
			} catch (error) {
				violations.push({
					rule: 'fixture-contract-missing',
					file: relativePath,
					message: `the scope fixture cannot be parsed: ${error.message}`,
				});
				continue;
			}
			const decisions = Array.isArray(fixture) ? fixture : fixture?.decisions;
			if (!Array.isArray(decisions) || decisions.length === 0) {
				violations.push({
					rule: 'fixture-contract-missing',
					file: relativePath,
					message: 'the scope fixture holds no decisions',
				});
				continue;
			}
			const produced = auditScopeDispositions(decisions, { file: relativePath });
			const expects = Array.isArray(fixture?.$expects) ? fixture.$expects : [];
			for (const message of compareFixtureExpectations(
				expectation,
				expects,
				produced.map((violation) => violation.rule),
			)) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file: relativePath,
					message,
				});
			}
			files.push({
				path: relativePath,
				expectation,
				expects,
				produced: [...new Set(produced.map((violation) => violation.rule))],
			});
		}
	}
	return { files, violations };
}

/* ------------------------------------------------------------------ *
 * the report
 * ------------------------------------------------------------------ */

/** The human-readable report. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push('WCAG 2.2 A/AA manual review matrix — Issue #410 / Issue #722');
	lines.push(
		`matrix: ${evidence.matrixPath} (revision ${evidence.updatedAt}, review window ${evidence.reviewWindowDays} day(s))`,
	);
	lines.push(
		`${evidence.items.length} item(s): ${evidence.machineChecked} machine-checked (auto-pass), ${evidence.humanReviewed} human review(s) — ${evidence.humanVerified} human-verified, ${evidence.humanFailed} human-failed, ${evidence.outstanding} not-reviewed`,
	);
	lines.push('');
	lines.push('machine-checked (an npm gate decided it — NOT a human verification):');
	for (const item of evidence.items.filter((entry) => entry.review?.state === 'auto-pass')) {
		lines.push(
			`  ok   ${item.id.padEnd(26)} ${scLabel(item)} ${item.surface.padEnd(22)} [${item.state}] ${(item.autoGates ?? []).join(', ')}`,
		);
	}
	lines.push('');
	lines.push('human review (a person performs it; an automatic pass is not a substitute):');
	const humanItems = evidence.items.filter((entry) => entry.review?.state !== 'auto-pass');
	if (humanItems.length === 0) {
		lines.push('  (none)');
	}
	for (const item of humanItems) {
		const verdict =
			item.review?.state === 'human-verified'
				? 'verified'
				: item.review?.state === 'human-failed'
					? 'FAILED'
					: 'outstanding';
		lines.push(
			`  ${verdict.padEnd(11)} ${item.id.padEnd(26)} ${scLabel(item)} ${item.surface.padEnd(22)} [${item.state}]`,
		);
	}
	lines.push('');
	lines.push('excluded criteria (stated, not dropped silently):');
	if (evidence.excluded.length === 0) lines.push('  (none)');
	for (const entry of evidence.excluded) {
		lines.push(`  - SC ${entry.sc} ${WCAG_22_CRITERIA[entry.sc].name} — ${entry.reason}`);
	}
	lines.push('');
	lines.push(
		`scope decisions: ${evidence.scopeDecisions.length} A/AA criteria are outside this table; the dispositions and their reasons live in ${SCOPE_DECISION_DOC}`,
	);
	lines.push(
		`  not-applicable: ${evidence.dispositionCounts['not-applicable']} (each one carries a fact about the published product)`,
	);
	lines.push(
		`  applicable-unverified: ${evidence.dispositionCounts['applicable-unverified']} (each one names a reviewer and a reproduction plan)`,
	);
	lines.push(
		`  applicable-and-verified: ${evidence.dispositionCounts['applicable-and-verified']} (no owner measurement exists in this repository, and an agent may not produce one)`,
	);
	for (const decision of evidence.scopeDecisions) {
		const owner = decision.reviewer ? ` (${decision.reviewer})` : '';
		lines.push(
			`  - SC ${decision.sc} (${decision.level}) ${decision.name} — ${decision.disposition}${owner}`,
		);
	}
	lines.push('');
	lines.push(
		"release assessment (the ledger's structure and the audited quality are two different things):",
	);
	lines.push(
		`  ledger structure: GREEN — every criterion has a disposition, every scope decision is mirrored in ${SCOPE_DECISION_DOC}, and every fixture behaves as it declares.`,
	);
	lines.push(
		`  audited quality: NOT PASSED — ${evidence.outstanding} manual item(s) are still outstanding, ${evidence.humanVerified} manual item(s) are human-verified, ${evidence.humanFailed} failed, and ${evidence.dispositionCounts['applicable-unverified']} criterion/criteria are applicable but unverified.`,
	);
	lines.push(
		`  this is NOT a WCAG 2.2 AA audit: ${evidence.machineChecked} of ${evidence.items.length} ledger items are machine-checked. A machine gate cannot decide what a screen reader announces, what the keyboard path feels like, or whether a link text says what the reader needs it to say — no browser or screen-reader confirmation is replaced by a gate.`,
	);
	lines.push(
		'  the outstanding manual items are outstanding: they are assigned to the owner and nobody has performed them.',
	);
	const knownAxe =
		evidence.knownAxeViolations ?? evidence.matrix?.releaseAssessment?.knownAxeViolations ?? null;
	if (knownAxe) {
		const recorded = Number(knownAxe.recordedViolations);
		const ledgers = Array.isArray(knownAxe.ledgers) ? knownAxe.ledgers.join(', ') : '';
		if (Number.isFinite(recorded) && recorded > 0) {
			lines.push(
				`  the axe-core violation records (${ledgers}) hold ${recorded} entry/entries; they are tracked by Issue ${knownAxe.issue ?? '(unrecorded)'} and this gate neither closes nor excuses them.`,
			);
		} else {
			lines.push(
				`  the axe-core violation records (${ledgers}) hold 0 entries — the recorded violations Issue ${knownAxe.issue ?? '(unrecorded)'} tracked were fixed in the implementation, and the Issue stays open for the MANUAL items above, not for a recorded axe violation.`,
			);
		}
	} else {
		lines.push(
			'  the axe-core violation records (e2e/a11y/axe-baseline.json and e2e/a11y/axe-storybook-baseline.json) are recorded in the ledger; read the ledger for their state, and do not infer an unfixed violation from an open Issue number.',
		);
	}
	lines.push('');
	lines.push(
		`site-level conformance claim: ${
			evidence.humanVerified > 0
				? 'available (a human verification exists and the claim must point at this matrix)'
				: 'NOT available — no human verification exists, so no document may claim WCAG 2.2 AA conformance'
		}`,
	);
	lines.push(
		'a green run of this gate means the TABLE is intact. It does not mean the site conforms to WCAG 2.2 AA.',
	);
	lines.push('');
	if (evidence.violations.length > 0) {
		lines.push(`violations (${evidence.violations.length}):`);
		for (const violation of evidence.violations) {
			lines.push(`  [${violation.rule}] ${violation.file} — ${violation.message}`);
		}
	} else {
		lines.push('no violations');
	}
	return lines.join('\n');
}

/** `SC 1.4.3 (AA)` for an item. */
function scLabel(item) {
	const sc = (item.sc ?? []).map((entry) => `${entry} (${WCAG_22_CRITERIA[entry]?.level ?? '?'})`);
	return sc.join(', ');
}

/* ------------------------------------------------------------------ *
 * entry point
 * ------------------------------------------------------------------ */

/** The npm scripts of the repository, or `null` when they cannot be read. */
export function readPackageScripts(repoRoot = REPO_ROOT) {
	try {
		const manifest = readJson(resolve(repoRoot, 'package.json'));
		return manifest.scripts ?? {};
	} catch {
		return null;
	}
}

/**
 * Read a scope-decision file.
 *
 * The file holds either the decisions themselves or an object with a
 * `decisions` array. It is how the negative controls are exercised
 * from the command line: pointing the gate at a decision file that
 * breaks a rule makes the gate red with that rule.
 */
export function loadScopeDecisions(path) {
	let parsed = null;
	try {
		parsed = readJson(path);
	} catch (error) {
		throw new Error(`the scope decision file ${path} cannot be parsed: ${error.message}`);
	}
	const decisions = Array.isArray(parsed) ? parsed : parsed?.decisions;
	if (!Array.isArray(decisions) || decisions.length === 0) {
		throw new Error(`the scope decision file ${path} holds no decisions`);
	}
	return decisions;
}

/** Collect every piece of evidence the gate reports. */
export function collectEvidence({
	today = todayIso(),
	repoRoot = REPO_ROOT,
	matrixPath = MATRIX_PATH,
	scopeDecisionsPath = null,
} = {}) {
	const absolute = resolve(repoRoot, matrixPath);
	if (!existsSync(absolute)) {
		throw new Error(`the review matrix ${matrixPath} does not exist`);
	}
	let matrix = null;
	try {
		matrix = readJson(absolute);
	} catch (error) {
		throw new Error(`the review matrix ${matrixPath} cannot be parsed: ${error.message}`);
	}
	const shapeProblems = validateShape(matrix);
	if (shapeProblems.length > 0) {
		throw new Error(`the review matrix ${matrixPath} is not a matrix: ${shapeProblems.join('; ')}`);
	}
	const packageScripts = readPackageScripts(repoRoot);
	const audited = auditMatrix(matrix, { today, repoRoot, packageScripts });
	const fixtures = auditFixtures({ repoRoot, packageScripts });
	const scopeFixtures = auditScopeFixtures({ repoRoot });
	// The documentation always mirrors the SHIPPED decisions. An
	// override (`--scope-decisions`) replaces the decisions the rules
	// are judged against, not the record the documentation states.
	const scopeDoc = auditScopeDecisions({ repoRoot });
	const decisions = scopeDecisionsPath
		? loadScopeDecisions(resolve(repoRoot, scopeDecisionsPath))
		: SCOPE_DECISIONS;
	const dispositions = auditScopeDispositions(decisions);
	const universe = auditCriterionUniverse();
	return {
		matrix,
		matrixPath,
		updatedAt: filledString(matrix.updatedAt) ?? '(no revision recorded)',
		reviewWindowDays: matrix.reviewWindowDays,
		items: audited.items,
		surfaces: audited.surfaces,
		states: audited.states,
		excluded: audited.excluded,
		coveredCriteria: audited.coveredCriteria,
		claims: audited.claims,
		humanVerified: audited.humanVerified,
		humanFailed: audited.items.filter((item) => item?.review?.state === 'human-failed').length,
		humanReviewed: audited.items.filter((item) => item?.review?.state !== 'auto-pass').length,
		outstanding: audited.outstanding,
		machineChecked: audited.machineChecked,
		scopeDecisions: decisions,
		dispositionCounts: Object.fromEntries(
			SCOPE_DISPOSITIONS.map((id) => [
				id,
				decisions.filter((decision) => decision.disposition === id).length,
			]),
		),
		fixtures: fixtures.files,
		scopeFixtures: scopeFixtures.files,
		violations: [
			...audited.violations,
			...fixtures.violations,
			...scopeDoc,
			...dispositions,
			...scopeFixtures.violations,
			...universe,
		],
	};
}

function usage() {
	process.stderr.write(
		'usage: check-a11y-wcag-review-matrix.mjs [--quiet] [--json=FILE] [--today=YYYY-MM-DD] [--matrix=PATH] [--scope-decisions=PATH]\n',
	);
}

/**
 * Read the command line.
 *
 * Every option takes its value either attached (`--today=2026-10-23`)
 * or as the next argument (`--today 2026-10-23`); both spellings mean
 * the same thing. An option without a value is refused rather than
 * silently replaced by a default, so a typo cannot turn into "today".
 */
export function parseOptions(argv = []) {
	const options = { quiet: false, json: null, today: null, matrix: null, scopeDecisions: null };
	const valued = {
		'--json': 'json',
		'--today': 'today',
		'--matrix': 'matrix',
		'--scope-decisions': 'scopeDecisions',
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--quiet') {
			options.quiet = true;
			continue;
		}
		const separator = arg.indexOf('=');
		const name = separator === -1 ? arg : arg.slice(0, separator);
		if (!Object.hasOwn(valued, name)) {
			usage();
			throw new Error(`unknown option: ${arg}`);
		}
		let value = separator === -1 ? null : arg.slice(separator + 1);
		if (value === null) {
			const next = argv[index + 1] ?? null;
			if (next?.startsWith('--')) {
				usage();
				throw new Error(`${name} requires a value`);
			}
			value = next;
			if (value !== null) index += 1;
		}
		if (value === null || value === '') {
			usage();
			throw new Error(`${name} requires a value`);
		}
		options[valued[name]] = value;
	}
	return options;
}

export function runGate(argv = process.argv.slice(2)) {
	const options = parseOptions(argv);
	const today = options.today ?? todayIso();
	const matrixPath = options.matrix ?? MATRIX_PATH;
	const jsonOut = options.json;

	const evidence = collectEvidence({
		today,
		matrixPath,
		scopeDecisionsPath: options.scopeDecisions,
	});

	if (!options.quiet) {
		process.stdout.write(`${renderGateSummary(evidence)}\n`);
	}
	for (const violation of evidence.violations) {
		process.stderr.write(`error [${violation.rule}]: ${violation.message}\n`);
	}
	if (jsonOut) {
		const target = resolve(REPO_ROOT, jsonOut);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
		process.stdout.write(`check-a11y-wcag-review-matrix: report ${jsonOut}\n`);
	}
	return evidence.violations.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		if (!runGate()) process.exit(1);
	} catch (error) {
		process.stderr.write(`check-a11y-wcag-review-matrix: ${error.message}\n`);
		process.exit(2);
	}
}
