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
 * Five deliberate decisions
 * -------------------------
 *   1. `src/routes/__root.tsx` is NOT a page unit. The root owns the
 *      shell (header / nav / footer) that every page renders, so it
 *      is one page's worth of chrome, not a page of its own.
 *   2. A unit is a PAGE or a COMPONENT surface, and the unit table
 *      says which — `kind: 'page'` or `kind: 'component'`. The kind
 *      is DECLARED, never inferred from what the unit happens to
 *      render: a page that lost both its `<h1>` and its `main`
 *      landmark must still be reported, so the gate may not read
 *      "this unit renders no `<h1>` and no `main`" as "this unit is
 *      not a page". A unit that declares no kind is treated as a
 *      page (fail-closed: an undeclared unit is never quietly
 *      excused). A component surface is not asked for a page outline
 *      — a shared component has no business carrying the page's
 *      `<h1>` — but its heading levels are still checked, so a
 *      component cannot skip a level either.
 *   3. Heading levels are compared WITHIN one file, in the order the
 *      file writes them. The shared `SectionHeading` primitive renders
 *      exactly one `<h2>` per call, so a `<SectionHeading …>` is read
 *      as a level-2 heading; without that the primitive's own `<h2>`
 *      would be invisible to a source scan and every page built from
 *      it would look like it skipped a level.
 *   4. The fixtures are part of the gate, not decoration. The gate
 *      checks that the fixture set is exactly the expected one and
 *      that every passing fixture still carries the structure it is
 *      supposed to demonstrate, so a fixture cannot be emptied (or
 *      deleted) to turn the gate green. A fixture that no longer
 *      demonstrates what it demonstrates is reported as
 *      `fixture-expectation-mismatch`.
 *   5. A rule may be EXEMPT for one declared unit, and the exemption
 *      is a declaration with a reason, not a quiet hole. It exists
 *      for the case where another contract already declares the
 *      state this gate would report: `/tools` renders no `main`
 *      landmark because the browser-compat contract expects
 *      `main: 'none'` for that route (Issue #288) — it is a
 *      full-viewport iframe shell. The exemption names the rule and
 *      the contract it comes from, the report PRINTS it, and an
 *      exemption without a reason (or one naming a rule the gate does
 *      not decide) excuses nothing and is reported as
 *      `exemption-mismatch`. An exemption applies only to the unit
 *      that declares it, so a unit that declares nothing is never
 *      excused.
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

import { readFileSync, readdirSync } from 'node:fs';
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
 *
 * `kind` DECLARES whether the unit is a page (`'page'`) or a
 * component surface (`'component'`). It is declared, not inferred:
 * see the module docstring, decision 2. A unit with no `kind` is
 * treated as a page.
 *
 * `exemptRules` DECLARES the rules this unit is exempt from, each
 * with the reason and the contract the state comes from. It is
 * optional: a unit that declares nothing is never excused. See the
 * module docstring, decision 5, and {@link applyExemptions}.
 */
export const PAGE_UNITS = [
	{
		id: 'home',
		kind: 'page',
		files: ['src/routes/index.tsx', 'src/home/**'],
		note: 'the canonical home surface (route + composer + sections)',
	},
	{
		id: 'about',
		kind: 'page',
		files: ['src/routes/about.tsx', 'src/about/**'],
		note: 'the approved person identity surface',
	},
	{
		id: 'keyboard',
		kind: 'page',
		files: ['src/routes/keyboard.tsx', 'src/keyboard/components/**'],
		note: 'the read-only keyboard-layout reference',
	},
	{
		id: 'portfolio-list',
		kind: 'page',
		files: [
			'src/portfolio/components/PortfolioList.tsx',
			'src/portfolio/components/ProjectCard.tsx',
		],
		note: 'the portfolio index page',
	},
	{
		id: 'portfolio-detail',
		kind: 'page',
		files: [
			'src/portfolio/components/PortfolioDetail.tsx',
			'src/portfolio/components/Markdown.tsx',
		],
		note: 'one portfolio entry page',
	},
	{
		id: 'legal-review',
		kind: 'component',
		files: ['src/legal/**'],
		note: 'the asset rights review card — a component a page embeds, so it carries no page outline of its own',
	},
	{
		id: 'external-api',
		kind: 'component',
		files: ['src/external-api/**'],
		note: 'the outbound-read display card — a component a page embeds',
	},
	{
		id: 'tools-index',
		kind: 'page',
		files: ['src/routes/tools.index.tsx'],
		note: 'the Tools index page',
		// Issue #288: this route is a full-viewport iframe shell, and
		// the browser-compat contract states the state explicitly —
		// `main: 'none'` — because the route is a documented
		// full-viewport surface rather than a page with a body
		// region. The exemption keeps that contract intact instead of
		// letting this gate report it as a defect, and the report
		// PRINTS the exemption with this reason, so it cannot
		// disappear silently. It excuses the missing landmark only:
		// a second `main`, a missing `<h1>` or a skipped heading level
		// on this page is still reported.
		exemptRules: [
			{
				rule: 'page-missing-landmark',
				reason: "the browser-compat contract expects `main: 'none'` for this route (Issue #288)",
			},
		],
	},
	{
		id: 'tools-detail',
		kind: 'component',
		files: ['src/routes/tools.$slug.tsx'],
		note: 'the Tool embed host shell — a chrome-less full-bleed iframe host whose document title is the route head, not a page outline',
	},
	{
		id: 'contact',
		kind: 'page',
		files: ['src/routes/contact.tsx', 'src/contact/page.tsx'],
		note: 'the contact page (route shell + the page it composes)',
	},
	{
		id: 'projects-dotfiles',
		kind: 'page',
		files: ['src/routes/projects.dotfiles.tsx', 'src/projects/DotfilesIntroductionPage.tsx'],
		note: 'the project-introduction page (route shell + the page it composes)',
	},
	{
		id: 'design-system',
		kind: 'page',
		files: ['src/routes/design-system.tsx', 'src/routes/design-system/DesignSystemPage.tsx'],
		note: 'the design-system page (route shell + the page it composes)',
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
		area: 'src/routes/design-system/** (except DesignSystemPage.tsx)',
		reason:
			'the gallery composes many surfaces into one screen; the page composition itself IS scanned as the design-system page unit',
	},
	{
		area: 'src/contact/** (except page.tsx), src/projects/** (except DotfilesIntroductionPage.tsx), src/tools/**',
		reason:
			'those pages own their own obligation; this Issue scanned the page compositions above, so their remaining modules are not checked here yet',
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
 * The rule the gate reports when the FIXTURES no longer demonstrate
 * what they are supposed to demonstrate.
 *
 * It is not one of the five page rules: it does not judge a shipped
 * page, it judges the gate's own evidence. A fixture that was deleted,
 * renamed, or emptied must not be able to turn the gate green.
 */
export const FIXTURE_RULE = 'fixture-expectation-mismatch';

/**
 * The rule the gate reports when a declared EXEMPTION is not valid.
 *
 * Like {@link FIXTURE_RULE}, it does not judge a shipped page: it
 * judges the gate's own declarations. An exemption that names a rule
 * the gate does not decide, or that carries no reason, must not be
 * able to excuse anything — and it must not disappear silently
 * either.
 */
export const EXEMPTION_RULE = 'exemption-mismatch';

/** Where the fixtures live (repo-relative). */
export const FIXTURE_DIR = 'scripts/fixtures/a11y-heading-landmarks';

/**
 * The fixture set the gate expects, exactly.
 *
 * The comparison is an EXACT set: a missing fixture and an extra
 * fixture are both a mismatch, because the set is what says which
 * rule has a demonstration.
 */
export const EXPECTED_FIXTURES = {
	pass: ['pass-landmarks.tsx', 'pass-outline.tsx'],
	fail: [
		'fail-duplicated-landmark.tsx',
		'fail-heading-level-skip.tsx',
		'fail-missing-h1.tsx',
		'fail-missing-landmark.tsx',
		'fail-missing-page-outline.tsx',
		'fail-multiple-h1.tsx',
	],
};

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
 * Apply a unit's declared exemptions to its violations (pure).
 *
 * An exemption is a statement that ANOTHER contract already declares
 * the state this gate would otherwise report. It is valid only when it
 * names one of the gate's rules AND carries the reason (and with it
 * the contract the state comes from):
 *
 *   - an exemption that names a rule this gate does not decide, or
 *     that carries no reason, is reported as {@link EXEMPTION_RULE}
 *     and excuses NOTHING (fail-closed: a typo cannot silently
 *     switch a rule off, and an exemption may never be silent);
 *   - an exemption applies ONLY to the unit that declares it, so a
 *     unit that declares nothing is never excused.
 *
 * The result separates three things: the violations that remain, the
 * findings each exemption excused (with the reason that excused
 * them), and the declarations that were not valid.
 */
export function applyExemptions(violations, exemptRules = []) {
	const remaining = [...violations];
	const exemptions = [];
	const problems = [];
	const known = new Set(RULES);

	for (const declaration of exemptRules) {
		const rule = declaration?.rule ?? null;
		const reason = typeof declaration?.reason === 'string' ? declaration.reason.trim() : '';
		if (!rule || !known.has(rule)) {
			problems.push({
				rule: EXEMPTION_RULE,
				file: 'exemption',
				line: null,
				wcag: '1.3.1',
				message: `the exemption names "${rule}", which is not a rule this gate decides; an exemption may only excuse a rule the gate reports`,
			});
			continue;
		}
		if (!reason) {
			problems.push({
				rule: EXEMPTION_RULE,
				file: 'exemption',
				line: null,
				wcag: '1.3.1',
				message: `the exemption for "${rule}" carries no reason; an exemption states which contract declares the state it excuses`,
			});
			continue;
		}
		const excused = remaining.filter((violation) => violation.rule === rule);
		for (const violation of excused) {
			remaining.splice(remaining.indexOf(violation), 1);
		}
		exemptions.push({ rule, reason, excused });
	}

	return { violations: remaining, exemptions, problems };
}

/**
 * Judge one page unit (pure).
 *
 * `files` is `[{ relativePath, source }]`. The unit's `<h1>` count
 * and its `main` landmark count are read across the whole unit — a
 * page is rendered from several files, so a page-level fact is a
 * unit-level fact — while the heading LEVELS are compared inside each
 * file.
 *
 * `kind` is the unit's DECLARED kind: `'page'` or `'component'`. It
 * defaults to `'page'`, and an unknown value is read as `'page'` too
 * (fail-closed: a unit is never excused because nobody said what it
 * is). The kind is never inferred from what the unit renders — a page
 * that lost both its `<h1>` and its `main` landmark is still a page,
 * and is reported as such.
 *
 * `exemptRules` is the unit's DECLARED exemption list (see
 * {@link applyExemptions}). It defaults to an empty list, so a unit
 * that declares no exemption is never excused.
 */
export function evaluateUnit({ id, kind = 'page', files, primitiveLevel = 2, exemptRules = [] }) {
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
	const unitKind = kind === 'component' ? 'component' : 'page';
	const isComponentSurface = unitKind === 'component';

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

	const applied = applyExemptions(violations, exemptRules);

	return {
		id,
		kind: unitKind,
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
		violations: applied.violations,
		exemptions: applied.exemptions,
		exemptionProblems: applied.problems.map((problem) => ({
			...problem,
			file: `exemption:${id}`,
		})),
	};
}

/**
 * The gate's own FIXTURES, judged (pure over the injected readers).
 *
 * The fixtures are the evidence the five rules are demonstrated with,
 * so the gate checks that they still are:
 *
 *   - the fixture set is EXACTLY {@link EXPECTED_FIXTURES} (a deleted,
 *     renamed or added fixture is a mismatch);
 *   - every passing fixture still carries the structure it
 *     demonstrates — at least one heading AND at least one `main`
 *     landmark — so an emptied fixture cannot pass by reporting no
 *     violation;
 *   - every failing fixture still reports a violation, so a fixture
 *     that stopped demonstrating its rule is a mismatch too.
 *
 * A mismatch is reported as {@link FIXTURE_RULE}. It is a gate
 * failure: the evidence is gone, so the run is not trustworthy.
 */
export function collectFixtureEvidence({
	root = REPO_ROOT,
	readFile = (relativePath) => readFileSync(join(root, relativePath), 'utf8'),
	readDirectory = (directory) => readdirSync(join(root, directory)).sort(),
} = {}) {
	const violations = [];
	const fixtures = [];
	const mismatch = (file, message) => ({
		rule: FIXTURE_RULE,
		file,
		line: null,
		wcag: '1.3.1',
		message,
	});

	for (const kind of ['pass', 'fail']) {
		const directory = `${FIXTURE_DIR}/${kind}`;
		let names = [];
		try {
			names = readDirectory(directory);
		} catch (error) {
			violations.push(
				mismatch(directory, `the fixture directory cannot be read: ${error.message}`),
			);
			continue;
		}
		const expected = EXPECTED_FIXTURES[kind];
		for (const name of expected.filter((name) => !names.includes(name))) {
			violations.push(mismatch(`${directory}/${name}`, 'the expected fixture is missing'));
		}
		for (const name of names.filter((name) => !expected.includes(name))) {
			violations.push(
				mismatch(`${directory}/${name}`, 'the fixture is not part of the expected fixture set'),
			);
		}
		for (const name of names) {
			const relativePath = `${directory}/${name}`;
			const source = readFile(relativePath);
			const result = evaluateUnit({
				id: name,
				kind: 'page',
				files: [{ relativePath, source }],
			});
			const rules = result.violations.map((violation) => violation.rule);
			fixtures.push({
				kind,
				name,
				relativePath,
				headings: result.headings.length,
				landmarks: result.landmarks.length,
				rules,
			});
			if (kind === 'pass') {
				if (result.headings.length === 0) {
					violations.push(
						mismatch(
							relativePath,
							'the passing fixture renders no heading; it demonstrates nothing about the outline',
						),
					);
				}
				if (result.landmarks.length === 0) {
					violations.push(
						mismatch(
							relativePath,
							'the passing fixture renders no main landmark; it demonstrates nothing about the landmarks',
						),
					);
				}
			} else if (result.violations.length === 0) {
				violations.push(
					mismatch(
						relativePath,
						'the failing fixture reports no violation; it demonstrates nothing',
					),
				);
			}
		}
	}

	return { violations, fixtures };
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
	const exemptions = [];
	const scanned = new Set();
	for (const unit of PAGE_UNITS) {
		const paths = expandUnitPatterns(unit.files, readDirectory);
		const files = paths.map((relativePath) => {
			scanned.add(relativePath);
			return { relativePath, source: readFile(relativePath) };
		});
		const result = evaluateUnit({
			id: unit.id,
			kind: unit.kind,
			files,
			primitiveLevel,
			exemptRules: unit.exemptRules ?? [],
		});
		units.push({ ...result, note: unit.note });
		violations.push(...result.violations);
		violations.push(...result.exemptionProblems);
		for (const exemption of result.exemptions) {
			exemptions.push({ unit: unit.id, ...exemption });
		}
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

	const fixtureEvidence = collectFixtureEvidence({ root });
	violations.push(...fixtureEvidence.violations);

	return {
		filesScanned: scanned.size,
		units,
		violations,
		exemptions,
		excluded,
		fixtures: fixtureEvidence.fixtures,
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
		const exempt = (unit.exemptions ?? []).map((exemption) => exemption.rule).join(', ');
		lines.push(
			`  ${unit.violations.length === 0 ? 'ok  ' : 'FAIL'} ${unit.id.padEnd(18)} h1=${h1} main=${unit.landmarks.length} (${unit.kind}${exempt ? `; exempt: ${exempt}` : ''})`,
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
	if (evidence.exemptions && evidence.exemptions.length > 0) {
		lines.push('exempted rules (declared, with the reason — an exemption is never silent):');
		for (const exemption of evidence.exemptions) {
			lines.push(`  - ${exemption.unit}: ${exemption.rule} — ${exemption.reason}`);
			lines.push(
				`      excused ${exemption.excused.length} finding(s)${exemption.excused.length > 0 ? `: ${exemption.excused.map((finding) => finding.file).join(', ')}` : ' (the rule was not triggered)'}`,
			);
		}
		lines.push('');
	}
	if (evidence.fixtures && evidence.fixtures.length > 0) {
		lines.push('fixtures (the gate’s own evidence):');
		for (const fixture of evidence.fixtures) {
			lines.push(
				`  ${fixture.kind.padEnd(4)} ${fixture.name.padEnd(34)} headings=${fixture.headings} landmarks=${fixture.landmarks} rules=[${fixture.rules.join(', ') || 'none'}]`,
			);
		}
		lines.push('');
	}
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
