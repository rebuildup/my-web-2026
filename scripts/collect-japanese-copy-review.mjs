#!/usr/bin/env node

/**
 * Japanese copy — review-target collector (Issue #425).
 *
 * What this report is
 * -------------------
 * A pull request that changes Japanese text a visitor can read changes
 * prose. Nobody can prove from the diff that the new sentence means
 * what the author intended, so this script does not try. It collects the
 * changed text and prints it beside its original, under three explicit
 * scopes:
 *
 *   - `article` — committed article Markdown (the Portfolio Markdown
 *     bodies in `src/portfolio/seed.ts`, and article files under the
 *     declared Markdown roots),
 *   - `about`   — the `/about` narrative prose,
 *   - `ui`      — the public UI copy the Issue #506 surface declaration
 *     already names.
 *
 * The output is a **review-target list**: every changed segment, its
 * original, and the semantic markers that changed (numbers, negation,
 * permission). It never rewrites a sentence, never publishes a draft and
 * never records an approval.
 *
 * What this report is not
 * -----------------------
 * It is **informational about un-reviewed prose**. A non-empty list is
 * the normal state of a pull request that edits Japanese; it is not a
 * failure. The blocking decision lives in Issue #506's approval gate
 * (`scripts/check-copy-editorial-approval.mjs`), which asks whether a
 * public copy change carries an owner approval record. This script does
 * not read the approval ledger and cannot pass or fail a change on its
 * behalf.
 *
 * Three distinctions are kept explicit because the Issue asks for them:
 *
 *   - **prose quality vs typography** — this report lists prose for a
 *     human. Typography (line-start / line-end prohibitions, full-width
 *     residue, spacing) is a mechanical rule set owned by
 *     `scripts/check-copy-i18n.mjs` (Issue #428). A typography finding
 *     is not a prose review target, and this report never grades prose.
 *   - **meaning markers vs wording** — a number, negation or permission
 *     marker that appears on one side and not the other is surfaced as
 *     `number-drift` / `negation-drift` / `permission-drift`. The
 *     detector is a marker heuristic (it errs toward reporting); the
 *     human decides.
 *   - **locale opt-in vs this report** — which capability publishes which
 *     locale stays `copy/resources.json`'s decision (Issue #428). This
 *     script does not read or alter it, and it applies to Japanese text
 *     only.
 *
 * What is excluded
 * ----------------
 * Code identifiers and secret-shaped values are not review targets:
 *
 *   - a TS/TSX segment comes from a string literal (or a JSX text node
 *     with its tags stripped); a comment, an import/declaration line and
 *     a template interpolation expression are not prose;
 *   - a Markdown line inside a fenced or indented code block, an inline
 *     code span, a link destination, a raw HTML tag or an HTML comment is
 *     not prose;
 *   - a changed line that matches a credential shape is **withheld** from
 *     the report. Only the path, line number and detector id are printed,
 *     never the value (AGENTS.md §4). The static secret scan is the
 *     authority for the credential itself; this report just refuses to
 *     copy it into a CI log.
 *
 * Exit codes
 * ----------
 *   0 = the report was produced. `clear`, `review` and `attention` all
 *       exit 0: un-reviewed prose is not a gate failure.
 *   1 = `--strict` and at least one `attention` finding (the explicit
 *       local / interactive escalation; CI does not pass `--strict`).
 *   2 = bad input (no base ref, unreadable declaration, unknown option).
 *       A report must not describe a change set it cannot compute.
 *
 * Usage:
 *   node scripts/collect-japanese-copy-review.mjs --base=release-0-7-0
 *   node scripts/collect-japanese-copy-review.mjs --base=release-0-7-0 \
 *     --format=html --out=.tmp/japanese-copy-review-report.html
 *   node scripts/collect-japanese-copy-review.mjs --base=release-0-7-0 --strict
 *
 * The base ref resolves as `--base`, then `COPY_REVIEW_BASE`, then
 * `GITHUB_BASE_REF` (read as `origin/<ref>`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
	REPO_ROOT,
	classifyFile,
	describeDiffBase,
	gitDiff,
	gitShowFile,
	hasJapanese,
	isCommentLine,
	matchesGlob,
	pairEditSegments,
	parseDiff,
	readJson,
	resolveBaseRef,
	resolveDiffBase,
	stringLiterals,
} from './_copy-japanese-diff.mjs';
import { DETECTORS, looksLikeCredentialValue } from './_secret-scan.mjs';
import { NEGATION_MARKERS, PERMISSION_MARKERS } from './check-copy-i18n.mjs';

/** The review-target declaration (scopes and their opt-in globs). */
export const DECLARATION_PATH = 'quality/japanese-copy-review-surfaces.json';

/** The committed fixtures (the collector's own test corpus). */
export const FIXTURE_DIR = 'test/fixtures/copy/japanese-diff-review';

/** Report statuses, in report order. */
export const STATUSES = ['clear', 'review', 'attention'];

/**
 * The one fixture whose credential shape is built at run time.
 *
 * A committed fixture would have to contain a token-shaped string, and
 * the repository's own static secret scan would (correctly) refuse it.
 * Constructing the value here keeps the shape out of the tracked source:
 * the scanner never sees a literal, while the collector's redaction path
 * is still exercised by a real detector.
 */
