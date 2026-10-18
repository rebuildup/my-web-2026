#!/usr/bin/env node

/**
 * UI copy locale-coverage gate (Issue #428).
 *
 * What this gate inspects
 * -----------------------
 * `copy/resources.json` is the **resource contract** for visitor-facing
 * copy: which capability (feature) is published in which locale, where
 * its source text lives, and — for every non-source locale a feature
 * opts into — the translated resources themselves.
 *
 * Two properties of that contract are checked here, because neither a
 * type checker nor a component test can observe them:
 *
 *   1. **Untranslated / unregistered keys.** A feature that opts into a
 *      locale must have a resource for every key it registers, and a
 *      resource must never name a key the feature does not register.
 *      The gap between the two is exactly the "未翻訳キー" and
 *      "未登録のキー" surface, and the report prints both sides.
 *   2. **Fallback.** Every declared locale names its fallback locale and
 *      the chain must terminate at the feature's source locale, so a
 *      missing resource degrades to the author's own text instead of an
 *      empty string.
 *
 * Locales are **opt-in per feature**, by construction: a feature lists
 * exactly the locales it is published in, and a locale absent from that
 * list is reported as `info`, never as an error. Nothing here demands a
 * fixed number of languages for every capability — the target language
 * set of a capability is a copy decision (see `docs/personal/owner.md`
 * "Working languages": 言語は capability ごとに決める).
 *
 * Mechanical vs. human judgement (the distinction is the point)
 * -------------------------------------------------------------
 * The report separates two kinds of statement and never mixes them:
 *
 *   - **Mechanical** — coverage, fallback integrity, and typography.
 *     Typography is script-level and decidable by rule (Japanese
 *     line-start / line-end prohibited characters, full-width residue
 *     in a Latin resource, spacing before punctuation). A mechanical
 *     finding blocks.
 *   - **Prose quality** — register, honorifics, sentence length,
 *     word order, cultural adaptation. **This gate cannot decide these.**
 *     A message carries `prose: "verified" | "unverified"`; the field is
 *     a recorded human claim, not a machine result. `unverified` in a
 *     `published` locale blocks, because publishing an unreviewed
 *     rewording is the failure this contract exists to prevent.
 *
 * The same split governs *what a draft may do*: a `draft` resource is
 * never served — `resolveMessage()` walks the fallback chain past it —
 * and a draft inside a `published` locale is an error. Undetermined
 * rewording stays in the repository; it does not reach a visitor.
 *
 * Dependencies and honesty about the reference tooling
 * -----------------------------------------------------
 * The gate is dependency-free Node (>=22.18, already required by
 * `package.json#engines`) and reads only repository files. No Python,
 * no machine-translation service, no network. The editing aid
 * referenced by the Issue (yomiyasu and comparable tools) may be run
 * offline to *propose* a rewording, but its output is a proposal: this
 * repository records `prose: "verified"` only when a human read the
 * result against the source text. Negation and permission detection are
 * **marker heuristics**, documented below, and they err toward reporting
 * a finding rather than toward silence.
 *
 * Usage:
 *   node scripts/check-copy-i18n.mjs
 *   node scripts/check-copy-i18n.mjs --format=text
 *   node scripts/check-copy-i18n.mjs --format=json --out=.tmp/copy-i18n.json
 *   node scripts/check-copy-i18n.mjs --include-fixture --format=html \
 *     --out=.tmp/missing-keys-report.html
 *
 * Options:
 *   --contract=<path>    Check this contract instead of `copy/resources.json`.
 *                        Repeatable; when present, the repository contract
 *                        is NOT loaded (a report run must not silently mix
 *                        demonstration data into the gate).
 *   --include-fixture    Additionally run the demonstration fixture
 *                        contract. Fixture findings never gate: they exist
 *                        to prove each finding class still fires.
 *   --format=text|json|html   Output format (default `text`).
 *   --out=<path>         Write to a file instead of stdout.
 *   --strict             Make every run gating (default: only the
 *                        repository contract gates).
 *
 * Exit codes: 0 = no blocking finding in a gating run, 1 = blocking
 * findings, 2 = bad input (unreadable / malformed contract).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..');

/** Repository-owned resource contract (the gate's default input). */
export const CONTRACT_PATH = 'copy/resources.json';

/** Demonstration fixture: one planted violation per finding class. */
export const FIXTURE_CONTRACT_PATH = 'test/fixtures/i18n/missing-keys.contract.json';

/** Contract schema this gate understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Ordered severity: a run fails when any gating run has an `error`. */
export const SEVERITIES = ['error', 'review', 'info'];

/**
 * Finding classes.
 *
 * `mechanical` findings are decidable from the contract text alone and
 * block. `prose` is the only class this gate explicitly cannot decide;
 * it carries a recorded human claim instead of a machine verdict.
 */
export const MECHANICAL_CLASSES = [
	'contract',
	'coverage',
	'fallback',
	'preservation',
	'typography',
	'publication',
	'opt-in',
];

/**
 * Per-locale script rules.
 *
 * A locale with no entry here is still a legal declaration — the gate
 * reports `no-typography-rules` as `info` and states that the locale is
 * unjudged, rather than pretending a Latin rule set applies to it.
 */
export const LOCALE_SCRIPTS = {
	ja: {
		script: 'cjk',
		/** 行頭禁則 — characters that may not begin a line. */
		lineStartProhibited: '、。，．・：；！？」』）】〉》〕｝”’',
		/** 行末禁則 — characters that may not end a line. */
		lineEndProhibited: '「（『【〈《〔｛“‘',
	},
	en: {
		script: 'latin',
		/** Spacing before punctuation, doubled spaces: typography, not prose. */
		spaceBeforePunctuation: [' ,', ' .', ' !', ' ?', ' ;', ' :', " '"],
	},
};

