#!/usr/bin/env node

/**
 * Stale public copy — owner review-date gate (Issue #437).
 *
 * What this gate is
 * -----------------
 * A public sentence that points at *now* decays: the set of published
 * works changes, the channels that are reachable change, the status a
 * page reports changes. This gate makes the **absence of a review**
 * visible for exactly those sentences, and nothing else.
 *
 *   1. It walks the **public copy surfaces** — the same declaration the
 *      editorial approval gate uses (`quality/copy-editorial-surfaces.json`),
 *      so "public copy" has exactly one definition in this repository.
 *   2. It extracts the **Japanese segments** of those files with the
 *      same extraction the editorial approval gate uses, and keeps the
 *      ones that carry a **time token** (`今日` / `現在` / `最新` / `今` …).
 *   3. It matches each selected segment against the **owner registry**
 *      (`quality/stale-content-review.json`), which records, per
 *      expression, **when the owner last read it** and **what kind of
 *      review it was** (`prose` / `typography`).
 *   4. It classifies each one and emits a **review queue** for the
 *      entries that are waiting for a human.
 *
 * The provenance of a record (Issue #720)
 * --------------------------------------
 * A review date in the registry is a **recorded claim** about when the
 * owner read the sentence. `reviewedBy: "owner"` is a claim the
 * registry makes about itself, so the gate does not take it at face
 * value: it reads the record's `provenance` block instead
 *
 * ```jsonc
 * "provenance": {
 *   "kind": "owner-review" | "agent-recorded" | "unverified",
 *   "reference": "<a GitHub review / issue comment URL, or null>",
 *   "recordedBy": "<who wrote this record: 'agent' | a handle>",
 *   "ownerConfirmation": "confirmed" | "unconfirmed"
 * }
 * ```
 *
 * and reports the two populations separately: **owner-confirmed**
 * records (a traceable owner artefact backs the claim) and records
 * **awaiting owner confirmation** (an automated side wrote them — they
 * are evidence that a review was prepared, never that the owner
 * approved it). The gate never presents an unconfirmed record as an
 * owner review, and it never re-dates a record: re-classification is
 * the only thing this gate does to the registry.
 *
 * The limit of what can be proven mechanically: the gate checks the
 * *shape* of a reference, not who wrote the thing it points at. A
 * reference is a claim about a human action; the repository records the
 * claim and cannot independently prove it. See
 * `docs/verification/governance/approval-provenance.md`.
 *
 * The four classifications
 * ------------------------
 *   - `current`      — a record exists and its review date is inside
 *                       the freshness window.
 *   - `stale`        — a record exists and its review date is outside
 *                       the freshness window. The expression is waiting
 *                       to be read again.
 *   - `unrecorded`   — no record covers this expression. Because the
 *                       match is on the **text**, a text edit
 *                       invalidates the old record: the edited sentence
 *                       is `unrecorded` again until the owner re-reads
 *                       it and records a new date.
 *   - `not-scanned`  — the expression's locale is not opted in, so no
 *                       review date is required for it. It is reported,
 *                       never silently dropped.
 *
 * The invariants — the point of the Issue
 * ---------------------------------------
 * 1. **This gate never writes to `src/**` and never changes what is
 *    published.** It only reads. The `--out` path is refused when it
 *    resolves inside `src/`.
 * 2. **This gate never asserts that an expression is untrue.** A
 *    waiting expression is *unreviewed*, not wrong. The report says
 *    "review pending" and never uses a verdict word that declares a
 *    segment to be false.
 * 3. **This gate never rewrites copy.** It proposes no replacement
 *    wording. The only owner inputs are the review date, the reviewer
 *    and the note.
 * 4. **This gate never publishes an unconfirmed rewrite.** There is no
 *    code path here that writes a sentence anywhere.
 * 5. **This gate is fail-closed.** An unreadable registry, a malformed
 *    record, an unparsable date or a review date in the future exits
 *    **2**, never 0.
 * 6. **The output is status-only.** Paths, counts, dates and the
 *    expression text. No credential, no environment dump.
 *
 * What this gate is not
 * ---------------------
 * It is not a proofreading tool and it does not judge prose. The
 * editing aid named by the Issue (yomiyasu or a comparable tool) is an
 * **editing aid** for a human; its output is evidence, never proof of
 * automatic quality assurance, and it adds no runtime to this gate.
 * The prose / typography split and the locale opt-in belong to
 * `docs/domain/i18n.md` §5 and §6; this gate only reports the two
 * dimensions separately and never judges either.
 *
 * Offline, read-only, no secret: the gate reads a tree of text files
 * plus two JSON files. It never contacts a network and never reads a
 * credential.
 *
 * Usage:
 *   node scripts/check-stale-content-review.mjs
 *   node scripts/check-stale-content-review.mjs --format=json
 *   node scripts/check-stale-content-review.mjs --format=html \
 *     --out=.tmp/stale-content-review.html
 *   node scripts/check-stale-content-review.mjs \
 *     --root=test/fixtures/content/stale-review \
 *     --registry=test/fixtures/content/stale-review/registry.json \
 *     --surfaces=test/fixtures/content/stale-review/surfaces.json \
 *     --today=2026-10-22
 *
 * Options:
 *   --registry=<path>   Owner registry (default `quality/stale-content-review.json`).
 *   --surfaces=<path>   Public copy surface declaration (default
 *                        `quality/copy-editorial-surfaces.json` — the same
 *                        declaration the editorial approval gate reads).
 *   --root=<path>       Tree to scan (default the repository root).
 *   --today=YYYY-MM-DD  The current date (default: today, UTC). The
 *                        freshness window is measured against it.
 *   --format=text|json|html   Output format (default `text`).
 *   --out=<path>        Write the report to a file instead of stdout.
 *
 * Exit codes: 0 = nothing is waiting for a review, 1 = the review
 * queue is not empty, 2 = the gate cannot decide (bad input).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	OWNER_CONFIRMATIONS,
	PROVENANCE_KINDS,
	SURFACES_PATH,
	classifyFile,
	evaluateProvenance,
	extractSegments,
	hasJapanese,
	matchesGlob,
	readJson,
	stringLiterals,
} from './check-copy-editorial-approval.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..');

/** The owner registry (the review dates). */
export const REGISTRY_PATH = 'quality/stale-content-review.json';

