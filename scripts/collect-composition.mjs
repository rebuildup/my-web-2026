#!/usr/bin/env node

/**
 * collect-composition — browser half of the composition lint
 * (ADR-0023 §2.1, Issue #1131).
 *
 * Visits each route in `quality/composition-contract.json` at each
 * contract viewport and emits `composition-model/v1` JSON — facts
 * only, no judgement. The pure judge (`scripts/judge-composition.mjs`)
 * consumes the models.
 *
 * Usage:
 *   node scripts/collect-composition.mjs [--base-url=URL] [--out-dir=DIR]
 *     [--routes=slug,slug] [--viewports=stem,stem]
 *
 * Read-only: GETs public pages and writes JSON under `.tmp/` by
 * default. No credentials, no bindings, no content strings beyond
 * block-kind classification.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_VERSION, loadContract } from './judge-composition.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';

function parseArgs(argv) {
	const out = {};
	for (const arg of argv) {
		const m = /^--([^=]+)=(.*)$/.exec(arg);
		if (m) out[m[1]] = m[2];
	}
	return out;
}

/**
 * In-page collector. Serialised into the browser by page.evaluate —
 * no module-scope access. Emits the composition-model/v1 facts.
 */
const COLLECTOR = () => {
	const vw = window.innerWidth;
	const docHeight = document.documentElement.scrollHeight;
	const visible = (el) => {
		const r = el.getBoundingClientRect();
		const s = getComputedStyle(el);
		return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
	};
	const area = (r) => Math.round(r.width * r.height);
	const px = (v) => Math.round(Number.parseFloat(v) || 0);

	const KIND_OF = (el) => {
		const tag = el.tagName.toLowerCase();
		if (/^h[1-6]$/.test(tag)) return 'heading';
		if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'svg') return 'media';
		if (tag === 'ul' || tag === 'ol') return 'list';
		if (tag === 'a' || tag === 'button') return 'control';
		// `dt` / `dd` are the definition rows a record list renders its
		// measured facts in — they are TEXT, so they count as content.
		if (tag === 'p' || tag === 'blockquote' || tag === 'dt' || tag === 'dd' || /^h[1-6]$/.test(tag))
			return 'text';
		return 'other';
	};

	// Media area inside an element subtree (img/video/canvas/svg).
	const mediaAreaOf = (root) => {
		let total = 0;
		for (const el of root.querySelectorAll('img, video, canvas, svg')) {
			if (!visible(el)) continue;
			const r = el.getBoundingClientRect();
			// object-fit cover crops visually but the element box is
			// the composition's media claim; use the box.
			total += area(r);
		}
		return total;
	};

	// Media area per element kind inside a subtree. Issue #1149 — CL-6
	// has to tell a raster IMAGE (the work's own asset) from a vector
	// mark (the site logo): a hero that carries a big SVG is not a
	// media-led hero, and an area ratio alone cannot say which it is.
	const mediaAreaByKindOf = (root) => {
		const byKind = { img: 0, video: 0, canvas: 0, svg: 0 };
		for (const el of root.querySelectorAll('img, video, canvas, svg')) {
			if (!visible(el)) continue;
			const kind = el.tagName.toLowerCase();
			if (kind in byKind) byKind[kind] += area(el.getBoundingClientRect());
		}
		return byKind;
	};

	// Media elements that FAILED to load. An `<img>` with a src whose
	// intrinsic size is still zero after the document settled is a
	// broken image — the browser draws the alt text or nothing, so the
	// composition loses the media it promised. Lazy images are given a
	// chance to load (the collector scrolls the document first), so a
	// still-zero intrinsic size is a failure, not a pending load.
	const brokenMediaOf = (root) => {
		let broken = 0;
		for (const el of root.querySelectorAll('img')) {
			if (!visible(el)) continue;
			const src = el.getAttribute('src');
			if (!src) continue;
			if (el.complete && el.naturalWidth === 0) broken += 1;
		}
		return broken;
	};

	const sections = [...document.querySelectorAll('section')].map((section, index) => {
		const s = getComputedStyle(section);
		const r = section.getBoundingClientRect();
		const top = r.top + window.scrollY;
		const inFlow = s.position !== 'fixed' && s.position !== 'sticky';
		const tone = section.getAttribute('data-tone') ?? 'ground';
		const rhythm = section.getAttribute('data-rhythm') ?? 'body';
		const name = section.getAttribute('data-section');

		// Direct-ish blocks: headings, media, lists, panels (elements
		// with their own surface), controls — capped to meaningful size.
		const blocks = [];
		const pushBlock = (el, kindOverride) => {
			if (!visible(el)) return;
			const br = el.getBoundingClientRect();
			const bs = getComputedStyle(el);
			const kind = kindOverride ?? KIND_OF(el);
			if (kind === 'other') return;
			if (area(br) < 500) return; // ignore slivers
			blocks.push({
				kind,
				area: area(br),
				rect: {
					x: Math.round(br.left),
					y: Math.round(br.top + window.scrollY),
					w: Math.round(br.width),
					h: Math.round(br.height),
				},
				fontSize: kind === 'media' ? undefined : px(bs.fontSize),
			});
		};
		for (const el of section.querySelectorAll(
			// `p` / `blockquote` are the TEXT blocks. Without them the
			// collector never records prose, so the density, the tail-gap and
			// the body font-size median all measure a heading-only page.
			// `p` / `blockquote` are the TEXT blocks; `dt` / `dd` are the
			// definition rows a record list renders its measured facts in.
			// Without the definition rows the collector sees a record's
			// name column and nothing else, and the whole facts column
			// reads as an empty tail.
			'h1,h2,h3,h4,h5,h6,p,blockquote,dt,dd,img,video,canvas,svg,ul,ol,a,button',
		)) {
			pushBlock(el);
		}
		// Panel-ish surfaces: elements with non-transparent bg or border.
		for (const el of section.querySelectorAll('div, li, article')) {
			const bs = getComputedStyle(el);
			const br = el.getBoundingClientRect();
			if (area(br) < 2000) continue;
			const hasSurface =
				(bs.backgroundColor && bs.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
				(Number.parseFloat(bs.borderTopWidth) > 0 && bs.borderTopStyle !== 'none');
			if (hasSurface && visible(el)) pushBlock(el, 'panel');
		}

		// Grid structure: first multi-column grid inside the section.
		let grid = null;
		for (const el of section.querySelectorAll('*')) {
			const gs = getComputedStyle(el);
			if (gs.display !== 'grid') continue;
			const tracks = gs.gridTemplateColumns.split(' ').filter(Boolean);
			if (tracks.length < 2) continue;
			const kids = [...el.children].filter(visible);
			if (kids.length < 2) continue;
			const lefts = [...new Set(kids.map((k) => Math.round(k.getBoundingClientRect().left)))].sort(
				(a, b) => a - b,
			);
			const gridRight = Math.round(el.getBoundingClientRect().right);
			// Column widths from left-edge boundaries; last column runs
			// to the grid's right edge. Normalized to sum = column count
			// so equal tracks read as equal ratios.
			const widths = lefts.map((l, i) => (i + 1 < lefts.length ? lefts[i + 1] : gridRight) - l);
			const wsum = widths.reduce((a, b) => a + b, 0) || 1;
			grid = {
				tracks: tracks.slice(0, 16),
				columnCount: lefts.length,
				columnRatio: widths.map((w) => Math.round((w / wsum) * lefts.length * 100) / 100),
			};
			break;
		}

		// Content column: union width of text-flow blocks (heading /
		// text / list). A genuinely narrow column shows up here; a
		// multi-column grid spans wide and reads as full-width.
		const textBlocks = blocks.filter((b) => ['heading', 'text', 'list'].includes(b.kind));
		let contentW = r.width;
		if (textBlocks.length >= 2) {
			const minX = Math.min(...textBlocks.map((b) => b.rect.x));
			const maxX = Math.max(...textBlocks.map((b) => b.rect.x + b.rect.w));
			contentW = Math.min(r.width, maxX - minX);
		}

		// Intra-section repetition: sibling elements of the same tag
		// with near-identical geometry — the "monotonous list" signal.
		let maxRepeatUnits = 0;
		let repeatKind = null;
		let repeatProfile = null;
		let repeatUnits = [];
		let maxRepeatArea = 0;
		for (const parent of section.querySelectorAll('ul, ol, div, article, section, main')) {
			const kids = [...parent.children].filter(
				(k) => visible(k) && area(k.getBoundingClientRect()) > 2000,
			);
			if (kids.length < 3) continue;
			const groups = new Map();
			for (const k of kids) {
				const kr = k.getBoundingClientRect();
				const key = `${k.tagName}|${Math.round(kr.width / 24)}x${Math.round(kr.height / 24)}`;
				const list = groups.get(key) ?? [];
				list.push(k);
				groups.set(key, list);
			}
			for (const [key, members] of groups) {
				if (members.length < 3) continue;
				// The group that dominates the composition wins: ranking by
				// the most UNITS would pick a page's smallest repeated
				// chip (a badge row, a pill list) over the cards the
				// reader actually sees, so the selection is by total
				// AREA and the unit count is a floor, not the ranking.
				const totalArea = members.reduce((sum, el) => sum + area(el.getBoundingClientRect()), 0);
				if (totalArea > maxRepeatArea) {
					maxRepeatUnits = members.length;
					maxRepeatArea = totalArea;
					repeatKind = key.split('|')[0].toLowerCase();
					repeatProfile = key.toLowerCase();
					repeatUnits = members;
				}
			}
		}

		// Issue #1149 — how much of a repeated unit is left EMPTY at its
		// bottom.
		//
		// The L-C review found the portfolio grid's text-only cards
		// stretched to the row height, so the copy sat in the top third
		// of an empty plane — a card-shaped void. The measurement is
		// the TAIL GAP: the share of the unit's height that lies below
		// the last content block inside it.
		//
		// An area ratio was tried first and rejected: a list row is
		// legitimately sparse (a short label in a wide row), so the
		// area ratio read every list on the site as an empty card. The
		// tail gap asks the question the eye asks — "is the bottom of
		// this box empty?" — and a list row, a swatch cell and a filled
		// card all answer "no".
		const contentBlocks = blocks.filter((b) => b.kind !== 'panel' && b.kind !== 'other' && b.rect);
		// The content bottom is read from the blocks that DRAW content,
		// not from a block that CONTAINS them. A card whose whole area
		// is one anchor registers that anchor as a `control` whose rect
		// is the card itself; using its bottom edge would report every
		// card as full and hide the void CL-12 exists to catch.
		const leafBlocks = contentBlocks.filter(
			(block) =>
				!contentBlocks.some(
					(other) =>
						other !== block &&
						other.rect.x + other.rect.w / 2 >= block.rect.x &&
						other.rect.x + other.rect.w / 2 <= block.rect.x + block.rect.w &&
						other.rect.y + other.rect.h / 2 >= block.rect.y &&
						other.rect.y + other.rect.h / 2 <= block.rect.y + block.rect.h,
				),
		);
		const tailGapOf = (unit) => {
			const ur = unit.getBoundingClientRect();
			const unitHeight = ur.height;
			if (unitHeight <= 0) return null;
			let contentBottom = null;
			for (const b of leafBlocks) {
				const cx = b.rect.x + b.rect.w / 2;
				const cy = b.rect.y + b.rect.h / 2;
				if (cx < ur.left || cx > ur.right || cy < ur.top || cy > ur.bottom) continue;
				const bottom = b.rect.y + b.rect.h - ur.top;
				if (contentBottom === null || bottom > contentBottom) contentBottom = bottom;
			}
			if (contentBottom === null) return null;
			const gap = (unitHeight - contentBottom) / unitHeight;
			return Math.max(0, Math.round(gap * 100) / 100);
		};
		const gaps = repeatUnits.map(tailGapOf).filter((v) => typeof v === 'number');
		const repeatTailGapRatio = gaps.length
			? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
			: undefined;
		// The ABSOLUTE empty tail, in pixels. The ratio alone cannot
		// separate a void card from a legitimately airy list row (a
		// 60 px row with a 35 px line of text is 40% empty and reads
		// fine), but the void is absolute: the card is 400 px tall and
		// 165 px of it hold nothing.
		const tailGapPxOf = (unit) => {
			const ur = unit.getBoundingClientRect();
			const unitHeight = ur.height;
			if (unitHeight <= 0) return null;
			let contentBottom = null;
			for (const b of leafBlocks) {
				const cx = b.rect.x + b.rect.w / 2;
				const cy = b.rect.y + b.rect.h / 2;
				if (cx < ur.left || cx > ur.right || cy < ur.top || cy > ur.bottom) continue;
				const bottom = b.rect.y + b.rect.h - ur.top;
				if (contentBottom === null || bottom > contentBottom) contentBottom = bottom;
			}
			if (contentBottom === null) return null;
			return Math.max(0, Math.round(unitHeight - contentBottom));
		};
		const gapPx = repeatUnits.map(tailGapPxOf).filter((v) => typeof v === 'number');
		const repeatTailGapPx = gapPx.length
			? gapPx.sort((a, b) => a - b)[Math.floor(gapPx.length / 2)]
			: undefined;

		// Composition fingerprint: content column edges, density and
		// block order — the page-level rhythm signals that
		// section signatures cannot see.
		const flowBlocks = blocks.filter((b) => b.rect);
		const contentLeft = flowBlocks.length
			? Math.min(...flowBlocks.map((b) => b.rect.x))
			: Math.round(r.left);
		const contentRight = flowBlocks.length
			? Math.max(...flowBlocks.map((b) => b.rect.x + b.rect.w))
			: Math.round(r.left + r.width);
		const covered = flowBlocks.reduce((sum, b) => sum + b.area, 0);
		const density = area(r) > 0 ? Math.min(1, Math.round((covered / area(r)) * 100) / 100) : 0;
		const blockOrder = blocks.slice(0, 16).map((b) => b.kind);

		const mediaArea = mediaAreaOf(section);
		const heading = section.querySelector('h1,h2,h3');
		const headingSize = heading ? px(getComputedStyle(heading).fontSize) : undefined;
		const kindSet = [...new Set(blocks.map((b) => b.kind))].sort();
		const signature = [
			tone,
			grid ? `g${grid.columnCount}` : '1col',
			mediaArea > 10000 ? 'media' : 'nomedia',
			heading ? `h${headingSize ?? '?'}` : 'nohead',
			kindSet.join('+'),
		].join('|');

		return {
			index,
			name: name ?? undefined,
			tone,
			rhythm,
			signature,
			inFlow,
			rect: {
				x: Math.round(r.left),
				y: Math.round(top),
				w: Math.round(r.width),
				h: Math.round(r.height),
			},
			backgroundStep: s.backgroundColor,
			// The emitted model keeps a bounded block list, but the
			// composition metrics are computed over the WHOLE list: a
			// section with more than 24 blocks (a long record list)
			// would otherwise look like it ends 150 px above its real
			// content, and CL-12 would report a void that is not there.
			blocks: blocks.slice(0, 24),
			grid,
			mediaArea,
			textArea: Math.max(0, area(r) - mediaArea),
			contentWidthRatio: vw > 0 ? Math.min(1, Math.round((contentW / vw) * 100) / 100) : 0,
			emptyAreaRatio:
				grid || r.width <= 0 ? 0 : Math.min(1, Math.round((1 - contentW / r.width) * 100) / 100),
			repeatUnits: maxRepeatUnits,
			repeatKind: repeatKind ?? undefined,
			repeatProfile: repeatProfile ?? undefined,
			repeatTailGapRatio,
			repeatTailGapPx,
			mediaByKind: mediaAreaByKindOf(section),
			brokenMedia: brokenMediaOf(section),
			contentLeft,
			contentRight,
			density,
			columnCount: grid?.columnCount ?? 1,
			blockOrder,
		};
	});

	// Document-level media totals.
	const mediaRoots = [...document.querySelectorAll('img, video, canvas, svg')].filter(visible);
	const mediaByKind = { img: 0, video: 0, canvas: 0, svg: 0 };
	let mediaTotal = 0;
	for (const el of mediaRoots) {
		const kind = el.tagName.toLowerCase();
		const a = area(el.getBoundingClientRect());
		mediaTotal += a;
		if (kind in mediaByKind) mediaByKind[kind] += a;
	}

	const contentArea = vw * docHeight;
	const features = [];
	// Detect declared primitives by their signatures in the DOM.
	if (document.querySelector('[class*="breakout"], [data-breakout]')) features.push('breakout');
	if (document.querySelector('[class*="overlap"]')) features.push('overlap');

	return {
		version: 'composition-model/v1',
		document: { width: vw, height: docHeight },
		sectionOrder: sections.map((s) => s.signature),
		sections,
		media: { totalArea: mediaTotal, byKind: mediaByKind },
		metrics: {
			contentArea,
			elementsPerPixel:
				Math.round((document.querySelectorAll('body *').length / Math.max(1, docHeight)) * 10000) /
				10000,
			recompositionScore: 0,
		},
		features,
	};
};

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const contract = loadContract();
	const baseUrl = opts['base-url'] ?? DEFAULT_BASE_URL;
	const outDir = opts['out-dir'] ?? '.tmp/composition-models';
	const routeFilter = opts.routes ? new Set(opts.routes.split(',')) : null;
	const vpFilter = opts.viewports ? new Set(opts.viewports.split(',')) : null;

	const routes = contract.routes.filter((r) => !routeFilter || routeFilter.has(r.slug));
	const viewports = contract.viewports.filter((v) => !vpFilter || vpFilter.has(v.stem));
	if (routes.length === 0 || viewports.length === 0) {
		process.stderr.write('composition: no routes/viewports selected\n');
		process.exit(2);
	}

	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	const written = [];
	const failed = [];
	try {
		for (const route of routes) {
			for (const vp of viewports) {
				const context = await browser.newContext({
					viewport: { width: vp.width, height: vp.height },
					deviceScaleFactor: 1,
					reducedMotion: 'reduce',
				});
				// Deny analytics consent so captures are deterministic.
				await context.addInitScript(() => {
					try {
						localStorage.setItem('my-web-2026:analytics-consent', 'denied');
					} catch {}
				});
				const page = await context.newPage();
				try {
					// A stale model must not survive a failed collection:
					// `composition:lint` only checks that a model FILE
					// exists, so a previous run's model would hide the
					// failure. The old file is removed BEFORE the fetch,
					// and a non-200 leaves no file behind.
					const file = `${route.slug}.${vp.stem}.json`;
					const abs = resolve(REPO_ROOT, outDir, file);
					rmSync(abs, { force: true });
					const res = await page.goto(`${baseUrl}${route.path}`, {
						waitUntil: 'load',
						timeout: 60000,
					});
					if (!res || res.status() !== 200) {
						process.stderr.write(`[collect] ${route.path} @${vp.stem}: HTTP ${res?.status()}\n`);
						failed.push(`${route.path} @${vp.stem}`);
						await context.close();
						continue;
					}
					await page.waitForTimeout(400);
					// Scroll through the document so lazy media loads, then
					// settle back at the top before measuring geometry.
					await page.evaluate(async () => {
						const step = window.innerHeight;
						const limit = Math.min(document.documentElement.scrollHeight, step * 60);
						for (let y = 0; y < limit; y += step) {
							window.scrollTo(0, y);
							await new Promise((r) => setTimeout(r, 50));
						}
						window.scrollTo(0, 0);
					});
					// Bounded settle: lazy media has had its chance; never
					// wait on decode() — a hung image must not hang the cell.
					await page.waitForTimeout(1200);
					const model = await page.evaluate(COLLECTOR);
					model.route = route.slug;
					model.viewport = { width: vp.width, height: vp.height, stem: vp.stem };
					mkdirSync(dirname(abs), { recursive: true });
					writeFileSync(abs, `${JSON.stringify(model, null, 2)}\n`);
					written.push(file);
					process.stdout.write(`[collect] ${route.path} @${vp.stem} → ${file}\n`);
				} finally {
					await context.close();
				}
			}
		}
	} finally {
		await browser.close();
	}
	process.stdout.write(`[collect] wrote ${written.length} model(s) to ${outDir}\n`);
	if (failed.length > 0) {
		process.stderr.write(
			`[collect] ${failed.length} cell(s) failed — no model was written for them: ${failed.join(', ')}\n`,
		);
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`collect failed: ${error.message}\n`);
		process.exit(1);
	});
}
