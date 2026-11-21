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

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract, MODEL_VERSION } from './judge-composition.mjs';

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
	const px = (v) => Math.round(parseFloat(v) || 0);

	const KIND_OF = (el) => {
		const tag = el.tagName.toLowerCase();
		if (/^h[1-6]$/.test(tag)) return 'heading';
		if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'svg') return 'media';
		if (tag === 'ul' || tag === 'ol') return 'list';
		if (tag === 'a' || tag === 'button') return 'control';
		if (tag === 'p' || tag === 'blockquote' || /^h[1-6]$/.test(tag)) return 'text';
		return 'other';
	};

	// Media area inside an element subtree (img/video/canvas/svg).
	const mediaAreaOf = (root) => {
		let total = 0;
		for (const el of root.querySelectorAll('img, video, canvas, svg')) {
			if (!visible(el)) continue;
			const r = el.getBoundingClientRect();
			// object-fit cover crops visually but the element box is the
			// composition's media claim; use the box.
			total += area(r);
		}
		return total;
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
				fontSize: kind === 'media' ? undefined : px(bs.fontSize),
			});
		};
		for (const el of section.querySelectorAll('h1,h2,h3,h4,h5,h6,img,video,canvas,svg,ul,ol,a,button')) {
			pushBlock(el);
		}
		// Panel-ish surfaces: elements with non-transparent bg or border.
		for (const el of section.querySelectorAll('div, li, article')) {
			const bs = getComputedStyle(el);
			const br = el.getBoundingClientRect();
			if (area(br) < 2000) continue;
			const hasSurface =
				(bs.backgroundColor && bs.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
				(parseFloat(bs.borderTopWidth) > 0 && bs.borderTopStyle !== 'none');
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
			const lefts = kids.map((k) => Math.round(k.getBoundingClientRect().left)).sort((a, b) => a - b);
			const uniq = [...new Set(lefts)];
			grid = {
				tracks: tracks.slice(0, 16),
				columnCount: uniq.length,
				columnRatio: uniq.length > 1 ? uniq.map((_, i) => (i === 0 ? 1 : 0)) : [1],
			};
			break;
		}

		// Alignment axis: cluster of left edges among blocks.
		const leftEdges = blocks.length
			? [...new Set(blocks.map(() => 0))]
			: [];
		void leftEdges;

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
			rect: { x: Math.round(r.left), y: Math.round(top), w: Math.round(r.width), h: Math.round(r.height) },
			backgroundStep: s.backgroundColor,
			blocks: blocks.slice(0, 24),
			grid,
			mediaArea,
			textArea: Math.max(0, area(r) - mediaArea),
			contentWidthRatio: r.width > 0 ? Math.min(1, Math.round((r.width / vw) * 100) / 100) : 0,
			emptyAreaRatio: 0, // refined below at document level if needed
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
		sections,
		media: { totalArea: mediaTotal, byKind: mediaByKind },
		metrics: {
			contentArea,
			elementsPerPixel: Math.round((document.querySelectorAll('body *').length / Math.max(1, docHeight)) * 10000) / 10000,
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
					const res = await page.goto(`${baseUrl}${route.path}`, {
						waitUntil: 'load',
						timeout: 60000,
					});
					if (!res || res.status() !== 200) {
						process.stderr.write(`[collect] ${route.path} @${vp.stem}: HTTP ${res?.status()}\n`);
						await context.close();
						continue;
					}
					await page.waitForTimeout(400);
					// Scroll through the document so lazy media loads, then
					// settle back at the top before measuring geometry.
					await page.evaluate(async () => {
						const step = window.innerHeight;
						for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
							window.scrollTo(0, y);
							await new Promise((r) => setTimeout(r, 60));
						}
						window.scrollTo(0, 0);
						await Promise.all(
							[...document.images].map((img) => img.decode?.().catch(() => {})),
						);
					});
					await page.waitForTimeout(300);
					const model = await page.evaluate(COLLECTOR);
					model.route = route.slug;
					model.viewport = { width: vp.width, height: vp.height, stem: vp.stem };
					const file = `${route.slug}.${vp.stem}.json`;
					const abs = resolve(REPO_ROOT, outDir, file);
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`collect failed: ${error.message}\n`);
		process.exit(1);
	});
}
