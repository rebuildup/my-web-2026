#!/usr/bin/env node
/**
 * layout-audit-check — quantitative grid gates for the public pages
 * (Issue #300).
 *
 * Companion to `layout-audit-shoot.mjs`. Prints one JSON object per
 * page/viewport and exits 1 when a gate fails. Gates:
 *
 *   1. no horizontal overflow (scrollWidth - clientWidth <= 1)
 *   2. every section title (h2) shares the Container left edge x
 *      (x=160 @1280, x=16 @375), and every spread-grid content span
 *      shares the content-column left edge x (x=506.67 @1280,
 *      stacked to x=16 below lg). h1 is NOT part of the x-assert —
 *      the rail-first page heroes (about / design-system) keep the
 *      mark/lead composition per §3.5, so the h1 x is page-owned;
 *      h1 is covered by the line-break gates below.
 *   3. no Japanese mid-word line break: a line must not end in a
 *      katakana run (including the prolonged sound mark ー and the
 *      small-kana block) while the next line continues katakana, and
 *      no line may START with small kana (行頭禁則) — checked by
 *      walking text-node line boxes of h1/h2 and long paragraphs
 *   4. no 1–3 character orphan last line in body paragraphs / h1
 *   5. nav labels (desktop strip) render on one line each
 *
 * Usage:
 *   node scripts/layout-audit-check.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:15907';

const PAGES = [
	'/',
	'/about',
	'/contact',
	'/portfolio',
	'/tools',
	'/tools/prototype',
	'/design-system',
];
const VIEWPORTS = [
	{ name: '1280', width: 1280, height: 900 },
	{ name: '375', width: 375, height: 812 },
];

const browser = await chromium.launch();
let failures = 0;

for (const vp of VIEWPORTS) {
	const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
	for (const path of PAGES) {
		await page.goto(base + path, { waitUntil: 'networkidle' });
		await page.evaluate(() => document.fonts.ready);
		await page.waitForTimeout(300);
		const r = await page.evaluate((vw) => {
			const lineTexts = (el) => {
				const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
				const lines = [];
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					const text = node.textContent;
					const range = document.createRange();
					let lastTop = null;
					let start = 0;
					for (let i = 1; i <= text.length; i++) {
						range.setStart(node, i - 1);
						range.setEnd(node, i);
						const rect = range.getBoundingClientRect();
						if (rect.width === 0 && rect.height === 0) continue;
						if (lastTop === null) lastTop = rect.top;
						else if (Math.abs(rect.top - lastTop) > 2) {
							lines.push(text.slice(start, i - 1));
							start = i - 1;
							lastTop = rect.top;
						}
					}
					lines.push(text.slice(start));
				}
				return lines;
			};
			// Katakana run INCLUDING the prolonged sound mark (U+30FC)
			// and the small-kana block (ァ-ヶ covers small katakana).
			// Without ー the flagship base violation
			// 「プラットフォ|ームの状態」 slipped through: line 1 ended
			// in フ, line 2 started in ー (outside [ァ-ヶ]).
			const kata = /[ァ-ヶー]/;
			// 行頭禁則: a line must never START with small kana,
			// either script — independent of what line 1 ends with.
			const smallKanaLineStart = /^[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮ]/;
			const badBoundary = (a, c) =>
				(kata.test(a.slice(-1)) && kata.test(c.slice(0, 1))) || smallKanaLineStart.test(c);
			const noteBadBreaks = (el, lines, out) => {
				for (let i = 0; i < lines.length - 1; i++) {
					const a = lines[i].trimEnd();
					const c = lines[i + 1].trimStart();
					if (badBoundary(a, c)) {
						out.badBreaks.push({
							where: el.textContent.slice(0, 24),
							at: i,
							a: a.slice(-6),
							c: c.slice(0, 6),
						});
					}
				}
			};
			const round2 = (n) => Math.round(n * 100) / 100;
			const out = {
				overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				titles: [],
				contentXs: [],
				badBreaks: [],
				orphans: [],
				navLines: [],
			};
			for (const h of document.querySelectorAll('h1, h2')) {
				const rect = h.getBoundingClientRect();
				if (rect.width < 100) continue;
				const lines = lineTexts(h);
				out.titles.push({
					tag: h.tagName,
					t: h.textContent.slice(0, 24),
					x: Math.round(rect.x),
					w: Math.round(rect.width),
					lines,
				});
				noteBadBreaks(h, lines, out);
				// content-span left edge: the header cluster's parent
				// grid (the spread rule) and its second child.
				const header = h.closest('header');
				const grid = header ? header.parentElement : null;
				if (grid && getComputedStyle(grid).display === 'grid') {
					const content = grid.children[1];
					if (content && content !== header) {
						out.contentXs.push(round2(content.getBoundingClientRect().x));
					}
				}
			}
			for (const el of document.querySelectorAll('h1, p')) {
				const text = (el.textContent || '').trim();
				if (el.tagName !== 'H1' && text.length < 60) continue;
				const lines = lineTexts(el).map((s) => s.trim());
				const last = lines[lines.length - 1];
				if (lines.length > 1 && last.length > 0 && last.length <= 3) {
					out.orphans.push({ t: text.slice(0, 24), last });
				}
				noteBadBreaks(el, lines, out);
			}
			for (const a of document.querySelectorAll('[data-testid="public-nav-desktop"] a')) {
				const span = a.querySelector('span');
				if (!span || span.offsetParent === null) continue;
				const cs = getComputedStyle(span);
				const lines = Math.round(
					span.getBoundingClientRect().height / Number.parseFloat(cs.lineHeight),
				);
				out.navLines.push({ t: span.textContent, lines });
			}
			out.vw = vw;
			return out;
		}, vp.width);

		const problems = [];
		if (r.overflow > 1) problems.push(`overflow=${r.overflow}`);
		if (r.badBreaks.length) problems.push(`mid-word breaks=${JSON.stringify(r.badBreaks)}`);
		if (r.orphans.length) problems.push(`orphans=${JSON.stringify(r.orphans)}`);
		for (const n of r.navLines) if (n.lines > 1) problems.push(`nav wrap: ${n.t}`);
		const edgeX = vp.name === '1280' ? 160 : 16;
		const contentX = vp.name === '1280' ? 506.66 : 16;
		const sectionTitles = r.titles.filter((t) => t.tag === 'H2');
		const xs = new Set(sectionTitles.map((t) => t.x));
		// full-width (default-variant) titles also start at the same x
		if (xs.size > 1) problems.push(`title x drift=${[...xs].join(',')}`);
		if (sectionTitles.length && !sectionTitles.every((t) => t.x === edgeX)) {
			problems.push(`title x != ${edgeX}`);
		}
		// spread content spans: one shared content-column edge
		if (r.contentXs.length && !r.contentXs.every((x) => Math.abs(x - contentX) <= 1)) {
			problems.push(`content span x != ${contentX} (${[...new Set(r.contentXs)].join(',')})`);
		}
		const status = problems.length ? 'FAIL' : 'pass';
		if (problems.length) failures++;
		console.log(`${status} ${vp.name} ${path} ${problems.join(' | ')}`);
	}
	await page.close();
}
await browser.close();
console.log(failures === 0 ? 'ALL GATES PASS' : `${failures} page/viewport gate(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
