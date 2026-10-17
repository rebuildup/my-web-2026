#!/usr/bin/env node
/**
 * Published app-icon contract gate (Issue #504).
 *
 * The icon family is published from three places — the document head
 * (`APP_ICON_LINKS` in `src/routes/__root.tsx`), the Web App Manifest
 * (`public/site.webmanifest`), and the raster files in `public/icons/`.
 * Three places means three ways to publish a broken promise: a `<link>`
 * pointing at a missing file, a manifest entry whose declared size does
 * not match the PNG, an icon file nobody links, a transparent PNG that
 * iOS composites onto black, a colour that drifted away from the design
 * tokens, or a new manifest member that quietly declares an obligation
 * this ticket never accepted.
 *
 * Each of those is a one-line fix at the source, and each is invisible
 * in a screenshot. This gate makes them fail-closed in `validate:fast`,
 * before `typecheck`, following the `check-release-assets.mjs` pattern
 * (pure function seam + `main()` + ESM guard, unit-tested by
 * `scripts/check-app-icons.test.mjs`).
 *
 * What it checks:
 *   1. `public/site.webmanifest` parses and carries every member this
 *      ticket ships — and ONLY those, so `share_target` / `shortcuts` /
 *      `display_override` cannot be added without a decision.
 *   2. Every `<link>` in `APP_ICON_LINKS` resolves to a file that
 *      exists, with the declared `sizes` matching the real pixels.
 *   3. Every PNG is opaque (no alpha channel) and actually renders the
 *      favicon's mark: centre pixel = mark colour, corner = canvas.
 *   4. The bijection: each file in `public/icons/` is referenced by the
 *      head links or the manifest, and referenced exactly once.
 *   5. `APP_ICON_LINKS` still declares the SVG favicon (Issue #285) and
 *      the Apple Touch Icon sizes iOS actually asks for.
 *   6. Every colour involved (manifest `theme_color` /
 *      `background_color`, both `theme-color` meta values) exists in
 *      `src/editorial/tokens.ts` — the icon family cannot introduce a
 *      colour the design system does not own.
 *   7. `public/_headers` pins the manifest media type and a
 *      revalidating cache policy for `/icons/*`.
 *   8. No service-worker registration exists anywhere in `src/` — the
 *      Issue forbids declaring offline behaviour, and the only way this
 *      platform could start claiming it is a registration.
 *
 * Exit codes: 0 = coherent, 1 = at least one violation (all printed),
 * 2 = unreadable input.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const HEAD_ROUTE_PATH = 'src/routes/__root.tsx';
export const MANIFEST_PATH = 'public/site.webmanifest';
export const FAVICON_PATH = 'public/favicon.svg';
export const ICONS_DIR = 'public/icons';
/** Public URL prefix the icon files are served under. */
export const ICONS_HREF_PREFIX = '/icons/';
export const HEADERS_PATH = 'public/_headers';
export const TOKENS_PATH = 'src/editorial/tokens.ts';
export const SRC_DIR = 'src';

/**
 * Manifest members this ticket ships. Anything else — including
 * `share_target`, `shortcuts`, `display_override`, `categories`,
 * `related_applications`, `prefer_related_applications` — is an
 * obligation decision, not a formatting choice, so it must fail here
 * until a ticket decides it.
 */
export const ALLOWED_MANIFEST_MEMBERS = [
	'name',
	'short_name',
	'lang',
	'dir',
	'id',
	'start_url',
	'scope',
	'display',
	'background_color',
	'theme_color',
	'icons',
];

/** Apple Touch Icon sizes iOS asks for: 180 iPhone, 167/152 iPad, 120 legacy. */
export const REQUIRED_APPLE_TOUCH_SIZES = ['120x120', '152x152', '167x167', '180x180'];

/** Raster fallback sizes that must sit beside the SVG favicon. */
export const REQUIRED_ICON_SIZES = ['16x16', '32x32'];

/** `purpose` values this ticket ships, per icon entry. */
export const ALLOWED_MANIFEST_PURPOSES = ['any', 'maskable'];

const HEX = /^#[0-9a-f]{6}$/i;