/**
 * Negation markers per locale (heuristic).
 *
 * A translation that drops negation inverts the meaning of the source
 * text, which is the one class of copy error a machine may safely
 * refuse to let through. The marker lists are deliberately broad: a
 * false positive costs one human look, a false negative ships a
 * sentence that says the opposite of the author's.
 */
export const NEGATION_MARKERS = {
	ja: ['ない', 'ません', 'なし', '不可', '禁止', '非表示', 'しない', 'できない'],
	en: [
		'not',
		'no',
		'never',
		'nothing',
		'none',
		'cannot',
		"can't",
		"don't",
		"doesn't",
		"won't",
		'without',
		'unavailable',
		'disabled',
	],
};

/**
 * Permission / authority markers per locale (heuristic).
 *
 * A message flagged `guarded: true` carries access-control meaning
 * ("only", "admin", "required"). A translation that keeps no
 * permission marker can widen or narrow what the reader is allowed to
 * do, so the gate requires the marker to survive.
 */
export const PERMISSION_MARKERS = {
	ja: [
		'権限',
		'管理',
		'編集',
		'承認',
		'公開',
		'非公開',
		'閲覧',
		'削除',
		'作成',
		'実行',
		'認証',
		'許可',
		'のみ',
		'だけ',
		'必須',
		'秘密',
	],
	en: [
		'permission',
		'admin',
		'owner',
		'edit',
		'approve',
		'publish',
		'private',
		'view',
		'delete',
		'create',
		'run',
		'auth',
		'only',
		'must',
		'required',
		'secret',
		'restricted',
	],
};

const VALID_LOCALE_STATES = new Set(['source', 'translating', 'published']);
const VALID_MESSAGE_STATUS = new Set(['draft', 'reviewed']);
const VALID_PROSE = new Set(['verified', 'unverified']);

/** CJK ideographs, kana, CJK punctuation and full-width forms. */
const CJK_PATTERN =
	/[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFE6]/u;

/** `{placeholder}` tokens, the only interpolation this contract allows. */
const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

function finding({ code, severity, className, message, feature, locale, key, detail }) {
	return {
		code,
		severity,
		class: className,
		message,
		feature: feature ?? null,
		locale: locale ?? null,
		key: key ?? null,
		detail: detail ?? null,
	};
}

/** Sort helper: errors first, then review, then info; stable within. */
function severityRank(severity) {
	const index = SEVERITIES.indexOf(severity);
	return index === -1 ? SEVERITIES.length : index;
}

function sortFindings(findings) {
	return [...findings].sort((a, b) => {
		const bySeverity = severityRank(a.severity) - severityRank(b.severity);
		if (bySeverity !== 0) return bySeverity;
		if (a.feature !== b.feature) return (a.feature ?? '').localeCompare(b.feature ?? '');
		if (a.locale !== b.locale) return (a.locale ?? '').localeCompare(b.locale ?? '');
		return (a.key ?? '').localeCompare(b.key ?? '');
	});
}

function countBy(findings, field) {
	const counts = {};
	for (const item of findings) counts[item[field]] = (counts[item[field]] ?? 0) + 1;
	return counts;
}

/** Numeric literals — including decimals — that must survive translation. */
function numericTokens(text) {
	return [...new Set(text.match(/\d+(?:[.,]\d+)*/g) ?? [])];
}

/**
 * Placeholder names in one text, compared as a **set**, not a
 * sequence: the check answers "did the translation keep every
 * placeholder?", and word order legitimately differs between
 * locales. The trade-off is recorded in `copy/README.md`: a
 * translation that swaps the arguments of two or more placeholders
 * (`{a} を {b}` -> `{b} を {a}`) is not reported by this gate.
 */
function placeholderTokens(text) {
	return [...new Set([...text.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[1]))].sort();
}

/**
 * Marker search.
 *
 * Japanese has no word delimiters, so its markers are matched as
 * substrings. A Latin-script locale is matched on whole tokens instead:
 * `"cannot use"` must not be missed because the marker sits at the end
 * of the string, and `"noon"` must not be read as the negation `"no"`.
 */
