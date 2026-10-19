#!/usr/bin/env node
/**
 * check-publication-redaction — 公開データの個人情報検出と掲載承認 gate
 * (Issue #494).
 *
 * What it decides
 * ---------------
 * Migrated text and images (Miro boards, the my-web-2025 site, Notion
 * pages) arrive with addresses, contact channels and other people's
 * names attached, because moving a board is not a publication
 * decision. This gate runs the two decisions separately:
 *
 *   1. **detect** — `scripts/personal-data-review.mjs` extracts every
 *      personal-data candidate from a record's title / text and from
 *      its image descriptors (alt, caption, file name, EXIF keys).
 *   2. **decide** — only the owner may approve publication. An
 *      approval needs `decided_by: "owner"` and a non-empty `basis`;
 *      anything else stays `review_required` and is withheld.
 *
 * Check mode fails closed when:
 *
 *   1. a withheld record's own content is present in published content
 *      (`E001`) — the acceptance condition of the Issue,
 *   2. an approval carries no owner authority (`E002`) or no basis
 *      (`E003`) — an assumed approval is worse than none,
 *   3. a decision value is not one of the three declared states
 *      (`E004`) — an unrecognised value is not a decision,
 *   4. published content carries a candidate no approved record
 *      covers (`E005`) — the reverse direction, so pasting a number
 *      into a shipped file fails too,
 *   5. the corpus is malformed / duplicated (`E006`, `E007`),
 *   6. the detector found no candidate at all (`E008`) — a detector
 *      that never fires proves nothing, and an empty corpus is the
 *      same failure with the records gone,
 *   7. the committed report no longer matches the corpus and the
 *      candidate-bearing published content it describes — i.e. the
 *      corpus changed and nobody re-recorded the review.
 *
 * Records still waiting for the owner decision are `W001` warnings:
 * "review required" is the expected state of a real migration, not a
 * failure. What fails is a private record reaching a published file.
 *
 * The published-content surface is collected in full. A file the text
 * scan cannot read — an image — is collected by its NAME alone, so
 * the file-name rules (`D011`, a personal-camera file name) and the
 * withheld record's own file name (`E001`) can still see a migrated
 * photo that landed in a published root. The pixels are not inspected
 * (no OCR): that stays an owner judgement.
 *
 * The published-content declaration is checked before anything else.
 * If it contradicts the walk — a scanned root inside a declared
 * not-scanned surface, or a declared not-scanned surface inside a
 * scanned root that no exclude prefix covers — the gate refuses to
 * run and exits 2, rather than scanning a surface it declared out of
 * scope.
 *
 * Modes:
 *   node scripts/check-publication-redaction.mjs           # check (CI)
 *   node scripts/check-publication-redaction.mjs --write   # re-record
 *
 * Cost: a text scan of the corpus plus a few dozen published content
 * files. No browser, no network, no Worker, no secret, no binding —
 * the gate is `node:fs` only.
 *
 * Exit codes: 0 = pass / review, 1 = fail, 2 = bad input.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	REVIEW_SCHEMA,
	rawTextMatches,
	renderMarkdownReport,
	reviewCorpus,
} from './personal-data-review.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The migrated corpus under review. Owner decisions live beside the records. */
export const CORPUS_RELATIVE_PATH = 'docs/migration/personal-data-review/corpus.json';

/** Tracked report. Both are pure functions of the review, so check mode byte-compares. */
export const REPORT_RELATIVE_PATH = 'docs/verification/privacy/publication-redaction-review.md';

/**
 * Directories whose text files a visitor can read.
 *
 * Declared rather than globbed: a new obligation that publishes copy
 * has to be added here deliberately, so "which files are public
 * content" is a reviewed list and not a silent default. The Worker
 * source that renders them is not part of it — this is the published
 * *content*, and the corpus-vs-content comparison is about data, not
 * about code.
 *
 * `src/contact` is here because `channels.json` is the repo-controlled
 * registry of the contact channels the site publishes: a personal
 * channel (an address, a phone number) can only reach a visitor
 * through a declared channel, so that file is exactly where a
 * migrated contact has to be caught.
 */
export const PUBLISHED_CONTENT_ROOTS = [
	'copy',
	'public',
	'src/about',
	'src/contact',
	'src/portfolio',
];