/**
 * The public copy surface declaration — re-exported from the editorial
 * approval gate, so "public copy" has exactly one definition in this
 * repository.
 */
export { SURFACES_PATH };

/** The committed fixtures (the gate's own test corpus). */
export const FIXTURE_DIR = 'test/fixtures/content/stale-review';

/** The four classifications, in report order. */
export const CLASSIFICATIONS = ['current', 'stale', 'unrecorded', 'not-scanned'];

/** The two review dimensions. `docs/domain/i18n.md` §5 owns the split. */
export const DIMENSIONS = ['prose', 'typography'];

/** The classifications that make up the review queue. */
export const QUEUE_STATUSES = ['stale', 'unrecorded'];

/**
 * The detector's token table — data, not scattered literals.
 *
 * A token is a word that points at *now*. Precision matters more than
 * recall here: a noisy detector makes the registry unreviewable.
 *
 * `blockedBefore` / `blockedAfter` are the boundary guards. They are
 * per token because the compounds differ per token:
 *
 *   - `現在` is not a prefix of any longer Japanese word (現状 and 実在
 *     do not contain it at all), so the guard sits on the **before**
 *     side: 実現在 is 実在 ("actually exists"), not 現在 ("now").
 *   - `最新` fuses with 鋭 into 最新鋭, a fixed evaluative adjective
 *     ("state-of-the-art") rather than a "the most recent X" claim.
 *     `最新号` (the newest edition) IS detected: it names the edition
 *     that is current, and that decays exactly like `現在` does. The
 *     difference is decided here, not left to the corpus.
 *   - `今` fuses with many kanji (今月, 今年, 今朝, 今度), so it is
 *     followed by no ideograph at all; 至今 and 目今 are fixed
 *     adverbials and are blocked on the before side.
 *
 * `今日` and `現時点` are unambiguous and carry no guard.
 *
 * The Latin table exists so that a locale can be **opted in** later
 * without touching the detector: a locale that is not listed in the
 * registry's `locales` is reported as not scanned.
 */
export const LOCALE_TOKENS = [
	{
		locale: 'ja',
		tokens: [
			{ token: '現時点', blockedBefore: [], blockedAfter: [] },
			{ token: '今日', blockedBefore: [], blockedAfter: [] },
			{ token: '現在', blockedBefore: ['状', '実', '現'], blockedAfter: [] },
			{ token: '最新', blockedBefore: [], blockedAfter: ['鋭'] },
			{
				token: '今',
				blockedBefore: ['至', '目'],
				blockedAfter: [],
				// `今` is a prefix of many kanji compounds (今月 / 今年 /
				// 今朝 / 今度), so no ideograph may follow it.
				blockAfterIdeograph: true,
				// 今ひとつ is a fixed phrase, not a time claim.
				blockedAfterKana: ['ひ'],
			},
		],
	},
	{
		locale: 'en',
		tokens: [
			{ token: 'currently', blockedBefore: [], blockedAfter: [] },
			{ token: 'as of', blockedBefore: [], blockedAfter: [] },
			{ token: 'latest', blockedBefore: [], blockedAfter: [] },
			{ token: 'today', blockedBefore: [], blockedAfter: [] },
		],
	},
];

/** File extensions the gate reads. */
export const SCANNABLE_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.json',
]);

/** CJK ideographs (used for the `今` boundary guard). */
const IDEOGRAPH_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;

/** A letter or digit — the Latin token boundary. */
const WORDISH_PATTERN = /[A-Za-z0-9]/;

/** Is this character a CJK ideograph? */
export function isIdeograph(character) {
	return typeof character === 'string' && character.length > 0 && IDEOGRAPH_PATTERN.test(character);
}

/** Does the boundary guard accept this occurrence? */
function boundaryAccepted(text, index, definition) {
	const before = index > 0 ? text[index - 1] : '';
	const after =
		index + definition.token.length < text.length ? text[index + definition.token.length] : '';
	const blockedBefore = definition.blockedBefore ?? [];
	const blockedAfter = definition.blockedAfter ?? [];
	const blockedAfterKana = definition.blockedAfterKana ?? [];
	if (before && blockedBefore.includes(before)) return false;
	if (after && blockedAfter.includes(after)) return false;
	if (definition.blockAfterIdeograph === true && isIdeograph(after)) return false;
	if (after && blockedAfterKana.includes(after)) return false;
	return true;
}

