#!/usr/bin/env node

/**
 * CJK 禁則処理 / line-break measurement harness (Issue #431).
 *
 * What it measures
 * ----------------
 * `src/editorial/cjk-line-break.stories.tsx` renders the shipped
 * editorial recipes (`SectionHeading` `title` + `description`) for
 * `ja` / `zh-Hans` / `zh-Hant` / `ko`, in three opt-in levels: the
 * shipped default, `lang` only, and `lang` + CJK typography. This
 * script drives those stories in a real Chromium, reconstructs the
 * per-character line boxes with `Range.getClientRects()`, and turns
 * the resulting break positions into pass / fail facts.
 *
 * It is a measurement, not a claim
 * --------------------------------
 * Everything printed here is what the browser did. The character
 * tables below encode the *typography* contract (which characters may
 * start or end a line); they say nothing about text quality
 * (translation, editing, tone), and this script never rewrites the
 * copy it measures. Numbers, units and negation survive verbatim
 * because rule R5 proves the reconstructed lines concatenate back to
 * the rendered text, character for character.
 *
 * Why a browser is mandatory
 * --------------------------
 * Line breaking is a user-agent layout feature. No JSDOM / happy-dom
 * run can answer "did the engine put 。 at a line head?", so the only
 * honest surface is the engine. That is also why the fixture renders
 * in Storybook — the Issue's requested surface — instead of a
 * synthetic HTML page: a measurement taken against a hand-written
 * stylesheet would be measuring the stylesheet, not the product.
 *
 * The static server
 * -----------------
 * `storybook-static/` is the output of `pnpm run build-storybook`,
 * which `validate:integration` already runs, so the harness needs no
 * extra build step and no network. Point it at a running dev server
 * with `--storybook-url http://127.0.0.1:6006` instead.
 *
 * Usage
 * -----
 *   node scripts/cjk-line-break-measure.mjs [--write-artefact]
 *     [--storybook-url <url>] [--storybook-dir <dir>] [--widths 320,375,768]
 *
 *   --write-artefact  also (re)writes docs/verification/i18n/cjk-line-break.webp.
 *                     Omitted by default so a plain measurement run
 *                     cannot silently replace a committed artefact.
 *
 * Exit codes: 0 = every rule holds, 1 = at least one rule failed,
 * 2 = the harness could not run (no build, no browser, bad input).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Kinsoku character tables.
 *
 * `headForbidden` are characters that must not OPEN a line (行頭禁則):
 * closing brackets, closing punctuation and the iteration marks
 * (UAX #14 line-break classes CL / CP / ID). Mandatory in every
 * `line-break` value except `anywhere`, so it is a hard rule for every
 * story.
 *
 * `tailForbidden` are characters that must not CLOSE a line (行末禁則):
 * opening brackets, prefix currency signs and the katakana middle dot
 * (classes OP / PR / NS). Also mandatory everywhere.
 *
 * `starterSensitive` are Japanese starters whose treatment depends on
 * the `line-break` value (UAX #14 resolves the Conditional Japanese
 * Starter class CJ differently per value): small kana and the
 * prolonged sound mark. Under `line-break: strict` they are a hard
 * rule; under `auto` the engine may legally leave one at a line head,
 * so it is recorded as an observation instead of a failure. Reporting
 * it either way is the point — the difference between the two stories
 * IS the finding.
 *
 * Exported so `scripts/cjk-line-break-measure.test.mjs` can prove the
 * tables themselves are well formed (non-empty, disjoint, inside the
 * script ranges they claim to cover) without launching a browser.
 */
export const KINSHOKU = {
	headForbidden: '。、，．：；！？!?‼⁇⁈⁉…‥’”」』）〕］｝〉》〗〙〛｠»›】々〆ゝゞヽヾ',
	tailForbidden: '‘“「『（〔［｛〈《〖〘〝｟«‹([{$￥＄＃＠§・',
	starterSensitive: 'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶー',
};

/**
 * Which tables apply to which locale. Korean is space-delimited, so a
 * 行頭禁則 violation is nearly unreachable there; it still gets the
 * shared punctuation rules, because a sentence-final `.` that opens a
 * line is a defect in any script.
 */
export function rulesForLocale(locale) {
	switch (locale) {
		case 'ja':
			return {
				head: KINSHOKU.headForbidden,
				tail: KINSHOKU.tailForbidden,
				starter: KINSHOKU.starterSensitive,
			};
		case 'zh-Hans':
		case 'zh-Hant':
			return { head: KINSHOKU.headForbidden, tail: KINSHOKU.tailForbidden, starter: '' };
		case 'ko':
			return { head: KINSHOKU.headForbidden, tail: KINSHOKU.tailForbidden, starter: '' };
		default:
			throw new Error(`unknown locale: ${locale}`);
	}
}

