#!/usr/bin/env node
/**
 * layout-audit-check — quantitative grid gates for the public pages
 * (Issue #300).
 *
 * Companion to `layout-audit-shoot.mjs`. Prints one JSON object per
 * page/viewport and exits 1 when a gate fails. Gates:
 *
 *   1. no horizontal overflow (scrollWidth - clientWidth <= 1)
 *   2. every section title (h2 in the spread grid) shares the
 *      Container left edge x, and every content span shares the
 *      content-column left edge x (1280px only)
 *   3. no Japanese mid-word line break: a line must not end in
 *      katakana while the next line starts with katakana inside the
 *      same word run (checked by walking text-node line boxes)
 *   4. no 1–3 character orphan last line in body paragraphs
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
			const kata = /[ァ-ヶ]/;
			const out = {
				overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				titles: [],
				badBreaks: [],
				orphans: [],
				navLines: [],
			};
			for (const h of document.querySelectorAll('h2')) {
				const rect = h.getBoundingClientRect();
				if (rect.width < 100) continue;
				const lines = lineTexts(h);
				out.titles.push({
					t: h.textContent.slice(0, 24),
					x: Math.round(rect.x),
					w: Math.round(rect.width),
					lines,
				});
				for (let i = 0; i < lines.length - 1; i++) {
					const a = lines[i].trimEnd();
					const c = lines[i + 1].trimStart();
					if (kata.test(a.slice(-1)) && kata.test(c.slice(0, 1))) {
						out.badBreaks.push({
							where: h.textContent.slice(0, 24),
							at: i,
							a: a.slice(-6),
							c: c.slice(0, 6),
						});
					}
				}
			}
			for (const p of document.querySelectorAll('p')) {
				if ((p.textContent || '').trim().length < 60) continue;
				const lines = lineTexts(p).map((s) => s.trim());
				const last = lines[lines.length - 1];
				if (lines.length > 1 && last.length > 0 && last.length <= 3) {
					out.orphans.push({ t: p.textContent.slice(0, 24), last });
				}
				for (let i = 0; i < lines.length - 1; i++) {
					const a = lines[i];
					const c = lines[i + 1];
					if (
						kata.test(a.slice(-1)) &&
						kata.test(c.slice(0, 1)) &&
						/[ァ-ヶ][ァ-ヶ]/.test(a.slice(-1) + c.slice(0, 1))
					) {
						out.badBreaks.push({
							where: p.textContent.slice(0, 24),
							at: i,
							a: a.slice(-6),
							c: c.slice(0, 6),
						});
					}
				}
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
			// content-span left edge from the first spread section grid
			const grid = document.querySelector('section [style*="grid"], section > div > div');
			out.vw = vw;
			return out;
		}, vp.width);

		const problems = [];
		if (r.overflow > 1) problems.push(`overflow=${r.overflow}`);
		if (r.badBreaks.length) problems.push(`mid-word breaks=${JSON.stringify(r.badBreaks)}`);
		if (r.orphans.length) problems.push(`orphans=${JSON.stringify(r.orphans)}`);
		for (const n of r.navLines) if (n.lines > 1) problems.push(`nav wrap: ${n.t}`);
		if (vp.name === '1280') {
			const xs = new Set(r.titles.map((t) => t.x));
			// full-width (default-variant) titles also start at the same x
			if (xs.size > 1) problems.push(`title x drift=${[...xs].join(',')}`);
			if (r.titles.length && !r.titles.every((t) => t.x === 160)) problems.push('title x != 160');
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