/**
 * The time tokens in one text, in detection order.
 *
 * The scan is longest-token-first and non-overlapping, so `今日` claims
 * the range before `今` can look at it. The locale of the **first**
 * match wins, and the locale table is ordered Japanese-first because
 * the corpus is Japanese: a segment like `現在 / Today` is a Japanese
 * segment.
 */
export function detectTimeTokens(text) {
	if (typeof text !== 'string' || text.length === 0) return [];
	const matches = [];
	const taken = [];
	for (const localeDefinition of LOCALE_TOKENS) {
		for (const definition of localeDefinition.tokens) {
			const token = definition.token;
			const isLatin = /^[\x20-\x7E]+$/.test(token);
			let index = text.toLowerCase().indexOf(token.toLowerCase());
			while (index !== -1) {
				const end = index + token.length;
				const overlaps = taken.some(([start, stop]) => index < stop && end > start);
				const wordOk = isLatin ? latinBoundaryOk(text, index, end) : true;
				if (!overlaps && wordOk && boundaryAccepted(text, index, definition)) {
					matches.push({ token, locale: localeDefinition.locale, index });
					taken.push([index, end]);
				}
				index = text.toLowerCase().indexOf(token.toLowerCase(), index + 1);
			}
		}
	}
	return matches;
}

/** A Latin token must not be glued to another letter or digit. */
function latinBoundaryOk(text, index, end) {
	const before = index > 0 ? text[index - 1] : '';
	const after = end < text.length ? text[end] : '';
	if (before && WORDISH_PATTERN.test(before)) return false;
	if (after && WORDISH_PATTERN.test(after)) return false;
	return true;
}

/**
 * The locale of one segment, or `null` when no time token is in it.
 *
 * The locale is the locale of the first matching token (see
 * `detectTimeTokens`).
 */
export function detectLocale(text) {
	const matches = detectTimeTokens(text);
	if (matches.length === 0) return null;
	return matches[0].locale;
}

/**
 * Directories the scan does not walk.
 *
 * They hold build output, dependencies or caches, never public copy,
 * and walking them would make the gate slower for no gain.
 */
export const SCAN_SKIP_DIRECTORIES = new Set([
	'.git',
	'.output',
	'.reference',
	'.tanstack',
	'.tmp',
	'.vinxi',
	'.wrangler',
	'coverage',
	'dist',
	'dist-cloudflare',
	'node_modules',
	'storybook-static',
	'styled-system',
]);

/** Every file under `root`, as absolute paths. */
export function walkFiles(root) {
	if (!existsSync(root)) return [];
	const out = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (SCAN_SKIP_DIRECTORIES.has(entry.name)) continue;
		const full = join(root, entry.name);
		if (entry.isDirectory()) out.push(...walkFiles(full));
		else if (entry.isFile()) out.push(full);
	}
	return out.sort();
}

/**
 * The segments of one line, with their locale.
 *
 * Japanese segments come from the editorial approval gate's own
 * extraction (`extractSegments`), so "a segment" means the same thing
 * in both copy gates. A segment that carries no Japanese character is
 * invisible to that extraction, so a Latin segment is collected from
 * the line's string literals instead — a Latin **raw** JSX text is not
 * collected, which is a declared limitation.
 */
export function lineSegments(line) {
	const segments = [];
	for (const segment of extractSegments(line)) {
		const locale = detectLocale(segment);
		if (locale) segments.push({ text: segment, locale });
	}
	for (const literal of stringLiterals(line)) {
		if (hasJapanese(literal)) continue;
		const locale = detectLocale(literal);
		if (locale) segments.push({ text: literal.trim(), locale });
	}
	return segments;
}

/**
 * The time-sensitive segments of a tree, with the files that were
 * skipped and the reason.
 */
export function collectSegments(
	root,
	surfaces,
	{ excludedPaths = [], excludedExpressions = [] } = {},
) {
	const absoluteRoot = resolve(root);
	const segments = [];
	const skipped = [];
	for (const file of walkFiles(absoluteRoot)) {
		const extension = file.slice(file.lastIndexOf('.'));
		if (!SCANNABLE_EXTENSIONS.has(extension)) continue;
		const relativePath = relative(absoluteRoot, file).split(sep).join('/');
		const classification = classifyFile(relativePath, surfaces);
		if (!classification.public) continue;
		const excluded = excludedPaths.find((entry) => matchesGlob(entry.glob, relativePath));
		if (excluded) {
			// A public copy surface the registry takes out of scope. The
			// reason is reported, so the exclusion is visible rather than
			// a silent omission.
			skipped.push({
				path: relativePath,
				reason: `excluded by "${excluded.glob}" (${excluded.reason})`,
			});
			continue;
		}
		let text;
		try {
			text = readFileSync(file, 'utf8');
		} catch {
			skipped.push({ path: relativePath, reason: 'unreadable file' });
			continue;
		}
		const lines = text.split('\n');
		for (const [index, line] of lines.entries()) {
			for (const segment of lineSegments(line)) {
				const excluded = excludedExpressions.find(
					(entry) => entry.path === relativePath && entry.expression === segment.text,
				);
				if (excluded) {
					// A runtime message inside a public copy surface. The
					// exclusion names it, so it is a stated rule and not
					// an accident.
					skipped.push({
						path: `${relativePath}:${index + 1}`,
						reason: `excluded expression (${excluded.reason})`,
					});
					continue;
				}
				segments.push({
					path: relativePath,
					line: index + 1,
					text: segment.text,
					locale: segment.locale,
				});
			}
		}
	}
	return { segments, skipped };
}

