#!/usr/bin/env node

/**
 * check-a11y-heading-landmarks — enforce the page outline / landmark
 * contract of the shipped surfaces (Issue #398).
 *
 * What this gate is for
 * ---------------------
 * A screen reader reaches a page through its OUTLINE: the heading
 * hierarchy and the landmarks. WCAG 2.2 asks for both to be
 * programmatically determinable — SC 1.3.1 Info and Relationships
 * (level A) for the structure, SC 2.4.6 Headings and Labels (level
 * AA) for the labels that name it.
 *
 * Every page used to decide its own outline, and nothing checked the
 * result: a page could ship two `<h1>`s, could jump from `<h1>` to
 * `<h3>`, or could ship no `main` landmark at all, and the repository
 * would still be green. This gate is the machine half of the Issue:
 * it fixes the STRUCTURE of a page — how many `<h1>`s it renders,
 * whether the heading levels are contiguous, and whether the page has
 * exactly one `main` landmark.
 *
 * The rules
 * ---------
 *   - page-multiple-h1
 *       one page renders two or more `<h1>`s. Two `<h1>`s mean two
 *       document titles, and a screen-reader user cannot tell which
 *       one names the page.
 *   - page-missing-h1
 *       a page renders no `<h1>` at all, so the document has no title
 *       to announce.
 *   - page-heading-level-skip
 *       the heading levels of a file jump a level (`h1` → `h3`,
 *       `h2` → `h4`). A skipped level breaks the outline: the reader
 *       loses the nesting the level was carrying.
 *   - page-missing-landmark
 *       a page renders no `main` landmark (`<main>` or
 *       `role="main"`), so the page body is not exposed as a region.
 *   - landmark-duplicated
 *       a page renders two or more `main` landmarks. Two `main`s make
 *       the region ambiguous.
 *
 * How a "page" is decided here
 * -----------------------------
 * The gate works on SOURCE, so it needs a static answer to "which
 * files make one page". {@link PAGE_UNITS} is that answer: each unit
 * is one page of the shipped platform, and every unit lists the files
 * that compose it (the route file plus the component files the route
 * renders). The unit table is the gate's SCOPE; a file that is not in
 * a unit is not scanned, and the report prints the units it scanned so
 * a reader can see the scope instead of trusting it.
 *
 * Three deliberate decisions
 * --------------------------
 *   1. `src/routes/__root.tsx` is NOT a page unit. The root owns the
 *      shell (header / nav / footer) that every page renders, so it
 *      is one page's worth of chrome, not a page of its own.
 *   2. A unit that renders neither an `<h1>` nor a `main` landmark is
 *      a COMPONENT surface (a card, a list, a panel), not a page.
 *      Such a unit is not asked for a page outline — a shared
 *      component has no business carrying the page's `<h1>` — but its
 *      heading levels are still checked, so a component cannot skip a
 *      level either.
 *   3. Heading levels are compared WITHIN one file, in the order the
 *      file writes them. The shared `SectionHeading` primitive renders
 *      exactly one `<h2>` per call, so a `<SectionHeading …>` is read
 *      as a level-2 heading; without that the primitive's own `<h2>`
 *      would be invisible to a source scan and every page built from
 *      it would look like it skipped a level.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * The gate decides the STRUCTURE: the heading list and the presence
 * of the `main` landmark. It cannot judge whether a heading's WORDING
 * describes its section, whether the outline order suits a reader, or
 * how a real screen reader announces the result. Those stay human
 * evaluation and are printed separately, so a green run is never
 * mistaken for "accessible".
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	REPO_ROOT,
	collectSourceFiles,
	lineAt,
	stripComments,
	toRepoPath,
} from './_source-scan.mjs';

/** The rules this gate decides, in report order. */
export const RULES = [
	'page-multiple-h1',
	'page-missing-h1',
	'page-heading-level-skip',
	'page-missing-landmark',
	'landmark-duplicated',
];