export function syntheticSecretFixture() {
	const token = `ghp_${'A'.repeat(36)}`;
	const beforeToken = 'B'.repeat(36);
	return {
		name: 'secret-redaction (runtime)',
		status: 'attention',
		note: 'a credential-shaped line is withheld; only path, line and detector id are printed.',
		diff: [
			'diff --git a/src/home/config.ts b/src/home/config.ts',
			'--- a/src/home/config.ts',
			'+++ b/src/home/config.ts',
			'@@ -8 +8 @@',
			`-const token = '${beforeToken}';`,
			`+const token = '${token}';`,
		],
		sourceTexts: {},
	};
}

/** The scopes the report distinguishes, in report order. */
export const SCOPES = ['article', 'about', 'ui'];

/** Human labels for the scopes. */
export const SCOPE_LABELS = {
	article: 'Article Markdown',
	about: 'About prose',
	ui: 'Public UI copy',
};

/**
 * Semantic-risk flags. `drift` flags compare the original with the new
 * text; `claim` flags mark a one-sided addition or removal whose claim
 * (a number, a negation, a permission) has no original beside it.
 */
export const RISK_FLAGS = [
	'number-drift',
	'negation-drift',
	'permission-drift',
	'claim-added',
	'claim-removed',
];

/** Risk flags that mean the original and the new text disagree. */
export const DRIFT_FLAGS = ['number-drift', 'negation-drift', 'permission-drift'];

/** Japanese negation markers, shared with the Issue #428 copy gate. */
export const NEGATION = NEGATION_MARKERS.ja;

/** Japanese permission / authority markers, shared with Issue #428. */
export const PERMISSION = PERMISSION_MARKERS.ja;

/** A fenced code block opener (` ``` ` or `~~~`), any indent. */
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

/** A line indented four spaces or one tab is Markdown code. */
const INDENTED_CODE = /^( {4}|\t)/;

/**
 * Which lines of a Markdown document are prose?
 *
 * Returns one boolean per line: `true` = a line a visitor reads,
 * `false` = a fenced code block, an indented code block, or a line
 * inside a multi-line HTML comment. The diff only carries changed
 * lines, so the full file content is needed to know whether a changed
 * line sits inside a fence opened many lines earlier.
 *
 * This is a line scanner, not a CommonMark parser. It is deliberately
 * conservative: an ambiguous line is treated as non-prose, so a code
 * identifier is missed rather than reported as visitor copy.
 */
export function markdownProseMask(text) {
	if (typeof text !== 'string') return null;
	const mask = [];
	let fence = null;
	let inComment = false;
	for (const line of text.split('\n')) {
		if (fence) {
			mask.push(false);
			if (line.trim().startsWith(fence)) fence = null;
			continue;
		}
		const opener = FENCE_OPEN.exec(line);
		if (opener) {
			fence = opener[1][0].repeat(3);
			mask.push(false);
			continue;
		}
		if (inComment) {
			mask.push(false);
			if (line.includes('-->')) inComment = false;
			continue;
		}
		const commentStart = line.indexOf('<!--');
		if (commentStart !== -1 && !line.includes('-->', commentStart)) {
			inComment = true;
			mask.push(false);
			continue;
		}
		if (line.trim().length > 0 && INDENTED_CODE.test(line)) {
			mask.push(false);
			continue;
		}
		mask.push(true);
	}
	return mask;
}

/**
 * The prose segments of one changed Markdown line.
 *
 * Markup is stripped in the order a reader experiences it: code spans
 * and fences are code, link destinations are not prose, raw HTML is not
 * prose (the Portfolio renderer escapes it), and heading / list /
 * blockquote / emphasis markers are presentation. What remains is the
 * text a reader sees.
 */