/** Whole days between two ISO dates (`to` minus `from`). */
export function daysBetween(fromIso, toIso) {
	const from = Date.parse(`${fromIso}T00:00:00Z`);
	const to = Date.parse(`${toIso}T00:00:00Z`);
	if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;
	return Math.round((to - from) / 86_400_000);
}

/** Is this an ISO calendar date (`YYYY-MM-DD`)? */
export function isIsoDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = Date.parse(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed)) return false;
	return new Date(parsed).toISOString().slice(0, 10) === value;
}

/**
 * Validate the owner registry. Fail-closed: every problem is reported
 * and the caller exits 2.
 */
export function validateRegistry(registry, { today }) {
	const problems = [];
	if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
		return { problems: ['the registry is not a JSON object'] };
	}
	if (registry.version !== 1) {
		problems.push(`version must be 1 (found ${JSON.stringify(registry.version)})`);
	}
	if (
		typeof registry.freshnessWindowDays !== 'number' ||
		!Number.isInteger(registry.freshnessWindowDays) ||
		registry.freshnessWindowDays <= 0
	) {
		problems.push('freshnessWindowDays must be a positive integer');
	}
	if (!Array.isArray(registry.locales) || registry.locales.length === 0) {
		problems.push('locales must be a non-empty array (the opt-in list)');
	} else {
		for (const locale of registry.locales) {
			if (typeof locale !== 'string' || locale.length === 0) {
				problems.push('every entry of locales must be a non-empty string');
			}
		}
		if (new Set(registry.locales).size !== registry.locales.length) {
			problems.push('locales must not repeat a locale');
		}
	}
	const excludedPaths = registry.excludedPaths ?? [];
	if (!Array.isArray(excludedPaths)) {
		problems.push('excludedPaths must be an array');
	} else {
		for (const entry of excludedPaths) {
			if (!entry || typeof entry.glob !== 'string' || typeof entry.reason !== 'string') {
				problems.push('every entry of excludedPaths needs a glob and a reason');
			}
		}
	}
	const excludedExpressions = registry.excludedExpressions ?? [];
	if (!Array.isArray(excludedExpressions)) {
		problems.push('excludedExpressions must be an array');
	} else {
		for (const entry of excludedExpressions) {
			if (
				!entry ||
				typeof entry.path !== 'string' ||
				typeof entry.expression !== 'string' ||
				typeof entry.reason !== 'string'
			) {
				problems.push(
					'every entry of excludedExpressions needs a path, an expression and a reason',
				);
			}
		}
	}
	const expressions = registry.expressions ?? [];
	if (!Array.isArray(expressions)) {
		problems.push('expressions must be an array');
	} else {
		const ids = new Set();
		const keys = new Set();
		for (const record of expressions) {
			const label = record && typeof record.id === 'string' ? record.id : '(no id)';
			if (!record || typeof record !== 'object') {
				problems.push(`record ${label} is not an object`);
				continue;
			}
			for (const field of ['id', 'path', 'expression', 'locale', 'reviewedBy', 'note']) {
				if (typeof record[field] !== 'string' || record[field].length === 0) {
					problems.push(`record ${label}: ${field} must be a non-empty string`);
				}
			}
			if (typeof record.id === 'string') {
				if (ids.has(record.id)) problems.push(`record ${label}: the id is used twice`);
				ids.add(record.id);
			}
			if (typeof record.expression === 'string' && record.expression.length > 0) {
				const key = `${record.path} ${record.expression}`;
				if (keys.has(key)) {
					problems.push(`record ${label}: the same path and expression is recorded twice`);
				}
				keys.add(key);
			}
			if (!DIMENSIONS.includes(record.dimension)) {
				problems.push(
					`record ${label}: dimension must be one of ${DIMENSIONS.join(' / ')} (found ${JSON.stringify(record.dimension)})`,
				);
			}
			if (!isIsoDate(record.reviewedAt)) {
				problems.push(`record ${label}: reviewedAt must be an ISO date (YYYY-MM-DD)`);
			} else if (isIsoDate(today) && daysBetween(record.reviewedAt, today) < 0) {
				problems.push(
					`record ${label}: reviewedAt (${record.reviewedAt}) is later than today (${today})`,
				);
			}
			// The provenance block (Issue #720) is optional in the sense
			// that a record without one is *reported* as awaiting owner
			// confirmation — but a malformed one is a malformed record,
			// and this gate fails closed on malformed records.
			if (record.provenance !== undefined && record.provenance !== null) {
				const provenance = record.provenance;
				if (typeof provenance !== 'object' || Array.isArray(provenance)) {
					problems.push(`record ${label}: provenance must be an object`);
				} else {
					if (!PROVENANCE_KINDS.includes(provenance.kind)) {
						problems.push(
							`record ${label}: provenance.kind must be one of ${PROVENANCE_KINDS.join(' / ')} (found ${JSON.stringify(provenance.kind)})`,
						);
					}
					if (!OWNER_CONFIRMATIONS.includes(provenance.ownerConfirmation)) {
						problems.push(
							`record ${label}: provenance.ownerConfirmation must be one of ${OWNER_CONFIRMATIONS.join(' / ')} (found ${JSON.stringify(provenance.ownerConfirmation)})`,
						);
					}
					if (typeof provenance.reference !== 'string' && provenance.reference !== null) {
						problems.push(`record ${label}: provenance.reference must be a string or null`);
					}
					if (typeof provenance.recordedBy !== 'string' || provenance.recordedBy.length === 0) {
						problems.push(`record ${label}: provenance.recordedBy must be a non-empty string`);
					}
				}
			}
		}
	}
	return { problems };
}