/**
 * The page units — the gate's SCOPE.
 *
 * Each entry is one page of the shipped platform. `files` mixes exact
 * paths with a single `dir/**` pattern per directory; the pattern
 * covers every source file in that directory except the excluded
 * kinds below.
 */
export const PAGE_UNITS = [
	{
		id: 'home',
		files: ['src/routes/index.tsx', 'src/home/**'],
		note: 'the canonical home surface (route + composer + sections)',
	},
	{
		id: 'about',
		files: ['src/routes/about.tsx', 'src/about/**'],
		note: 'the approved person identity surface',
	},
	{
		id: 'keyboard',
		files: ['src/routes/keyboard.tsx', 'src/keyboard/components/**'],
		note: 'the read-only keyboard-layout reference',
	},
	{
		id: 'portfolio-list',
		files: [
			'src/portfolio/components/PortfolioList.tsx',
			'src/portfolio/components/ProjectCard.tsx',
		],
		note: 'the portfolio index page',
	},
	{
		id: 'portfolio-detail',
		files: [
			'src/portfolio/components/PortfolioDetail.tsx',
			'src/portfolio/components/Markdown.tsx',
		],
		note: 'one portfolio entry page',
	},
	{
		id: 'legal-review',
		files: ['src/legal/**'],
		note: 'the asset rights review surface',
	},
	{
		id: 'external-api',
		files: ['src/external-api/**'],
		note: 'the outbound-read display card',
	},
	{
		id: 'tools-index',
		files: ['src/routes/tools.index.tsx'],
		note: 'the Tools index page',
	},
	{
		id: 'tools-detail',
		files: ['src/routes/tools.$slug.tsx'],
		note: 'one Tool shell page',
	},
	{
		id: 'contact',
		files: ['src/routes/contact.tsx'],
		note: 'the contact route shell',
	},
	{
		id: 'projects-dotfiles',
		files: ['src/routes/projects.dotfiles.tsx'],
		note: 'the project-introduction route shell',
	},
	{
		id: 'design-system',
		files: ['src/routes/design-system.tsx'],
		note: 'the design-system route shell',
	},
];

/**
 * Files inside a scanned directory that are NOT page sources.
 *
 * They are excluded because they are not pages: a test asserts, a
 * story renders a gallery of variants, a fixture is data. The report
 * prints what was excluded and why, so the exclusion is visible.
 */