function hasMarker(text, locale, markers) {
	if (!markers) return null;
	if (locale !== 'en') return markers.some((marker) => text.includes(marker));
	const tokens = new Set(
		text
			.toLowerCase()
			.split(/[^\p{L}\p{N}']+/u)
			.filter(Boolean),
	);
	return markers.some((marker) => tokens.has(marker.toLowerCase()));
}

/**
 * Does the text carry a negation marker in this locale? A locale with
 * no marker list cannot answer, which is reported rather than guessed.
 */
function hasNegation(text, locale) {
	return hasMarker(text, locale, NEGATION_MARKERS[locale]);
}

/** Does the text carry a permission / authority marker in this locale? */
function hasPermissionMarker(text, locale) {
	return hasMarker(text, locale, PERMISSION_MARKERS[locale]);
}

/**
 * Mechanical typography findings for one message.
 *
 * Only script-level rules live here. Register, honorifics, sentence
 * length and word order are prose questions and are never guessed at.
 */
function typographyFindings(text, locale, context) {
	const rules = LOCALE_SCRIPTS[locale];
	if (!rules) {
		return [
			finding({
				code: 'no-typography-rules',
				severity: 'info',
				className: 'typography',
				message: `No typography rule set is defined for locale "${locale}"; mechanical typography is unjudged for this message.`,
				...context,
			}),
		];
	}
	const results = [];
	if (rules.script === 'cjk') {
		const first = [...text][0] ?? '';
		const last = [...text].at(-1) ?? '';
		if (rules.lineStartProhibited.includes(first)) {
			results.push(
				finding({
					code: 'line-start-prohibited',
					severity: 'error',
					className: 'typography',
					message: `"${first}" may not begin a line (行頭禁則).`,
					...context,
				}),
			);
		}
		if (rules.lineEndProhibited.includes(last)) {
			results.push(
				finding({
					code: 'line-end-prohibited',
					severity: 'error',
					className: 'typography',
					message: `"${last}" may not end a line (行末禁則).`,
					...context,
				}),
			);
		}
	}
	if (rules.script === 'latin') {
		if (CJK_PATTERN.test(text)) {
			results.push(
				finding({
					code: 'cjk-residue',
					severity: 'error',
					className: 'typography',
					message: 'A Latin-script resource still carries CJK characters or full-width forms.',
					...context,
				}),
			);
		}
		for (const sequence of rules.spaceBeforePunctuation) {
			if (text.includes(sequence)) {
				results.push(
					finding({
						code: 'space-before-punctuation',
						severity: 'error',
						className: 'typography',
						message: `"${sequence.trim()}" carries a leading space in a Latin-script resource.`,
						...context,
					}),
				);
				break;
			}
		}
		if (/\s{2,}/u.test(text)) {
			results.push(
				finding({
					code: 'double-space',
					severity: 'error',
					className: 'typography',
					message: 'Consecutive spaces in a Latin-script resource.',
					...context,
				}),
			);
		}
	}
	if (text !== text.trim()) {
		results.push(
			finding({
				code: 'stray-whitespace',
				severity: 'error',
				className: 'typography',
				message: 'Leading or trailing whitespace in the resource text.',
				...context,
			}),
		);
	}
	return results;
}

/** Read and parse a contract file. Throws a caller-readable Error. */
export function loadContract(contractPath) {
	const absolute = resolve(REPO_ROOT, contractPath);
	if (!existsSync(absolute)) {
		throw new Error(`contract not found: ${relative(REPO_ROOT, absolute)}`);
	}
	const raw = readFileSync(absolute, 'utf8');
	try {
		return { contract: JSON.parse(raw), raw, path: contractPath };
	} catch (error) {
		throw new Error(`${contractPath} is not valid JSON: ${error.message}`);
	}
}

function knownLocaleList(contract) {
	return Array.isArray(contract.knownLocales) ? contract.knownLocales : [];
}

/**
 * Contract-level shape checks.
 *
 * Everything here is about the contract being *interpretable*: a gate
 * that cannot parse the declaration cannot honestly claim a locale is
 * complete, so an undeclared locale or a broken fallback chain is an
 * error rather than a warning.
 */
export function validateContract(contract, { repoRoot = REPO_ROOT } = {}) {
	const findings = [];
	if (!contract || typeof contract !== 'object') {
		return [
			finding({
				code: 'contract-not-an-object',
				severity: 'error',
				className: 'contract',
				message: 'The contract root must be a JSON object.',
			}),
		];
	}
	if (contract.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
		findings.push(
			finding({
				code: 'unsupported-schema-version',
				severity: 'error',
				className: 'contract',
				message: `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}, got ${JSON.stringify(contract.schemaVersion)}.`,
			}),
		);
	}
	const locales = knownLocaleList(contract);
	if (locales.length === 0) {
		findings.push(
			finding({
				code: 'no-known-locales',
				severity: 'error',
				className: 'contract',
				message: 'knownLocales must list at least one locale.',
			}),
		);
	}
	for (const duplicate of duplicates(locales)) {
		findings.push(
			finding({
				code: 'duplicate-locale',
				severity: 'error',
				className: 'contract',
				message: `knownLocales lists "${duplicate}" more than once.`,
				locale: duplicate,
			}),
		);
	}
	if (!Array.isArray(contract.features) || contract.features.length === 0) {
		findings.push(
			finding({
				code: 'no-features',
				severity: 'error',
				className: 'contract',
				message: 'features must be a non-empty array.',
			}),
		);
		return findings;
	}

	for (const duplicate of duplicates(contract.features.map((f) => f?.id))) {
		findings.push(
			finding({
				code: 'duplicate-feature',
				severity: 'error',
				className: 'contract',
				message: `features declares "${duplicate}" more than once.`,
				feature: duplicate,
			}),
		);
	}

	for (const feature of contract.features) {
		const id = feature?.id ?? null;
		if (!id) {
			findings.push(
				finding({
					code: 'feature-without-id',
					severity: 'error',
					className: 'contract',
					message: 'Every feature needs an id.',
				}),
			);
			continue;
		}
		if (typeof feature.owner !== 'string' || feature.owner.length === 0) {
			findings.push(
				finding({
					code: 'feature-without-owner',
					severity: 'error',
					className: 'contract',
					message: 'Every feature names the source obligation that owns its copy.',
					feature: id,
				}),
			);
		} else if (!existsSync(resolve(repoRoot, 'src', feature.owner))) {
			findings.push(
				finding({
					code: 'unknown-owner',
					severity: 'error',
					className: 'contract',
					message: `owner "${feature.owner}" is not a source obligation (src/${feature.owner} does not exist).`,
					feature: id,
				}),
			);
		}

		const declared = feature.locales && typeof feature.locales === 'object' ? feature.locales : {};
		const declaredLocales = Object.keys(declared);
		if (declaredLocales.length === 0) {
			findings.push(
				finding({
					code: 'feature-without-locale',
					severity: 'error',
					className: 'contract',
					message: 'Every feature declares at least the locale its copy is authored in.',
					feature: id,
				}),
			);
			continue;
		}
		for (const locale of declaredLocales) {
			if (!locales.includes(locale)) {
				findings.push(
					finding({
						code: 'unknown-locale',
						severity: 'error',
						className: 'contract',
						message: `Locale "${locale}" is not listed in knownLocales.`,
						feature: id,
						locale,
					}),
				);
			}
			const state = declared[locale]?.state;
			if (!VALID_LOCALE_STATES.has(state)) {
				findings.push(
					finding({
						code: 'invalid-locale-state',
						severity: 'error',
						className: 'contract',
						message: `Locale "${locale}" needs state one of ${[...VALID_LOCALE_STATES].join(' / ')}, got ${JSON.stringify(state)}.`,
						feature: id,
						locale,
					}),
				);
			}
		}
		const sources = declaredLocales.filter((locale) => declared[locale]?.state === 'source');
		if (sources.length !== 1) {
			findings.push(
				finding({
					code: 'source-locale-count',
					severity: 'error',
					className: 'contract',
					message: `A feature declares exactly one locale with state "source", got ${sources.length}.`,
					feature: id,
				}),
			);
		} else if (feature.sourceLocale !== sources[0]) {
			findings.push(
				finding({
					code: 'source-locale-mismatch',
					severity: 'error',
					className: 'contract',
					message: `sourceLocale "${feature.sourceLocale}" does not name the locale whose state is "source" ("${sources[0]}").`,
					feature: id,
					locale: sources[0],
				}),
			);
		}

		for (const locale of declaredLocales) {
			const fallback = declared[locale]?.fallback ?? null;
			const chain = fallbackChain(feature, locale);
			if (declared[locale]?.state === 'source') {
				if (fallback !== null && fallback !== undefined) {
					findings.push(
						finding({
							code: 'fallback-on-source',
							severity: 'error',
							className: 'fallback',
							message: 'The source locale is the end of the chain and must not declare a fallback.',
							feature: id,
							locale,
						}),
					);
				}
				continue;
			}
			if (!fallback) {
				findings.push(
					finding({
						code: 'missing-fallback',
						severity: 'error',
						className: 'fallback',
						message: 'Every non-source locale names the locale it falls back to.',
						feature: id,
						locale,
					}),
				);
				continue;
			}
			if (!declaredLocales.includes(fallback)) {
				findings.push(
					finding({
						code: 'fallback-undeclared',
						severity: 'error',
						className: 'fallback',
						message: `fallback "${fallback}" is not a locale this feature declares.`,
						feature: id,
						locale,
					}),
				);
				continue;
			}
			if (chain.ok !== true) {
				findings.push(
					finding({
						code: chain.reason,
						severity: 'error',
						className: 'fallback',
						message: chain.message,
						feature: id,
						locale,
					}),
				);
			}
		}

		const keyList = Array.isArray(feature.keys) ? feature.keys : [];
		for (const duplicate of duplicates(keyList.map((k) => k?.key))) {
			findings.push(
				finding({
					code: 'duplicate-key',
					severity: 'error',
					className: 'contract',
					message: `keys registers "${duplicate}" more than once.`,
					feature: id,
					key: duplicate,
				}),
			);
		}
		for (const entry of keyList) {
			if (typeof entry?.source !== 'string' || entry.source.length === 0) {
				findings.push(
					finding({
						code: 'key-without-source',
						severity: 'error',
						className: 'contract',
						message: 'Every registered key carries the source-locale text it translates from.',
						feature: id,
						key: entry?.key ?? null,
					}),
				);
			}
		}

		const messages =
			feature.messages && typeof feature.messages === 'object' ? feature.messages : {};
		for (const locale of Object.keys(messages)) {
			if (!declaredLocales.includes(locale)) {
				findings.push(
					finding({
						code: 'resource-for-undeclared-locale',
						severity: 'error',
						className: 'contract',
						message: `messages carries resources for "${locale}", which the feature does not declare.`,
						feature: id,
						locale,
					}),
				);
			}
			if (locale === feature.sourceLocale) {
				findings.push(
					finding({
						code: 'source-resource-redundant',
						severity: 'error',
						className: 'contract',
						message:
							'The source text lives in keys[].source; a source-locale resource is a second place to keep it in sync.',
						feature: id,
						locale,
					}),
				);
			}
		}
	}

	// Opt-in is a feature-level decision, so an undeclared locale is
	// information rather than a failure: the gate never requires every
	// known locale of every feature.
	for (const feature of contract.features) {
		const declaredLocales = Object.keys(feature?.locales ?? {});
		for (const locale of locales) {
			if (!declaredLocales.includes(locale)) {
				findings.push(
					finding({
						code: 'locale-not-opted-in',
						severity: 'info',
						className: 'opt-in',
						message: `Locale "${locale}" is available but not opted in for this feature; that is a copy decision, not a gap.`,
						feature: feature?.id ?? null,
						locale,
					}),
				);
			}
		}
	}
	return findings;
}

function duplicates(values) {
	const seen = new Set();
	const repeated = new Set();
	for (const value of values) {
		if (value === undefined || value === null) continue;
		if (seen.has(value)) repeated.add(value);
		seen.add(value);
	}
	return [...repeated];
}

/**
 * Walk the declared fallback chain for one locale.
 *
 * Terminates on the source locale, on an undeclared locale, or when a
 * cycle is detected — the caller turns anything but `ok` into a finding.
 */
export function fallbackChain(feature, locale) {
	const declared = feature?.locales ?? {};
	const visited = new Set([locale]);
	let current = declared[locale]?.fallback ?? null;
	while (current) {
		if (visited.has(current)) {
			return {
				ok: false,
				reason: 'fallback-cycle',
				message: `Fallback chain loops back to "${current}"; a missing resource could recurse forever.`,
			};
		}
		visited.add(current);
		if (!declared[current]) {
			return {
				ok: false,
				reason: 'fallback-undeclared',
				message: `Fallback chain reaches "${current}", which this feature does not declare.`,
			};
		}
		if (declared[current].state === 'source') return { ok: true, chain: [...visited] };
		current = declared[current]?.fallback ?? null;
	}
	return {
		ok: false,
		reason: 'fallback-unterminated',
		message: `Fallback chain from "${locale}" never reaches the source locale.`,
	};
}

/**
 * Resolve one message the way the contract says a reader must see it.
 *
 * Only a `reviewed` resource is ever served. A `draft` is *skipped*, not
 * short-circuited: the walk continues down the chain so the nearest
 * reviewed translation wins, exactly as the header and `copy/README.md`
 * describe. If nothing later in the chain is reviewed, the answer is
 * the ordinary `missing` case (the author's own text, `ok: true`) with
 * `draftsSkipped` recording which locales held an unserved draft.
 */
export function resolveMessage(contract, featureId, locale, key) {
	const feature = contract?.features?.find((item) => item?.id === featureId);
	if (!feature) {
		return {
			ok: false,
			reason: 'unknown-feature',
			text: null,
			resolvedFrom: null,
			locale,
			draftsSkipped: [],
		};
	}
	const entry = (feature.keys ?? []).find((item) => item?.key === key);
	if (!entry) {
		return {
			ok: false,
			reason: 'unknown-key',
			text: null,
			resolvedFrom: null,
			locale,
			draftsSkipped: [],
		};
	}
	const declared = feature.locales ?? {};
	if (!declared[locale]) {
		return {
			ok: true,
			reason: 'locale-not-declared',
			text: entry.source,
			resolvedFrom: feature.sourceLocale,
			locale,
			draftsSkipped: [],
		};
	}
	const order = [locale];
	const chain = fallbackChain(feature, locale);
	for (const next of chain.ok ? chain.chain.slice(1) : []) order.push(next);
	const draftsSkipped = [];
	for (const candidate of order) {
		const message = feature.messages?.[candidate]?.[key];
		if (message?.status === 'reviewed') {
			return {
				ok: true,
				reason: candidate === locale ? 'hit' : 'fallback',
				text: message.text,
				resolvedFrom: candidate,
				locale,
				draftsSkipped,
			};
		}
		// A draft is never served; keep walking the chain for a
		// reviewed translation before degrading to the source text.
		if (message?.status === 'draft') draftsSkipped.push(candidate);
	}
	return {
		ok: true,
		reason: 'missing',
		text: entry.source,
		resolvedFrom: feature.sourceLocale,
		locale,
		draftsSkipped,
	};
}

/** Coverage + preservation + publication checks for one feature. */
export function checkFeature(feature) {
	const findings = [];
	const id = feature?.id ?? null;
	const declared = feature?.locales ?? {};
	const keyList = Array.isArray(feature?.keys) ? feature.keys : [];
	const registeredKeys = new Set(keyList.map((entry) => entry?.key));

	for (const [locale, declaration] of Object.entries(declared)) {
		const state = declaration?.state;
		if (state === 'source') {
			// The source text is authoritative; nothing is missing here.
			continue;
		}
		const resources = feature?.messages?.[locale] ?? {};
		for (const entry of keyList) {
			const key = entry?.key;
			const message = resources[key];
			if (!message) {
				findings.push(
					finding({
						code: 'missing-key',
						severity: 'error',
						className: 'coverage',
						message: `No resource for this key in locale "${locale}"; readers see the source text through the fallback.`,
						feature: id,
						locale,
						key,
					}),
				);
				continue;
			}
			findings.push(
				...checkMessage({
					feature: id,
					key,
					locale,
					state,
					sourceLocale: feature?.sourceLocale ?? null,
					sourceText: entry?.source ?? '',
					guarded: entry?.guarded === true,
					message,
				}),
			);
		}
		for (const key of Object.keys(resources)) {
			if (!registeredKeys.has(key)) {
				findings.push(
					finding({
						code: 'unregistered-key',
						severity: 'error',
						className: 'coverage',
						message:
							'Resource names a key this feature does not register, so nothing verifies it and the fallback cannot cover it.',
						feature: id,
						locale,
						key,
					}),
				);
			}
		}
	}

	for (const [locale, resources] of Object.entries(feature?.messages ?? {})) {
		const declaredLocales = Object.keys(declared);
		if (!declaredLocales.includes(locale) || locale === feature?.sourceLocale) continue;
		for (const [key, message] of Object.entries(resources ?? {})) {
			if (!registeredKeys.has(key)) continue;
			if (!VALID_MESSAGE_STATUS.has(message?.status)) {
				findings.push(
					finding({
						code: 'invalid-message-status',
						severity: 'error',
						className: 'contract',
						message: `status must be one of ${[...VALID_MESSAGE_STATUS].join(' / ')}, got ${JSON.stringify(message?.status)}.`,
						feature: id,
						locale,
						key,
					}),
				);
			}
			if (!VALID_PROSE.has(message?.prose)) {
				findings.push(
					finding({
						code: 'invalid-prose-state',
						severity: 'error',
						className: 'contract',
						message: `prose must be one of ${[...VALID_PROSE].join(' / ')}, got ${JSON.stringify(message?.prose)}.`,
						feature: id,
						locale,
						key,
					}),
				);
			}
			if (typeof message?.text !== 'string' || message.text.length === 0) {
				findings.push(
					finding({
						code: 'empty-resource',
						severity: 'error',
						className: 'coverage',
						message:
							'A resource with no text would render nothing; declare it a draft or remove it.',
						feature: id,
						locale,
						key,
					}),
				);
			}
		}
	}
	return findings;
}

/**
 * One message against its source text.
 *
 * Order matters for the report: preservation and typography are
 * mechanical, publication state decides whether the text may ship at
 * all, and prose quality is reported as an open human question.
 */
export function checkMessage({
	feature,
	key,
	locale,
	state,
	sourceLocale,
	sourceText,
	guarded,
	message,
}) {
	const findings = [];
	const context = { feature, key, locale };
	const sourceNegated = hasNegation(sourceText, sourceLocale);

	if (typeof message?.text === 'string' && message.text.length > 0) {
		for (const number of numericTokens(sourceText)) {
			if (!message.text.includes(number)) {
				findings.push(
					finding({
						code: 'number-drift',
						severity: 'error',
						className: 'preservation',
						message: `Numeric literal "${number}" in the source text is absent from the translation.`,
						...context,
					}),
				);
			}
		}
		const sourcePlaceholders = placeholderTokens(sourceText);
		const translatedPlaceholders = placeholderTokens(message.text);
		if (sourcePlaceholders.join(',') !== translatedPlaceholders.join(',')) {
			findings.push(
				finding({
					code: 'placeholder-drift',
					severity: 'error',
					className: 'preservation',
					message: `Placeholders differ: source {${sourcePlaceholders.join('}{') || '—'}} vs translation {${translatedPlaceholders.join('}{') || '—'}}.`,
					...context,
				}),
			);
		}
		const translationNegation = hasNegation(message.text, locale);
		if (
			sourceNegated !== null &&
			translationNegation !== null &&
			sourceNegated !== translationNegation
		) {
			findings.push(
				finding({
					code: 'negation-drift',
					severity: 'error',
					className: 'preservation',
					message: `Negation is ${sourceNegated ? 'present' : 'absent'} in the source text and ${translationNegation ? 'present' : 'absent'} in the translation.`,
					...context,
				}),
			);
		}
		if (guarded) {
			const sourcePermission = hasPermissionMarker(sourceText, sourceLocale);
			const translationPermission = hasPermissionMarker(message.text, locale);
			if (sourcePermission === true && translationPermission === false) {
				findings.push(
					finding({
						code: 'permission-drift',
						severity: 'error',
						className: 'preservation',
						message:
							'This key is guarded (access-control meaning) and the translation keeps no permission marker, which can widen or narrow what the reader may do.',
						...context,
					}),
				);
			}
		}
		findings.push(...typographyFindings(message.text, locale, context));
	}

	if (message?.status === 'draft' && state === 'published') {
		findings.push(
			finding({
				code: 'draft-in-published-locale',
				severity: 'error',
				className: 'publication',
				message:
					'An undetermined rewording must not be published: mark the locale "translating" or finish the review.',
				...context,
			}),
		);
	}
	if (message?.status === 'draft') {
		findings.push(
			finding({
				code: 'draft-not-served',
				severity: 'review',
				className: 'publication',
				message:
					'Draft resource: never served — resolution falls back to the next locale in the chain.',
				...context,
			}),
		);
	}
	if (message?.prose === 'unverified') {
		findings.push(
			finding({
				code: 'prose-unverified',
				severity: state === 'published' ? 'error' : 'review',
				className: 'prose',
				message:
					'Prose quality (register, honorifics, word order) is a human judgement this gate cannot make; no verified review is recorded.',
				...context,
			}),
		);
	}
	if (guarded && message?.prose !== 'verified' && state === 'published') {
		findings.push(
			finding({
				code: 'guarded-copy-unreviewed',
				severity: 'error',
				className: 'prose',
				message:
					'Access-control copy cannot be published without a recorded human review of the translation.',
				...context,
			}),
		);
	}
	return findings;
}

/** Run every check over one parsed contract. */
export function runChecks(contract, { repoRoot = REPO_ROOT } = {}) {
	// `validateContract` already reports a non-array `features` as the
	// `no-features` error; the walk must survive the same shape so the
	// report is emitted instead of a raw TypeError.
	const featureList = Array.isArray(contract?.features) ? contract.features : [];
	const findings = [
		...validateContract(contract, { repoRoot }),
		...featureList.flatMap((feature) => checkFeature(feature)),
	];
	const sorted = sortFindings(findings);
	return {
		findings: sorted,
		summary: {
			total: sorted.length,
			errors: countBy(sorted, 'severity').error ?? 0,
			review: countBy(sorted, 'severity').review ?? 0,
			info: countBy(sorted, 'severity').info ?? 0,
			blockingClasses: countBy(
				sorted.filter((item) => item.severity === 'error'),
				'class',
			),
			features: featureList.length,
			optInPairs: featureList.reduce(
				(total, feature) => total + Object.keys(feature?.locales ?? {}).length,
				0,
			),
		},
	};
}

/**
 * Opt-in matrix: feature x known locale.
 *
 * The whole point of per-feature locale declaration is that coverage
 * is uneven on purpose, so the report has to show the shape of that
 * unevenness rather than only its failures. A `—` cell is a locale the
 * feature never opted into, which is a copy decision and not a gap.
 */
export function renderCoverageMatrix(contract) {
	if (!contract || !Array.isArray(contract.features)) return null;
	const locales = knownLocaleList(contract);
	const head = ['feature', 'owner', ...locales];
	const rows = contract.features.map((feature) => [
		feature?.id ?? '—',
		feature?.owner ?? '—',
		...locales.map((locale) => {
			const declaration = feature?.locales?.[locale];
			if (!declaration) return '—';
			return declaration.state === 'source' ? 'source' : `${declaration.state}`;
		}),
	]);
	return { head, rows };
}

function textCoverageMatrix(contract) {
	const matrix = renderCoverageMatrix(contract);
	if (!matrix) return [];
	return [
		'  locale opt-in (— = not opted in, never a failure):',
		`    ${matrix.head.join(' | ')}`,
		...matrix.rows.map((row) => `    ${row.join(' | ')}`),
	];
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function locationOf(item) {
	return [item.feature, item.locale, item.key].filter(Boolean).join(' › ');
}

const LEGEND = [
	[
		'Mechanical (blocking)',
		'coverage / fallback / preservation / typography / publication — decidable from the contract text alone.',
	],
	[
		'Prose quality (not decidable here)',
		'register, honorifics, word order, cultural adaptation. Recorded as a human claim (`prose: verified`), never inferred.',
	],
	[
		'Opt-in (informational)',
		'A known locale a feature has not opted into is a copy decision, never a failure.',
	],
];

/** Terminal report. Default output; also the text pasted into a PR. */
export function renderText(runs) {
	const lines = [];
	for (const run of runs) {
		lines.push(`copy i18n gate — ${run.label} (${run.path})`);
		lines.push(
			`  features: ${run.summary.features}  opt-in pairs: ${run.summary.optInPairs}  findings: ${run.summary.errors} error / ${run.summary.review} review / ${run.summary.info} info`,
		);
		if (run.findings.length === 0) {
			lines.push(
				'  OK: every declared locale is complete, its fallback chain terminates, and no mechanical rule fired.',
			);
		}
		lines.push(...textCoverageMatrix(run.contract));
		for (const item of run.findings) {
			lines.push(
				`  [${item.severity}] ${item.code} ${item.class}  ${locationOf(item)}  ${item.message}`,
			);
		}
		lines.push('');
	}
	lines.push('Reading the report:');
	for (const [label, description] of LEGEND) lines.push(`  - ${label}: ${description}`);
	return `${lines.join('\n')}\n`;
}

export function renderJson(runs) {
	return `${JSON.stringify({ schemaVersion: SUPPORTED_SCHEMA_VERSION, runs }, null, 2)}\n`;
}

/**
 * Opt-in matrix as HTML. Rendered above the findings so a reviewer can
 * see the shape of the coverage before reading what failed.
 */
function htmlCoverageMatrix(contract) {
	const matrix = renderCoverageMatrix(contract);
	if (!matrix) return '';
	const cells = matrix.rows
		.map(
			(row) =>
				`<tr>${row
					.map((cell, index) => {
						if (index > 1 && cell === '—') return '<td class="off">—</td>';
						if (index > 1 && cell === 'source') return '<td class="on">source</td>';
						return `<td>${escapeHtml(cell)}</td>`;
					})
					.join('')}</tr>`,
		)
		.join('\n');
	return `<table class="matrix">
			<thead><tr>${matrix.head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>
			<tbody>${cells}</tbody>
		</table>`;
}

/**
 * Self-contained HTML report.
 *
 * One file, no external asset, so a CI job can upload it as an
 * artefact and a reviewer can open it without a build step. This is
 * also the surface the Issue's verification screenshot captures.
 */
export function renderHtml(runs) {
	const sections = runs
		.map((run) => {
			const rows = run.findings
				.map(
					(item) => `<tr class="sev-${item.severity}">
						<td><span class="badge ${item.severity}">${item.severity}</span></td>
						<td><code>${escapeHtml(item.code)}</code></td>
						<td class="class">${escapeHtml(item.class)}</td>
						<td class="loc">${escapeHtml(locationOf(item)) || '—'}</td>
						<td>${escapeHtml(item.message)}</td>
					</tr>`,
				)
				.join('\n');
			const matrix = htmlCoverageMatrix(run.contract);
			return `<section>
				<h2>${escapeHtml(run.label)}</h2>
				<p class="path"><code>${escapeHtml(run.path)}</code></p>
				<p class="summary">
					<span class="error">${run.summary.errors} error</span>
					<span class="review">${run.summary.review} review</span>
					<span class="info">${run.summary.info} info</span>
					<span class="plain">${run.summary.features} features · ${run.summary.optInPairs} opt-in pairs</span>
				</p>
				${
					matrix
						? `<p class="matrix-note">Locale opt-in per feature — <code>—</code> is a locale this feature never opted into, which is a copy decision and not a gap.</p>${matrix}`
						: ''
				}
				${
					run.findings.length === 0
						? '<p class="empty">No findings: every declared locale is complete, its fallback chain terminates, and no mechanical rule fired.</p>'
						: `<table>
							<thead><tr><th>severity</th><th>finding</th><th>class</th><th>feature › locale › key</th><th>detail</th></tr></thead>
							<tbody>${rows}</tbody>
						</table>`
				}
			</section>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>UI copy locale gate — missing keys and fallback</title>
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 48px 56px 64px;
		background: #f6f4ef; color: #16150f;
		font: 15px/1.65 ui-sans-serif, system-ui, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
	}
	h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.01em; }
	h2 { font-size: 20px; margin: 0 0 4px; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
	.lede { max-width: 78ch; margin: 0 0 32px; color: #4a473c; }
	section { background: #fffdf8; border: 1px solid #e2ddd1; border-radius: 10px; padding: 24px 28px; margin-bottom: 24px; }
	.path { margin: 0 0 12px; color: #6b6759; }
	.summary { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 18px; }
	.summary span { border-radius: 999px; padding: 3px 12px; font-size: 13px; border: 1px solid transparent; }
	.error { background: #fbe6e1; border-color: #e8b4a6; color: #8c2f18; }
	.review { background: #fdf3dc; border-color: #e4ce9a; color: #6d5312; }
	.info { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	.plain { background: #efede6; border-color: #d9d4c7; color: #4a473c; }
	table { width: 100%; border-collapse: collapse; font-size: 14px; }
	th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ece7db; vertical-align: top; }
	th { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6759; }
	td.loc, td.class { white-space: nowrap; color: #6b6759; }
	tr.sev-error td:first-child { box-shadow: inset 3px 0 0 #c2482a; }
	tr.sev-review td:first-child { box-shadow: inset 3px 0 0 #d0a338; }
	tr.sev-info td:first-child { box-shadow: inset 3px 0 0 #6c8fb0; }
	.empty { margin: 0; color: #4a473c; }
	table.matrix { margin-bottom: 18px; }
	table.matrix td.off { color: #a9a495; text-align: center; }
	table.matrix td.on { background: #eef3e8; color: #3c5a2c; text-align: center; }
	.matrix-note { margin: 0 0 8px; font-size: 13px; color: #6b6759; }
	.legend { background: #fffdf8; border: 1px solid #e2ddd1; border-radius: 10px; padding: 24px 28px; }
	.legend h2 { margin-bottom: 12px; }
	.legend dl { margin: 0; display: grid; grid-template-columns: 260px 1fr; gap: 8px 20px; }
	.legend dt { font-weight: 600; }
	.legend dd { margin: 0; color: #4a473c; }
</style>
</head>
<body>
<h1>UI copy locale gate — untranslated keys and fallback</h1>
<p class="lede">
	Machine report from <code>scripts/check-copy-i18n.mjs</code>. Every finding carries the
	feature it belongs to, the locale it belongs to, and the key it belongs to, so a report
	row can be resolved to one source string. Findings are separated by what can decide them:
	script rules and contract shape decide themselves, prose quality does not.
</p>
${sections}
<div class="legend">
	<h2>How to read this report</h2>
	<dl>
		${LEGEND.map(([label, description]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(description)}</dd>`).join('\n\t\t')}
	</dl>
</div>
</body>
</html>
`;
}

function parseArgs(argv) {
	const options = {
		contracts: [],
		includeFixture: false,
		format: 'text',
		out: null,
		strict: false,
	};
	for (const arg of argv) {
		if (arg === '--include-fixture') options.includeFixture = true;
		else if (arg === '--strict') options.strict = true;
		else if (arg.startsWith('--contract=')) options.contracts.push(arg.slice('--contract='.length));
		else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
		else if (arg.startsWith('--format=')) options.format = arg.slice('--format='.length);
		else throw new Error(`unknown option: ${arg}`);
	}
	return options;
}

function main(argv) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`[check-copy-i18n] ${error.message}\n`);
		return 2;
	}
	if (!['text', 'json', 'html'].includes(options.format)) {
		process.stderr.write(`[check-copy-i18n] unknown --format: ${options.format}\n`);
		return 2;
	}

	const inputs = [
		...options.contracts.map((path) => ({
			path,
			gating: options.strict,
			label: 'custom contract',
		})),
	];
	if (inputs.length === 0) {
		inputs.push({ path: CONTRACT_PATH, gating: true, label: 'repository contract' });
	}
	if (options.includeFixture) {
		inputs.push({ path: FIXTURE_CONTRACT_PATH, gating: false, label: 'fixture (demonstration)' });
	}

	const runs = [];
	for (const input of inputs) {
		let loaded;
		try {
			loaded = loadContract(input.path);
		} catch (error) {
			process.stderr.write(`[check-copy-i18n] ${error.message}\n`);
			return 2;
		}
		const result = runChecks(loaded.contract, { repoRoot: REPO_ROOT });
		runs.push({
			label: input.label,
			path: input.path,
			gating: input.gating,
			contract: loaded.contract,
			findings: result.findings,
			summary: result.summary,
		});
	}

	const rendered =
		options.format === 'json'
			? renderJson(runs)
			: options.format === 'html'
				? renderHtml(runs)
				: renderText(runs);
	if (options.out) {
		writeOutput(options.out, rendered);
	} else {
		process.stdout.write(rendered);
	}

	const failed = runs.some((run) => run.gating && run.summary.errors > 0);
	return failed ? 1 : 0;
}

function writeOutput(path, contents) {
	const absolute = resolve(REPO_ROOT, path);
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, contents);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv.slice(2)));
}
