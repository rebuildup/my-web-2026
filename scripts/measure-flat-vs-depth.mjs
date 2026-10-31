#!/usr/bin/env node

/**
 * measure-flat-vs-depth — observe the two published screens that Issue #520
 * compares, and write the measurements the review document quotes.
 *
 * What this measures
 * ------------------
 * Two public screens of this repository (`/` and `/portfolio`), read with a
 * real browser: the type scale actually rendered, the surface palette, the
 * elevation cues (shadow / border / gradient / background image), the
 * vertical rhythm (section padding vs. the gap between sections), the
 * horizontal grid (heading column vs. body column), and the contrast ratio
 * of the text steps against the canvas they sit on.
 *
 * The review document quotes these numbers, so they have to be reproducible:
 * this script is the "how" the document cites.
 *
 * Scope and safety
 * ----------------
 *   - Read-only. It performs HTTP GETs against a public origin and writes
 *     nothing outside `.tmp/` unless `--out` says otherwise.
 *   - It reads no secret, no credential and no binding value, and it prints
 *     no value that could be one.
 *   - The default origin is the canonical production origin
 *     (`https://rebuildup.dev`, ADR-0014). `--base-url` exists so the same
 *     measurement can be repeated against a local build.
 *
 * Usage:
 *   node scripts/measure-flat-vs-depth.mjs [--base-url=URL] [--width=N] [--height=N] [--out=PATH]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The two screens the review compares, by path.
 *
 * The ids are the same ids the review data uses (`case-home`,
 * `case-portfolio`), so the measurement report and the review document
 * name the same cases.
 */
export const SCREENS = [
	{ id: 'case-home', path: '/' },
	{ id: 'case-portfolio', path: '/portfolio' },
];

/** The canonical production origin (ADR-0014). */
export const DEFAULT_BASE_URL = 'https://rebuildup.dev';

export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/** Parse `--key=value` arguments into an object. */
export function parseArgs(argv) {
	const out = {};
	for (const arg of argv) {
		const match = /^--([^=]+)=(.*)$/.exec(arg);
		if (match) out[match[1]] = match[2];
	}
	return out;
}

/**
 * The in-page collector. It runs inside the browser and returns plain data,
 * so the report is reproducible and diffable.
 *
 * `page.evaluate` serialises this function into the page, so it cannot
 * close over module scope: the luminance and contrast maths it needs is
 * repeated inside it (`contrastRatioLocal` below) rather than imported.
 */
