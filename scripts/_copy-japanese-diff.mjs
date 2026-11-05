/**
 * Shared Japanese-copy diff extraction (Issues #506 and #425).
 *
 * Why this module exists
 * ----------------------
 * Two copy concerns read the same diff:
 *
 *   - Issue #506 asks whether a change of public Japanese copy carries a
 *     recorded owner decision. Its gate is
 *     `scripts/check-copy-editorial-approval.mjs`.
 *   - Issue #425 collects the changed Japanese text as a **review-target
 *     list** (article Markdown, About prose, public UI copy) and prints
 *     the original against the new text.
 *
 * If each script grew its own definition of "the Japanese text this pull
 * request changed", the two reports could disagree about the same diff,
 * and a change could be visible to one and invisible to the other. The
 * extraction rules and the git change-set helpers therefore live here,
 * once. Neither owner's policy lives here:
 *
 *   - no approval record is read (that is #506),
 *   - no review target is classified, scored or rendered (that is #425).
 *
 * The module is pure except for the git helpers at the bottom, which run
 * `git` read-only against the repository. It reads no credential, makes
 * no network call and writes no file.
 *
 * Extraction rules
 * ----------------
 * `extractSegments` is the Issue #506 unit: a Japanese string literal is
 * one segment, a Japanese line without a literal is one segment, and a
 * comment-only line contributes nothing. It is line-based on purpose —
 * a full parser would be a larger contract than the gate needs, and a
 * mis-scan fails toward a missed segment rather than a wrong one.
 *
 * `buildChangeSet` pairs the removed and added lines of one hunk
 * positionally, so a one-sentence rewrite keeps its original beside it.
 *
 * A caller may supply `extractLine` to add its own line-aware rules
 * (#425 uses it for Markdown code fences and secret-shaped values). The
 * default is the #506 rule, so the approval gate's behaviour is
 * unchanged.
 *
 * The diff is the pull request's OWN change set: `resolveDiffBase`
 * prefers the merge base and falls back to the first parent of a merge
 * commit. A base branch that moved on must not publish its own text into
 * either report.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this file. */
export const REPO_ROOT = resolve(here, '..');

/**
 * CJK ideographs, kana, CJK punctuation and full-width forms — the same
 * character class `scripts/check-copy-i18n.mjs` uses, so "Japanese text"
 * means the same thing in every copy gate.
 */
export const JAPANESE_PATTERN = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠￠-￦]/u;

/** Does this text contain Japanese characters? */
export function hasJapanese(text) {
	return typeof text === 'string' && JAPANESE_PATTERN.test(text);
}

/**
 * Glob matcher for the surface declarations.
 *
 * Only the two wildcards the declarations use are supported: `*` (any
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
 * Classify one changed file against a surface declaration.
 *
 * The declaration is opt-in, and it carries TWO kinds of entry:
 *
 *   - `publicCopyGlobs` — a directory (or subtree) whose files are
 *     public copy as a whole. Used for the surfaces whose obligation
 *     owns every file in the subtree.
 *   - `publicCopyFiles` — ONE file, named exactly. Used for the
 *     surfaces that mix display-bearing files with data, schema and
 *     pure logic: there, the unit that matters is the FILE, because a
 *     file is what a render target actually reads (Issue #672).
 *
 * A file is public copy when it matches a glob entry OR is named in
 * the file list, and no `excludeGlobs` entry matches it. The reason is
 * returned so the report can say *why* a file was out of scope — a
 * silent skip would be indistinguishable from a missed file.
 *
 * `excludeGlobs` wins over both kinds of entry, so an exclusion can
 * never be defeated by a broader glob. A file that is named in
 * `publicCopyFiles` AND matched by an `excludeGlobs` entry is a
 * contradiction in the declaration; the shipped declaration has none,
 * and the test suite asserts that.
 */