export function markdownSegments(line, { inCode = false } = {}) {
	if (inCode) return [];
	if (isCommentLine(line)) return [];
	if (FENCE_OPEN.test(line)) return [];
	if (line.trim().length > 0 && INDENTED_CODE.test(line)) return [];
	let text = line;
	text = text.replace(/<!--[\s\S]*?-->/g, ' ');
	text = text.replace(/`[^`]*`/g, ' ');
	text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
	text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
	text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
	text = text.replace(/<https?:\/\/[^>]*>/g, ' ');
	text = text.replace(/<[^>]+>/g, ' ');
	text = text.replace(/https?:\/\/\S+/g, ' ');
	text = text.replace(/^\s{0,3}#{1,6}\s*/, '');
	text = text.replace(/^\s{0,3}>\s?/, '');
	text = text.replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/, '');
	text = text.replace(/[*_~]{1,3}/g, '');
	text = text.replace(/\s+/g, ' ').trim();
	return hasJapanese(text) ? [text] : [];
}

/** Remove Markdown presentation markers from an already extracted segment. */
export function cleanInlineMarkdown(segment) {
	return segment
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_~]{1,3}/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** A declaration or template interpolation is not visitor text. */
function replaceInterpolations(segment) {
	return segment.replace(/\$\{[^}]*\}/g, '{…}');
}

/**
 * The visitor-visible segments of one TS / TSX / JSON object line.
 *
 * This is the Issue #506 extraction rule with two extra filters for the
 * collector: a string literal is used as-is (it is what a reader sees),
 * a raw JSX line keeps only its text nodes, and a declaration line with
 * no Japanese literal is a code identifier, not copy.
 */
export function visibleSegments(line) {
	if (isCommentLine(line)) return [];
	const literals = stringLiterals(line)
		.filter((literal) => hasJapanese(literal))
		.map((literal) => replaceInterpolations(literal.trim()))
		.filter((literal) => literal.length > 0);
	if (literals.length > 0) return literals;
	if (
		/^\s*(?:import|export|const|let|var|function|class|interface|type|enum|declare|return)\b/.test(
			line,
		)
	) {
		return [];
	}
	const text = line
		.replace(/<[^>]*>/g, ' ')
		.replace(/[{}]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return hasJapanese(text) ? [text] : [];
}

/**
 * The first credential shape this text carries, or null.
 *
 * Reuses Issue #475's detector table and value-shape heuristic. The
 * caller must NOT render the text when this returns a detector id: the
 * whole point is that a credential never moves from a tracked file into
 * a report or a CI log (AGENTS.md §4).
 */
export function secretShape(text) {
	const value = String(text ?? '');
	for (const detector of DETECTORS) {
		detector.regex.lastIndex = 0;
		if (detector.regex.test(value)) return detector.id;
	}
	const tokens = value.match(/[A-Za-z0-9_+/=.-]{12,}/g) ?? [];
	for (const token of tokens) {
		if (looksLikeCredentialValue(token)) return 'credential-shaped-value';
	}
	return null;
}

/**
 * Classify one changed file into a report scope.
 *
 * Article Markdown is checked first because `src/portfolio/seed.ts` is
 * both an article body and a file the #506 surface declaration already
 * names. Everything else is classified by the #506 declaration; `about`
 * is a label on a public file, not a second target list. A file outside
 * every declaration is out of scope and the reason is reported.
 */
export function classifyReviewFile(path, declaration, baseSurfaces) {
	const articleExcluded = (declaration.articleMarkdownExcludeGlobs ?? []).find((glob) =>
		matchesGlob(glob, path),
	);
	if (articleExcluded) {
		return { scope: null, reason: `excluded by "${articleExcluded}"` };
	}
	if ((declaration.articleMarkdownGlobs ?? []).some((glob) => matchesGlob(glob, path))) {
		return { scope: 'article', reason: 'declared article Markdown surface' };
	}
	const base = classifyFile(path, baseSurfaces);
	if (!base.public) return { scope: null, reason: base.reason };
	const about = (declaration.aboutGlobs ?? []).some((glob) => matchesGlob(glob, path));
	return {
		scope: about ? 'about' : 'ui',
		reason: about ? 'declared About prose surface' : base.reason,
	};
}

/** Numeric literals in one text (decimals and joined thousands included). */
export function numericTokens(text) {
	return [...new Set(String(text ?? '').match(/\d+(?:[.,]\d+)*/g) ?? [])].sort();
}

/** Does the text carry a marker from this list? */
function markersIn(text, markers) {
	const value = String(text ?? '');
	return markers.filter((marker) => value.includes(marker));
}

function sameSet(before, after) {
	return before.length === after.length && before.every((marker) => after.includes(marker));
}

function setDelta(before, after) {
	return {
		added: after.filter((marker) => !before.includes(marker)),
		removed: before.filter((marker) => !after.includes(marker)),
	};
}

/**
 * The meaning markers of one segment. This is a heuristic, not a parse:
 * a marker list gives a reviewer a place to look, and a false positive
 * costs one look while a silent omission costs a sentence that says the
 * opposite of the original. Marker *sets* are compared, not booleans:
 * dropping `のみ` from a sentence that still says `編集` is a permission
 * change even though the permission category stays present.
 */
export function claimMarkers(text) {
	if (text === null || text === undefined) {
		return {
			numbers: [],
			negation: false,
			permission: false,
			negationMarkers: [],
			permissionMarkers: [],
		};
	}
	const negationMarkers = markersIn(text, NEGATION);
	const permissionMarkers = markersIn(text, PERMISSION);
	return {
		numbers: numericTokens(text),
		negation: negationMarkers.length > 0,
		permission: permissionMarkers.length > 0,
		negationMarkers,
		permissionMarkers,
	};
}

/**
 * Compare a review target's original and new text.
 *
 * `number-drift` / `negation-drift` / `permission-drift` compare the two
 * sides. `claim-added` / `claim-removed` mark a one-sided change that
 * states a number, a negation or a permission with no original beside
 * it: there is nothing to compare, which is exactly what a reviewer must
 * see.
 */
export function analyzeUnit(unit) {
	const before = claimMarkers(unit.before);
	const after = claimMarkers(unit.after);
	// Drift compares two sides. An added or removed segment has no other
	// side to compare with, so its missing markers are not "drift" — the
	// `claim-added` / `claim-removed` flags carry that case instead.
	const paired = unit.before !== null && unit.after !== null;
	const numbersAdded = paired
		? after.numbers.filter((number) => !before.numbers.includes(number))
		: [];
	const numbersRemoved = paired
		? before.numbers.filter((number) => !after.numbers.includes(number))
		: [];
	const negationDelta = paired
		? setDelta(before.negationMarkers, after.negationMarkers)
		: { added: [], removed: [] };
	const permissionDelta = paired
		? setDelta(before.permissionMarkers, after.permissionMarkers)
		: { added: [], removed: [] };
	const risk = [];
	if (numbersAdded.length > 0 || numbersRemoved.length > 0) risk.push('number-drift');
	if (paired && !sameSet(before.negationMarkers, after.negationMarkers)) {
		risk.push('negation-drift');
	}
	if (paired && !sameSet(before.permissionMarkers, after.permissionMarkers)) {
		risk.push('permission-drift');
	}
	const afterClaim = after.numbers.length > 0 || after.negation || after.permission;
	const beforeClaim = before.numbers.length > 0 || before.negation || before.permission;
	if (unit.kind === 'added' && afterClaim) risk.push('claim-added');
	if (unit.kind === 'removed' && beforeClaim) risk.push('claim-removed');
	return {
		...unit,
		beforeMarkers: before,
		afterMarkers: after,
		numbersAdded,
		numbersRemoved,
		negationMarkersAdded: negationDelta.added,
		negationMarkersRemoved: negationDelta.removed,
		permissionMarkersAdded: permissionDelta.added,
		permissionMarkersRemoved: permissionDelta.removed,
		risk,
		meaningRisk: risk.some((flag) => DRIFT_FLAGS.includes(flag)),
	};
}

function redactionKey(redaction) {
	return `${redaction.path}\t${redaction.side}\t${redaction.line}\t${redaction.detector}`;
}

/**
 * Build the review-target set for one diff.
 *
 * `sourceTexts` maps a Markdown path to its full before / after content;
 * it is how a changed line knows whether it sits inside a code fence.
 * When it is absent (a fixture, or a path git cannot show) the line-level
 * Markdown rules still apply and the limitation is visible in the report.
 */
export function buildReviewTargets(
	diffText,
	declaration,
	baseSurfaces,
	{ sourceTexts = {}, diffBase = null } = {},
) {
	const files = parseDiff(diffText);
	const targets = [];
	const redactions = [];
	const redactionSeen = new Set();
	const reviewFiles = [];
	const otherFiles = [];

	for (const file of files) {
		const classification = classifyReviewFile(file.path, declaration, baseSurfaces);
		if (!classification.scope) {
			otherFiles.push({ path: file.path, status: file.status, reason: classification.reason });
			continue;
		}
		reviewFiles.push({
			path: file.path,
			status: file.status,
			scope: classification.scope,
			reason: classification.reason,
		});
		const markdown = /\.mdx?$/i.test(file.path);
		const beforeMask = markdown ? markdownProseMask(sourceTexts[file.path]?.before) : null;
		const afterMask = markdown ? markdownProseMask(sourceTexts[file.path]?.after) : null;

		const extractLine = (line, context) => {
			const detector = secretShape(line);
			if (detector) {
				const redaction = {
					path: file.path,
					scope: classification.scope,
					side: context.side,
					line: context.lineNumber,
					detector,
				};
				const key = redactionKey(redaction);
				if (!redactionSeen.has(key)) {
					redactionSeen.add(key);
					redactions.push(redaction);
				}
				return [];
			}
			if (markdown) {
				const mask = context.side === 'before' ? beforeMask : afterMask;
				const inCode =
					mask !== null && context.lineNumber !== null
						? mask[context.lineNumber - 1] === false
						: false;
				return markdownSegments(line, { inCode });
			}
			const segments = visibleSegments(line);
			if (classification.scope !== 'article') return segments;
			// An article body committed inside a TS file (`src/portfolio/seed.ts`)
			// is Markdown in a template literal. Its prose line is raw Markdown,
			// so it gets the same marker stripping as a `.md` line; a Japanese
			// string literal (a title, a slug caption) keeps its literal text.
			return segments
				.flatMap((segment) => {
					const cleaned = markdownSegments(segment);
					return cleaned.length > 0 ? cleaned : [cleanInlineMarkdown(segment)];
				})
				.filter((segment) => segment.length > 0);
		};

		for (const edit of file.edits) {
			for (const unit of pairEditSegments(edit, extractLine, { path: file.path })) {
				targets.push(analyzeUnit({ ...unit, scope: classification.scope }));
			}
		}
	}

	const attention = targets.some((target) => target.meaningRisk) || redactions.length > 0;
	const status =
		targets.length === 0 && redactions.length === 0 ? 'clear' : attention ? 'attention' : 'review';

	return {
		status,
		diffBase,
		targets,
		redactions,
		reviewFiles,
		otherFiles,
		summary: summarize(targets, redactions, reviewFiles, otherFiles),
	};
}

/** Counts used by every renderer. */
export function summarize(targets, redactions = [], reviewFiles = [], otherFiles = []) {
	const byScope = { article: 0, about: 0, ui: 0 };
	const byKind = { added: 0, modified: 0, removed: 0 };
	const byRisk = {};
	for (const target of targets) {
		byScope[target.scope] = (byScope[target.scope] ?? 0) + 1;
		byKind[target.kind] = (byKind[target.kind] ?? 0) + 1;
		for (const flag of target.risk) byRisk[flag] = (byRisk[flag] ?? 0) + 1;
	}
	return {
		targets: targets.length,
		redactions: redactions.length,
		reviewFiles: reviewFiles.length,
		otherFiles: otherFiles.length,
		meaningRisk: targets.filter((target) => target.meaningRisk).length,
		byScope,
		byKind,
		byRisk,
	};
}

/** Findings derived from the target set. No prose is graded. */
export function findingsFor(result) {
	const findings = [];
	if (result.targets.length > 0) {
		findings.push({
			code: 'review-targets',
			severity: 'info',
			message: `${result.targets.length} changed Japanese segment(s) are listed for human review. This report approves nothing.`,
		});
	}
	for (const target of result.targets) {
		if (!target.meaningRisk) continue;
		findings.push({
			code: 'meaning-risk',
			severity: 'attention',
			message: `${target.path} changes a meaning marker (${target.risk.join(', ')}). Compare the original and the new text before accepting the rewording.`,
		});
	}
	for (const redaction of result.redactions) {
		findings.push({
			code: 'secret-shaped-text',
			severity: 'attention',
			message: `A changed line in ${redaction.path} (${redaction.side}, line ${redaction.line ?? '?'}) carries a credential-shaped value (${redaction.detector}); the text is withheld from this report. Run the static secret scan for the credential itself.`,
		});
	}
	return findings;
}

/** Verdict label used in the report. */
export function statusLabel(status) {
	if (status === 'attention') return 'ATTENTION';
	return status.toUpperCase();
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function riskText(target) {
	if (target.risk.length === 0) return '—';
	const parts = [...target.risk];
	if (target.numbersAdded.length > 0)
		parts.push(`numbers added: ${target.numbersAdded.join(', ')}`);
	if (target.numbersRemoved.length > 0) {
		parts.push(`numbers removed: ${target.numbersRemoved.join(', ')}`);
	}
	if (target.negationMarkersAdded.length > 0) {
		parts.push(`negation added: ${target.negationMarkersAdded.join(', ')}`);
	}
	if (target.negationMarkersRemoved.length > 0) {
		parts.push(`negation removed: ${target.negationMarkersRemoved.join(', ')}`);
	}
	if (target.permissionMarkersAdded.length > 0) {
		parts.push(`permission added: ${target.permissionMarkersAdded.join(', ')}`);
	}
	if (target.permissionMarkersRemoved.length > 0) {
		parts.push(`permission removed: ${target.permissionMarkersRemoved.join(', ')}`);
	}
	return parts.join('; ');
}

/** Terminal report. Default output; also the text pasted into a PR. */
export function renderText(result) {
	const findings = findingsFor(result);
	const lines = [];
	lines.push('Japanese copy — review targets (Issue #425)');
	lines.push(`  status: ${statusLabel(result.status)}`);
	if (result.diffBase) {
		lines.push(`  change set: ${result.diffBase.ref} (${describeDiffBase(result.diffBase)})`);
	}
	lines.push(
		`  targets: ${result.summary.targets}  (article=${result.summary.byScope.article}, about=${result.summary.byScope.about}, ui=${result.summary.byScope.ui}; added=${result.summary.byKind.added}, modified=${result.summary.byKind.modified}, removed=${result.summary.byKind.removed})`,
	);
	lines.push(
		`  meaning-risk targets: ${result.summary.meaningRisk}  withheld lines: ${result.summary.redactions}`,
	);
	if (result.targets.length === 0) {
		lines.push(
			'  NO REVIEW TARGETS: this change set changes no Japanese text in a declared review scope.',
		);
	}
	for (const target of result.targets) {
		lines.push('');
		lines.push(
			`  [${target.kind}] ${target.path} (${target.scope}${target.line === null ? '' : `, line ${target.line}`})`,
		);
		lines.push(`      before: ${target.before === null ? '—' : target.before}`);
		lines.push(`      after:  ${target.after === null ? '—' : target.after}`);
		if (target.risk.length > 0) lines.push(`      risk:   ${riskText(target)}`);
	}
	if (result.redactions.length > 0) {
		lines.push('');
		lines.push('  Withheld (a credential never enters this report):');
		for (const redaction of result.redactions) {
			lines.push(
				`    - ${redaction.path} (${redaction.side}, line ${redaction.line ?? '?'}) — ${redaction.detector}`,
			);
		}
	}
	if (result.otherFiles.length > 0) {
		lines.push('');
		lines.push('  Out of scope (declared, not forgotten):');
		for (const file of result.otherFiles) {
			lines.push(`    - ${file.path} — ${file.reason}`);
		}
	}
	lines.push('');
	lines.push('Findings:');
	if (findings.length === 0) lines.push('  none');
	for (const finding of findings) {
		lines.push(`  [${finding.severity}] ${finding.code}  ${finding.message}`);
	}
	lines.push('');
	lines.push('Reading the status:');
	lines.push('  - clear      no Japanese text changed in a declared review scope');
	lines.push('  - review     review targets exist; this is a list, not a failure');
	lines.push('  - attention  a meaning marker changed, or a secret-shaped line was withheld');
	lines.push('');
	lines.push('Boundary:');
	lines.push(
		'  - This report approves nothing and rewrites nothing. The Issue #506 gate decides whether',
	);
	lines.push('    a public copy change carries an owner approval record.');
	lines.push('  - Typography is mechanical and owned by `pnpm run copy:i18n:check` (Issue #428).');
	lines.push('  - Prose quality (register, honorifics, word order) is never machine-decided.');
	lines.push(
		'  - Locale opt-in per capability stays in copy/resources.json; this report changes none.',
	);
	return `${lines.join('\n')}\n`;
}

/** Machine-readable report. */
export function renderJson(result) {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			status: result.status,
			diffBase: result.diffBase ?? null,
			summary: result.summary,
			targets: result.targets,
			redactions: result.redactions,
			reviewFiles: result.reviewFiles,
			otherFiles: result.otherFiles,
			findings: findingsFor(result),
		},
		null,
		2,
	)}\n`;
}