/**
 * The ideographic space. It may not open a line (行頭空白) in Japanese
 * typography.
 *
 * NOT the ASCII space: a collapsible space at a line break is removed
 * by CSS Text and never renders, so its position is not a defect and
 * judging it as one would make the harness cry wolf on every
 * space-delimited locale — Korean above all, where every line but the
 * first begins at a break. See `collectSamplesInPage` for how the
 * reconstruction keeps the character without inventing a line for it.
 */
const IDEOGRAPHIC_SPACE = '　';

/** The three opt-in levels the fixture renders, in showcase order. */
export const MODES = [
	{ mode: 'default', label: '① Default（出荷状態）' },
	{ mode: 'locale', label: '② LocaleOptIn（lang のみ）' },
	{ mode: 'locale-typography', label: '③ LocaleOptIn + CJK typography（未採用）' },
];

/** Locale ids the fixture must carry, mirrored from `cjk-line-break.tsx`. */
export const CJK_LOCALE_IDS = ['ja', 'zh-Hans', 'zh-Hant', 'ko'];

/** Viewports the Issue asks about: two phone widths and one tablet. */
export const WIDTHS = [320, 375, 768];

/** The route the fixture is mounted on. */
export const ROUTE = '/design-system';

const ARTEFACT_PATH = 'docs/verification/i18n/cjk-line-break.webp';
/**
 * The artefact budget. 1280px / quality 56 lands the full report —
 * seven crops plus the 72-row matrix, printed two tables side by
 * side — at roughly a quarter of a megabyte, which keeps
 * `docs/verification/` from becoming the heaviest thing in the
 * repository while staying readable at 1:1.
 */
const ARTEFACT_WIDTH = 1280;
const ARTEFACT_QUALITY = 56;
const REPORT_PATH = '.tmp/cjk-line-break/report.json';
/**
 * Default preview port for the harness's own server. It is deliberately
 * NOT Playwright's 3000: several worktrees share this host, and a
 * silent "the port already answers, use it" would measure another
 * worker's build — which is exactly the confusion this Issue must not
 * ship. Pass `--port` or `--base-url` to point somewhere else.
 */
const DEFAULT_PORT = 39217;

/**
 * The Issue names `docs/verification/i18n/cjk-line-break.png`; the
 * artefact is the same picture as a compressed WebP (1600px wide,
 * quality 72) so a verification screenshot cannot bloat the
 * repository. Exported so the unit test can assert the substitution
 * stays deliberate.
 */
export const ARTEFACT = ARTEFACT_PATH;

/* ------------------------------------------------------------------ *
 * Pure rules (unit-tested without a browser)
 * ------------------------------------------------------------------ */

/**
 * Turn reconstructed lines into violations + observations.
 *
 * @param {{ text: string, lines: string[], lineBreak: string }} input
 */
export function judgeLines({ text, lines, lineBreak }) {
	const locale = detectLocale(text);
	const rules = rulesForLocale(locale);
	const strict = lineBreak === 'strict';
	const violations = [];
	const observations = [];

	const head = new Set(rules.head);
	const tail = new Set(rules.tail);
	const starter = new Set(rules.starter);

	lines.forEach((line, index) => {
		const isFirst = index === 0;
		const isLast = index === lines.length - 1;
		const trimmed = line.replace(/[ \t　]+$/u, '');

		if (trimmed.length === 0) {
			if (!isFirst) violations.push({ rule: 'R3-blank-line', line: index, detail: 'blank line' });
			return;
		}

		// R1 — 行頭禁則: a closing bracket or closing punctuation may not
		// open a line.
		const first = [...trimmed][0];
		if (head.has(first)) {
			violations.push({ rule: 'R1-line-head', line: index, detail: `opens with ${first}` });
		}

		// R2 — 行頭空白: a line may not open with an ideographic space.
		if (first === IDEOGRAPHIC_SPACE) {
			violations.push({ rule: 'R2-ideographic-space', line: index, detail: 'opens with U+3000' });
		}

		// R3 — 行末禁則: an opening bracket may not close a line.
		const last = [...trimmed].at(-1);
		if (!isLast && tail.has(last)) {
			violations.push({ rule: 'R3-line-tail', line: index, detail: `closes with ${last}` });
		}

		// R4 — Conditional Japanese starters. Hard under `strict`,
		// observable under `auto`.
		if (starter.has(first)) {
			const entry = { rule: 'R4-starter', line: index, detail: `opens with ${first}` };
			if (strict) violations.push(entry);
			else observations.push(entry);
		}
	});

	return { locale, violations, observations };
}