const COLLECTOR = () => {
	const visible = (el) => {
		const rect = el.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};
	const all = Array.from(document.querySelectorAll('body *')).filter(visible);
	const style = (el) => getComputedStyle(el);
	const describe = (el) => {
		const s = style(el);
		const rect = el.getBoundingClientRect();
		return {
			tag: el.tagName.toLowerCase(),
			text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
			fontSize: s.fontSize,
			fontWeight: s.fontWeight,
			lineHeight: s.lineHeight,
			letterSpacing: s.letterSpacing,
			color: s.color,
			backgroundColor: s.backgroundColor,
			left: Math.round(rect.left),
			top: Math.round(rect.top + window.scrollY),
			width: Math.round(rect.width),
			height: Math.round(rect.height),
		};
	};

	const fontSizes = new Map();
	const surfaceColors = new Map();
	const textColors = new Map();
	let shadow = 0;
	let bordered = 0;
	let radius = 0;
	let backgroundImage = 0;
	let gradient = 0;
	for (const el of all) {
		const s = style(el);
		if (s.boxShadow && s.boxShadow !== 'none') shadow += 1;
		if (s.borderTopWidth !== '0px' || s.borderBottomWidth !== '0px') bordered += 1;
		if (s.borderRadius && !/^0px/.test(s.borderRadius)) radius += 1;
		if (s.backgroundImage && s.backgroundImage !== 'none') {
			backgroundImage += 1;
			if (s.backgroundImage.includes('gradient')) gradient += 1;
		}
		if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)') {
			surfaceColors.set(s.backgroundColor, (surfaceColors.get(s.backgroundColor) ?? 0) + 1);
		}
		if (el.children.length === 0 && (el.textContent ?? '').trim()) {
			textColors.set(s.color, (textColors.get(s.color) ?? 0) + 1);
			fontSizes.set(s.fontSize, (fontSizes.get(s.fontSize) ?? 0) + 1);
		}
	}

	const sectionElements = Array.from(document.querySelectorAll('section'));
	const sections = sectionElements.map((section) => {
		const s = style(section);
		const rect = section.getBoundingClientRect();
		const inFlow = s.position !== 'fixed' && s.position !== 'sticky';
		const children = Array.from(section.querySelectorAll('*')).filter(visible);
		const tops = children.map((el) => el.getBoundingClientRect().top + window.scrollY);
		const bottoms = children.map((el) => el.getBoundingClientRect().bottom + window.scrollY);
		const heading = section.querySelector('h1, h2');
		return {
			id: section.getAttribute('aria-labelledby') ?? section.getAttribute('aria-label') ?? '',
			inFlow,
			paddingBlock: s.paddingBlock,
			paddingInline: s.paddingInline,
			borderTop: `${s.borderTopWidth} ${s.borderTopStyle}`,
			backgroundColor: s.backgroundColor,
			height: Math.round(rect.height),
			headingColumn: heading
				? {
						tag: heading.tagName.toLowerCase(),
						left: Math.round(heading.getBoundingClientRect().left),
						width: Math.round(heading.getBoundingClientRect().width),
					}
				: null,
			contentTop: tops.length ? Math.round(Math.min(...tops)) : null,
			contentBottom: bottoms.length ? Math.round(Math.max(...bottoms)) : null,
		};
	});

	// The whitespace between two consecutive sections: the bottom of the
	// first section's content and the top of the next section's content.
	const sectionGaps = [];
	const inFlowSections = sections.filter((section) => section.inFlow);
	for (let i = 0; i < inFlowSections.length - 1; i += 1) {
		const current = inFlowSections[i];
		const next = inFlowSections[i + 1];
		if (current.contentBottom === null || next.contentTop === null) continue;
		sectionGaps.push({
			from: current.id,
			to: next.id,
			gap: next.contentTop - current.contentBottom,
		});
	}

	const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
		.filter(visible)
		.map((el) => ({ ...describe(el), id: el.id ?? '' }));

	const svgs = Array.from(document.querySelectorAll('svg'))
		.filter(visible)
		.map((svg) => {
			const fills = new Set();
			for (const path of svg.querySelectorAll('path, circle, rect, polygon')) {
				const fill = path.getAttribute('fill');
				if (fill) fills.add(fill);
			}
			const rect = svg.getBoundingClientRect();
			return {
				ariaHidden: svg.getAttribute('aria-hidden'),
				fills: [...fills].sort(),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			};
		});

	const images = Array.from(document.querySelectorAll('img'))
		.filter(visible)
		.map((img) => {
			const rect = img.getBoundingClientRect();
			return {
				natural: `${img.naturalWidth}x${img.naturalHeight}`,
				displayed: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
			};
		});

	const canvas = style(document.body).backgroundColor;
	const contrastOf = (el) => {
		if (!el) return null;
		return contrastRatioLocal(style(el).color, canvas);
	};
	/**
	 * WCAG contrast ratio between two `rgb()` strings.
	 *
	 * The same maths as `scripts/check-a11y-contrast.mjs` uses for the
	 * contrast gate. It is repeated here rather than imported because
	 * this function is serialised into the page by `page.evaluate` and
	 * therefore has no access to the module scope.
	 */
	function contrastRatioLocal(fg, bg) {
		const lum = (color) => {
			const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color ?? '');
			if (!m) return null;
			const ch = (raw) => {
				const s = Number(raw) / 255;
				return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
			};
			return 0.2126 * ch(m[1]) + 0.7152 * ch(m[2]) + 0.0722 * ch(m[3]);
		};
		const a = lum(fg);
		const b = lum(bg);
		if (a === null || b === null) return null;
		return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
	}

	/**
	 * The horizontal grid: the first in-flow section that lays its heading
	 * and its body out in columns. The container's resolved track list and
	 * the bounding box of each direct child are reported, so the column
	 * geometry can be read off the report instead of inferred.
	 */
	const grid = (() => {
		for (const section of sectionElements) {
			if (!visible(section)) continue;
			const s = style(section);
			if (s.position === 'fixed' || s.position === 'sticky') continue;
			const candidates = Array.from(section.querySelectorAll('*')).filter((el) => {
				const s = style(el);
				return s.display === 'grid' && s.gridTemplateColumns.split(' ').length > 1;
			});
			for (const container of candidates) {
				const children = Array.from(container.children).filter(visible);
				if (children.length < 2) continue;
				const boxes = children.map((child) => {
					const rect = child.getBoundingClientRect();
					return {
						tag: child.tagName.toLowerCase(),
						left: Math.round(rect.left),
						width: Math.round(rect.width),
					};
				});
				return {
					container: {
						gridTemplateColumns: style(container).gridTemplateColumns,
						columnGap: style(container).columnGap,
						left: Math.round(container.getBoundingClientRect().left),
						width: Math.round(container.getBoundingClientRect().width),
					},
					columns: boxes,
				};
			}
		}
		return null;
	})();

	/**
	 * The vertical distances a reader's eye travels: from the page title to
	 * the first repeated item, and between the repeated items.
	 */
	const verticalRhythm = (() => {
		const title = document.querySelector('main h1, h1');
		const items = Array.from(document.querySelectorAll('main h3')).filter(visible);
		if (!title || items.length === 0) return null;
		const titleRect = title.getBoundingClientRect();
		const firstRect = items[0].getBoundingClientRect();
		const gaps = [];
		for (let i = 0; i < items.length - 1; i += 1) {
			gaps.push(
				Math.round(
					items[i + 1].getBoundingClientRect().top - items[i].getBoundingClientRect().bottom,
				),
			);
		}
		return {
			titleToFirstItem: Math.round(firstRect.top - titleRect.bottom),
			itemToItem: gaps,
		};
	})();

	return {
		documentHeight: document.documentElement.scrollHeight,
		viewport: { width: window.innerWidth, height: window.innerHeight },
		elements: all.length,
		// Density: rendered elements per pixel of document height. Two
		// screens can share a type scale and still read very differently if
		// one of them packs three times the elements into the same scroll.
		elementsPerPixel:
			Math.round((all.length / document.documentElement.scrollHeight) * 10000) / 10000,
		elevation: { shadow, bordered, radius, backgroundImage, gradient },
		surfaces: [...surfaceColors.entries()]
			.map(([color, count]) => ({ color, count }))
			.sort((a, b) => b.count - a.count),
		textColors: [...textColors.entries()]
			.map(([color, count]) => ({ color, count }))
			.sort((a, b) => b.count - a.count),
		fontSizes: [...fontSizes.entries()]
			.map(([size, count]) => ({ size, count }))
			.sort((a, b) => Number.parseFloat(a.size) - Number.parseFloat(b.size)),
		sections,
		sectionGaps,
		verticalRhythm,
		headings,
		svgs,
		images,
		grid,
		contrast: {
			canvas,
			h1: contrastOf(document.querySelector('h1')),
			h2: contrastOf(document.querySelector('main h2')),
			body: contrastRatioLocal(style(document.body).color, canvas),
			// The most-used text colour against the canvas: the step that
			// carries the most words on the screen, and therefore the one that
			// decides whether the flat surface is readable.
			mostUsedText: (() => {
				const mostUsed = [...textColors.entries()].sort((a, b) => b[1] - a[1])[0];
				return mostUsed
					? {
							color: mostUsed[0],
							count: mostUsed[1],
							ratio: contrastRatioLocal(mostUsed[0], canvas),
						}
					: null;
			})(),
		},
	};
};

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const baseUrl = options['base-url'] ?? DEFAULT_BASE_URL;
	const width = Number(options.width ?? DEFAULT_VIEWPORT.width);
	const height = Number(options.height ?? DEFAULT_VIEWPORT.height);
	const outPath = options.out ?? '.tmp/flat-vs-depth/measurements.json';

	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	const results = [];
	try {
		for (const screen of SCREENS) {
			const context = await browser.newContext({
				viewport: { width, height },
				deviceScaleFactor: 1,
			});
			const page = await context.newPage();
			await page.goto(`${baseUrl}${screen.path}`, { waitUntil: 'networkidle', timeout: 60000 });
			const measured = await page.evaluate(COLLECTOR);
			results.push({
				id: screen.id,
				url: `${baseUrl}${screen.path}`,
				...measured,
			});
			await context.close();
		}
	} finally {
		await browser.close();
	}

	const report = {
		baseUrl,
		viewport: { width, height },
		deviceScaleFactor: 1,
		browser: 'Chromium (Playwright)',
		measuredAt: new Date().toISOString(),
		screens: results,
	};
	const absolute = resolve(REPO_ROOT, outPath);
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[measure] wrote ${outPath}\n`);
	for (const screen of results) {
		process.stdout.write(
			`[measure] ${screen.url} — height ${screen.documentHeight}px, ${screen.elements} elements, ` +
				`shadow ${screen.elevation.shadow}, border ${screen.elevation.bordered}, gradient ${screen.elevation.gradient}, ` +
				`background-image ${screen.elevation.backgroundImage}\n`,
		);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`measure failed: ${error.message}\n`);
		process.exit(1);
	});
}
