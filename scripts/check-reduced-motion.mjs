#!/usr/bin/env node

/**
 * check-reduced-motion — enforce the reduced-motion contract on the
 * shipped surface (Issue #403).
 *
 * What this gate is for
 * ---------------------
 * The obligation lives in `src/editorial/reduced-motion.ts` and
 * `src/styles.css`: *a value or an operation state is carried by the
 * resting document, never by the animation that decorates it*. This
 * gate is what stops the rest of `src/` from quietly undoing it. Every
 * rule corresponds to a claim the verification artefact
 * (`docs/verification/a11y/reduced-motion-on-off.webp`) makes:
 *
 *   global-motion-floor        `src/styles.css` carries a
 *                              `@media (prefers-reduced-motion: reduce)`
 *                              block that reduces animation duration,
 *                              transition duration and smooth scrolling
 *                              for EVERY element. This is the backstop
 *                              for motion nobody has classified.
 *   motion-without-hook        a component that emits an animation
 *                              declaration must tag its element with a
 *                              `data-motion="<name>"` hook, so the
 *                              opt-out can name it without depending on
 *                              a `data-testid` or a generated utility
 *                              class.
 *   motion-without-preference-check
 *                              that component must read the shared
 *                              preference contract, so the animation is
 *                              not emitted at all under reduced motion
 *                              — the resting markup IS the reduced
 *                              markup, which is the only version a unit
 *                              test can assert.
 *   motion-without-stylesheet-opt-out
 *                              every `MOTION_*` hook the contract
 *                              publishes must be named by a selector
 *                              inside a reduced-motion block in the
 *                              shipped stylesheet — i.e. the opt-out is
 *                              reachable by the CSS layer too, not only
 *                              by the render-time branch.
 *   no-unconditional-smooth-scroll
 *                              `scroll-behavior: smooth` is motion the
 *                              visitor did not ask for; the file that
 *                              asks for it must name its own
 *                              reduced-motion counterpart.
 *   no-autoplay-motion-media   autoplaying `<video>` / `<audio>` is
 *                              moving content that starts by itself
 *                              (WCAG 2.2 SC 2.2.2 Pause, Stop, Hide —
 *                              level A). The platform ships none; the
 *                              rule exists so the answer cannot become
 *                              "no" by accident later.
 *
 * What this gate does NOT establish, so a green run is not read as a
 * conformance claim:
 *
 *   - It is a TEXT rule over `src/**` and the stylesheets. It does not
 *     run a browser, so it cannot see motion the browser produces on
 *     its own (a library's keyframes, a UA scroll animation). The
 *     browser-side half of the evidence is
 *     `scripts/capture-a11y-reduced-motion.mjs`, which renders the real
 *     fixture in Chromium under both `no-preference` and `reduce` and
 *     fails if the reduced render still animates or loses its value.
 *   - It says nothing about whether a visitor can *read* the resting
 *     state. WCAG 2.3.3 Animation from Interactions is **AAA**, not
 *     A/AA, and the A/AA obligations this work carries (state readable
 *     without motion — 1.4.13 / 4.1.2 — and the 2.2.2 floor) need human
 *     evaluation with a screen reader. `docs/verification/a11y/README.md`
 *     records which claim is machine-checked and which is not.
 *   - `scripts/**` is out of scope, for the same reason
 *     `check-i18n-policy.mjs` excludes itself: the capture script has
 *     to be able to NAME the forbidden forms in order to render its
 *     evidence.
 *   - Test / story files are exempt — a fixture is allowed to force
 *     motion to prove the resting state is identical.
 *   - Colour / border / outline `transition`s are deliberately NOT
 *     listed as motion surfaces. They are state indication on an
 *     already-present property (WCAG 1.4.11 Non-text Contrast is about
 *     the state, not the interpolation), the universal floor reduces
 *     them, and demanding a per-component opt-out for each would put
 *     the rule in the way of the fix.
 *
 * Exit codes: 0 = clean, 1 = violations, 2 = bad input.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourceFiles, lineAt, stripComments, toRepoPath } from './_source-scan.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
/** The one stylesheet that ships to the browser document. */
export const SHIPPED_STYLESHEET = 'src/styles.css';

/** The contract components read their preference from. */
export const PREFERENCE_CONTRACT = 'src/editorial/reduced-motion';