const STATUS_STYLES = {
	clear: 'clear',
	review: 'review',
	attention: 'attention',
};

function targetTable(targets) {
	if (targets.length === 0) {
		return '<p>This change set changes no Japanese text in a declared review scope.</p>';
	}
	const rows = targets
		.map(
			(target) => `<tr>
				<td><code>${escapeHtml(target.path)}</code>${target.line === null ? '' : `<br /><span class="line">line ${escapeHtml(target.line)}</span>`}</td>
				<td>${escapeHtml(SCOPE_LABELS[target.scope] ?? target.scope)}</td>
				<td>${escapeHtml(target.kind)}</td>
				<td class="text">${escapeHtml(target.before ?? '—')}</td>
				<td class="text">${escapeHtml(target.after ?? '—')}</td>
				<td>${target.risk.length === 0 ? '—' : target.risk.map((flag) => `<span class="risk">${escapeHtml(flag)}</span>`).join(' ')}</td>
			</tr>`,
		)
		.join('\n');
	return `<table>
		<thead><tr><th>file</th><th>scope</th><th>change</th><th>before</th><th>after</th><th>risk</th></tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
}

function redactionTable(redactions) {
	const rows = redactions
		.map(
			(redaction) => `<tr>
				<td><code>${escapeHtml(redaction.path)}</code></td>
				<td>${escapeHtml(redaction.side)}</td>
				<td>${escapeHtml(redaction.line ?? '?')}</td>
				<td><code>${escapeHtml(redaction.detector)}</code></td>
				<td class="text">withheld — the value never enters this report</td>
			</tr>`,
		)
		.join('\n');
	return `<table>
		<thead><tr><th>file</th><th>side</th><th>line</th><th>detector</th><th>text</th></tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
}