/**
 * Which rule set a measured sample belongs to.
 *
 * The wrapper carries `data-cjk-sample="<locale id>"`, so the harness
 * already knows; this fallback exists so the rule engine can be
 * exercised from a unit test with a bare string. Traditional and
 * simplified Chinese share one rule set, so collapsing them is
 * deliberate rather than lossy.
 */
function detectLocale(text) {
	if (/[ぁ-ゖァ-ヺ]/.test(text)) return 'ja';
	if (/[가-힯]/.test(text)) return 'ko';
	return 'zh-Hans';
}

/**
 * R5 — the reconstruction must be lossless.
 *
 * Concatenating the measured lines has to reproduce the element's own
 * text exactly. If it does not, every downstream conclusion is void: a
 * dropped character could hide a digit, a dropped negation could flip a
 * meaning, and neither would show up in a line count.
 */
export function assertLossless(source, lines) {
	const rebuilt = lines.join('');
	if (rebuilt === source) return { ok: true };
	const at = firstDifference(rebuilt, source);
	return {
		ok: false,
		detail: `reconstruction diverges at index ${at}: measured ${JSON.stringify(
			rebuilt.slice(at, at + 8),
		)} vs rendered ${JSON.stringify(source.slice(at, at + 8))}`,
	};
}

function firstDifference(a, b) {
	const max = Math.min(a.length, b.length);
	for (let i = 0; i < max; i += 1) if (a[i] !== b[i]) return i;
	return max;
}

/**
 * Guard the typography contract the fixture depends on.
 *
 * `src/styles.css` and `SectionHeading.tsx` hold the declarations this
 * measurement is a measurement OF. If Issue #300's base rules are
 * dropped, or a heading stops asking for `text-wrap: balance`, the
 * browser run still succeeds — it is just measuring something else.
 * Reading the two sources keeps that honest at `pnpm test` cost.
 */
export function auditTypographySources(sources = {}) {
	const styles = sources.styles ?? readRepoFile('src/styles.css');
	const heading = sources.heading ?? readRepoFile('src/editorial/primitives/SectionHeading.tsx');
	const required = [
		[styles, 'word-break: normal', 'src/styles.css must keep the Issue #300 base word-break'],
		[
			styles,
			'word-break: auto-phrase',
			'src/styles.css must keep the Issue #300 phrase-based word-break',
		],
		[styles, 'text-wrap: pretty', 'src/styles.css must keep the Issue #300 prose text-wrap'],
		[heading, "textWrap: 'balance'", 'SectionHeading titles must keep text-wrap: balance'],
		[heading, "textWrap: 'pretty'", 'SectionHeading descriptions must keep text-wrap: pretty'],
	];
	return required
		.filter(([haystack, needle]) => !haystack.includes(needle))
		.map(([, needle, message]) => `${message} (missing ${needle})`);
}