/** The media query both layers are written against. */
export const REDUCED_MOTION_MEDIA = 'prefers-reduced-motion: reduce';

/** Declarations the universal reduced-motion floor must contain. */
export const FLOOR_DECLARATIONS = ['animation-duration', 'transition-duration', 'scroll-behavior'];

/** Path fragments that are generated or framework-owned. */
const SKIP_SEGMENTS = ['routeTree.gen.ts'];

/** File suffixes exempt from the scan (see the scope note above). */
const EXEMPT_SUFFIXES = [
	'.test.ts',
	'.test.tsx',
	'.spec.ts',
	'.spec.tsx',
	'.stories.ts',
	'.stories.tsx',
];

/** The source pattern that means "this component creates motion". */
export const MOTION_DECLARATION =
	/\banimation(?:Name|Duration|TimingFunction|FillMode|Delay|IterationCount)\s*:/g;

/** The source pattern that means "smooth scrolling nobody opted into". */
export const SMOOTH_SCROLL_DECLARATION = /\bscroll-?behavior\s*:\s*['"]?smooth\b/gi;

/** The source pattern that means "moving content that starts by itself". */
export const AUTOPLAY_MEDIA = /<(?:video|audio)\b[^>]*\bauto(?:Play|play)\b/gs;

/** WCAG criteria quoted by the human-evaluation half of the report. */
export const WCAG_MAPPING = [
	{
		sc: '2.2.2 Pause, Stop, Hide',
		level: 'A',
		claim: 'no moving content starts automatically and runs longer than five seconds',
		checkedBy:
			'machine (check-reduced-motion.mjs `no-autoplay-motion-media`) + capture (both renders are static)',
	},
	{
		sc: '1.4.13 Content on Hover or Focus',
		level: 'AA',
		claim:
			'the state a visitor triggers (hover / focus / pressed) is conveyed by something other than movement',
		checkedBy:
			'machine (reduced-motion fixture renders identically in both modes) + human (focus order and visible ring)',
	},
	{
		sc: '4.1.2 Name, Role, Value',
		level: 'A',
		claim:
			'the counter value is carried by an accessible name, so removing the animation removes no information',
		checkedBy: 'machine (vitest asserts the label in both modes) + human (screen-reader pass)',
	},
	{
		sc: '2.3.3 Animation from Interactions',
		level: 'AAA',
		claim: 'motion triggered by interaction can be turned off',
		checkedBy:
			'machine (preference contract + universal floor); noted as AAA so the A/AA claim is not inflated',
	},
];

/** Whether a repo-relative path is scanned at all. */
export function isScanned(scanPath) {
	if (!scanPath.startsWith('src/')) return false;
	if (SKIP_SEGMENTS.some((segment) => scanPath.endsWith(segment))) return false;
	if (EXEMPT_SUFFIXES.some((suffix) => scanPath.endsWith(suffix))) return false;
	return true;
}

/**
 * Extract every `@media (prefers-reduced-motion: reduce) { … }` block
 * from a stylesheet, with the 1-based line each block starts on.
 *
 * Brace matching rather than a regex body capture: these blocks nest
 * (`[data-motion] img { … }` inside the media block), and a non-greedy
 * capture would stop at the inner `}`.
 */
export function parseReducedMotionBlocks(css, scanPath = SHIPPED_STYLESHEET) {
	const blocks = [];
	const pattern = new RegExp(`@media[^{]*${REDUCED_MOTION_MEDIA}[^{]*\\{`, 'g');
	let match = pattern.exec(css);
	while (match !== null) {
		const bodyStart = match.index + match[0].length;
		let depth = 1;
		let i = bodyStart;
		while (i < css.length && depth > 0) {
			if (css[i] === '{') depth += 1;
			else if (css[i] === '}') depth -= 1;
			i += 1;
		}
		blocks.push({
			file: scanPath,
			startLine: lineAt(css, match.index),
			body: css.slice(bodyStart, i - 1),
		});
		match = pattern.exec(css);
	}
	return blocks;
}

/** The `data-motion="…"` hook names declared inside a CSS body. */
export function motionHooksIn(body) {
	const hooks = new Set();
	const pattern = /data-motion\s*=\s*["']([^"']+)["']/g;
	let match = pattern.exec(body);
	while (match !== null) {
		hooks.add(match[1]);
		match = pattern.exec(body);
	}
	return hooks;
}

/** CSS property names present in a body, lowercased. */
export function declarationsIn(body) {
	const declarations = new Set();
	const pattern = /([a-z-]+)\s*:/g;
	let match = pattern.exec(body);
	while (match !== null) {
		declarations.add(match[1].toLowerCase());
		match = pattern.exec(body);
	}
	return declarations;
}

/** Whether a reduced-motion block applies to every element (the floor). */
export function isUniversalBlock(body) {
	return /(^|[}\s])(?:\*|:where\(\s*\*)/.test(body);
}

/**
 * The stylesheet-side evidence: which `data-motion` hooks have a
 * reduced-motion selector, and whether the universal floor exists.
 */
export function readStylesheetContract(scanPath = SHIPPED_STYLESHEET) {
	const css = readFileSync(join(REPO_ROOT, scanPath), 'utf8');
	const blocks = parseReducedMotionBlocks(css, scanPath);
	const optedOutHooks = new Map();
	const floorDeclarations = new Set();
	let hasUniversalBlockSeen = false;
	for (const block of blocks) {
		for (const hook of motionHooksIn(block.body)) {
			if (!optedOutHooks.has(hook)) optedOutHooks.set(hook, block.startLine);
		}
		if (!isUniversalBlock(block.body)) continue;
		hasUniversalBlockSeen = true;
		for (const declaration of declarationsIn(block.body)) floorDeclarations.add(declaration);
	}
	return {
		file: scanPath,
		blockCount: blocks.length,
		optedOutHooks,
		floor: {
			hasUniversalBlock: hasUniversalBlockSeen,
			declarations: [...floorDeclarations],
			missing: FLOOR_DECLARATIONS.filter((name) => !floorDeclarations.has(name)),
		},
	};
}

/**
 * Every `MOTION_*` constant the contract module publishes, with the
 * hook name it carries, so the gate knows the names the shipped
 * components use instead of hard-coding a second copy of them.
 */
export function readContractConstants(contractPath = `${PREFERENCE_CONTRACT}.ts`) {
	const source = readFileSync(join(REPO_ROOT, contractPath), 'utf8');
	const constants = [];
	const pattern = /export const ([A-Z0-9_]+)\s*=\s*'([^']*)';/g;
	let match = pattern.exec(source);
	while (match !== null) {
		constants.push({ constant: match[1], name: match[2] });
		match = pattern.exec(source);
	}
	return constants;
}