export function classifyFile(path, surfaces) {
	const include = surfaces?.publicCopyGlobs ?? [];
	const files = surfaces?.publicCopyFiles ?? [];
	const exclude = surfaces?.excludeGlobs ?? [];
	const namedFile = Array.isArray(files) && files.includes(path);
	const matchedGlob = include.some((glob) => matchesGlob(glob, path));
	if (!namedFile && !matchedGlob) {
		return { public: false, reason: 'not a declared public copy surface' };
	}
	const excludedBy = exclude.find((glob) => matchesGlob(glob, path));
	if (excludedBy) {
		return { public: false, reason: `excluded by "${excludedBy}"` };
	}
	return {
		public: true,
		reason: namedFile ? 'declared public copy file' : 'declared public copy surface',
	};
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

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified diff into files and their edits.
 *
 * `git diff --unified=0` is the input shape: no context lines, one
 * hunk per contiguous change. An edit is the removed and the added
 * lines of one hunk, in order, so a reviewer can see which text
 * replaced which text. The old / new line numbers are kept alongside
 * each line: a line-aware extractor (Markdown code fences, for
 * example) needs to know where the line sits in the file, while the
 * approval gate itself ignores them.
 */
export function parseDiff(diffText) {
	const files = [];
	let current = null;
	let hunk = null;

	const closeHunk = () => {
		if (current && hunk) {
			current.edits.push({
				removed: hunk.removed,
				added: hunk.added,
				removedLines: hunk.removedLines,
				addedLines: hunk.addedLines,
			});
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
			const header = HUNK_HEADER.exec(line);
			hunk = {
				removed: [],
				added: [],
				removedLines: [],
				addedLines: [],
				oldLine: header ? Number(header[1]) : null,
				newLine: header ? Number(header[2]) : null,
			};
			continue;
		}
		if (!hunk) continue;
		if (line.startsWith('+')) {
			hunk.added.push(line.slice(1));
			hunk.addedLines.push(hunk.newLine);
			if (hunk.newLine !== null) hunk.newLine += 1;
			continue;
		}
		if (line.startsWith('-')) {
			hunk.removed.push(line.slice(1));
			hunk.removedLines.push(hunk.oldLine);
			if (hunk.oldLine !== null) hunk.oldLine += 1;
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
 * Pair one hunk's removed and added lines into review units.
 *
 * A modified line pairs its removed and its added text positionally —
 * the first removed segment with the first added segment — which is what
 * a one-sentence rewrite looks like in a unified diff. Segments without
 * a partner are additions or removals of their own.
 *
 * `extractLine(line, context)` returns the segments of one side.
 * `context` carries the path, the side (`before` / `after`) and the line
 * number, so a caller can apply line-aware rules without re-parsing the
 * diff. The default is the #506 extraction rule.
 */
export function pairEditSegments(edit, extractLine, context = {}) {
	const units = [];
	const pairs = Math.max(edit.removed.length, edit.added.length);
	for (let index = 0; index < pairs; index += 1) {
		const removedLine = edit.removed[index];
		const addedLine = edit.added[index];
		const beforeSegments =
			removedLine === undefined
				? []
				: extractLine(removedLine, {
						...context,
						side: 'before',
						lineNumber: edit.removedLines?.[index] ?? null,
					});
		const afterSegments =
			addedLine === undefined
				? []
				: extractLine(addedLine, {
						...context,
						side: 'after',
						lineNumber: edit.addedLines?.[index] ?? null,
					});
		const segmentCount = Math.max(beforeSegments.length, afterSegments.length);
		for (let segment = 0; segment < segmentCount; segment += 1) {
			const before = beforeSegments[segment] ?? null;
			const after = afterSegments[segment] ?? null;
			if (before !== null && after !== null && before === after) continue;
			const kind = before === null ? 'added' : after === null ? 'removed' : 'modified';
			units.push({
				path: context.path ?? null,
				kind,
				before,
				after,
				line:
					after !== null
						? (edit.addedLines?.[index] ?? null)
						: (edit.removedLines?.[index] ?? null),
			});
		}
	}
	return units;
}

/**
 * Build the change set: the Japanese text a pull request changed in a
 * public copy surface.
 *
 * The surface declaration is the same one Issue #506 uses. A caller may
 * pass `extractLine` to change the per-line extraction (Issue #425 adds
 * Markdown code-fence and secret-shaped-value rules); omitting it keeps
 * the approval gate's behaviour exactly.
 */
export function buildChangeSet(diffText, surfaces, { extractLine = extractSegments } = {}) {
	const files = parseDiff(diffText);
	const units = [];
	const publicFiles = [];
	const otherFiles = [];

	for (const file of files) {
		const classification = classifyFile(file.path, surfaces);
		if (!classification.public) {
			otherFiles.push({
				path: file.path,
				status: file.status,
				reason: classification.reason,
			});
			continue;
		}
		publicFiles.push({ path: file.path, status: file.status });
		for (const edit of file.edits) {
			units.push(...pairEditSegments(edit, extractLine, { path: file.path }));
		}
	}

	return { units, publicFiles, otherFiles };
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
 * The commit the report diffs against — the pull request's own change
 * set.
 *
 * Two ways to reach it, and the first one that works wins:
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
 * caller says so instead of judging a diff it did not compute.
 */
export function resolveDiffBase(base, head, { cwd = REPO_ROOT } = {}) {
	const fork = mergeBaseOf(base, head, { cwd });
	if (fork) {
		return { ref: fork, mode: 'merge-base', base, head };
	}
	const parents = commitParents(head, { cwd });
	if (parents.length >= 2) {
		return { ref: parents[0], mode: 'merge-commit', base, head };
	}
	return null;
}

/** How the diff base was reached, in the words the reports print. */
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
 * the base branch: the caller judges the pull request's own change set.
 */
export function gitDiff(base, head, { cwd = REPO_ROOT } = {}) {
	return execFileSync(
		'git',
		['diff', '--no-color', '--no-ext-diff', '--unified=0', '--find-renames', base, head],
		{ cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
}

/** The content of one file at one ref, or null when it is not there. */
export function gitShowFile(ref, path, { cwd = REPO_ROOT } = {}) {
	try {
		return execFileSync('git', ['show', `${ref}:${path}`], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch {
		return null;
	}
}

/**
 * The base ref a report diffs against.
 *
 * `--base` wins, then each configured environment name in order, then
 * `GITHUB_BASE_REF` (read as `origin/<ref>`, which is how CI checks the
 * base branch out). There is no silent default: a report that diffs
 * against the wrong ref would describe text nobody changed.
 */
export function resolveBaseRef(explicit, env = process.env, envNames = ['COPY_APPROVAL_BASE']) {
	const candidates = [];
	if (explicit) candidates.push(explicit);
	for (const name of envNames) {
		if (env[name]) candidates.push(env[name]);
	}
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