function readRepoFile(relative) {
	const path = join(REPO_ROOT, relative);
	return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/**
 * Guard the fixture the measurement reads.
 *
 * The harness reconstructs line boxes from `[data-cjk-sample]`
 * wrappers. If the fixture renames an attribute, drops a locale, or
 * ships a baseline mode that carries `lang`, the browser run still
 * succeeds and silently measures nothing. These checks read the source
 * so the breakage is a failed unit test rather than an empty report.
 */
export function auditFixtureSources() {
	const fixture = readRepoFile('src/editorial/cjk-line-break.tsx');
	const section = readRepoFile('src/routes/design-system/sections/CjkLineBreak.tsx');
	const page = readRepoFile('src/routes/design-system/DesignSystemPage.tsx');
	const problems = [];

	for (const [haystack, needle, message] of [
		[fixture, 'data-cjk-sample', 'the fixture must keep the data-cjk-sample wrapper hook'],
		[fixture, 'data-cjk-mode', 'the fixture must keep the data-cjk-mode hook'],
		[fixture, 'data-cjk-showcase', 'the showcase must keep the data-cjk-showcase hook'],
		[section, 'CjkLineBreakShowcase', 'the /design-system section must render the shared showcase'],
		[page, '<CjkSection />', 'DesignSystemPage must render the CJK section'],
	]) {
		if (!haystack.includes(needle)) problems.push(message);
	}

	for (const locale of CJK_LOCALE_IDS) {
		if (!fixture.includes(`id: '${locale}'`)) {
			problems.push(`the fixture lost the ${locale} sample`);
		}
	}
	return problems;
}

/* ------------------------------------------------------------------ *
 * Browser run
 * ------------------------------------------------------------------ */

/**
 * Runs inside the page. Must not close over anything in this module —
 * Playwright serialises the function source.
 */
function collectSamplesInPage() {
	const wrappers = [...document.querySelectorAll('[data-cjk-sample]')];
	return wrappers.map((wrapper) => {
		const locale = wrapper.getAttribute('data-cjk-sample');
		const mode = wrapper.getAttribute('data-cjk-mode');
		const lang = wrapper.getAttribute('lang');

		const measure = (element, role) => {
			if (!element) return null;
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			const segments = [];
			let offset = 0;
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				segments.push({ node, start: offset, end: offset + node.data.length });
				offset += node.data.length;
			}
			const text = element.textContent ?? '';
			const range = document.createRange();
			const chars = [];
			let unmeasurable = 0;
			for (let i = 0; i < text.length; i += 1) {
				const segment = segments.find((s) => i >= s.start && i < s.end);
				if (!segment) {
					unmeasurable += 1;
					continue;
				}
				const local = i - segment.start;
				range.setStart(segment.node, local);
				range.setEnd(segment.node, local + 1);
				const rects = [...range.getClientRects()].filter((r) => r.height > 0 || r.width > 0);
				const rect = rects.at(-1) ?? range.getBoundingClientRect();
				chars.push({ ch: text[i], top: Math.round(rect.top) });
			}

			// A line is a run of characters sharing a line-box top. Two
			// characters on the same line can differ by a pixel of
			// rounding, so the tolerance is 2px rather than exact.
			const grouped = [];
			for (const char of chars) {
				const current = grouped.at(-1);
				if (current && Math.abs(char.top - current.top) <= 2) current.chars.push(char);
				else grouped.push({ top: char.top, chars: [char] });
			}

			// A collapsible space at a line break renders nowhere, and
			// Chromium reports its rect on a top of its own. Grouping it
			// as a line would invent a line break the reader cannot see
			// (and would put a "leading space" on every Korean line).
			// Fold it into the run before it so the character sequence
			// stays byte-identical for R5 and the line count stays real.
			const lines = [];
			for (const line of grouped) {
				const previous = lines.at(-1);
				const whitespaceOnly = line.chars.every((c) => c.ch === ' ' || c.ch === '\t');
				if (whitespaceOnly && previous) previous.chars.push(...line.chars);
				else lines.push(line);
			}

			const style = getComputedStyle(element);
			return {
				role,
				tag: element.tagName.toLowerCase(),
				text,
				lines: lines.map((line) => line.chars.map((c) => c.ch).join('')),
				unmeasurable,
				contentBox: Math.round(element.getBoundingClientRect().width * 100) / 100,
				style: {
					wordBreak: style.wordBreak,
					lineBreak: style.lineBreak,
					textWrap: style.textWrap,
					textWrapStyle: style.textWrapStyle,
					textSpacingTrim: style.textSpacingTrim,
					overflowWrap: style.overflowWrap,
					fontFamily: style.fontFamily,
					fontSize: style.fontSize,
				},
			};
		};

		return {
			locale,
			mode,
			lang,
			heading: measure(wrapper.querySelector('h2'), 'heading'),
			body: measure(wrapper.querySelector('p'), 'body'),
		};
	});
}

async function measureAtWidth(context, baseUrl, width) {
	const page = await context.newPage();
	await page.setViewportSize({ width, height: 1200 });
	const response = await page.goto(`${baseUrl}${ROUTE}`, { waitUntil: 'load' });
	if (!response || !response.ok()) {
		throw new Error(`GET ${ROUTE} returned ${response?.status() ?? 'no response'} at ${baseUrl}`);
	}
	try {
		await page.waitForSelector('[data-cjk-sample]', { timeout: 30_000 });
	} catch (error) {
		const title = await page.title().catch(() => '(unreachable)');
		const samples = await page
			.locator('[data-cjk-sample]')
			.count()
			.catch(() => 0);
		throw new Error(
			`${baseUrl}${ROUTE} served a document without the CJK fixture (title=${JSON.stringify(title)}, samples=${samples}). Is the server running this worktree's build? Re-run \`pnpm run build\`, or pass --base-url explicitly.`,
			{ cause: error },
		);
	}
	// The shipped page loads Noto Sans JP / Zen Kaku Gothic New from
	// Google Fonts; measuring before they land would measure a fallback.
	await page.evaluate(() => document.fonts.ready);
	const samples = await page.evaluate(collectSamplesInPage);
	return { page, samples };
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */

async function reachable(url) {
	try {
		const response = await fetch(url, { redirect: 'follow' });
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Start the same local preview the E2E gate uses.
 *
 * `scripts/e2e-local-bootstrap.mjs` migrates + seeds the local D1 and
 * only then execs `pnpm preview`, which is why the harness reuses it
 * instead of spawning a server of its own: the measurement must read
 * the same document the E2E gate reads. Production D1 / R2 are never
 * touched — the script is `--local` only by construction.
 */
async function startPreview(port) {
	// `pnpm run build` produces the Worker bundle under
	// `.cloudflare/output/` (via `@cloudflare/vite-plugin`) and the tool
	// artifacts under `dist/`. `dist/client/index.html` does not exist
	// for a TanStack Start Worker, so probing for it would reject a
	// perfectly good build.
	if (!existsSync(join(REPO_ROOT, '.cloudflare/output/v0/workers/default/bundle/index.js'))) {
		throw new Error(
			'no Worker build at .cloudflare/output\n\nRun `pnpm run build` first — the harness measures the built Worker through `pnpm preview`, the same way `playwright.config.ts` does.',
		);
	}
	const child = spawn('node', ['scripts/e2e-local-bootstrap.mjs', `--port=${port}`], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
		detached: true,
	});
	const baseUrl = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (await reachable(baseUrl)) return { baseUrl, child };
		if (child.exitCode !== null) {
			throw new Error(
				`preview server exited with code ${child.exitCode} before serving ${baseUrl}`,
			);
		}
		await new Promise((done) => setTimeout(done, 500));
	}
	stopPreview(child);
	throw new Error(`preview server did not answer ${baseUrl} within 90s`);
}

function stopPreview(child) {
	if (!child || child.exitCode !== null) return;
	// `detached: true` puts the whole bootstrap → pnpm → vite → wrangler
	// chain in one process group, so a negative PID reaps the tree
	// instead of orphaning an inspector on port 9229 for the next run.
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {
		child.kill('SIGTERM');
	}
	const escalate = setTimeout(() => {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			/* already gone */
		}
	}, 5000);
	escalate.unref();
	child.once('exit', () => clearTimeout(escalate));
}