/**
 * Whether a file reads the shared preference contract. Comments are
 * stripped first: prose that NAMES the contract is documentation, and
 * a rule that let a comment satisfy it would stay green on a component
 * that imports nothing.
 */
export function readsPreferenceContract(scanPath, code) {
	if (
		scanPath === PREFERENCE_CONTRACT ||
		scanPath.startsWith(`${PREFERENCE_CONTRACT}.`) ||
		scanPath.startsWith(`${PREFERENCE_CONTRACT}/`)
	) {
		return true;
	}
	const source = stripComments(code);
	return (
		/from\s*['"][^'"]*reduced-motion['"]/.test(source) ||
		/\busePrefersReducedMotion\s*\(/.test(source)
	);
}

/** A violation record. `wcag` is quoted so the CLI line is self-contained. */
function violation(rule, file, line, snippet, message, wcag) {
	return { rule, file, line, snippet, message, wcag };
}

/** One human-readable line per violation. */
export function formatViolation(entry) {
	return `${entry.file}:${entry.line} [${entry.rule}] ${entry.message} — saw: ${entry.snippet} (WCAG ${entry.wcag})`;
}

/**
 * Everything the gate (and the capture artefact) need: the stylesheet
 * contract, the contract's hook constants, the per-file findings, and
 * the motion inventory.
 */
export function collectEvidence(directory = SRC_ROOT) {
	const stylesheet = readStylesheetContract();
	const constants = readContractConstants();
	const files = collectSourceFiles(directory, (scanPath) => !isScanned(scanPath));
	const sources = new Map(
		files.map((file) => [toRepoPath(file), stripComments(readFileSync(file, 'utf8'))]),
	);

	const violations = [];
	if (!stylesheet.floor.hasUniversalBlock) {
		violations.push(
			violation(
				'global-motion-floor',
				SHIPPED_STYLESHEET,
				1,
				`@media (${REDUCED_MOTION_MEDIA})`,
				`no universal reduced-motion floor: one block must apply to every element (e.g. :where(*)) and declare ${FLOOR_DECLARATIONS.join(', ')}`,
				'2.2.2 Pause, Stop, Hide (A)',
			),
		);
	}
	for (const missing of stylesheet.floor.missing) {
		violations.push(
			violation(
				'global-motion-floor',
				SHIPPED_STYLESHEET,
				1,
				`@media (${REDUCED_MOTION_MEDIA})`,
				`the universal reduced-motion floor does not declare ${missing}`,
				'2.2.2 Pause, Stop, Hide (A)',
			),
		);
	}

	const surfaces = [];
	for (const [scanPath, code] of sources) {
		const motionLines = matchLines(code, MOTION_DECLARATION);
		const smoothLines = matchLines(code, SMOOTH_SCROLL_DECLARATION);
		const autoplayLines = matchLines(code, AUTOPLAY_MEDIA);

		if (motionLines.length > 0) {
			const declaresHook = /data-motion\s*=/.test(code);
			const readsContract = readsPreferenceContract(scanPath, code);
			if (!declaresHook) {
				violations.push(
					violation(
						'motion-without-hook',
						scanPath,
						motionLines[0].line,
						motionLines[0].snippet,
						'a component that animates must tag its element with data-motion="<name>" (the hook name comes from a MOTION_* constant in src/editorial/reduced-motion.ts) so the stylesheet can opt it out',
						'1.4.13 Content on Hover or Focus (AA)',
					),
				);
			}
			if (!readsContract) {
				violations.push(
					violation(
						'motion-without-preference-check',
						scanPath,
						motionLines[0].line,
						motionLines[0].snippet,
						'a component that animates must read the shared preference contract, so reduced motion emits no animation declaration at all',
						'1.4.13 Content on Hover or Focus (AA)',
					),
				);
			}
			const hook = declaresHook ? hookUsage(scanPath, code, constants) : [];
			surfaces.push({
				file: scanPath,
				kind: 'keyframe animation',
				declarationLines: motionLines.map((entry) => entry.line),
				renderTimeOptOut: readsContract,
				hooks: hook.map((entry) => entry),
				stylesheetOptOut:
					hook.length === 0
						? null
						: `${stylesheet.file}:${stylesheet.optedOutHooks.get(hook[0].name) ?? 'missing'}`,
				wcag: '2.3.3 Animation from Interactions (AAA); 1.4.13 Content on Hover or Focus (AA)',
			});
		}

		for (const entry of smoothLines) {
			violations.push(
				violation(
					'no-unconditional-smooth-scroll',
					scanPath,
					entry.line,
					entry.snippet,
					'smooth scrolling is motion the visitor did not ask for; this file must name its own reduced-motion counterpart (scroll-behavior: auto)',
					'2.3.3 Animation from Interactions (AAA)',
				),
			);
		}

		for (const entry of autoplayLines) {
			violations.push(
				violation(
					'no-autoplay-motion-media',
					scanPath,
					entry.line,
					entry.snippet,
					'autoplaying media is moving content that starts on its own and WCAG 2.2 SC 2.2.2 (A) requires a pause control; ship it paused behind a control',
					'2.2.2 Pause, Stop, Hide (A)',
				),
			);
		}
	}

	// A hook a component references but no stylesheet selector can reach
	// is a dead opt-out: the render-time branch would honour the
	// preference, but any motion applied later by CSS (a hover rule, a
	// re-render without the branch) would still animate.
	for (const surface of surfaces) {
		for (const hook of surface.hooks) {
			const line = stylesheet.optedOutHooks.get(hook.name);
			if (line) continue;
			violations.push(
				violation(
					'motion-without-stylesheet-opt-out',
					stylesheet.file,
					1,
					`data-motion="${hook.name}"`,
					`${hook.file}:${hook.line} uses ${hook.constant} ("${hook.name}") but no selector inside @media (${REDUCED_MOTION_MEDIA}) names it, so the CSS layer would still animate that element`,
					'1.4.13 Content on Hover or Focus (AA)',
				),
			);
		}
	}

	violations.sort(
		(a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
	);
	return { stylesheet, constants, surfaces, violations, fileCount: files.length };
}

/** Every match of `pattern` in `code`, with its line and a snippet. */
export function matchLines(code, pattern) {
	const compiled = new RegExp(pattern.source, pattern.flags);
	const found = [];
	let match = compiled.exec(code);
	while (match !== null) {
		found.push({
			line: lineAt(code, match.index),
			snippet: code
				.slice(match.index, match.index + 60)
				.split('\n')[0]
				.trim(),
		});
		match = compiled.exec(code);
	}
	return found;
}

/**
 * Which contract hook constants a component file actually references,
 * with the line of each reference.
 */
export function hookUsage(scanPath, code, constants) {
	const usages = [];
	for (const entry of constants) {
		const pattern = new RegExp(`data-motion\\s*=\\s*\\{\\s*${entry.constant}\\s*\\}`, 'g');
		const matches = matchLines(code, pattern);
		if (matches.length > 0) usages.push({ ...entry, file: scanPath, line: matches[0].line });
	}
	return usages;
}

/** Formatted violations across the whole `src/` tree (empty when clean). */
export function scanAllViolations() {
	return collectEvidence().violations.map(formatViolation);
}

/**
 * The gate output, including the motion inventory and the explicit
 * machine / human split. Shared with the capture script so the
 * artefact and CI print the same evidence from the same data.
 */
export function renderGateSummary() {
	const { stylesheet, surfaces, violations, fileCount } = collectEvidence();
	const lines = [`[a11y:reduced-motion:check] motion inventory (${fileCount} scanned src file(s))`];
	for (const surface of surfaces) {
		lines.push(
			`  ${surface.file} — ${surface.kind} at line(s) ${surface.declarationLines.join(', ')}; ` +
				`hook=${surface.hooks[0]?.name ?? 'none'}; ` +
				`render-time opt-out=${surface.renderTimeOptOut ? 'yes' : 'no'}; ` +
				`stylesheet opt-out=${surface.stylesheetOptOut ?? 'missing'}`,
		);
	}
	lines.push(
		`  ${stylesheet.file} — ${stylesheet.blockCount} reduced-motion block(s); universal floor: ${
			stylesheet.floor.missing.length === 0
				? stylesheet.floor.declarations
						.filter((name) => FLOOR_DECLARATIONS.includes(name))
						.join(', ')
				: `MISSING ${stylesheet.floor.missing.join(', ')}`
		}`,
	);
	lines.push('');
	lines.push(
		'[a11y:reduced-motion:check] machine-checked: opt-out pairing, universal floor presence, no autoplaying media, no unnamed smooth scroll',
	);
	lines.push(
		'[a11y:reduced-motion:check] NOT machine-checked: whether the resting state is readable (human evaluation: screen reader, contrast, focus order)',
	);
	return { lines, violations, surfaces };
}

function usage() {
	process.stderr.write(
		'usage: check-reduced-motion.mjs [--quiet]\n' +
			'  --quiet  print only violations and the final summary\n',
	);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg === '--help' || arg === '-h')) {
		usage();
		return 0;
	}
	if (args.some((arg) => arg !== '--quiet')) {
		usage();
		return 2;
	}
	const quiet = args.includes('--quiet');

	let srcStats;
	try {
		srcStats = statSync(SRC_ROOT);
	} catch {
		process.stderr.write(`missing src/ directory: ${SRC_ROOT}\n`);
		return 2;
	}
	if (!srcStats.isDirectory()) {
		process.stderr.write(`src/ is not a directory: ${SRC_ROOT}\n`);
		return 2;
	}

	const { lines, violations } = renderGateSummary();
	if (!quiet) process.stdout.write(`${lines.join('\n')}\n`);

	if (violations.length > 0) {
		process.stderr.write('\n[a11y:reduced-motion:check] reduced-motion contract violations:\n');
		for (const entry of violations) process.stderr.write(`- ${formatViolation(entry)}\n`);
		process.stderr.write(
			`\n[a11y:reduced-motion:check] FAILED: ${violations.length} violation(s) (Issue #403)\n`,
		);
		return 1;
	}

	process.stdout.write(
		'[a11y:reduced-motion:check] OK: every motion surface has a render-time opt-out and a stylesheet opt-out, the universal floor is present, and no autoplaying media ships\n',
	);
	return 0;
}

// Imported by the Issue #403 capture script; only the CLI invocation runs
// the gate.
const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
	process.exitCode = await main();
}