/** Raster extensions only; an SVG must never reach the PNG-only platforms. */
const RASTER_EXTENSIONS = new Set(['.png']);

/**
 * The `<link>` object literals inside `APP_ICON_LINKS`.
 *
 * The block is located by name rather than by matching every link in the
 * file, so a route-level link elsewhere in `__root.tsx` (preconnect,
 * stylesheet) cannot be mistaken for an icon entry.
 */
export function parseHeadIconLinks(source) {
	const block = /const APP_ICON_LINKS\s*=\s*\[([\s\S]*?)\n\];/.exec(source);
	if (!block) return null;
	return [...block[1].matchAll(/\{\s*rel:\s*'([^']+)'([^}]*)\}/g)].map(([, rel, rest]) => ({
		rel,
		type: pick(rest, 'type'),
		sizes: pick(rest, 'sizes'),
		href: pick(rest, 'href'),
	}));
}

function pick(text, key) {
	const found = new RegExp(`${key}:\\s*'([^']*)'`).exec(text);
	return found ? found[1] : null;
}

function pickAttr(text, key) {
	const found = new RegExp(`${key}="([^"]*)"`).exec(text);
	return found ? found[1] : null;
}

/**
 * The `theme-color` metas in the document shell.
 *
 * Two shapes are accepted because the head split forces them: a route
 * `head().meta` object literal, and the JSX `<meta … />` element inside
 * `RootComponent`. The latter is the one that actually ships (TanStack
 * Router dedupes `meta` by `name`, so two entries in `head()` collapse);
 * the object form is read too so a value that moved cannot slip past.
 */
export function parseThemeColorMetas(source) {
	const objects = [...source.matchAll(/\{\s*name:\s*'theme-color'([^}]*)\}/g)].map(([, rest]) => ({
		media: pick(rest, 'media'),
		content: pick(rest, 'content'),
	}));
	const jsx = [...source.matchAll(/<meta\s+name="theme-color"([^>]*?)\/?>/g)].map(([, rest]) => ({
		media: pickAttr(rest, 'media'),
		content: pickAttr(rest, 'content'),
	}));
	return [...objects, ...jsx];
}

/** The manifest `icons[]` entries, normalised. */
export function parseManifestIcons(manifest) {
	if (!manifest || !Array.isArray(manifest.icons)) return [];
	return manifest.icons.map((icon) => ({
		src: icon?.src ?? null,
		sizes: icon?.sizes ?? null,
		type: icon?.type ?? null,
		purpose: icon?.purpose ?? null,
	}));
}