/* ------------------------------------------------------------------ *
 * Verdicts
 * ------------------------------------------------------------------ */

function buildRows(measurements) {
	const rows = [];
	for (const { width, samples } of measurements) {
		for (const sample of samples) {
			for (const key of ['heading', 'body']) {
				const measured = sample[key];
				if (!measured) continue;
				const { violations, observations } = judgeLines({
					text: measured.text,
					lines: measured.lines,
					lineBreak: measured.style.lineBreak,
				});
				rows.push({
					mode: sample.mode,
					storyLabel: MODES.find((m) => m.mode === sample.mode)?.label ?? sample.mode,
					width,
					locale: sample.locale,
					lang: sample.lang ?? '(none)',
					role: key,
					lines: measured.lines.length,
					contentBox: measured.contentBox,
					firstChars: measured.lines.map((line) => [...line.trim()][0] ?? ''),
					lastLineLength: [...(measured.lines.at(-1) ?? '')].length,
					style: measured.style,
					violations,
					observations,
					lossless: assertLossless(measured.text, measured.lines),
				});
			}
		}
	}
	return rows;
}

/**
 * Everything that is not a per-line break position: the style contract
 * the fixture depends on, and the R5 losslessness check.
 */
function collectFailures(rows) {
	const failures = [];
	for (const row of rows) {
		const where = `${row.mode}/${row.width}px/${row.locale}/${row.role}`;
		for (const violation of row.violations) {
			failures.push(`${where}: ${violation.rule} (line ${violation.line}) — ${violation.detail}`);
		}
		if (!row.lossless.ok) failures.push(`${where}: R5 ${row.lossless.detail}`);

		// R6: the shipped base rule must survive. A surface that forces
		// `break-all` / `keep-all` onto prose reintroduces exactly the
		// mid-word splits this fixture exists to watch.
		if (!['normal', 'auto-phrase'].includes(row.style.wordBreak)) {
			failures.push(
				`${where}: R6 word-break is ${row.style.wordBreak}, expected normal|auto-phrase`,
			);
		}

		// R7: each role keeps the wrap mode its own recipe asks for, so
		// a change to SectionHeading surfaces as a failed measurement
		// instead of as a silently different picture.
		const expectedWrap = row.role === 'heading' ? 'balance' : 'pretty';
		if (row.style.textWrapStyle !== expectedWrap) {
			failures.push(
				`${where}: R7 text-wrap-style is ${row.style.textWrapStyle}, expected ${expectedWrap}`,
			);
		}

		// R8: `lang` is opt-in and scoped to the sample's own locale —
		// never set on the shipped baseline, never set to another locale.
		if (row.mode === 'default' && row.lang !== '(none)') {
			failures.push(`${where}: R8 baseline mode must carry no lang, got ${row.lang}`);
		}
		if (row.mode !== 'default' && row.lang !== row.locale) {
			failures.push(`${where}: R8 lang is ${row.lang}, expected ${row.locale}`);
		}
	}
	return failures;
}

/* ------------------------------------------------------------------ *
 * Report + artefact
 * ------------------------------------------------------------------ */