/**
 * Classify every scanned segment against the registry.
 *
 * The match key is the **text**: `path` + `expression`. A record
 * therefore stops matching the moment the sentence is edited, and the
 * edited sentence is `unrecorded` again.
 */
export function evaluateRegistry({ segments, registry, today }) {
	const expressions = Array.isArray(registry?.expressions) ? registry.expressions : [];
	const optedIn = new Set(Array.isArray(registry?.locales) ? registry.locales : []);
	const window = registry?.freshnessWindowDays ?? 0;
	const records = new Map();
	for (const record of expressions) {
		records.set(`${record.path} ${record.expression}`, record);
	}

	const entries = [];
	const matchedRecords = new Set();
	for (const segment of segments) {
		const key = `${segment.path} ${segment.text}`;
		const record = records.get(key) ?? null;
		let status;
		let daysSince = null;
		if (record) {
			// A record that matches a text is not an orphan, even when the
			// text's locale is not opted in: the record is simply not
			// required for that locale.
			matchedRecords.add(key);
		}
		if (!optedIn.has(segment.locale)) {
			status = 'not-scanned';
		} else if (!record) {
			status = 'unrecorded';
		} else {
			daysSince = daysBetween(record.reviewedAt, today);
			status = daysSince <= window ? 'current' : 'stale';
		}
		entries.push({ ...segment, status, record, daysSince });
	}

	const orphanRecords = expressions.filter(
		(record) => !matchedRecords.has(`${record.path} ${record.expression}`),
	);

	// The provenance summary (Issue #720). A record whose provenance
	// cannot be traced is not presented as an owner review: the date it
	// carries is a recorded claim, and the report says so.
	let ownerConfirmed = 0;
	let awaitingConfirmation = 0;
	let missingProvenance = 0;
	for (const record of expressions) {
		const provenance = evaluateProvenance(record);
		if (!provenance.present) missingProvenance += 1;
		if (provenance.ownerConfirmed) ownerConfirmed += 1;
		else awaitingConfirmation += 1;
	}

	const counts = { current: 0, stale: 0, unrecorded: 0, 'not-scanned': 0 };
	for (const entry of entries) counts[entry.status] += 1;

	const queue = entries.filter((entry) => QUEUE_STATUSES.includes(entry.status));

	const notScannedLocales = [
		...new Set(entries.filter((e) => e.status === 'not-scanned').map((e) => e.locale)),
	];

	return {
		today,
		freshnessWindowDays: window,
		locales: [...optedIn],
		notScannedLocales,
		entries,
		queue,
		orphanRecords,
		counts,
		provenanceSummary: {
			records: expressions.length,
			ownerConfirmed,
			awaitingConfirmation,
			missingProvenance,
		},
	};
}

/**
 * The human wording of one record's provenance (Issue #720).
 *
 * `reviewedBy: "owner"` in the registry is a **claim** the registry
 * makes about itself. The provenance block is what the gate reads, and
 * an unconfirmed provenance is reported as such — the report never
 * presents the record as an owner review.
 */