/** Every `#rrggbb` literal in the raw token palette. */
export function tokenPalette(source) {
	return new Set((source.match(/#[0-9a-f]{6}/gi) ?? []).map((hex) => hex.toLowerCase()));
}

/** The single `fill` of the favicon, i.e. the mark colour. */
export function markColorFromFavicon(svg) {
	const fills = [
		...new Set(
			(svg.match(/fill="(#[0-9a-fA-F]{3,8})"/g) ?? []).map((s) => s.slice(6, -1).toLowerCase()),
		),
	];
	return fills.length === 1 ? fills[0] : null;
}

function walkSourceFiles(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return walkSourceFiles(path);
		return ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
	});
}

function readIfPresent(path, errors) {
	if (!existsSync(path)) {
		errors.push(`${path} is missing`);
		return null;
	}
	return readFileSync(path, 'utf8');
}

/**
 * Inspect one published icon file.
 *
 * `expected` is the declared edge length (`'180x180'`); `null` means
 * "no declared size" (only `favicon.svg`, which is not a raster file).
 */
async function inspectRaster(path, expectedSize, { mark, canvas }, errors) {
	const rel = path.slice(path.indexOf('/public/') + 1);
	const match = /^(\d+)x(\d+)$/.exec(expectedSize ?? '');
	const declared = match ? Number(match[1]) : null;
	const meta = await sharp(path).metadata();
	if (meta.format !== 'png') {
		errors.push(`${rel}: expected a PNG, found ${meta.format}`);
		return;
	}
	if (!declared) {
		errors.push(`${rel}: referenced without a declared sizes attribute`);
		return;
	}
	if (meta.width !== declared || meta.height !== declared) {
		errors.push(
			`${rel}: declared ${declared}x${declared} but the file is ${meta.width}x${meta.height}`,
		);
	}
	if (meta.hasAlpha) {
		errors.push(
			`${rel}: carries an alpha channel; iOS composites transparency onto black, so an apple-touch icon must be opaque`,
		);
	}
	const { data, info } = await sharp(path)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const channels = info.channels;
	const pixel = (x, y) => {
		const i = (y * info.width + x) * channels;
		return `#${Buffer.from(data.subarray(i, i + 3))
			.toString('hex')
			.toLowerCase()}`;
	};
	const centre = pixel(Math.floor(meta.width / 2), Math.floor(meta.height / 2));
	const corner = pixel(0, 0);
	if (mark && centre !== mark) {
		errors.push(`${rel}: centre pixel is ${centre}, expected the favicon mark ${mark}`);
	}
	if (canvas && corner !== canvas) {
		errors.push(`${rel}: corner pixel is ${corner}, expected the canvas ${canvas}`);
	}
}

/**
 * Run the gate against an explicit repo root.
 *
 * Returns `{ ok, errors }`; every violation is collected so one run
 * reports the whole drift instead of the first symptom.
 */
export async function checkAppIcons({ root = repoRoot } = {}) {
	const errors = [];
	const headSource = readIfPresent(resolve(root, HEAD_ROUTE_PATH), errors);
	const faviconSource = readIfPresent(resolve(root, FAVICON_PATH), errors);
	const manifestText = readIfPresent(resolve(root, MANIFEST_PATH), errors);
	const headersSource = readIfPresent(resolve(root, HEADERS_PATH), errors);
	const tokensSource = readIfPresent(resolve(root, TOKENS_PATH), errors);
	const iconsDir = resolve(root, ICONS_DIR);
	const iconsOnDisk = existsSync(iconsDir)
		? readdirSync(iconsDir)
				.filter((name) => RASTER_EXTENSIONS.has(extname(name)))
				.sort()
		: [];

	if (headSource === null) return { ok: false, errors };

	// --- mark + canvas colours -------------------------------------------
	const mark = faviconSource ? markColorFromFavicon(faviconSource) : null;
	if (faviconSource && mark === null) {
		errors.push(
			`${FAVICON_PATH} does not carry exactly one flat fill colour; the icon family cannot be derived from it`,
		);
	}
	const palette = tokensSource ? tokenPalette(tokensSource) : new Set();
	// The canvas colour is the one the raster generator writes; it must
	// exist in the token palette too. Derived from the palette rather
	// than hard-coded here so the gate fails when either side moves.
	const canvas = [...palette].find((hex) => hex === '#ffffff') ?? null;
	if (tokensSource && canvas === null) {
		errors.push(`${TOKENS_PATH} no longer declares the #ffffff canvas step the icons are drawn on`);
	}

	// --- manifest ---------------------------------------------------------
	let manifest = null;
	if (manifestText !== null) {
		try {
			manifest = JSON.parse(manifestText);
		} catch (error) {
			errors.push(`${MANIFEST_PATH} is not valid JSON: ${error.message}`);
		}
	}
	if (manifest) {
		for (const member of ALLOWED_MANIFEST_MEMBERS) {
			if (manifest[member] === undefined) {
				errors.push(`${MANIFEST_PATH} is missing the required member "${member}"`);
			}
		}
		const extra = Object.keys(manifest).filter((key) => !ALLOWED_MANIFEST_MEMBERS.includes(key));
		if (extra.length > 0) {
			errors.push(
				`${MANIFEST_PATH} declares member(s) outside this ticket's contract: ${extra.join(', ')}. A new member is an obligation decision — decide it in a ticket, then extend ALLOWED_MANIFEST_MEMBERS here.`,
			);
		}
		if (manifest.name !== manifest.short_name) {
			errors.push(
				`${MANIFEST_PATH}: short_name "${manifest.short_name}" must fit a home-screen label; it currently differs from name "${manifest.name}"`,
			);
		}
		for (const key of ['theme_color', 'background_color']) {
			const value = manifest[key];
			if (value !== undefined && !HEX.test(String(value))) {
				errors.push(`${MANIFEST_PATH}: ${key} must be a #rrggbb colour, found "${value}"`);
			} else if (value !== undefined && !palette.has(String(value).toLowerCase())) {
				errors.push(
					`${MANIFEST_PATH}: ${key} ${value} is not a colour in ${TOKENS_PATH}; the icon family must not introduce colours the design system does not own`,
				);
			}
		}
		if (manifest.lang !== undefined && manifest.lang !== 'ja') {
			errors.push(
				`${MANIFEST_PATH}: lang "${manifest.lang}" contradicts the <html lang="ja"> the document shell renders`,
			);
		}
		for (const icon of parseManifestIcons(manifest)) {
			if (!ALLOWED_MANIFEST_PURPOSES.includes(icon.purpose)) {
				errors.push(
					`${MANIFEST_PATH}: icon ${icon.src} declares purpose "${icon.purpose}", outside ${ALLOWED_MANIFEST_PURPOSES.join(' / ')}`,
				);
			}
			if (icon.type !== 'image/png') {
				errors.push(`${MANIFEST_PATH}: icon ${icon.src} must declare type "image/png"`);
			}
		}
	}

	// --- head links -------------------------------------------------------
	const links = parseHeadIconLinks(headSource) ?? [];
	if (links.length === 0) {
		errors.push(`${HEAD_ROUTE_PATH} declares no APP_ICON_LINKS entries`);
	}
	const iconLinks = links.filter((link) => link.rel === 'icon' || link.rel === 'apple-touch-icon');
	if (!iconLinks.some((link) => link.type === 'image/svg+xml' && link.href === '/favicon.svg')) {
		errors.push(
			`${HEAD_ROUTE_PATH} no longer declares the Issue #285 SVG favicon (rel="icon", /favicon.svg)`,
		);
	}
	if (!iconLinks.some((link) => link.type === 'image/png')) {
		errors.push(`${HEAD_ROUTE_PATH} declares no PNG icon raster fallback`);
	}
	for (const size of REQUIRED_ICON_SIZES) {
		if (!iconLinks.some((link) => link.rel === 'icon' && link.sizes === size)) {
			errors.push(`${HEAD_ROUTE_PATH} declares no rel="icon" PNG at ${size}`);
		}
	}
	for (const size of REQUIRED_APPLE_TOUCH_SIZES) {
		if (!iconLinks.some((link) => link.rel === 'apple-touch-icon' && link.sizes === size)) {
			errors.push(`${HEAD_ROUTE_PATH} declares no apple-touch-icon at ${size}`);
		}
	}
	if (!links.some((link) => link.rel === 'manifest')) {
		errors.push(`${HEAD_ROUTE_PATH} declares no rel="manifest" link to ${MANIFEST_PATH}`);
	}

	// --- theme-color meta -------------------------------------------------
	const themeMetas = parseThemeColorMetas(headSource);
	if (themeMetas.length === 0) {
		errors.push(`${HEAD_ROUTE_PATH} declares no theme-color meta`);
	}
	for (const meta of themeMetas) {
		if (!meta.media) {
			errors.push(
				`${HEAD_ROUTE_PATH}: theme-color ${meta.content} has no media query; the site ships two appearances (Issue #290), so each value must be conditioned`,
			);
		}
		if (!palette.has(String(meta.content ?? '').toLowerCase())) {
			errors.push(
				`${HEAD_ROUTE_PATH}: theme-color ${meta.content} is not a colour in ${TOKENS_PATH}`,
			);
		}
	}
	const mediaQueries = themeMetas.map((meta) => meta.media).sort();
	const expectedQueries = ['(prefers-color-scheme: dark)', '(prefers-color-scheme: light)'];
	if (themeMetas.length !== 2 || mediaQueries.join('|') !== expectedQueries.join('|')) {
		errors.push(
			`${HEAD_ROUTE_PATH}: expected exactly one light and one dark theme-color meta (${expectedQueries.join(' / ')}), found ${mediaQueries.join(' / ') || 'none'}`,
		);
	}

	// --- files, sizes, pixels, bijection ----------------------------------
	const referenced = new Map();
	for (const link of iconLinks) {
		if (link.href === '/favicon.svg') continue;
		if (!link.href.startsWith(ICONS_HREF_PREFIX)) {
			errors.push(`${HEAD_ROUTE_PATH}: icon href ${link.href} must live under /icons/`);
			continue;
		}
		const full = resolve(root, `public${link.href}`);
		if (!existsSync(full)) {
			errors.push(`${HEAD_ROUTE_PATH}: rel="${link.rel}" points at a missing file ${link.href}`);
			continue;
		}
		referenced.set(link.href, (referenced.get(link.href) ?? 0) + 1);
		await inspectRaster(full, link.sizes, { mark, canvas }, errors);
	}
	for (const icon of parseManifestIcons(manifest)) {
		if (!icon.src) {
			errors.push(`${MANIFEST_PATH} has an icon entry without src`);
			continue;
		}
		if (!icon.src.startsWith(ICONS_HREF_PREFIX)) {
			errors.push(`${MANIFEST_PATH}: icon src ${icon.src} must live under /icons/`);
			continue;
		}
		const full = resolve(root, `public${icon.src}`);
		if (!existsSync(full)) {
			errors.push(`${MANIFEST_PATH} points at a missing file ${icon.src}`);
			continue;
		}
		referenced.set(icon.src, (referenced.get(icon.src) ?? 0) + 1);
		await inspectRaster(full, icon.sizes, { mark, canvas }, errors);
	}
	for (const [href, count] of referenced) {
		if (count > 1) {
			errors.push(`${href} is referenced ${count} times across the head links and the manifest`);
		}
	}
	for (const name of iconsOnDisk) {
		const href = `${ICONS_HREF_PREFIX}${name}`;
		if (!referenced.has(href)) {
			errors.push(
				`${ICONS_DIR}/${name} is not referenced by the document head or the manifest; every published icon must be reachable from one of them`,
			);
		}
	}

	// --- response-header contract -----------------------------------------
	if (headersSource !== null) {
		if (
			!/\/site\.webmanifest[\s\S]*?Content-Type:\s*application\/manifest\+json/.test(headersSource)
		) {
			errors.push(
				`${HEADERS_PATH} does not pin Content-Type: application/manifest+json for /site.webmanifest`,
			);
		}
		if (
			!/\/icons\/\*[\s\S]*?Cache-Control:\s*public,\s*max-age=0,\s*must-revalidate/.test(
				headersSource,
			)
		) {
			errors.push(
				`${HEADERS_PATH} does not keep /icons/* revalidating (max-age=0, must-revalidate); a launcher may cache an icon for weeks`,
			);
		}
	}

	// --- no offline declaration -------------------------------------------
	for (const file of walkSourceFiles(resolve(root, SRC_DIR))) {
		const source = readFileSync(file, 'utf8');
		if (/serviceWorker\s*\.\s*register|navigator\s*\.\s*serviceWorker/.test(source)) {
			errors.push(
				`${file.slice(root.length + 1)} registers a service worker. Issue #504 forbids declaring offline behaviour, and this platform has no offline contract — do not register one without a ticket that owns it.`,
			);
		}
	}

	return { ok: errors.length === 0, errors };
}

async function main() {
	let result;
	try {
		result = await checkAppIcons({ root: repoRoot });
	} catch (error) {
		process.stderr.write(`[check-app-icons] FAIL: gate could not run: ${error.stack}\n`);
		process.exit(2);
	}
	if (!result.ok) {
		process.stderr.write(
			`[check-app-icons] FAIL: ${result.errors.length} published-icon violation(s):\n${result.errors
				.map((line) => `  - ${line}`)
				.join('\n')}\n`,
		);
		process.exit(1);
	}
	console.log(
		'[check-app-icons] OK: head links, manifest, and public/icons/ describe one icon family.',
	);
}

// ESM main-module guard: importing this file for testing must not run
// the gate (same pattern as scripts/check-release-assets.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
