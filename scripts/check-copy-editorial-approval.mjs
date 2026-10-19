#!/usr/bin/env node

/**
 * Public Japanese copy — editorial approval gate (Issue #506).
 *
 * What this gate is
 * -----------------
 * A pull request that changes the **Japanese text a visitor reads** is
 * an editorial change, and an editorial change is a human decision.
 * Nothing in this repository could prove that the person who wrote the
 * new sentence meant what it says, so this gate does not try. What it
 * does is make the *absence* of that decision visible:
 *
 *   1. It extracts **only** the Japanese text the pull request changed
 *      in a public copy surface (the diff's added / removed Japanese
 *      segments, nothing else in the file).
 *   2. It looks for an **owner approval record** in
 *      `quality/copy-editorial-approvals.json` that covers exactly
 *      that change set (bound by a fingerprint of the changed text).
 *   3. It resolves the record into three review dimensions and keeps
 *      their outcomes apart:
 *
 *        - `proposal` — the editing aid (yomiyasu or a comparable tool)
 *          was run over the changed text and its suggestions were
 *          adjudicated. A tool run is **evidence**, never approval.
 *        - `semantic` — the original text and the final text were
 *          compared, meaning-wise, and the comparison is written down
 *          per changed segment.
 *        - `approval` — the owner decided (`approved` / `rejected`),
 *          and the decision names its reviewer and its date.
 *
 * The four verdicts are kept distinct on purpose, exactly like the
 * release-gate ledger they sit next to:
 *
 *   - `pass`            — the changed public Japanese text is covered by
 *                         a complete owner approval record.
 *   - `fail`            — a review was recorded and it says no, or the
 *                         record contradicts the change set.
 *   - `not run`         — the review was never recorded (this is the
 *                         NEEDS REVIEW state: the pull request asks for
 *                         an owner decision nobody has taken yet).
 *   - `not applicable`  — the pull request changed no public Japanese
 *                         copy at all.
 *
 * `not run` and `fail` both stop the merge; they are different
 * sentences, and the report says which one it is.
 *
 * What this gate is not
 * ---------------------
 * It is not a Japanese proofreading tool and it does not judge prose.
 * It cannot tell whether a sentence is polite, clear or correct — the
 * editing aid referenced by the Issue may propose a rewording, but a
 * proposal is not proof (see `docs/domain/i18n.md` and
 * `docs/portfolio/decisions.md`, which already say so). The gate's only
 * claim is about **evidence**: a change of public Japanese copy carries
 * a recorded owner decision, or the change is reported as un-reviewed.
 *
 * It is also not a page-consolidation project and it does not require
 * every locale to be complete. The public copy surfaces are an explicit,
 * opt-in list (`quality/copy-editorial-surfaces.json`), and the copy
 * contract's per-capability locale opt-in
 * (`copy/resources.json`) is untouched by this gate.
 *
 * The change set is the pull request's OWN change set
 * ----------------------------------------------------
 * The gate diffs the **merge base** of the base ref and the head ref
 * (`git diff base...head`), never the two refs directly. A base branch
 * that moved on publishes its own text, and a two-dot diff reports that
 * text as if the pull request had changed it: the fingerprint of the
 * change set then differs between a local run and the CI run, the
 * owner cannot record an approval that CI accepts, and the report
 * describes files the pull request never touched.
 *
 * When the history is too shallow to compute a merge base — the
 * depth-1 clone `actions/checkout` makes — the head is the merge
 * commit GitHub builds for the pull request, and diffing it against
 * its first parent is the same change set: what the pull request
 * publishes on top of the base it was merged into. When neither can be
 * established, the gate does not guess: it exits 2 rather than judge a
 * change set it cannot see.
 *
 * Offline, read-only, no secret: the gate reads the git diff of two
 * refs plus two JSON files. It never writes to the tree, never contacts
 * a network, and never reads a credential.
 *
 * Usage:
 *   node scripts/check-copy-editorial-approval.mjs --base=release-0-7-0
 *   node scripts/check-copy-editorial-approval.mjs --base=release-0-7-0 \
 *     --format=html --out=.tmp/copy-editorial-approval.html
 *   node scripts/check-copy-editorial-approval.mjs --base=release-0-7-0 \
 *     --print-fingerprint
 *
 * Options:
 *   --base=<ref>      Base ref to diff against. Defaults to
 *                      `COPY_APPROVAL_BASE`, then to `GITHUB_BASE_REF`
 *                      (read as `origin/<ref>`). Without a base the
 *                      gate cannot know what changed and exits 2.
 *   --head=<ref>      Head ref to diff (default `HEAD`).
 *   --pr=<number>     Pull request number, used to report a stale
 *                      approval for the same pull request.
 *   --ledger=<path>   Approval ledger (default
 *                      `quality/copy-editorial-approvals.json`).
 *   --surfaces=<path> Public copy surface declaration (default
 *                      `quality/copy-editorial-surfaces.json`).
 *   --format=text|json|html   Output format (default `text`).
 *   --out=<path>      Write to a file instead of stdout.
 *   --print-fingerprint  Print the change set fingerprint and exit.
 *
 * Exit codes: 0 = pass / not applicable, 1 = fail / not run (NEEDS
 * REVIEW), 2 = bad input (no base ref, unreadable declaration).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..');

/** Public copy surface declaration (which files hold visitor-facing copy). */
export const SURFACES_PATH = 'quality/copy-editorial-surfaces.json';