/**
 * Published paths this gate deliberately does not judge.
 *
 * `public/share/` is the `/share/<slug>/` delivery surface: a static
 * document bundle (a conference site, a printed handout) that Static
 * Assets serves as a document of its own, published under its own
 * decision and audited by its own obligation. It is not migrated
 * Miro / legacy-site / Notion content, so re-opening an already-made
 * publication decision here would be this gate re-deciding something
 * it does not own. It is stated rather than silently skipped: if a
 * future change moves share documents into the platform copy, this
 * exclusion has to be revisited in the same PR.
 */
export const PUBLISHED_CONTENT_EXCLUDE_PREFIXES = ['public/share/'];

/**
 * Published surfaces this gate does not scan, each with the reason.
 *
 * The declaration is the point: a surface that is neither in
 * `PUBLISHED_CONTENT_ROOTS` nor listed here is an unstated gap, and
 * the whole finding of the review that produced this list was that
 * the roster read as complete while it was not. Each entry says what
 * the surface is and why the gate leaves it alone, so a reviewer can
 * disagree with the reason instead of guessing the intent.
 *
 * The component surfaces are excluded because their copy is *authored
 * in this repository* — the owner wrote it in the pull request that
 * added it, so the publication decision was made there — while the
 * scanned roots are the surfaces that carry migrated or declared
 * identity data (`about`, `contact`, `portfolio`), the platform copy
 * resources (`copy`) and the static assets a visitor can fetch
 * (`public`). Extending the reverse scan to component copy is an
 * owner decision: it needs a stated policy for placeholder contact
 * values (a `user@example.com` form placeholder is shaped like a
 * personal address), and that policy is not this gate's to invent.
 */
export const PUBLISHED_CONTENT_NOT_SCANNED = [
	{
		surface: 'public/share/',
		reason:
			'the `/share/<slug>/` static document surface is a separate delivery obligation with its own publication decision; this gate reviews migrated content, so it does not re-decide what is already published there',
	},
	{
		surface: 'src/home/',
		reason:
			'component code: the copy is authored in this repository and reviewed in the pull request that added it, not migrated content',
	},
	{
		surface: 'src/editorial/',
		reason: 'component code: the visual language, not a published data surface',
	},
	{
		surface: 'src/routes/',
		reason:
			'route code: the file route renders data that its own obligation publishes; a placeholder contact value in a form is not migrated content',
	},
	{
		surface: 'src/admin/',
		reason:
			'admin code: the admin surface is not a public published-content surface, and it carries operator-side placeholders',
	},
	{
		surface: 'src/i18n/',
		reason: 'the Unicode / glyph policy tables are synthetic decision fixtures, not published copy',
	},
];

/** Extensions of a published content file a scan can read as text. */
export const PUBLISHED_CONTENT_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.json',
	'.md',
	'.html',
	'.txt',
	'.css',
	'.svg',
	'.webmanifest',
];

/**
 * Published files with no extension that are still text.
 *
 * `public/_headers` is the Cloudflare Static Assets header contract
 * (a `_headers` file is a plain-text file with no extension), so an
 * extension-only rule would leave it unscanned inside a scanned root.
 */
export const PUBLISHED_CONTENT_EXTRA_FILES = ['public/_headers'];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const rel = (full) => relative(repoRoot, full).split('\\').join('/');

function walk(dir, onFile) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, onFile);
		else onFile(full);
	}
}

/**
 * Published content files, test files excluded: a fixture value in a
 * test is not a published value, and including it would make every new
 * test a finding.
 *
 * A file the text scan cannot read is **still a published file** and
 * is collected by its NAME alone (empty text). Dropping it would make
 * the file-name rules (`D011` — a personal-camera file name) and the
 * withheld-record file-name needle (`E001`) unreachable for exactly
 * the files they exist for: a migrated photo that lands in
 * `public/` keeps its own name, and that name is the only part of it
 * this gate can judge without reading pixels (the pixels stay an
 * owner judgement — no OCR).
 */