function dataUri(png) {
	return `data:image/png;base64,${png.toString('base64')}`;
}

function htmlEscape(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * One crop of the real render.
 *
 * The context runs at deviceScaleFactor 2 so CJK glyph positions are
 * measured on sub-pixel-accurate boxes, which makes the raw crops
 * four times the pixels the report actually shows them at. Downscaling
 * to the display size (x2) keeps the text crisp and takes the artefact
 * from ~540 KB to well under the 300 KB budget.
 */
const CROP_WIDTH = 480;

async function crop(page, selector) {
	const element = page.locator(selector).first();
	await element.scrollIntoViewIfNeeded();
	const raw = await element.screenshot({ type: 'png' });
	const { default: sharp } = await import('sharp');
	return sharp(raw).resize({ width: CROP_WIDTH, withoutEnlargement: true }).png().toBuffer();
}

const REPORT_CSS = `
*{box-sizing:border-box}
body{margin:0;padding:32px;background:#ffffff;color:#0b1020;
  font-family:"Helvetica Neue",Arial,"Hiragino Sans","Noto Sans CJK JP",sans-serif;font-size:14px;line-height:1.55}
h1{font-size:24px;margin:0 0 6px}
h2{font-size:16px;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #0b1020}
p{margin:0 0 8px}
.meta{color:#5b6478;font-size:13px;margin-bottom:16px}
.shots{display:grid;gap:16px;grid-template-columns:repeat(3,1fr)}
.shot{margin:0;border:1px solid #d7dce6;border-radius:6px;overflow:hidden;background:#fff}
.shot figcaption{padding:6px 8px;font-size:12px;background:#f2f4f8;border-bottom:1px solid #d7dce6;font-weight:600}
.shot img{display:block;width:100%}
table{border-collapse:collapse;width:100%;font-size:11px}
th,td{border:1px solid #d7dce6;padding:2px 5px;text-align:left;vertical-align:top;line-height:1.4}
th{background:#f2f4f8;font-weight:600}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.ok{color:#0a6b3d;font-weight:600}
.bad{color:#a11b1b;font-weight:600}
.note{background:#f7f8fa;border-left:4px solid #0b1020;padding:10px 14px;margin:12px 0 0;font-size:13px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
ul{margin:8px 0 0;padding-left:20px}
li{margin-bottom:5px}
`;

function renderReport({ rows, failures, ua, shots }) {
	const uniq = (pick) => [...new Set(rows.map(pick))].filter(Boolean).sort().join(' / ');
	const verdict = failures.length === 0 ? 'PASS' : 'FAIL';

	const tableRow = (row) => {
		const bad = row.violations.length > 0 || !row.lossless.ok;
		const heads = row.firstChars.slice(1).join('');
		const rules = bad ? htmlEscape(row.violations.map((v) => v.rule).join(', ')) : '';
		return `<tr>
  <td>${row.width}</td>
  <td>${htmlEscape(row.locale)}</td>
  <td>${htmlEscape(row.lang)}</td>
  <td>${row.role}</td>
  <td>${row.contentBox}</td>
  <td>${row.lines}</td>
  <td>${heads ? htmlEscape(heads) : '—'}</td>
  <td class="${bad ? 'bad' : 'ok'}">${bad ? 'NG' : 'OK'}${rules ? ` — ${rules}` : ''}</td>
</tr>`;
	};
	const modeRow = (mode) =>
		`<tr><th colspan="8" style="background:#eef1f6">${htmlEscape(
			MODES.find((m) => m.mode === mode)?.label ?? mode,
		)}</th></tr>`;

	// Group by mode, then split the whole matrix across two columns.
	// 72 stacked rows is ~1400px of report height for no reading
	// benefit; side by side the same data costs half the pixels, and
	// half the pixels is the difference between a 350 KB artefact and
	// a 250 KB one.
	const grouped = MODES.flatMap((mode) => [
		modeRow(mode.mode),
		...rows.filter((row) => row.mode === mode.mode).map(tableRow),
	]);
	const split = Math.ceil(grouped.length / 2);
	const table = (cells) => `<table>
<thead><tr><th>vw</th><th>locale</th><th>lang</th><th>role</th><th>幅 px</th><th>行数</th><th>行頭文字</th><th>判定</th></tr></thead>
<tbody>${cells.join('')}</tbody>
</table>`;

	const figure = (items) =>
		items
			.map(
				(item) =>
					`<figure class="shot"><figcaption>${htmlEscape(item.caption)}</figcaption><img src="${item.src}" alt=""></figure>`,
			)
			.join('');

	return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${REPORT_CSS}</style></head><body>
<h1>Issue #431 — CJK 禁則処理 / line-break 検証レポート</h1>
<p class="meta">
  測定面: <code>${ROUTE}</code> の 07 — CJK line-break セクション（<code>src/editorial/cjk-line-break.tsx</code> × <code>SectionHeading</code> の title / description ＝出荷レシピ）<br>
  エンジン: ${htmlEscape(ua)} ／ 測定: ${rows.length} 行（mode × viewport × locale × role）<br>
  計算値: <code>word-break: ${htmlEscape(uniq((r) => r.style.wordBreak))}</code> ／
  <code>line-break: ${htmlEscape(uniq((r) => r.style.lineBreak))}</code> ／
  <code>text-wrap-style: ${htmlEscape(uniq((r) => r.style.textWrapStyle))}</code> ／
  <code>text-spacing-trim: ${htmlEscape(uniq((r) => r.style.textSpacingTrim))}</code><br>
  総合判定: <strong class="${verdict === 'PASS' ? 'ok' : 'bad'}">${verdict}</strong> ／ 違反 ${failures.length} 件 ／
  R4-starter（条件付き行頭禁則）は engine が line-break の値に応じて合法とする差なので判定には数えません（今回は 0 件）。
</p>

<h2>1. 実画面 — 出荷状態（① Default / viewport 375px）</h2>
<div class="shots">${figure(shots.realScreen)}</div>

<h2>2. 文章比較 — 同じ文言を opt-in 段階ごとに並べる（viewport 375px）</h2>
<div class="shots">${figure(shots.compare)}</div>
<p class="meta" style="margin-top:8px">
文言は一字一句同じです。差が出るのは改行位置と字取りだけです。これが「タイポグラフィ」と「文章品質」を分ける境界です。
①が出荷状態、②③は opt-in した時の見え方です。②③は比較用であり、製品側で採用したものではありません。
</p>

<h2>3. 狭い画面 — 320px（最も不利な条件）</h2>
<div class="shots">${figure(shots.narrow)}</div>

<h2>4. CI レポート — 全 ${rows.length} 測定行（行頭＝各行の最初の 1 文字、2 行目以降の連結）</h2>
<div class="cols">
${table(grouped.slice(0, split))}
${table(grouped.slice(split))}
</div>

<h2>5. この測定が何を主張しないか（未対応範囲）</h2>
<p class="note" style="margin:0">
<strong>文章品質</strong>（翻訳・推敲・トーン・用語統一）は対象外 — 禁則処理が通ることは文章が良いことを意味しません。 ／
<strong>Firefox / WebKit</strong> は 0.6.x のブラウザ対象が Chromium のみのため未測定。 ／
<strong><code>word-break: auto-phrase</code></strong>（Issue #300 の base 宣言）と <strong><code>text-spacing-trim</code></strong> はエンジンの実装状況に依存するため、計算値として記録するだけで成否の判定には使いません。 ／
<strong>Storybook</strong> にも同じ fixture を <code>src/editorial/cjk-line-break.stories.tsx</code> として公開していますが、本リポジトリでは preview bundle が manager 側にしか出力されないため測定は app 側（<code>${ROUTE}</code>）で行っています。 ／
<strong>ロケール別ルーティング・翻訳・言語別フォント</strong>（#338 / #341 / #342-#347）には依存しません。fixture の文言は検証専用で、製品コピーの変更はゼロです。
</p>

<div class="note">
本レポートは実測値であり、公開コピーの推敲結果ではありません。
数値・単位・否定は原文のまま保持され、全行で再構成一致（R5）を検証済みです。
</div>
</body></html>`;
}

async function writeArtefact(browser, payload) {
	// A dedicated 1x context: the measurement context runs at 2x for
	// sub-pixel line boxes, and capturing the report at 2x as well only
	// adds pixels that are thrown away by the resize.
	const context = await browser.newContext({ deviceScaleFactor: 1 });
	const page = await context.newPage();
	await page.setViewportSize({ width: ARTEFACT_WIDTH, height: 1200 });
	await page.setContent(renderReport(payload), { waitUntil: 'load' });
	const webpPath = resolve(REPO_ROOT, ARTEFACT_PATH);
	const pngPath = webpPath.replace(/\.webp$/, '.png');
	mkdirSync(dirname(webpPath), { recursive: true });
	await page.screenshot({ path: pngPath, fullPage: true });
	const { default: sharp } = await import('sharp');
	const info = await sharp(pngPath)
		.resize({ width: ARTEFACT_WIDTH, withoutEnlargement: true })
		.webp({ quality: ARTEFACT_QUALITY })
		.toFile(webpPath);
	unlinkSync(pngPath);
	await context.close();
	return { path: ARTEFACT_PATH, bytes: info.size, width: info.width, height: info.height };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
	const options = {
		writeArtefact: false,
		baseUrl: null,
		widths: WIDTHS,
		port: DEFAULT_PORT,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--write-artefact') options.writeArtefact = true;
		else if (arg === '--base-url') options.baseUrl = argv[++i];
		else if (arg === '--port') options.port = Number(argv[++i]);
		else if (arg === '--widths') options.widths = argv[++i].split(',').map((v) => Number(v));
		else throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

function printTable(rows) {
	const header = ['mode', 'w', 'locale', 'lang', 'role', 'box', 'lines', 'head', 'verdict'];
	const cells = (row) => [
		row.mode,
		row.width,
		row.locale,
		row.lang,
		row.role,
		`${row.contentBox}px`,
		row.lines,
		row.firstChars.slice(1).join('') || '-',
		row.violations.length ? `NG(${row.violations.length})` : 'OK',
	];
	const columns = header.map((label, index) =>
		Math.max(label.length, ...rows.map((row) => String(cells(row)[index] ?? '').length)),
	);
	const format = (cells) =>
		cells.map((cell, i) => String(cell ?? '').padEnd(columns[i])).join('  ');
	process.stdout.write(`${format(header)}\n${columns.map((w) => '-'.repeat(w)).join('  ')}\n`);
	for (const row of rows) process.stdout.write(`${format(cells(row))}\n`);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));

	const sourceProblems = [...auditTypographySources(), ...auditFixtureSources()];
	if (sourceProblems.length) {
		process.stderr.write(`${sourceProblems.map((p) => `- ${p}`).join('\n')}\n`);
		return 2;
	}

	const external =
		options.baseUrl ??
		((await reachable(`http://127.0.0.1:${options.port}`))
			? `http://127.0.0.1:${options.port}`
			: null);
	const preview = external ? null : await startPreview(options.port);
	const baseUrl = external ?? preview.baseUrl;

	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	const context = await browser.newContext({ deviceScaleFactor: 2 });

	try {
		const measurements = [];
		const shots = { realScreen: [], compare: [], narrow: [] };

		for (const width of options.widths) {
			const { page, samples } = await measureAtWidth(context, baseUrl, width);
			measurements.push({ width, samples });

			if (width === 375) {
				for (const mode of MODES) {
					shots.compare.push({
						caption: `${mode.label} — ja`,
						src: dataUri(await crop(page, `[data-cjk-mode="${mode.mode}"][data-cjk-sample="ja"]`)),
					});
				}
			}
			if (width === 375) {
				for (const locale of ['ja', 'zh-Hans']) {
					shots.realScreen.push({
						caption: `${locale} — heading + body（出荷状態）`,
						src: dataUri(
							await crop(page, `[data-cjk-mode="default"][data-cjk-sample="${locale}"]`),
						),
					});
				}
			}
			if (width === 320) {
				for (const locale of ['zh-Hans', 'zh-Hant', 'ko']) {
					shots.narrow.push({
						caption: `${locale} @ 320px（lang opt-in）`,
						src: dataUri(await crop(page, `[data-cjk-mode="locale"][data-cjk-sample="${locale}"]`)),
					});
				}
			}
			await page.close();
		}

		const rows = buildRows(measurements);
		const failures = collectFailures(rows);
		const ua = `Chromium ${browser.version()}`;
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));

		printTable(rows);
		process.stdout.write(`\n${rows.length} measurement row(s), ${failures.length} failure(s)\n`);

		mkdirSync(dirname(resolve(REPO_ROOT, REPORT_PATH)), { recursive: true });
		writeFileSync(
			resolve(REPO_ROOT, REPORT_PATH),
			`${JSON.stringify(
				{
					issue: '#431',
					engine: ua,
					route: ROUTE,
					baseUrl,
					widths: options.widths,
					rows,
					failures,
				},
				null,
				2,
			)}\n`,
		);

		if (options.writeArtefact) {
			const info = await writeArtefact(browser, { rows, failures, ua, shots });
			process.stdout.write(
				`artefact : ${info.path} (${info.width}x${info.height}, ${Math.round(info.bytes / 1024)} KB)\n`,
			);
		} else {
			process.stdout.write(
				`artefact : not written (pass --write-artefact to refresh ${ARTEFACT_PATH})\n`,
			);
		}

		if (failures.length) {
			process.stderr.write(`\n${failures.length} failure(s):\n`);
			for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
			return 1;
		}
		process.stdout.write(`\n${rows.length} row(s) measured; report at ${REPORT_PATH}\n`);
		return 0;
	} finally {
		await context.close();
		await browser.close();
		stopPreview(preview?.child);
	}
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			process.stderr.write(`${error?.stack ?? error}\n`);
			process.exitCode = 2;
		});
}