export const EXCLUDED_FILE_PATTERNS = [
	{ pattern: /\.test\.tsx?$/, reason: 'test source — asserts, does not render a page' },
	{ pattern: /\.spec\.tsx?$/, reason: 'spec source — asserts, does not render a page' },
	{ pattern: /\.stories\.tsx?$/, reason: 'Storybook story — renders a gallery, not a page' },
	{ pattern: /\/fixtures\//, reason: 'fixture data — not a shipped page' },
];

/**
 * Scope areas that are deliberately NOT scanned, with the reason.
 *
 * Printed by the report: an out-of-scope area is a decision a reader
 * has to be able to see, not a silent gap.
 */
export const OUT_OF_SCOPE = [
	{
		area: 'src/routes/__root.tsx',
		reason: 'the root owns the shared shell (header / nav / footer), not a page',
	},
	{
		area: 'src/routes/admin.*',
		reason: 'the admin surface is an authenticated shell, not a public page',
	},
	{
		area: 'src/routes/design-system/**',
		reason: 'the design-system gallery composes many surfaces into one screen',
	},
	{
		area: 'src/contact/**, src/projects/**, src/tools/**',
		reason:
			'those pages own their own obligation; this Issue scoped the units above, so their headings are not checked here yet',
	},
	{
		area: 'src/routes/portfolio/**, src/routes/projects/**',
		reason: 'the portfolio / project route shells are directories, not `src/routes/*.tsx`',
	},
];

/**
 * The shared heading primitive. It renders exactly one `<h2>` per
 * call, so the gate reads a `<SectionHeading …>` call as a level-2
 * heading; the level is read from the primitive's own source so a
 * change to the primitive cannot silently change the gate's model.
 */
export const SECTION_HEADING_PRIMITIVE = 'src/editorial/primitives/SectionHeading.tsx';

/**
 * Things this gate deliberately does not decide. Printed with the
 * report so a reader never mistakes a green run for "accessible".
 */
export const HUMAN_EVALUATION = [
	'whether a heading’s wording describes the section it introduces',
	'whether the outline ORDER suits a reader (a page may be correct and still read oddly)',
	'a real screen-reader pass (VoiceOver / NVDA) announcing the outline and the landmarks',
	'whether a `main` landmark is placed where the reader expects the page body to start',
	'whether a heading level matches the VISUAL size of the text it labels',
];

/** Whether a path is one of the excluded kinds (pure). */
export function isExcludedPath(relativePath) {
	return EXCLUDED_FILE_PATTERNS.some((entry) => entry.pattern.test(relativePath));
}

/**
 * The level the shared heading primitive renders (pure).
 *
 * Read from the primitive's source rather than hard-coded, so the
 * gate and the primitive cannot disagree. `null` when the primitive
 * cannot be read — the caller then treats a `<SectionHeading …>` call
 * as an unknown heading and does not count it, which fails closed for
 * the level rule.
 */
export function readPrimitiveHeadingLevel(source) {
	const match = /<h([1-6])(?=[\s>])/.exec(stripComments(source));
	return match ? Number(match[1]) : null;
}

/**
 * The headings a file renders, in the order the file writes them
 * (pure).
 *
 * `element` is a literal `<h1>`…`<h6>`; `primitive` is a
 * `<SectionHeading …>` call, whose level comes from the primitive.
 */
export function extractHeadings(source, primitiveLevel = 2) {
	const code = stripComments(source);
	const found = [];
	for (const match of code.matchAll(/<h([1-6])(?=[\s>])/g)) {
		found.push({
			level: Number(match[1]),
			line: lineAt(code, match.index ?? 0),
			kind: 'element',
			index: match.index ?? 0,
		});
	}
	if (primitiveLevel !== null) {
		for (const match of code.matchAll(/<SectionHeading(?=[\s>])/g)) {
			found.push({
				level: primitiveLevel,
				line: lineAt(code, match.index ?? 0),
				kind: 'primitive',
				index: match.index ?? 0,
			});
		}
	}
	return found.sort((left, right) => left.index - right.index);
}

/**
 * The `main` landmarks a file renders (pure).
 *
 * A `<main>` element and a `role="main"` on any element are both the
 * `main` landmark. A `<main role="main">` is one landmark, not two,
 * so the attribute on a `<main>` tag is not counted again.
 */
export function extractMainLandmarks(source) {
	const code = stripComments(source);
	const landmarks = [];
	for (const match of code.matchAll(/<main(?=[\s>])[^>]*>/g)) {
		const tag = match[0];
		const alsoRole = /role=["']main["']/.test(tag);
		landmarks.push({
			line: lineAt(code, match.index ?? 0),
			kind: alsoRole ? 'element+role' : 'element',
		});
	}
	for (const match of code.matchAll(/role=["']main["']/g)) {
		const before = code.slice(0, match.index ?? 0);
		const tagStart = before.lastIndexOf('<');
		if (tagStart !== -1 && /^<main(?=[\s>])/.test(before.slice(tagStart))) {
			// Already counted as the `<main>` element it decorates.
			continue;
		}
		landmarks.push({ line: lineAt(code, match.index ?? 0), kind: 'role' });
	}
	return landmarks;
}

/**
 * The level skips inside one file (pure).
 *
 * The first heading of the file is the baseline: a file that starts
 * at `<h2>` (a shared component, or a section of a page whose `<h1>`
 * another file owns) is judged from its own first heading, so only
 * `h2` → `h4` is a skip there.
 */
export function levelSkipViolations(headings, relativePath) {
	const violations = [];
	for (let index = 1; index < headings.length; index += 1) {
		const previous = headings[index - 1];
		const current = headings[index];
		if (current.level > previous.level + 1) {
			violations.push({
				rule: 'page-heading-level-skip',
				file: relativePath,
				line: current.line,
				wcag: '1.3.1',
				message: `h${previous.level} → h${current.level} skips a level; the outline loses the nesting the level carries`,
			});
		}
	}
	return violations;
}

/**
 * Judge one page unit (pure).
 *
 * `files` is `[{ relativePath, source }]`. The unit's `<h1>` count
 * and its `main` landmark count are read across the whole unit — a
 * page is rendered from several files, so a page-level fact is a
 * unit-level fact — while the heading LEVELS are compared inside each
 * file.
 */
export function evaluateUnit({ id, files, primitiveLevel = 2 }) {
	const violations = [];
	const headings = [];
	const landmarks = [];
	for (const file of files) {
		const fileHeadings = extractHeadings(file.source, primitiveLevel);
		headings.push(...fileHeadings.map((heading) => ({ ...heading, file: file.relativePath })));
		landmarks.push(
			...extractMainLandmarks(file.source).map((landmark) => ({
				...landmark,
				file: file.relativePath,
			})),
		);
		violations.push(...levelSkipViolations(fileHeadings, file.relativePath));
	}

	const h1s = headings.filter((heading) => heading.level === 1);
	const isComponentSurface = h1s.length === 0 && landmarks.length === 0;

	if (!isComponentSurface) {
		if (h1s.length === 0) {
			violations.push({
				rule: 'page-missing-h1',
				file: `page:${id}`,
				line: null,
				wcag: '1.3.1',
				message: 'the page renders no <h1>; the document has no title to announce',
			});
		}
		for (const extra of h1s.slice(1)) {
			violations.push({
				rule: 'page-multiple-h1',
				file: extra.file,
				line: extra.line,
				wcag: '1.3.1',
				message: `the page renders ${h1s.length} <h1> elements; a reader cannot tell which one names the page`,
			});
		}
		if (landmarks.length === 0) {
			violations.push({
				rule: 'page-missing-landmark',
				file: `page:${id}`,
				line: null,
				wcag: '1.3.1',
				message: 'the page renders no main landmark (<main> or role="main")',
			});
		}
		for (const extra of landmarks.slice(1)) {
			violations.push({
				rule: 'landmark-duplicated',
				file: extra.file,
				line: extra.line,
				wcag: '1.3.1',
				message: `the page renders ${landmarks.length} main landmarks; the region is ambiguous`,
			});
		}
	}

	return {
		id,
		isComponentSurface,
		files: files.map((file) => file.relativePath),
		headings: headings.map((heading) => ({
			level: heading.level,
			file: heading.file,
			line: heading.line,
			kind: heading.kind,
		})),
		landmarks: landmarks.map((landmark) => ({
			file: landmark.file,
			line: landmark.line,
			kind: landmark.kind,
		})),
		violations,
	};
}

/**
 * Every source file a unit's patterns cover (pure over a directory
 * listing, so it is testable without a checkout).
 */
export function expandUnitPatterns(patterns, readDirectory) {
	const files = [];
	for (const pattern of patterns) {
		if (pattern.endsWith('/**')) {
			const directory = pattern.slice(0, -3);
			for (const relativePath of readDirectory(directory)) {
				if (isExcludedPath(relativePath)) continue;
				files.push(relativePath);
			}
			continue;
		}
		if (isExcludedPath(pattern)) continue;
		files.push(pattern);
	}
	return [...new Set(files)].sort();
}

/**
 * Scan the repository (pure over the injected file reader, so the
 * rules are unit-testable without a checkout).
 */
export function collectEvidence({
	root = REPO_ROOT,
	readFile = (relativePath) => readFileSync(join(root, relativePath), 'utf8'),
	readDirectory = (directory) =>
		collectSourceFiles(join(root, directory)).map((file) => toRepoPath(file)),
} = {}) {
	let primitiveLevel = null;
	let primitiveNote = null;
	try {
		primitiveLevel = readPrimitiveHeadingLevel(readFile(SECTION_HEADING_PRIMITIVE));
		if (primitiveLevel === null) {
			primitiveNote = `${SECTION_HEADING_PRIMITIVE} renders no heading element; its calls are not counted`;
		}
	} catch (error) {
		primitiveNote = `${SECTION_HEADING_PRIMITIVE} could not be read (${error.message}); its calls are not counted`;
	}

	const units = [];
	const violations = [];
	const scanned = new Set();
	for (const unit of PAGE_UNITS) {
		const paths = expandUnitPatterns(unit.files, readDirectory);
		const files = paths.map((relativePath) => {
			scanned.add(relativePath);
			return { relativePath, source: readFile(relativePath) };
		});
		const result = evaluateUnit({ id: unit.id, files, primitiveLevel });
		units.push({ ...result, note: unit.note });
		violations.push(...result.violations);
	}

	const excluded = [];
	for (const unit of PAGE_UNITS) {
		for (const pattern of unit.files) {
			if (!pattern.endsWith('/**')) continue;
			const directory = pattern.slice(0, -3);
			for (const relativePath of readDirectory(directory)) {
				if (!isExcludedPath(relativePath)) continue;
				const entry = EXCLUDED_FILE_PATTERNS.find((candidate) =>
					candidate.pattern.test(relativePath),
				);
				excluded.push({ file: relativePath, reason: entry?.reason ?? 'not a page source' });
			}
		}
	}

	return {
		filesScanned: scanned.size,
		units,
		violations,
		excluded,
		primitiveLevel,
		primitiveNote,
		humanEvaluation: HUMAN_EVALUATION,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push('heading outline / landmark gate — Issue #398');
	lines.push(
		`scanned ${evidence.filesScanned} source file(s) across ${evidence.units.length} page unit(s)`,
	);
	lines.push('');
	lines.push('machine-checked:');
	for (const unit of evidence.units) {
		const h1 = unit.headings.filter((heading) => heading.level === 1).length;
		lines.push(
			`  ${unit.violations.length === 0 ? 'ok  ' : 'FAIL'} ${unit.id.padEnd(18)} h1=${h1} main=${unit.landmarks.length} ${unit.isComponentSurface ? '(component surface)' : ''}`,
		);
		// The outline is printed per file: the level rule is decided
		// inside a file, so a flat list would read as one sequence that
		// the gate never judged.
		const byFile = new Map();
		for (const heading of unit.headings) {
			byFile.set(heading.file, [...(byFile.get(heading.file) ?? []), heading]);
		}
		for (const [file, headings] of byFile) {
			const outline = headings.map((heading) => `h${heading.level}`).join(' → ');
			lines.push(`       ${file}: ${outline}`);
		}
	}
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push('not scanned (deliberately out of scope):');
	for (const entry of OUT_OF_SCOPE) lines.push(`  - ${entry.area}: ${entry.reason}`);
	lines.push('');
	if (evidence.excluded.length > 0) {
		lines.push(`excluded files inside the scanned scope (${evidence.excluded.length}):`);
		for (const entry of evidence.excluded) lines.push(`  - ${entry.file}: ${entry.reason}`);
		lines.push('');
	}
	if (evidence.primitiveNote) {
		lines.push(`note: ${evidence.primitiveNote}`);
		lines.push('');
	}
	if (evidence.violations.length > 0) {
		lines.push(`violations (${evidence.violations.length}):`);
		for (const entry of evidence.violations) {
			const where = entry.line ? `${entry.file}:${entry.line}` : entry.file;
			lines.push(`  [${entry.rule}] ${where} — ${entry.message}`);
		}
	} else {
		lines.push('no violations');
	}
	return lines.join('\n');
}

function main() {
	let evidence;
	try {
		evidence = collectEvidence();
	} catch (error) {
		process.stderr.write(`cannot scan the repository: ${error.message}\n`);
		return 2;
	}
	const report = `${renderGateSummary(evidence)}\n`;
	if (evidence.violations.length > 0) process.stderr.write(report);
	else process.stdout.write(report);
	return evidence.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main());
}

export { main };