/**
 * Self-contained HTML report — the surface the verification artefact
 * captures and the CI artifact carries.
 *
 * `fixtures` adds the committed demonstration matrix: the collector's
 * rules are asserted by tests, and the report shows what each fixture
 * proves even when the live change set is empty. `demo` is one fixture
 * rendered in full, labelled as a worked example, so the report still
 * demonstrates the before/after table on a pull request that changes no
 * Japanese itself. `sourceSha` is the commit the report was rendered
 * from.
 */
export function renderHtml(result, { fixtures = [], demo = null, sourceSha = null } = {}) {
	const findings = findingsFor(result);
	const fixtureRows = fixtures
		.map(
			(fixture) => `<tr>
				<td><code>${escapeHtml(fixture.name)}</code></td>
				<td><span class="badge ${escapeHtml(STATUS_STYLES[fixture.status] ?? 'review')}">${escapeHtml(statusLabel(fixture.status))}</span></td>
				<td>${escapeHtml(fixture.note)}</td>
			</tr>`,
		)
		.join('\n');

	const fileRows = [
		...result.reviewFiles.map(
			(file) => `<tr>
				<td><code>${escapeHtml(file.path)}</code></td>
				<td>${escapeHtml(SCOPE_LABELS[file.scope] ?? file.scope)}</td>
				<td>${escapeHtml(file.reason)}</td>
			</tr>`,
		),
		...result.otherFiles.map(
			(file) => `<tr class="off">
				<td><code>${escapeHtml(file.path)}</code></td>
				<td>out of scope</td>
				<td>${escapeHtml(file.reason)}</td>
			</tr>`,
		),
	].join('\n');

	const findingRows = findings
		.map(
			(finding) => `<tr>
				<td><span class="badge ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></td>
				<td><code>${escapeHtml(finding.code)}</code></td>
				<td>${escapeHtml(finding.message)}</td>
			</tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Japanese copy — review targets</title>
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 48px 56px 64px;
		background: #f6f4ef; color: #16150f;
		font: 15px/1.65 ui-sans-serif, system-ui, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
	}
	h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.01em; }
	h2 { font-size: 20px; margin: 0 0 12px; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
	.lede { max-width: 82ch; margin: 0 0 32px; color: #4a473c; }
	section { background: #fffdf8; border: 1px solid #e2ddd1; border-radius: 10px; padding: 24px 28px; margin-bottom: 24px; }
	.verdict { display: inline-block; border-radius: 999px; padding: 6px 18px; font-weight: 700; font-size: 15px; border: 1px solid transparent; }
	.clear { background: #e6f0e2; border-color: #a9c69c; color: #2f5a24; }
	.review { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	.attention { background: #fdf3dc; border-color: #e4ce9a; color: #6d5312; }
	.info { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	table { width: 100%; border-collapse: collapse; font-size: 14px; }
	th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ece7db; vertical-align: top; }
	th { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6759; }
	td.text { white-space: pre-wrap; }
	tr.off td { color: #6b6759; }
	.meta { color: #6b6759; font-size: 14px; margin: 0 0 18px; }
	.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0; }
	.grid div { border: 1px solid #e2ddd1; border-radius: 8px; padding: 12px 14px; background: #fff; }
	.grid dt { font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; color: #6b6759; margin: 0 0 4px; }
	.grid dd { margin: 0; font-size: 22px; font-weight: 700; }
	.line { color: #6b6759; font-size: 12px; }
	.risk { display: inline-block; border-radius: 999px; border: 1px solid #e4ce9a; background: #fdf3dc; color: #6d5312; padding: 1px 8px; font-size: 12px; margin: 0 4px 4px 0; }
	.legend dl { margin: 0; display: grid; grid-template-columns: 230px 1fr; gap: 8px 20px; }
	.legend dt { font-weight: 600; }
	.legend dd { margin: 0; color: #4a473c; }
	ul.scope { margin: 0; padding-left: 20px; color: #4a473c; }
	.worked { border-color: #c9b98a; background: #fffbf0; }
</style>
</head>
<body>
<h1>Japanese copy — review targets</h1>
<p class="lede">
	Issue #425. This report lists the Japanese text a pull request changed in article Markdown,
	About prose and public UI copy, with its original beside it. It approves nothing, rewrites
	nothing and publishes no draft. Meaning markers (numbers, negation, permission) that changed
	are surfaced for a human; prose quality is never graded here.
</p>
<section>
	<h2>Status</h2>
	<p><span class="verdict ${escapeHtml(STATUS_STYLES[result.status] ?? 'review')}">${escapeHtml(statusLabel(result.status))}</span></p>
	<p class="meta">${
		result.diffBase
			? `change set <code>${escapeHtml(result.diffBase.ref)}</code> (${escapeHtml(describeDiffBase(result.diffBase))})`
			: 'change set unknown'
	}${sourceSha ? ` · source <code>${escapeHtml(sourceSha)}</code>` : ''}</p>
	<dl class="grid">
		<div><dt>targets</dt><dd>${escapeHtml(result.summary.targets)}</dd></div>
		<div><dt>meaning risk</dt><dd>${escapeHtml(result.summary.meaningRisk)}</dd></div>
		<div><dt>withheld</dt><dd>${escapeHtml(result.summary.redactions)}</dd></div>
		<div><dt>out of scope</dt><dd>${escapeHtml(result.summary.otherFiles)}</dd></div>
	</dl>
</section>
<section>
	<h2>Changed Japanese text</h2>
	${targetTable(result.targets)}
</section>
${
	result.redactions.length === 0
		? ''
		: `<section>
	<h2>Withheld lines</h2>
	<p class="meta">A changed line matched a credential shape. The text is deliberately absent: a credential must not move from a tracked file into a report or a CI log (AGENTS.md §4). The static secret scan owns the credential finding.</p>
	${redactionTable(result.redactions)}
</section>`
}
<section>
	<h2>Findings</h2>
	${
		findings.length === 0
			? '<p>No finding: no Japanese review target and no withheld line in this change set.</p>'
			: `<table>
				<thead><tr><th>severity</th><th>finding</th><th>detail</th></tr></thead>
				<tbody>${findingRows}</tbody>
			</table>`
	}
</section>
<section>
	<h2>Changed files and their classification</h2>
	<table>
		<thead><tr><th>file</th><th>scope</th><th>reason</th></tr></thead>
		<tbody>${fileRows || '<tr><td colspan="3">no changed file</td></tr>'}</tbody>
	</table>
</section>
${
	demo
		? `<section class="worked">
	<h2>Worked example — fixture <code>${escapeHtml(demo.name)}</code></h2>
	<p class="meta">This pull request changes no Japanese text in a declared scope, so the table above is empty. The rows below are rendered from fixtures through the same extractor: they show what a reviewer sees when a pull request does change Japanese. They are not part of this change set.</p>
	<p><span class="badge ${escapeHtml(STATUS_STYLES[demo.status] ?? 'review')}">${escapeHtml(statusLabel(demo.status))}</span></p>
	${targetTable(demo.targets)}
	${demo.redactions.length === 0 ? '' : `<h2>Withheld lines</h2>${redactionTable(demo.redactions)}`}
</section>`
		: ''
}
<section>
	<h2>Fixture matrix</h2>
	<p class="meta">Fixtures under <code>test/fixtures/copy/japanese-diff-review/</code> and their expected status, plus one fixture whose credential shape is generated at run time so no token-shaped literal is committed. The tests assert the same rows.</p>
	<table>
		<thead><tr><th>fixture</th><th>status</th><th>what it proves</th></tr></thead>
		<tbody>${fixtureRows || '<tr><td colspan="3">no fixture</td></tr>'}</tbody>
	</table>
</section>
<section class="legend">
	<h2>How to read this report</h2>
	<dl>
		<dt>clear</dt><dd>no Japanese text changed in a declared review scope. No review target is owed.</dd>
		<dt>review</dt><dd>review targets exist. This is a list for a human, not a merge verdict.</dd>
		<dt>attention</dt><dd>a number / negation / permission marker changed, or a credential-shaped line was withheld. Read the original and the new text before accepting it.</dd>
		<dt>number-drift</dt><dd>a numeric literal appears on one side only. The report prints the added and removed literals.</dd>
		<dt>negation-drift</dt><dd>a Japanese negation marker appears on one side only.</dd>
		<dt>permission-drift</dt><dd>a permission / authority marker appears on one side only.</dd>
		<dt>claim-added / claim-removed</dt><dd>a one-sided change states a number, negation or permission with no original beside it. There is nothing to compare, which is what a reviewer must see.</dd>
	</dl>
</section>
<section>
	<h2>Where the other copy decisions live</h2>
	<ul class="scope">
		<li><strong>Issue #506</strong> — the approval gate for public UI copy: did this change carry a recorded owner decision? It blocks a pull request. This report does not read that ledger and cannot approve on its behalf.</li>
		<li><strong>Issue #428</strong> — typography (line-start / line-end prohibitions, full-width residue, spacing) is mechanical and checked by <code>pnpm run copy:i18n:check</code>. A typography finding is not a prose review target.</li>
		<li><strong>Prose quality</strong> — register, honorifics, word order and cultural adaptation are never machine-decided. This report lists the text; a human decides.</li>
		<li><strong>Locale opt-in</strong> — which capability publishes which locale stays <code>copy/resources.json</code>'s decision. This report changes none of it and applies to Japanese text only.</li>
		<li><strong>Not observable in a diff</strong> — article prose that lives only in D1 or a Notion import is not in the repository, so no pull request can show it. That gap is stated in the runbook rather than guessed at.</li>
	</ul>
</section>
</body>
</html>
`;
}

function parseArgs(argv) {
	const options = {
		base: null,
		head: 'HEAD',
		declaration: DECLARATION_PATH,
		format: 'text',
		out: null,
		strict: false,
	};
	for (const arg of argv) {
		// `pnpm run <script> -- <args>` forwards the separator; the runbook
		// documents that form, so it is not an unknown option.
		if (arg === '--') continue;
		if (arg.startsWith('--base=')) options.base = arg.slice('--base='.length);
		else if (arg.startsWith('--head=')) options.head = arg.slice('--head='.length);
		else if (arg.startsWith('--declaration=')) {
			options.declaration = arg.slice('--declaration='.length);
		} else if (arg.startsWith('--format=')) options.format = arg.slice('--format='.length);
		else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
		else if (arg === '--strict') options.strict = true;
		else throw new Error(`unknown option: ${arg}`);
	}
	return options;
}

/**
 * The CLI exit code for a produced report.
 *
 * Un-reviewed prose is informational: `review` and even `attention`
 * exit 0, because the report is a list and the blocking decision belongs
 * to the Issue #506 approval gate. `--strict` is the explicit local
 * escalation: an `attention` finding exits 1. CI never passes it.
 */
export function exitCodeFor(result, strict = false) {
	return strict && result.status === 'attention' ? 1 : 0;
}

/** Validate the review declaration and return it with its base surfaces. */
export function loadDeclarations(path = DECLARATION_PATH) {
	const declaration = readJson(path, 'Japanese copy review declaration');
	if (declaration?.version !== 1) {
		throw new Error('Japanese copy review declaration must declare version: 1');
	}
	if (typeof declaration.baseDeclaration !== 'string' || declaration.baseDeclaration.length === 0) {
		throw new Error('Japanese copy review declaration must name a baseDeclaration');
	}
	if (!Array.isArray(declaration.articleMarkdownGlobs)) {
		throw new Error('Japanese copy review declaration must declare articleMarkdownGlobs');
	}
	if (!Array.isArray(declaration.aboutGlobs)) {
		throw new Error('Japanese copy review declaration must declare aboutGlobs');
	}
	const baseSurfaces = readJson(declaration.baseDeclaration, 'public copy surface declaration');
	return { declaration, baseSurfaces };
}

export function main(argv, { env = process.env } = {}) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`[collect-japanese-copy-review] ${error.message}\n`);
		return 2;
	}
	if (!['text', 'json', 'html'].includes(options.format)) {
		process.stderr.write(`[collect-japanese-copy-review] unknown --format: ${options.format}\n`);
		return 2;
	}

	let declaration;
	let baseSurfaces;
	try {
		({ declaration, baseSurfaces } = loadDeclarations(options.declaration));
	} catch (error) {
		process.stderr.write(`[collect-japanese-copy-review] ${error.message}\n`);
		return 2;
	}

	const base = resolveBaseRef(options.base, env, ['COPY_REVIEW_BASE']);
	if (!base) {
		process.stderr.write(
			'[collect-japanese-copy-review] no base ref: pass --base=<ref> (or set COPY_REVIEW_BASE / GITHUB_BASE_REF). The report cannot describe a change set it cannot see.\n',
		);
		return 2;
	}

	const diffBase = resolveDiffBase(base, options.head);
	if (!diffBase) {
		process.stderr.write(
			`[collect-japanese-copy-review] no change set: neither the merge base of ${base} and ${options.head} nor the first parent of the head commit is reachable (shallow clone?). Fetch more history; the report will not describe a diff it cannot compute.\n`,
		);
		return 2;
	}

	let diffText;
	try {
		diffText = gitDiff(diffBase.ref, options.head);
	} catch {
		process.stderr.write(
			`[collect-japanese-copy-review] cannot diff ${diffBase.ref}..${options.head}\n`,
		);
		return 2;
	}

	// Markdown code-fence state needs the whole file, not the changed lines.
	const sourceTexts = {};
	for (const file of parseDiff(diffText)) {
		if (!/\.mdx?$/i.test(file.path)) continue;
		sourceTexts[file.path] = {
			before: gitShowFile(diffBase.ref, file.path),
			after: gitShowFile(options.head, file.path),
		};
	}

	const result = buildReviewTargets(diffText, declaration, baseSurfaces, {
		sourceTexts,
		diffBase,
	});

	const rendered =
		options.format === 'json'
			? renderJson(result)
			: options.format === 'html'
				? renderHtml(result)
				: renderText(result);
	if (options.out) {
		const absolute = resolve(REPO_ROOT, options.out);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, rendered);
	} else {
		process.stdout.write(rendered);
	}

	return exitCodeFor(result, options.strict);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv.slice(2)));
}