export function collectPublishedContent() {
	const files = [];
	for (const root of PUBLISHED_CONTENT_ROOTS) {
		const full = join(repoRoot, root);
		if (!existsSync(full)) continue;
		walk(full, (file) => {
			const name = rel(file);
			if (PUBLISHED_CONTENT_EXCLUDE_PREFIXES.some((prefix) => name.startsWith(prefix))) return;
			if (name.includes('.test.') || name.includes('.stories.')) return;
			if (!isScannablePublishedFile(name)) {
				files.push({ path: name, text: '' });
				return;
			}
			files.push({ path: name, text: readFileSync(file, 'utf8') });
		});
	}
	return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Is this file one the published-content scan can read as text? */
export function isScannablePublishedFile(name) {
	if (PUBLISHED_CONTENT_EXTRA_FILES.includes(name)) return true;
	return PUBLISHED_CONTENT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Is `path` the surface itself, or inside it?
 *
 * Both sides are normalised first: a declared surface is written with
 * a trailing slash (`src/about/`) while a scanned root is written
 * without one (`src/about`), so a bare `startsWith` would never match
 * and the guard would be a no-op. The comparison is on a path
 * boundary, so `src/about-legacy` is NOT inside `src/about/`.
 */
function isWithinSurface(path, surface) {
	const normalisedPath = path.replace(/\/+$/, '');
	const normalisedSurface = surface.replace(/\/+$/, '');
	return normalisedPath === normalisedSurface || normalisedPath.startsWith(`${normalisedSurface}/`);
}

/**
 * A declaration that contradicts the walk is a contradiction, in both
 * directions:
 *
 *   1. a scanned root inside a declared not-scanned surface — the
 *      declaration says the surface is out of scope while the walk
 *      reads it anyway;
 *   2. a declared not-scanned surface inside a scanned root that no
 *      exclude prefix covers — the declaration claims an exclusion the
 *      collector does not make, so the surface is read anyway.
 *
 * The gate refuses to run rather than scanning a surface it declared
 * out of scope (exit 2). The roots and the declaration can be
 * injected so the guard itself is provable on fixtures.
 */
export function rootDeclarationConflicts({
	roots = PUBLISHED_CONTENT_ROOTS,
	notScanned = PUBLISHED_CONTENT_NOT_SCANNED,
} = {}) {
	const conflicts = [];
	for (const root of roots) {
		for (const entry of notScanned) {
			if (isWithinSurface(root, entry.surface)) {
				conflicts.push(
					`scanned root \`${root}\` sits inside the declared not-scanned surface \`${entry.surface}\``,
				);
				continue;
			}
			if (!isWithinSurface(entry.surface, root)) continue;
			const covered = PUBLISHED_CONTENT_EXCLUDE_PREFIXES.some((prefix) =>
				isWithinSurface(entry.surface, prefix),
			);
			if (covered) continue;
			conflicts.push(
				`declared not-scanned surface \`${entry.surface}\` sits inside the scanned root \`${root}\` and no exclude prefix covers it, so the walk would read it anyway`,
			);
		}
	}
	return conflicts;
}

/** Read the corpus. Returns `{ corpus, raw }` so the caller can digest the exact bytes. */
export function loadCorpus(relativePath = CORPUS_RELATIVE_PATH) {
	const full = join(repoRoot, relativePath);
	if (!existsSync(full)) {
		return { corpus: null, raw: '', error: `corpus not found: ${relativePath}` };
	}
	const raw = readFileSync(full, 'utf8');
	try {
		return { corpus: JSON.parse(raw), raw };
	} catch (error) {
		return { corpus: null, raw, error: `corpus is not valid JSON: ${error.message}` };
	}
}

/**
 * The whole check as a pure-ish function over injected inputs, so the
 * tests can drive it with independent fixtures and the CLI, the
 * report maker and the gate all agree on one implementation.
 */
export function evaluate({ corpus, publishedFiles, corpusLabel = CORPUS_RELATIVE_PATH }) {
	const review = reviewCorpus({ corpus, publishedFiles, corpusLabel });
	return review;
}

/**
 * The published files that carry at least one personal-data candidate.
 *
 * The published side of the digest is scoped to these files on
 * purpose. A copy edit that carries no candidate changes no finding,
 * so it must not redden the privacy gate and train reviewers to
 * re-run the write command without reading the diff. A file that
 * gains or loses a candidate enters or leaves this set, so the
 * privacy-relevant change is still caught — and it is caught twice,
 * because the findings themselves are re-derived on every run.
 */
export function candidateBearingFiles(publishedFiles) {
	return publishedFiles.filter(
		(file) =>
			(typeof file.text === 'string' && rawTextMatches(file.text).length > 0) ||
			(typeof file.path === 'string' &&
				rawTextMatches(file.path.split('/').pop() ?? '').length > 0),
	);
}

/** Digests shown in the report, so a stale report is recognisable. */
export function digests({ corpusRaw, publishedFiles }) {
	const scoped = candidateBearingFiles(publishedFiles);
	const publishedDigest = sha256(
		scoped.map((file) => `${file.path}\n${file.text}`).join('\n---\n'),
	);
	return {
		corpusDigest: sha256(corpusRaw).slice(0, 12),
		publishedDigest: publishedDigest.slice(0, 12),
		candidateFiles: scoped.length,
	};
}

function main(argv) {
	const write = argv.includes('--write');
	const conflicts = rootDeclarationConflicts();
	if (conflicts.length > 0) {
		process.stderr.write('the published-content declaration contradicts itself:\n');
		for (const conflict of conflicts) process.stderr.write(`  - ${conflict}\n`);
		return 2;
	}
	const { corpus, raw, error } = loadCorpus();
	if (error) {
		process.stderr.write(`${error}\n`);
		return 2;
	}
	if (!corpus || corpus.schema !== REVIEW_SCHEMA) {
		process.stderr.write(
			`corpus ${CORPUS_RELATIVE_PATH} has no \`schema: "${REVIEW_SCHEMA}"\` block\n`,
		);
		return 2;
	}

	const publishedFiles = collectPublishedContent();
	const review = evaluate({ corpus, publishedFiles });
	const { corpusDigest, publishedDigest, candidateFiles } = digests({
		corpusRaw: raw,
		publishedFiles,
	});
	const report = renderMarkdownReport({
		review,
		corpusDigest,
		publishedDigest,
		candidateFileCount: candidateFiles,
	});
	const reportPath = join(repoRoot, REPORT_RELATIVE_PATH);

	const out = (line) => process.stdout.write(`${line}\n`);
	out(`personal-data review ${REVIEW_SCHEMA}`);
	out(`  corpus            ${CORPUS_RELATIVE_PATH} (${corpusDigest})`);
	out(
		`  published content ${publishedFiles.length} file(s), ${candidateFiles} carrying a candidate (${publishedDigest})`,
	);
	out(
		`  records           ${review.counts.records} / candidates ${review.counts.candidates} / published ${review.counts.published} / withheld ${review.counts.withheld}`,
	);
	out(`  verdict           ${review.verdict}`);

	// Status-only findings: a rule id, a path, a masked form. No raw value.
	for (const entry of review.findings) {
		const stream = entry.severity === 'error' ? process.stderr : process.stdout;
		stream.write(`  ${entry.severity.toUpperCase().padEnd(5)} ${entry.code} ${entry.message}\n`);
	}

	if (write) {
		if (!existsSync(dirname(reportPath))) {
			process.stderr.write(`report directory missing: ${dirname(reportPath)}\n`);
			return 2;
		}
		writeFileSync(reportPath, report);
		out(`  wrote             ${REPORT_RELATIVE_PATH}`);
		return review.verdict === 'fail' ? 1 : 0;
	}

	if (!existsSync(reportPath)) {
		process.stderr.write(
			`report missing: ${REPORT_RELATIVE_PATH}. Run \`pnpm run publication:redaction:write\`.\n`,
		);
		return 1;
	}
	const committed = readFileSync(reportPath, 'utf8');
	if (committed !== report) {
		process.stderr.write(
			`${REPORT_RELATIVE_PATH} is stale: the corpus (${corpusDigest}) or a candidate-bearing published file (${publishedDigest}) changed without a new review. Run \`pnpm run publication:redaction:write\` and re-read the diff.\n`,
		);
		return 1;
	}
	out(`  report            ${REPORT_RELATIVE_PATH} matches`);

	return review.verdict === 'fail' ? 1 : 0;
}

/**
 * Is this module the process entry point?
 *
 * Both sides are resolved to their real path. A script started
 * through a symlinked path (`node /tmp/link-to-the-gate.mjs`) would
 * otherwise compare unequal, the gate would run **nothing** and exit
 * 0 — a fail-open in a privacy gate, and the reason the CLI-level
 * test drives the gate from a temporary directory.
 */
function isEntryPoint() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (isEntryPoint()) {
	process.exitCode = main(process.argv.slice(2));
}