/** Owner approval ledger (the review evidence). */
export const LEDGER_PATH = 'quality/copy-editorial-approvals.json';

/** The committed fixtures (the gate's own test corpus). */
export const FIXTURE_DIR = 'test/fixtures/copy/editorial-approval';

/** The four verdicts, in report order. */
export const VERDICTS = ['pass', 'fail', 'not run', 'not applicable'];

/** The three review dimensions the Issue names. */
export const DIMENSIONS = ['proposal', 'semantic', 'approval'];

/** Decisions an owner may record. */
export const DECISIONS = ['approved', 'rejected'];

/** Verdicts a per-segment semantic comparison may carry. */
export const COMPARISON_VERDICTS = ['equivalent', 'intentional'];

/**
 * CJK ideographs, kana, CJK punctuation and full-width forms — the same
 * character class `scripts/check-copy-i18n.mjs` uses, so "Japanese text"
 * means the same thing in both copy gates.
 */
export const JAPANESE_PATTERN =
	/[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFE6]/u;

/** Does this text contain Japanese characters? */
export function hasJapanese(text) {
	return typeof text === 'string' && JAPANESE_PATTERN.test(text);
}

/**
 * Glob matcher for the surface declaration.
 *
 * Only the two wildcards the declaration uses are supported: `*` (any
 * run of characters inside one path segment) and `**` (any run of
 * characters, including `/`). Everything else is literal, so a path
 * with a `$` (`src/routes/tools.$slug.tsx`) matches as itself.
 */
export function globToRegExp(glob) {
	let source = '';
	for (let index = 0; index < glob.length; index += 1) {
		const char = glob[index];
		if (char === '*') {
			if (glob[index + 1] === '*') {
				source += '.*';
				index += 1;
				if (glob[index + 1] === '/') index += 1;
			} else {
				source += '[^/]*';
			}
			continue;
		}
		source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${source}$`);
}

/** Does `path` match `glob`? */
export function matchesGlob(glob, path) {
	return globToRegExp(glob).test(path);
}

/**
 * Classify one changed file against the surface declaration.
 *
 * The declaration is opt-in: a file is public copy only when it matches
 * a `publicCopyGlobs` entry and no `excludeGlobs` entry. The reason is
 * returned so the report can say *why* a file was out of scope — a
 * silent skip would be indistinguishable from a missed file.
 */
export function classifyFile(path, surfaces) {
	const include = surfaces?.publicCopyGlobs ?? [];
	const exclude = surfaces?.excludeGlobs ?? [];
	if (!include.some((glob) => matchesGlob(glob, path))) {
		return { public: false, reason: 'not a declared public copy surface' };
	}
	const excludedBy = exclude.find((glob) => matchesGlob(glob, path));
	if (excludedBy) {
		return { public: false, reason: `excluded by "${excludedBy}"` };
	}
	return { public: true, reason: 'declared public copy surface' };
}

/**
 * String literals in one line, with the quotes removed.
 *
 * A visitor-facing sentence normally lives in a literal, so the literal
 * is the unit a reviewer compares. The scan is textual, not a parse:
 * an apostrophe inside a comment can open a "literal" that never ends.
 * Such a line contributes no usable segment (it has no Japanese
 * content of its own), so the failure mode is a missed segment rather
 * than a wrong one.
 */
export function stringLiterals(line) {
	const literals = [];
	let index = 0;
	while (index < line.length) {
		const quote = line[index];
		if (quote !== '"' && quote !== "'" && quote !== '`') {
			index += 1;
			continue;
		}
		let cursor = index + 1;
		let content = '';
		let closed = false;
		while (cursor < line.length) {
			const char = line[cursor];
			if (char === '\\' && cursor + 1 < line.length) {
				content += line[cursor + 1];
				cursor += 2;
				continue;
			}
			if (char === quote) {
				closed = true;
				break;
			}
			content += char;
			cursor += 1;
		}
		if (!closed) {
			index = cursor;
			continue;
		}
		literals.push(content);
		index = cursor + 1;
	}
	return literals;
}

/** A line that only carries a comment is not copy. */
export function isCommentLine(line) {
	const trimmed = line.trim();
	return (
		trimmed.startsWith('//') ||
		trimmed.startsWith('/*') ||
		trimmed.startsWith('*') ||
		trimmed.startsWith('<!--')
	);
}

/**
 * The Japanese text segments of one changed line.
 *
 * A literal that contains Japanese is a segment (the whole literal: the
 * sentence a reader sees, with its Latin words attached). A line with
 * Japanese but no literal — raw JSX text, a bare Japanese value — is a
 * segment as a whole. Comment-only lines contribute nothing: a
 * Japanese code comment is documentation, not something a visitor reads.
 */
