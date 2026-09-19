#!/usr/bin/env node
/**
 * Generate the access-counter digit images.
 *
 * The home page's `04 — Access counter` tile (src/home/access/tiles.tsx)
 * renders the page-view count as a sequence of pre-rasterised digit
 * images rather than as text. The "image swap" effect — combined with
 * a fixed 7-digit display width — gives the tile its mechanical
 * odometer feel; the React component just imports the right image
 * per digit slot.
 *
 * Why a fixed digit count:
 *   - Per the design pass, the counter must look like an odometer:
 *     always 7 slots wide with leading zeros ("0001234"), never
 *     narrower for small counts and never wider for big ones (until
 *     the count literally outgrows 7 digits, at which point the
 *     display expands naturally).
 *   - The user explicitly required rasterising the *font* — i.e.
 *     the digit image is a font glyph, not a hand-drawn segment.
 *     That makes the swap mechanic subordinate to the typography:
 *     the digits look like a regular mono number that has been
 *     frozen as a bitmap, then mounted with `display: inline-block`.
 *
 * Why this script runs at all:
 *   - The 10 generated WebP files are committed to the repo so the
 *     build does not depend on sharp being installed. The script is
 *     a maintainer convenience — re-run it when the digit style
 *     changes via `pnpm run generate:digits`.
 *
 * Sharp usage notes:
 *   - `sharp` is devDependency-only; it is not part of the runtime
 *     image (the generated WebPs are).
 *   - Production does not run this script. CI does not run it.
 *   - The Worker / SSR runtime never imports sharp.
 *
 * WebP output:
 *   - 64x96 canvas per digit — the mono glyph at 72 px font-size
 *     fits naturally inside this canvas with a small inset. The
 *     React component scales the image via CSS so we render at
 *     ~1.5× of the smallest display size (60 px at lg) for retina.
 *   - `lossless: true` keeps glyph edges sharp at small display
 *     sizes; alpha channel kept transparent.
 *   - The SVG uses `currentColor`; librsvg resolves that to the CSS
 *     initial (`#000`) at rasterise time. `text.default` in the
 *     editorial palette is `#0b1020` — visually identical to black
 *     so the baked colour matches the rendered foreground.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WIDTH = 64;
const HEIGHT = 96;

/**
 * SVG template. The font stack asks fontconfig for a mono font;
 * the local fontconfig typically resolves `ui-monospace` to the
 * system default (DejaVu Sans Mono, Ubuntu Mono, Menlo, etc. —
 * any of which renders cleanly). The exact glyph shape is a
 * maintainer convenience, not a public contract: the React
 * component only cares about the silhouette of "what 0–9 looks
 * like", not the specific font family.
 */
function svgForDigit(digit) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <text x="${WIDTH / 2}" y="${HEIGHT * 0.78}"
    text-anchor="middle"
    font-family="ui-monospace, 'JetBrains Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"
    font-size="72"
    font-weight="700"
    letter-spacing="-2"
    fill="currentColor">${digit}</text>
</svg>`;
}

async function main() {
	const here = dirname(fileURLToPath(import.meta.url));
	const outDir = resolve(here, '..', 'src', 'home', 'digits');
	await mkdir(outDir, { recursive: true });

	for (let digit = 0; digit <= 9; digit++) {
		const svg = svgForDigit(digit);
		const outPath = resolve(outDir, `${digit}.webp`);
		await sharp(Buffer.from(svg)).webp({ lossless: true }).toFile(outPath);
		process.stdout.write(`wrote ${outPath}\n`);
	}

	// Drop a sibling README so the directory is self-explanatory.
	const readme = `# access-counter digit images

Pre-rasterised mono digits (0–9), one file per digit. The home page's
\`04 — Access counter\` tile imports each digit as a URL and renders
the count as a fixed-width sequence of \`<img>\` tags — 7 slots wide
with leading zeros (\`0001234\`), like an odometer. Re-generate with:

\`\`\`
pnpm run generate:digits
\`\`\`

Visual: \`<text>\` rendered through sharp's SVG → WebP pipeline using
\`ui-monospace\` (fontconfig resolves to the system mono on each
machine; the exact glyph differs slightly between dev / CI, but the
silhouette — and therefore the swap effect — is identical). Bake
colour is \`currentColor\` resolved at rasterise time, which librsvg
renders as \`#000\` (matches \`text.default\` = \`#0b1020\` visually).
`;
	await writeFile(resolve(outDir, 'README.md'), readme, 'utf8');
	process.stdout.write(`wrote ${resolve(outDir, 'README.md')}\n`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