export function provenanceState(record) {
	const provenance = evaluateProvenance(record);
	if (!provenance.present) {
		return {
			ownerConfirmed: false,
			label: 'no provenance recorded — awaiting owner confirmation',
		};
	}
	if (provenance.ownerConfirmed) {
		return { ownerConfirmed: true, label: 'owner-confirmed' };
	}
	return {
		ownerConfirmed: false,
		label: `awaiting owner confirmation (kind=${provenance.kind}, recordedBy=${provenance.recordedBy ?? '—'}, reference=${provenance.reference ?? 'none'})`,
	};
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** The report's wording for one classification. */
const STATUS_LABEL = {
	current: 'current',
	stale: 'review pending (the review date is outside the window)',
	unrecorded: 'review pending (no owner record covers this expression)',
	'not-scanned': 'not scanned (the locale is not opted in)',
};

/** Terminal report. Default output; also the text pasted into a PR. */
export function renderText(result) {
	const lines = [];
	lines.push('stale public copy — owner review-date gate (Issue #437)');
	lines.push(`  today: ${result.today}   freshness window: ${result.freshnessWindowDays} day(s)`);
	lines.push(`  opted-in locales: ${result.locales.join(', ')}`);
	if (result.notScannedLocales.length > 0) {
		lines.push(
			`  locales not opted in (reported, not reviewed): ${result.notScannedLocales.join(', ')}`,
		);
	}
	lines.push(
		`  time-sensitive expressions: ${result.entries.length}  (current ${result.counts.current}, review pending ${result.counts.stale + result.counts.unrecorded}, not scanned ${result.counts['not-scanned']})`,
	);
	if (result.provenanceSummary) {
		lines.push(
			`  review records: ${result.provenanceSummary.records}  (owner-confirmed ${result.provenanceSummary.ownerConfirmed}, awaiting owner confirmation ${result.provenanceSummary.awaitingConfirmation})`,
		);
	}
	lines.push('');
	if (result.queue.length === 0) {
		lines.push(
			'  review queue: empty — every scanned expression carries a record inside the window.',
		);
	} else {
		lines.push(`  review queue (${result.queue.length}):`);
		for (const entry of result.queue) {
			const age =
				entry.daysSince === null
					? 'no record'
					: `last reviewed ${entry.record.reviewedAt} (${entry.daysSince} day(s) ago)`;
			lines.push(`  [${entry.status}] ${entry.path}:${entry.line}`);
			lines.push(`      expression: ${entry.text}`);
			lines.push(`      ${age} · dimension: ${entry.record ? entry.record.dimension : '—'}`);
			if (entry.record) {
				lines.push(`      owner confirmation: ${provenanceState(entry.record).label}`);
			}
		}
	}
	if (result.orphanRecords.length > 0) {
		lines.push('');
		lines.push(`  records without a matching expression (${result.orphanRecords.length}):`);
		for (const record of result.orphanRecords) {
			lines.push(`  [orphan] ${record.path}  ${record.expression}`);
			lines.push(
				'      the sentence was edited or removed — the record no longer matches any text',
			);
		}
	}
	lines.push('');
	lines.push('Reading the report:');
	lines.push(
		'  - current       a record exists and its review date is inside the freshness window.',
	);
	lines.push('  - review pending the expression waits for the owner to read it again.');
	lines.push('  - not scanned   the locale is not opted in, so no review date is required for it.');
	lines.push('');
	lines.push('What the owner confirmation line means:');
	lines.push(
		'  - a review date in the registry is a RECORDED CLAIM about when the owner read the sentence.',
	);
	lines.push('  - "owner-confirmed" means a traceable owner artefact backs that claim.');
	lines.push(
		'  - "awaiting owner confirmation" means the record was written by an automated side: it is evidence',
	);
	lines.push('    that a review was prepared, never that the owner approved it (Issue #720).');
	lines.push('');
	lines.push('What this gate does not do:');
	lines.push('  - it does not decide whether a sentence is correct;');
	lines.push('  - it does not remove a sentence from the publication;');
	lines.push('  - it does not propose a replacement wording;');
	lines.push('  - it does not publish anything.');
	lines.push('  A review-pending expression is a request for a human to read it.');
	return `${lines.join('\n')}\n`;
}

/** Machine-readable report. */
export function renderJson(result) {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			issue: '#437',
			today: result.today,
			freshnessWindowDays: result.freshnessWindowDays,
			locales: result.locales,
			notScannedLocales: result.notScannedLocales,
			counts: result.counts,
			provenanceSummary: result.provenanceSummary ?? null,
			entries: result.entries.map((entry) => ({
				path: entry.path,
				line: entry.line,
				text: entry.text,
				locale: entry.locale,
				status: entry.status,
				dimension: entry.record ? entry.record.dimension : null,
				reviewedAt: entry.record ? entry.record.reviewedAt : null,
				daysSince: entry.daysSince,
				recordId: entry.record ? entry.record.id : null,
				ownerConfirmation: entry.record ? provenanceState(entry.record).label : null,
			})),
			queue: result.queue.map((entry) => ({
				path: entry.path,
				line: entry.line,
				text: entry.text,
				status: entry.status,
			})),
			orphanRecords: result.orphanRecords.map((record) => ({
				id: record.id,
				path: record.path,
				expression: record.expression,
			})),
		},
		null,
		2,
	)}\n`;
}

/**
 * Self-contained HTML report — the surface the verification artefact
 * captures.
 */
export function renderHtml(result, { sourceSha = null, skipped = [] } = {}) {
	const entryRows = result.entries
		.map(
			(entry) => `<tr class="status-${escapeHtml(entry.status)}">
			<td><code>${escapeHtml(entry.path)}</code>:${entry.line}</td>
			<td>${escapeHtml(entry.locale)}</td>
			<td class="text">${escapeHtml(entry.text)}</td>
			<td><span class="badge ${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span></td>
			<td>${escapeHtml(entry.record ? entry.record.dimension : '—')}</td>
			<td>${escapeHtml(entry.record ? entry.record.reviewedAt : '—')}</td>
			<td>${entry.daysSince === null ? '—' : `${entry.daysSince} d`}</td>
		</tr>`,
		)
		.join('\n');

	const queueRows = result.queue.length
		? result.queue
				.map(
					(entry) => `<tr>
			<td><span class="badge ${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span></td>
			<td><code>${escapeHtml(entry.path)}</code>:${entry.line}</td>
			<td class="text">${escapeHtml(entry.text)}</td>
			<td>${escapeHtml(entry.record ? entry.record.dimension : '—')}</td>
			<td>${escapeHtml(entry.record ? entry.record.reviewedAt : '—')}</td>
			<td>${escapeHtml(entry.record ? entry.record.note : '—')}</td>
		</tr>`,
				)
				.join('\n')
		: '<tr><td colspan="6">The review queue is empty: every scanned expression carries a record inside the window.</td></tr>';

	const orphanRows = result.orphanRecords.length
		? result.orphanRecords
				.map(
					(record) => `<tr>
			<td><code>${escapeHtml(record.path)}</code></td>
			<td class="text">${escapeHtml(record.expression)}</td>
			<td>${escapeHtml(record.reviewedAt)}</td>
			<td>The sentence was edited or removed, so the record matches no text any more.</td>
		</tr>`,
				)
				.join('\n')
		: '<tr><td colspan="4">No record is left without a matching expression.</td></tr>';

	const skippedRows = skipped
		.map(
			(file) =>
				`<tr class="off"><td><code>${escapeHtml(file.path)}</code></td><td>${escapeHtml(file.reason)}</td></tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Stale public copy — owner review-date gate</title>
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 28px 36px 36px;
		background: #f6f4ef; color: #16150f;
		font: 14px/1.55 ui-sans-serif, system-ui, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
	}
	h1 { font-size: 26px; line-height: 1.2; margin: 0 0 6px; letter-spacing: -0.01em; }
	h2 { font-size: 17px; margin: 0 0 8px; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
	.lede { max-width: 84ch; margin: 0 0 18px; color: #4a473c; }
	section { background: #fffdf8; border: 1px solid #e2ddd1; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
	table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
	th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #ece7db; vertical-align: top; }
	th { font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6759; }
	td.text { white-space: pre-wrap; }
	.meta { color: #6b6759; font-size: 13.5px; margin: 0 0 16px; }
	.badge { display: inline-block; border-radius: 999px; padding: 2px 11px; font-size: 12px; font-weight: 600; border: 1px solid transparent; }
	.current { background: #e6f0e2; border-color: #a9c69c; color: #2f5a24; }
	.stale, .unrecorded { background: #fdf3dc; border-color: #e4ce9a; color: #6d5312; }
	.not-scanned { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	tr.off td { color: #6b6759; }
	dl.legend { margin: 0; display: grid; grid-template-columns: 190px 1fr; gap: 7px 20px; }
	dl.legend dt { font-weight: 600; }
	dl.legend dd { margin: 0; color: #4a473c; }
	ul.scope { margin: 0; padding-left: 20px; color: #4a473c; }
	.counts { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 16px; }
	.counts div { border: 1px solid #e2ddd1; border-radius: 8px; padding: 8px 14px; background: #fffdf8; }
	.counts b { display: block; font-size: 20px; }
	.counts span { color: #6b6759; font-size: 12px; }
	@media (max-width: 760px) {
		body { padding: 20px 18px 24px; font-size: 13px; }
		table { font-size: 11.5px; }
		th, td { padding: 4px 5px; }
		/* The narrow view keeps the columns a reader needs to read a
		   row; the rest of the table is reachable by scrolling. */
		th:nth-child(5), td:nth-child(5), th:nth-child(6), td:nth-child(6), th:nth-child(7), td:nth-child(7) { display: none; }
	}
</style>
</head>
<body>
<h1>Stale public copy — owner review-date gate</h1>
<p class="lede">
	Issue #437. A public sentence that points at <em>now</em> decays. This gate matches the
	time-sensitive expressions of the declared public copy surfaces against an owner registry that
	records, per expression, <strong>when the owner last read it</strong>. It reports what waits for
	a human; it never judges a sentence, never removes one from the publication and never proposes a
	replacement wording.
</p>
<section>
	<h2>Summary</h2>
	<div class="counts">
		<div><b>${result.entries.length}</b><span>time-sensitive expressions</span></div>
		<div><b>${result.counts.current}</b><span>current</span></div>
		<div><b>${result.counts.stale + result.counts.unrecorded}</b><span>review pending</span></div>
	<div><b>${result.counts['not-scanned']}</b><span>not scanned</span></div>
		${
			result.provenanceSummary
				? `<div><b>${result.provenanceSummary.ownerConfirmed}</b><span>owner-confirmed review records</span></div>
		<div><b>${result.provenanceSummary.awaitingConfirmation}</b><span>awaiting owner confirmation</span></div>`
				: ''
		}
	</div>
	<p class="meta">
		today <code>${escapeHtml(result.today)}</code> · freshness window
		<code>${escapeHtml(result.freshnessWindowDays)}</code> day(s) · opted-in locales
		<code>${escapeHtml(result.locales.join(', '))}</code>${
			result.notScannedLocales.length > 0
				? ` · locales not opted in <code>${escapeHtml(result.notScannedLocales.join(', '))}</code>`
				: ''
		}${sourceSha ? ` · source <code>${escapeHtml(sourceSha)}</code>` : ''}
	</p>
</section>
<section>
	<h2>Review queue</h2>
	<table>
		<thead><tr><th>status</th><th>file</th><th>expression</th><th>dimension</th><th>reviewed at</th><th>note</th></tr></thead>
		<tbody>${queueRows}</tbody>
	</table>
</section>
<section>
	<h2>Every classified expression</h2>
	<table>
		<thead><tr><th>file</th><th>locale</th><th>expression</th><th>status</th><th>dimension</th><th>reviewed at</th><th>age</th></tr></thead>
		<tbody>${entryRows}</tbody>
	</table>
</section>
<section>
	<h2>Records without a matching expression</h2>
	<table>
		<thead><tr><th>file</th><th>expression</th><th>reviewed at</th><th>note</th></tr></thead>
		<tbody>${orphanRows}</tbody>
	</table>
</section>
<section>
	<h2>How to read this report</h2>
	<dl class="legend">
	<dt>current</dt><dd>a record exists and its review date is inside the freshness window. The date is a recorded claim about when the owner read the sentence; the provenance counts above say whether an owner artefact backs it (Issue #720).</dd>
		<dt>review pending</dt><dd>the expression waits for the owner to read it again: either the recorded date has passed the window, or no record covers the text.</dd>
		<dt>not scanned</dt><dd>the locale is not opted in, so no review date is required for it. It is reported, never silently dropped.</dd>
	</dl>
</section>
<section>
	<h2>What this gate does not do</h2>
	<ul class="scope">
		<li>It does not decide whether a sentence is correct, and it never declares an expression to be untrue.</li>
		<li>It does not remove a sentence from the publication — that is an owner decision.</li>
		<li>It does not propose a replacement wording; the only owner inputs are the review date, the reviewer and the note.</li>
		<li>It does not publish anything, and it never writes into <code>src/**</code>.</li>
		<li>It is not a proofreading tool. An editing aid (yomiyasu or a comparable tool) is an editing aid, never proof of automatic quality assurance, and it adds no runtime here.</li>
		<li>It does not judge prose or typography. The two dimensions are reported separately and neither is judged — see <code>docs/domain/i18n.md</code> §5.</li>
	</ul>
</section>
<section>
	<h2>Files that were out of scope</h2>
	<table>
		<thead><tr><th>file</th><th>reason</th></tr></thead>
		<tbody>${skippedRows || '<tr><td colspan="2">No file was skipped.</td></tr>'}</tbody>
	</table>
</section>
</body>
</html>
`;
}

/** Today's date, in UTC. */
export function todayIso(now = new Date()) {
	return now.toISOString().slice(0, 10);
}

function parseArgs(argv) {
	const options = {
		registry: REGISTRY_PATH,
		surfaces: SURFACES_PATH,
		root: REPO_ROOT,
		today: null,
		format: 'text',
		out: null,
	};
	for (const arg of argv) {
		if (arg === '--') continue;
		if (arg.startsWith('--registry=')) options.registry = arg.slice('--registry='.length);
		else if (arg.startsWith('--surfaces=')) options.surfaces = arg.slice('--surfaces='.length);
		else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
		else if (arg.startsWith('--today=')) options.today = arg.slice('--today='.length);
		else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
		else if (arg.startsWith('--format=')) options.format = arg.slice('--format='.length);
		else throw new Error(`unknown option: ${arg}`);
	}
	return options;
}

/** Is this path inside the repository's `src/`? */
export function isInsideSourceTree(path) {
	const absolute = resolve(path);
	const sourceRoot = resolve(REPO_ROOT, 'src');
	return absolute === sourceRoot || absolute.startsWith(`${sourceRoot}${sep}`);
}

export function main(argv, { env = process.env } = {}) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`[check-stale-content-review] ${error.message}\n`);
		return 2;
	}
	if (!['text', 'json', 'html'].includes(options.format)) {
		process.stderr.write(`[check-stale-content-review] unknown --format: ${options.format}\n`);
		return 2;
	}
	const today = options.today ?? env.STALE_REVIEW_TODAY ?? todayIso();
	if (!isIsoDate(today)) {
		process.stderr.write(
			`[check-stale-content-review] --today must be an ISO date (YYYY-MM-DD), found ${today}\n`,
		);
		return 2;
	}
	if (options.out && isInsideSourceTree(options.out)) {
		process.stderr.write(
			'[check-stale-content-review] refusing to write inside src/: this gate only reads the tree.\n',
		);
		return 2;
	}

	let surfaces;
	let registry;
	try {
		surfaces = readJson(options.surfaces, 'public copy surface declaration');
		registry = readJson(options.registry, 'owner review registry');
	} catch (error) {
		process.stderr.write(`[check-stale-content-review] ${error.message}\n`);
		return 2;
	}

	const { problems } = validateRegistry(registry, { today });
	if (problems.length > 0) {
		process.stderr.write(
			`[check-stale-content-review] the owner registry cannot be read (${problems.length} problem(s)):\n`,
		);
		for (const problem of problems) {
			process.stderr.write(`  - ${problem}\n`);
		}
		return 2;
	}

	const { segments, skipped } = collectSegments(options.root, surfaces, {
		excludedPaths: registry.excludedPaths ?? [],
		excludedExpressions: registry.excludedExpressions ?? [],
	});
	const result = evaluateRegistry({ segments, registry, today });

	const rendered =
		options.format === 'json'
			? renderJson(result)
			: options.format === 'html'
				? renderHtml(result, { skipped })
				: renderText(result);
	if (options.out) {
		const absolute = resolve(REPO_ROOT, options.out);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, rendered);
	} else {
		process.stdout.write(rendered);
	}

	return result.queue.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv.slice(2)));
}