export function extractSegments(line) {
	if (isCommentLine(line)) return [];
	const segments = [];
	for (const literal of stringLiterals(line)) {
		if (hasJapanese(literal)) segments.push(literal.trim());
	}
	if (segments.length === 0 && hasJapanese(line)) {
		const trimmed = line.trim();
		if (trimmed.length > 0) segments.push(trimmed);
	}
	return segments;
}

/**
 * Parse a unified diff into files and their edits.
 *
 * `git diff --unified=0` is the input shape: no context lines, one
 * hunk per contiguous change. An edit is the removed and the added
 * lines of one hunk, in order, so a reviewer can see which text
 * replaced which text.
 */
export function parseDiff(diffText) {
	const files = [];
	let current = null;
	let hunk = null;

	const closeHunk = () => {
		if (current && hunk) {
			current.edits.push({ removed: hunk.removed, added: hunk.added });
		}
		hunk = null;
	};

	for (const line of String(diffText ?? '').split('\n')) {
		if (line.startsWith('diff --git ')) {
			closeHunk();
			current = { path: null, status: 'modified', edits: [] };
			files.push(current);
			continue;
		}
		if (!current) continue;
		if (line.startsWith('new file mode ')) {
			current.status = 'added';
			continue;
		}
		if (line.startsWith('deleted file mode ')) {
			current.status = 'deleted';
			continue;
		}
		if (line.startsWith('rename from ')) {
			current.status = 'renamed';
			continue;
		}
		if (line.startsWith('rename to ')) {
			current.path = line.slice('rename to '.length).trim();
			continue;
		}
		// `--- ` / `+++ ` are file headers only outside a hunk. Inside a
		// hunk they are content: a removed line whose text starts with
		// `-- ` is printed as `--- …`, and taking it for a header would
		// point the whole file at the wrong path and drop its Japanese
		// change from the change set.
		if (hunk === null && line.startsWith('--- ')) {
			const value = line.slice(4).trim();
			if (value !== '/dev/null') current.path = value.replace(/^a\//, '');
			continue;
		}
		if (hunk === null && line.startsWith('+++ ')) {
			const value = line.slice(4).trim();
			if (value !== '/dev/null') current.path = value.replace(/^b\//, '');
			continue;
		}
		if (line.startsWith('@@')) {
			closeHunk();
			hunk = { removed: [], added: [] };
			continue;
		}
		if (!hunk) continue;
		if (line.startsWith('+')) {
			hunk.added.push(line.slice(1));
			continue;
		}
		if (line.startsWith('-')) {
			hunk.removed.push(line.slice(1));
		}
	}
	closeHunk();

	return files
		.map((file) => ({
			path: file.path,
			status: file.status,
			edits: file.edits,
		}))
		.filter((file) => typeof file.path === 'string' && file.path.length > 0);
}

/**
 * Build the change set: the Japanese text a pull request changed in a
 * public copy surface.
 *
 * A modified line pairs its removed and its added text positionally —
 * the first removed segment with the first added segment — which is
 * what a one-sentence rewrite looks like in a unified diff. Segments
 * without a partner are additions or removals of their own.
 */
export function buildChangeSet(diffText, surfaces) {
	const files = parseDiff(diffText);
	const units = [];
	const publicFiles = [];
	const otherFiles = [];

	for (const file of files) {
		const classification = classifyFile(file.path, surfaces);
		if (!classification.public) {
			otherFiles.push({ path: file.path, status: file.status, reason: classification.reason });
			continue;
		}
		publicFiles.push({ path: file.path, status: file.status });
		for (const edit of file.edits) {
			const pairs = Math.max(edit.removed.length, edit.added.length);
			for (let index = 0; index < pairs; index += 1) {
				const removedLine = edit.removed[index];
				const addedLine = edit.added[index];
				const beforeSegments = removedLine === undefined ? [] : extractSegments(removedLine);
				const afterSegments = addedLine === undefined ? [] : extractSegments(addedLine);
				const segmentCount = Math.max(beforeSegments.length, afterSegments.length);
				for (let segment = 0; segment < segmentCount; segment += 1) {
					const before = beforeSegments[segment] ?? null;
					const after = afterSegments[segment] ?? null;
					if (before !== null && after !== null && before === after) continue;
					const kind = before === null ? 'added' : after === null ? 'removed' : 'modified';
					units.push({ path: file.path, kind, before, after });
				}
			}
		}
	}

	return { units, publicFiles, otherFiles };
}

/**
 * The fingerprint of a change set.
 *
 * It binds an approval to the **final text** of every changed segment,
 * not to the diff context: a base branch that moved on changes the
 * "before" side of the diff without changing what the pull request
 * publishes, and an approval of the published text must survive that.
 * The "before" side is still recorded in the approval record — it is
 * what the owner compared against — but it is not part of the binding.
 */
export function fingerprintUnits(units) {
	const lines = units
		.map((unit) => `${unit.path}\t${unit.kind}\t${unit.after ?? unit.before ?? ''}`)
		.sort();
	const digest = createHash('sha256').update(lines.join('\n')).digest('hex');
	return `sha256:${digest}`;
}

/** Read and parse a JSON file. Throws a caller-readable Error. */
export function readJson(path, label) {
	const absolute = resolve(REPO_ROOT, path);
	if (!existsSync(absolute)) {
		throw new Error(`${label} not found: ${relative(REPO_ROOT, absolute)}`);
	}
	try {
		return JSON.parse(readFileSync(absolute, 'utf8'));
	} catch (error) {
		throw new Error(`${label} is not valid JSON (${path}): ${error.message}`);
	}
}

function finding(code, severity, message) {
	return { code, severity, message };
}

/**
 * Resolve the approval record for a change set and the three review
 * dimensions it claims.
 *
 * The record is matched by fingerprint, so an approval cannot be reused
 * for a different text. A record for the same pull request with a
 * different fingerprint is reported as stale: the approved text is no
 * longer the text this pull request publishes.
 */
export function evaluateApproval({ units, ledger, pr = null, diffBase = null }) {
	const fingerprint = fingerprintUnits(units);
	const records = Array.isArray(ledger?.records) ? ledger.records : [];
	const findings = [];

	if (units.length === 0) {
		return {
			verdict: 'not applicable',
			fingerprint,
			units: [],
			dimensions: {
				proposal: 'not applicable',
				semantic: 'not applicable',
				approval: 'not applicable',
			},
			findings: [],
			record: null,
			pr,
			diffBase,
		};
	}

	const matching = records.filter((record) => record?.fingerprint === fingerprint);
	if (matching.length === 0) {
		const stale = pr ? records.filter((record) => Number(record?.pr) === Number(pr)) : [];
		if (stale.length > 0) {
			// A record exists for this pull request, but it approved other
			// text. That is a contradiction, not an un-taken decision.
			findings.push(
				finding(
					'stale-approval',
					'error',
					`An approval record exists for pull request #${pr}, but its fingerprint does not match the current change set. The approved text is not the text this pull request publishes.`,
				),
			);
			return {
				verdict: 'fail',
				fingerprint,
				units,
				dimensions: { proposal: 'fail', semantic: 'fail', approval: 'fail' },
				findings,
				record: null,
				pr,
				diffBase,
			};
		}
		findings.push(
			finding(
				'no-approval-record',
				'error',
				`No owner approval record covers this change set (fingerprint ${fingerprint}). The changed public Japanese copy is un-reviewed.`,
			),
		);
		return {
			verdict: 'not run',
			fingerprint,
			units,
			dimensions: { proposal: 'not run', semantic: 'not run', approval: 'not run' },
			findings,
			record: null,
			pr,
			diffBase,
		};
	}

	const record = matching[0];
	const dimensions = { proposal: 'not run', semantic: 'not run', approval: 'not run' };

	// 1. The editing aid: evidence, never approval.
	const proposal = record.proposal;
	if (proposal && proposal.ran === true) {
		const summary = typeof proposal.summary === 'string' ? proposal.summary.trim() : '';
		const disposition = typeof proposal.disposition === 'string' ? proposal.disposition.trim() : '';
		if (summary.length > 0 && disposition.length > 0) {
			dimensions.proposal = 'pass';
		} else {
			findings.push(
				finding(
					'proposal-incomplete',
					'error',
					'The approval record says the editing aid ran, but the suggestions or their disposition are not written down.',
				),
			);
		}
	} else {
		findings.push(
			finding(
				'proposal-not-run',
				'error',
				'The approval record does not say that the editing aid was run over the changed text.',
			),
		);
	}

	// 2. The semantic comparison: the original text against the final text.
	const comparisons = Array.isArray(record.comparisons) ? record.comparisons : [];
	const covered = new Set();
	let comparisonFailed = false;
	for (const unit of units) {
		const text = unit.after ?? unit.before ?? '';
		const match = comparisons.find(
			(entry) => entry?.path === unit.path && (entry?.after ?? entry?.text) === text,
		);
		if (!match) continue;
		covered.add(match);
		const note = typeof match.note === 'string' ? match.note.trim() : '';
		const verdict = typeof match.verdict === 'string' ? match.verdict.trim() : '';
		if (!COMPARISON_VERDICTS.includes(verdict) || note.length === 0) {
			comparisonFailed = true;
			findings.push(
				finding(
					'comparison-incomplete',
					'error',
					`The semantic comparison for "${text}" in ${unit.path} has no usable verdict (${COMPARISON_VERDICTS.join(' / ')}) or no written note.`,
				),
			);
		}
	}
	const uncovered = units.filter((unit) => {
		const text = unit.after ?? unit.before ?? '';
		return !comparisons.some(
			(entry) => entry?.path === unit.path && (entry?.after ?? entry?.text) === text,
		);
	});
	if (uncovered.length > 0) {
		findings.push(
			finding(
				'comparison-missing',
				'error',
				`${uncovered.length} changed segment(s) have no semantic comparison against the original text: ${uncovered
					.map((unit) => `${unit.path} (${unit.after ?? unit.before ?? ''})`)
					.join(', ')}.`,
			),
		);
	}
	for (const entry of comparisons) {
		if (covered.has(entry)) continue;
		findings.push(
			finding(
				'comparison-extra',
				'review',
				`The approval record compares "${entry?.after ?? entry?.text ?? ''}" in ${entry?.path ?? '?'}, which this change set does not change.`,
			),
		);
	}
	if (comparisonFailed) {
		dimensions.semantic = 'fail';
	} else if (uncovered.length === 0) {
		dimensions.semantic = 'pass';
	}

	// 3. The owner's decision.
	const decision = typeof record.decision === 'string' ? record.decision.trim() : '';
	const reviewer = typeof record.reviewer === 'string' ? record.reviewer.trim() : '';
	const reviewedAt = typeof record.reviewedAt === 'string' ? record.reviewedAt.trim() : '';
	if (decision === 'rejected') {
		dimensions.approval = 'fail';
		findings.push(
			finding(
				'approval-rejected',
				'error',
				`The owner rejected this change set${reviewer ? ` (${reviewer})` : ''}. The changed public Japanese copy may not be published as it stands.`,
			),
		);
	} else if (decision === 'approved' && reviewer.length > 0 && reviewedAt.length > 0) {
		dimensions.approval = 'pass';
	} else {
		findings.push(
			finding(
				'approval-incomplete',
				'error',
				'The approval record does not carry a complete owner decision (decision, reviewer, date).',
			),
		);
	}

	const failed = Object.values(dimensions).includes('fail');
	const notRun = Object.values(dimensions).includes('not run');
	const verdict = failed ? 'fail' : notRun ? 'not run' : 'pass';

	return { verdict, fingerprint, units, dimensions, findings, record, pr, diffBase };
}

/** Verdict label used in the report (the human wording of `not run`). */
export function verdictLabel(verdict) {
	return verdict === 'not run' ? 'NEEDS REVIEW' : verdict.toUpperCase();
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function unitText(unit) {
	return unit.after ?? unit.before ?? '';
}

/** Terminal report. Default output; also the text pasted into a PR. */
export function renderText(result) {
	const lines = [];
	lines.push('public Japanese copy — editorial approval gate (Issue #506)');
	lines.push(`  verdict: ${verdictLabel(result.verdict)}`);
	lines.push(`  fingerprint: ${result.fingerprint}`);
	if (result.diffBase) {
		lines.push(`  change set: ${result.diffBase.ref} (${describeDiffBase(result.diffBase)})`);
	}
	lines.push(
		`  changed public segments: ${result.units.length}  (review dimensions: ${DIMENSIONS.map(
			(dimension) => `${dimension}=${result.dimensions[dimension]}`,
		).join(', ')})`,
	);
	if (result.units.length === 0) {
		lines.push(
			'  NOT APPLICABLE: this change set changes no Japanese text in a public copy surface.',
		);
	}
	for (const unit of result.units) {
		const before = unit.before === null ? '—' : unit.before;
		const after = unit.after === null ? '—' : unit.after;
		lines.push(`  [${unit.kind}] ${unit.path}`);
		lines.push(`      before: ${before}`);
		lines.push(`      after:  ${after}`);
	}
	for (const item of result.findings) {
		lines.push(`  [${item.severity}] ${item.code}  ${item.message}`);
	}
	lines.push('');
	lines.push('Reading the verdict:');
	lines.push(
		'  - pass           the changed public Japanese copy carries a complete owner approval record',
	);
	lines.push(
		'  - fail           a review was recorded and it says no, or the record contradicts the change set',
	);
	lines.push(
		'  - NEEDS REVIEW   the review was never recorded (the pull request asks for a decision nobody took)',
	);
	lines.push('  - not applicable this change set changes no public Japanese copy');
	return `${lines.join('\n')}\n`;
}

/** Machine-readable report. */
export function renderJson(result) {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			verdict: result.verdict,
			fingerprint: result.fingerprint,
			dimensions: result.dimensions,
			units: result.units,
			findings: result.findings,
			pr: result.pr,
			diffBase: result.diffBase ?? null,
		},
		null,
		2,
	)}\n`;
}

const DIMENSION_LABELS = {
	proposal: 'Editing aid (推敲提案)',
	semantic: 'Comparison with the original (原文との意味比較)',
	approval: 'Owner decision (owner の採否)',
};

/**
 * Self-contained HTML report — the surface the verification artefact
 * captures.
 *
 * `changeSet` (optional) adds the per-file classification: which
 * changed file was treated as public copy, and why every other changed
 * file was out of scope. A gate that silently skipped a file would
 * look exactly like a gate that found nothing to review, so the report
 * prints the skipped files too.
 */
export function renderHtml(result, { fixtures = [], sourceSha = null, changeSet = null } = {}) {
	const unitRows = result.units
		.map(
			(unit) => `<tr>
			<td><code>${escapeHtml(unit.path)}</code></td>
			<td>${escapeHtml(unit.kind)}</td>
			<td class="text">${escapeHtml(unit.before ?? '—')}</td>
			<td class="text">${escapeHtml(unit.after ?? '—')}</td>
		</tr>`,
		)
		.join('\n');

	const dimensionRows = DIMENSIONS.map(
		(dimension) => `<tr>
			<td>${escapeHtml(DIMENSION_LABELS[dimension])}</td>
			<td><span class="badge ${escapeHtml(result.dimensions[dimension])}">${escapeHtml(
				result.dimensions[dimension],
			)}</span></td>
		</tr>`,
	).join('\n');

	const findingRows = result.findings
		.map(
			(item) => `<tr class="sev-${escapeHtml(item.severity)}">
			<td><span class="badge ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></td>
			<td><code>${escapeHtml(item.code)}</code></td>
			<td>${escapeHtml(item.message)}</td>
		</tr>`,
		)
		.join('\n');

	const fixtureRows = fixtures
		.map(
			(fixture) => `<tr>
			<td><code>${escapeHtml(fixture.name)}</code></td>
			<td><span class="badge ${escapeHtml(fixture.verdict)}">${escapeHtml(
				fixture.verdict === 'not run' ? 'NEEDS REVIEW' : fixture.verdict,
			)}</span></td>
			<td>${escapeHtml(fixture.note)}</td>
		</tr>`,
		)
		.join('\n');

	const fileRows = changeSet
		? [
				...changeSet.publicFiles.map(
					(file) =>
						`<tr><td><code>${escapeHtml(file.path)}</code></td><td>public copy</td><td>${escapeHtml(
							'declared public copy surface',
						)}</td></tr>`,
				),
				...changeSet.otherFiles.map(
					(file) =>
						`<tr class="off"><td><code>${escapeHtml(file.path)}</code></td><td>out of scope</td><td>${escapeHtml(
							file.reason,
						)}</td></tr>`,
				),
			].join('\n')
		: '';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Public Japanese copy — editorial approval gate</title>
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
	.pass { background: #e6f0e2; border-color: #a9c69c; color: #2f5a24; }
	.fail { background: #fbe6e1; border-color: #e8b4a6; color: #8c2f18; }
	.not-run { background: #fdf3dc; border-color: #e4ce9a; color: #6d5312; }
	.not-applicable { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	.review { background: #fdf3dc; border-color: #e4ce9a; color: #6d5312; }
	.info { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	table { width: 100%; border-collapse: collapse; font-size: 14px; }
	th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ece7db; vertical-align: top; }
	th { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6759; }
	td.text { white-space: pre-wrap; }
	.meta { color: #6b6759; font-size: 14px; margin: 0 0 18px; }
	.legend dl { margin: 0; display: grid; grid-template-columns: 220px 1fr; gap: 8px 20px; }
	.legend dt { font-weight: 600; }
	.legend dd { margin: 0; color: #4a473c; }
	ul.scope { margin: 0; padding-left: 20px; color: #4a473c; }
</style>
</head>
<body>
<h1>Public Japanese copy — editorial approval gate</h1>
<p class="lede">
	Issue #506. A change to the Japanese text a visitor reads is an editorial change, so the
	change set is extracted from the pull request diff and matched against an owner approval
	record. The editing aid (yomiyasu or a comparable tool) is <em>evidence</em>: its output
	never approves anything on its own.
</p>
<section>
	<h2>Verdict</h2>
	<p><span class="verdict ${escapeHtml(result.verdict)}">${escapeHtml(
		verdictLabel(result.verdict),
	)}</span></p>
	<p class="meta">fingerprint <code>${escapeHtml(result.fingerprint)}</code>${
		result.diffBase
			? ` · change set <code>${escapeHtml(result.diffBase.ref)}</code> (${escapeHtml(
					describeDiffBase(result.diffBase),
				)})`
			: ''
	}${sourceSha ? ` · source <code>${escapeHtml(sourceSha)}</code>` : ''}
	</p>
	<table>
		<thead><tr><th>review dimension</th><th>status</th></tr></thead>
		<tbody>${dimensionRows}</tbody>
	</table>
</section>
<section>
	<h2>Changed public Japanese text</h2>
	${
		result.units.length === 0
			? '<p>This change set changes no Japanese text in a public copy surface.</p>'
			: `<table>
				<thead><tr><th>file</th><th>change</th><th>before</th><th>after</th></tr></thead>
				<tbody>${unitRows}</tbody>
			</table>`
	}
</section>
<section>
	<h2>Findings</h2>
	${
		result.findings.length === 0
			? '<p>No finding: the changed public Japanese copy carries a complete owner approval record.</p>'
			: `<table>
				<thead><tr><th>severity</th><th>finding</th><th>detail</th></tr></thead>
				<tbody>${findingRows}</tbody>
			</table>`
	}
</section>
<section>
	<h2>Changed files and their classification</h2>
	${
		changeSet === null
			? ''
			: `<table>
				<thead><tr><th>file</th><th>classification</th><th>reason</th></tr></thead>
				<tbody>${fileRows}</tbody>
			</table>`
	}
</section>
<section>
	<h2>The four verdicts (fixtures)</h2>
	<p class="meta">The committed fixtures under <code>test/fixtures/copy/editorial-approval/</code> resolve to these four states.</p>
	<table>
		<thead><tr><th>fixture</th><th>verdict</th><th>what it proves</th></tr></thead>
		<tbody>${fixtureRows}</tbody>
	</table>
</section>
<div class="legend">
	<h2>How to read this report</h2>
	<dl>
		<dt>pass</dt><dd>the changed public Japanese copy carries a complete owner approval record (proposal + comparison + decision).</dd>
		<dt>fail</dt><dd>a review was recorded and it says no, or the record contradicts the change set. The change may not be published as it stands.</dd>
		<dt>not run (NEEDS REVIEW)</dt><dd>the review was never recorded. The pull request asks for an owner decision nobody has taken yet.</dd>
		<dt>not applicable</dt><dd>the change set changes no public Japanese copy, so no review is owed.</dd>
	</dl>
</div>
<section>
	<h2>Out of scope (declared, not forgotten)</h2>
	<ul class="scope">
		<li>Japanese text in internal documents, skills, scripts and tests — contributor-facing, not visitor-facing.</li>
		<li>Admin surfaces (<code>src/admin/**</code>, <code>src/routes/admin.*</code>) — owner-only, behind authentication.</li>
		<li>Storybook samples, fixtures and design-system demo routes — not published copy.</li>
		<li>Prose quality itself: register, honorifics, word order. The gate records a human decision; it never grades Japanese.</li>
		<li>Locale coverage: a capability's published languages stay an opt-in copy decision in <code>copy/resources.json</code>.</li>
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
		pr: null,
		ledger: LEDGER_PATH,
		surfaces: SURFACES_PATH,
		format: 'text',
		out: null,
		printFingerprint: false,
	};
	for (const arg of argv) {
		// `pnpm run <script> -- <args>` forwards the separator; the runbook
		// documents that form, so it is not an unknown option.
		if (arg === '--') continue;
		if (arg.startsWith('--base=')) options.base = arg.slice('--base='.length);
		else if (arg.startsWith('--head=')) options.head = arg.slice('--head='.length);
		else if (arg.startsWith('--pr=')) options.pr = arg.slice('--pr='.length);
		else if (arg.startsWith('--ledger=')) options.ledger = arg.slice('--ledger='.length);
		else if (arg.startsWith('--surfaces=')) options.surfaces = arg.slice('--surfaces='.length);
		else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
		else if (arg.startsWith('--format=')) options.format = arg.slice('--format='.length);
		else if (arg === '--print-fingerprint') options.printFingerprint = true;
		else throw new Error(`unknown option: ${arg}`);
	}
	return options;
}

/** The commit id a ref points at, or null when the ref is unknown. */
export function commitSha(ref, { cwd = REPO_ROOT } = {}) {
	try {
		const sha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		return sha.length > 0 ? sha : null;
	} catch {
		return null;
	}
}

/** Does this ref exist in the repository? */
export function refExists(ref, options = {}) {
	return commitSha(ref, options) !== null;
}

/**
 * The parents of a commit, read from the commit object itself.
 *
 * `git cat-file -p` prints the commit as it is stored, so the parents
 * stay readable in a shallow clone — where the revision walk cannot
 * reach them.
 */
export function commitParents(ref, { cwd = REPO_ROOT } = {}) {
	try {
		const text = execFileSync('git', ['cat-file', '-p', `${ref}^{commit}`], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return text
			.split('\n')
			.filter((line) => line.startsWith('parent '))
			.map((line) => line.slice('parent '.length).trim());
	} catch {
		return [];
	}
}

/** The merge base of two refs, or null when the history cannot say. */
export function mergeBaseOf(base, head, { cwd = REPO_ROOT } = {}) {
	try {
		const sha = execFileSync('git', ['merge-base', base, head], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		return sha.length > 0 ? sha : null;
	} catch {
		return null;
	}
}

/**
 * The commit the gate diffs against — the pull request's own change set.
 *
 * Two ways to reach it, and the gate uses the first one that works:
 *
 *   - `merge-base` — the commit the branch forked from. `git diff
 *     base...head` is the pull request's own change set, whatever the
 *     base branch published in the meantime. This is the local case
 *     (a clone that carries the history).
 *   - `merge-commit` — the first parent of a merge commit. A pull
 *     request checkout in CI is the merge commit GitHub builds
 *     (`refs/pull/<n>/merge`), and a depth-1 clone cannot compute a
 *     merge base. Only a commit with two or more parents qualifies: a
 *     single-parent head is not the merge GitHub builds, and diffing it
 *     against its parent would judge the last commit only — silently
 *     narrowing the review instead of asking for history.
 *
 * When neither can be established the change set is unknown, and the
 * gate says so instead of judging a diff it did not compute.
 */
export function resolveDiffBase(base, head, { cwd = REPO_ROOT } = {}) {
	const fork = mergeBaseOf(base, head, { cwd });
	if (fork) {
		return { ref: fork, mode: 'merge-base', base, head };
	}
	// Only a real merge commit (two or more parents) is the CI head.
	// A single-parent head means the change set cannot be computed, and
	// diffing it against its parent would judge the LAST commit only —
	// silently narrowing the review instead of asking for history.
	const parents = commitParents(head, { cwd });
	if (parents.length >= 2) {
		return { ref: parents[0], mode: 'merge-commit', base, head };
	}
	return null;
}

/** How the diff base was reached, in the words the report prints. */
export function describeDiffBase(diffBase) {
	if (!diffBase) return 'unknown';
	if (diffBase.mode === 'merge-base') {
		return `merge base of ${diffBase.base} and ${diffBase.head}`;
	}
	return `first parent of the merge commit ${diffBase.head}`;
}

/**
 * The diff between two refs, as `git diff --unified=0` prints it.
 *
 * The first argument is the **diff base** (see `resolveDiffBase`), not
 * the base branch: the gate judges the pull request's own change set.
 */
export function gitDiff(base, head, { cwd = REPO_ROOT } = {}) {
	return execFileSync(
		'git',
		['diff', '--no-color', '--no-ext-diff', '--unified=0', '--find-renames', base, head],
		{ cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
}

/**
 * The base ref the gate diffs against.
 *
 * `--base` wins, then `COPY_APPROVAL_BASE`, then `GITHUB_BASE_REF`
 * (read as `origin/<ref>`, which is how CI checks the base branch out).
 * There is no silent default: a gate that diffs against the wrong ref
 * would report a verdict about text nobody changed.
 */
export function resolveBaseRef(explicit, env = process.env) {
	const candidates = [];
	if (explicit) candidates.push(explicit);
	if (env.COPY_APPROVAL_BASE) candidates.push(env.COPY_APPROVAL_BASE);
	if (env.GITHUB_BASE_REF) candidates.push(`origin/${env.GITHUB_BASE_REF}`);
	for (const candidate of candidates) {
		for (const variant of refVariants(candidate)) {
			if (refExists(variant)) return variant;
		}
	}
	return null;
}

/**
 * The refs a candidate base name may resolve to, in order.
 *
 * The name is taken as given first — `--base=HEAD` means HEAD, not
 * `origin/HEAD` — and a bare branch name falls back to its remote
 * tracking ref, which is how a fresh clone reaches the base branch. A
 * name that already carries a path (`origin/…`, `refs/heads/…`) is
 * taken as it is.
 */
function refVariants(candidate) {
	if (candidate.includes('/')) return [candidate];
	return [candidate, `origin/${candidate}`];
}

export function main(argv, { env = process.env } = {}) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`[check-copy-editorial-approval] ${error.message}\n`);
		return 2;
	}
	if (!['text', 'json', 'html'].includes(options.format)) {
		process.stderr.write(`[check-copy-editorial-approval] unknown --format: ${options.format}\n`);
		return 2;
	}

	let surfaces;
	let ledger;
	try {
		surfaces = readJson(options.surfaces, 'public copy surface declaration');
		ledger = readJson(options.ledger, 'approval ledger');
	} catch (error) {
		process.stderr.write(`[check-copy-editorial-approval] ${error.message}\n`);
		return 2;
	}

	const base = resolveBaseRef(options.base, env);
	if (!base) {
		process.stderr.write(
			'[check-copy-editorial-approval] no base ref: pass --base=<ref> (or set COPY_APPROVAL_BASE / GITHUB_BASE_REF). The gate cannot judge a change set it cannot see.\n',
		);
		return 2;
	}
	if (!refExists(options.head)) {
		process.stderr.write(`[check-copy-editorial-approval] head ref not found: ${options.head}\n`);
		return 2;
	}

	// Judge the pull request's OWN change set, never the two refs
	// directly: a base branch that moved on would otherwise publish its
	// own text into the report and the fingerprint. No merge base and no
	// merge commit means the change set is unknown — exit 2, do not
	// guess.
	const diffBase = resolveDiffBase(base, options.head);
	if (!diffBase) {
		process.stderr.write(
			`[check-copy-editorial-approval] no change set: neither the merge base of ${base} and ${options.head} nor the first parent of the head commit is reachable (shallow clone?). Fetch more history; the gate will not judge a diff it cannot compute.\n`,
		);
		return 2;
	}

	let diffText;
	try {
		diffText = gitDiff(diffBase.ref, options.head);
	} catch (error) {
		process.stderr.write(
			`[check-copy-editorial-approval] cannot diff ${diffBase.ref}..${options.head}\n`,
		);
		return 2;
	}

	const changeSet = buildChangeSet(diffText, surfaces);
	const result = evaluateApproval({
		units: changeSet.units,
		ledger,
		pr: options.pr ? Number(options.pr) : null,
		diffBase,
	});

	if (options.printFingerprint) {
		process.stdout.write(`${result.fingerprint}\n`);
		return 0;
	}

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

	return result.verdict === 'pass' || result.verdict === 'not applicable' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv.slice(2)));
}
