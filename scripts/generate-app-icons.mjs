#!/usr/bin/env node
/**
 * Deterministic app-icon rasteriser (Issue #504).
 *
 * Why this exists
 * ---------------
 * The site icon family ships as PNGs because two platforms refuse SVG:
 *
 *   - iOS home screen (`apple-touch-icon`) reads a raster PNG only, and
 *     composes any alpha channel onto **black**. A transparent PNG
 *     therefore renders as a black square in the installed app.
 *   - Android / Chrome adaptive icons (`purpose: "maskable"`) are also
 *     raster-only and additionally get cropped by the launcher mask.
 *
 * So the mark itself stays vector — `public/favicon.svg` is the single
 * source of the shape and of the mark colour — and this script is the
 * only place that turns it into bytes. Nothing here invents a brand: the
 * disc is exactly the circle in `public/favicon.svg`, and the only
 * thing added is the opaque canvas the two platforms above require.
 *
 * Determinism / auditability
 * --------------------------
 *   - Offline. No network call, no font, no external image.
 *   - No hidden input. The mark colour is parsed out of
 *     `public/favicon.svg`; the canvas colour is `bg.canvas` from
 *     `src/editorial/semantic-tokens.ts` (light step = `neutral.0`),
 *     transcribed below with the token path in a comment.
 *   - The output table is the published one: `scripts/check-app-icons.mjs`
 *     cross-checks every generated file against `public/site.webmanifest`
 *     and against the `<link>` tags in `src/routes/__root.tsx`, so a size
 *     that drifts out of the published contract fails the gate.
 *
 * `sharp` is already a devDependency (used by the portfolio media
 * pipeline), so this adds no new dependency.
 *
 * Usage: `pnpm run generate:app-icons` (writes `public/icons/*.png`).
 * Re-running it on unchanged input must leave byte-identical files.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FAVICON_PATH = join(repoRoot, 'public/favicon.svg');
const OUT_DIR = join(repoRoot, 'public/icons');

/**
 * Opaque canvas behind the mark.
 *
 * `bg.canvas` (light) === `colors.neutral.0` === `#ffffff` in
 * `src/editorial/tokens.ts`. It is NOT the transparent favicon canvas:
 * see the module docstring for the iOS black-compositing reason.
 */
export const CANVAS_COLOR = '#ffffff';

/**
 * Maskable disc diameter as a fraction of the icon edge.
 *
 * A maskable icon is cropped by the launcher's mask; the Web App
 * Manifest spec's safe zone is a circle of diameter 80 % centred in the
 * icon. The disc is drawn at 60 % so the mark survives every mask shape
 * (circle, squircle, rounded square) with margin, while the full-bleed
 * canvas keeps the crop edge invisible.
 */
export const MASKABLE_DISC_RATIO = 0.6;

/**
 * The published size table.
 *
 * `rel` is the `<link rel>` the file is served under (or `null` when the
 * file is only reachable through the manifest — the manifest itself
 * names its own icons, so the head never links them).
 */
export const APP_ICON_SPECS = [
	{ file: 'icon-16x16.png', size: 16, kind: 'icon', rel: 'icon' },
	{ file: 'icon-32x32.png', size: 32, kind: 'icon', rel: 'icon' },
	{ file: 'apple-touch-icon-120x120.png', size: 120, kind: 'apple', rel: 'apple-touch-icon' },
	{ file: 'apple-touch-icon-152x152.png', size: 152, kind: 'apple', rel: 'apple-touch-icon' },
	{ file: 'apple-touch-icon-167x167.png', size: 167, kind: 'apple', rel: 'apple-touch-icon' },
	{ file: 'apple-touch-icon-180x180.png', size: 180, kind: 'apple', rel: 'apple-touch-icon' },
	{ file: 'icon-192x192.png', size: 192, kind: 'any', rel: null },
	{ file: 'icon-512x512.png', size: 512, kind: 'any', rel: null },
	{ file: 'icon-maskable-512x512.png', size: 512, kind: 'maskable', rel: null },
];

/**
 * The single `fill` in `public/favicon.svg` is the mark colour.
 *
 * Fail-closed: a mark that is not one flat fill cannot be re-created
 * here, and silently guessing a colour would fork the brand.
 */
export function markColorFromFaviconSvg(svgText) {
	const fills = [...svgText.matchAll(/fill="(#[0-9a-fA-F]{3,8})"/g)].map((m) => m[1].toLowerCase());
	const unique = [...new Set(fills)];
	if (unique.length !== 1) {
		throw new Error(
			`[generate-app-icons] expected exactly one distinct fill in public/favicon.svg, found ${unique.length} (${unique.join(', ') || 'none'}). Refusing to invent a mark colour.`,
		);
	}
	return unique[0];
}

/** Disc radius for one spec, in pixels. */
export function discRadius(spec) {
	return spec.size * (spec.kind === 'maskable' ? MASKABLE_DISC_RATIO : 1) * 0.5;
}

/**
 * Raster source: full-bleed opaque canvas + the favicon's disc.
 *
 * Same geometry as `public/favicon.svg` (an inscribed circle) for every
 * `any` / `apple` / `icon` spec, so the raster family and the vector
 * favicon read as the same mark at every size.
 */
export function appIconSvg({ size, kind, mark }) {
	const c = size / 2;
	const r = discRadius({ size, kind });
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
		`<rect width="${size}" height="${size}" fill="${CANVAS_COLOR}"/>`,
		`<circle cx="${c}" cy="${c}" r="${r}" fill="${mark}"/>`,
		'</svg>',
		'',
	].join('\n');
}

export async function renderAppIcon(spec, mark) {
	return (
		sharp(Buffer.from(appIconSvg({ size: spec.size, kind: spec.kind, mark })), {
			density: 384,
		})
			.resize(spec.size, spec.size, { fit: 'cover' })
			// `flatten` against the same opaque canvas drops the alpha
			// channel entirely (the raster source is already fully opaque, so
			// this changes no pixel). The result is an RGB PNG with no alpha
			// plane, which is exactly what iOS needs: it composites a
			// transparent icon onto black.
			.flatten({ background: CANVAS_COLOR })
			.png({ compressionLevel: 9, palette: false })
			.toBuffer()
	);
}

export async function generateAppIcons({ root = repoRoot } = {}) {
	const faviconPath = join(root, 'public/favicon.svg');
	if (!existsSync(faviconPath)) {
		throw new Error(`[generate-app-icons] missing ${faviconPath}`);
	}
	const mark = markColorFromFaviconSvg(readFileSync(faviconPath, 'utf8'));
	const outDir = join(root, 'public/icons');
	mkdirSync(outDir, { recursive: true });
	const written = [];
	for (const spec of APP_ICON_SPECS) {
		const buffer = await renderAppIcon(spec, mark);
		writeFileSync(join(outDir, spec.file), buffer);
		written.push({ ...spec, bytes: buffer.byteLength });
	}
	// Fail-closed on orphans: a leftover PNG in `public/icons/` that no
	// spec produces is a file the published contract does not describe,
	// so surface it instead of shipping an unaudited asset.
	const orphans = readdirSync(outDir)
		.filter((name) => name.endsWith('.png'))
		.filter((name) => !APP_ICON_SPECS.some((spec) => spec.file === name));
	return { mark, written, orphans };
}

async function main() {
	const { mark, written, orphans } = await generateAppIcons();
	if (orphans.length > 0) {
		process.stderr.write(
			`[generate-app-icons] FAIL: unexpected file(s) in public/icons/: ${orphans.join(', ')}\n`,
		);
		process.exit(1);
	}
	console.log(
		`[generate-app-icons] OK: ${written.length} icons from public/favicon.svg (mark ${mark}) on ${CANVAS_COLOR}:`,
	);
	for (const entry of written) {
		console.log(`  - ${entry.file} (${entry.size}px, ${entry.bytes} bytes)`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
