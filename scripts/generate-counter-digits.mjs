#!/usr/bin/env node
/**
 * Generate the access-counter digit images.
 *
 * The home page's `04 — Access counter` tile (src/home/access/tiles.tsx)
 * renders the page-view count as a sequence of pre-rasterised digit
 * images rather than as text. The "image swap" effect is what gives
 * the tile its mechanical-counter feel — the React component just
 * imports the right image per digit position.
 *
 * Why 7-segment LCD:
 *   - It is the canonical "counter" visual (odometer, page-view
 *     counters, scoreboards). The user research surfaced this as the
 *     recognisable counter aesthetic.
 *   - The shape is path-based, so the output is identical on every
 *     machine — no fontconfig dependency, no system-font drift
 *     between dev / CI / production builds.
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
 *   - 96x144 canvas per digit (1.5x of the largest display size in
 *     tiles.tsx so that @2x rendering stays crisp on retina).
 *   - `lossless: true` keeps the segment edges sharp at small sizes.
 *   - Transparent background — the React component owns the color.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * 7-segment digit patterns. Each digit is identified by which of
 * the seven segments (a..g) are lit:
 *
 *      aaa
 *     f   b
 *     f   b
 *      ggg
 *     e   c
 *     e   c
 *      ddd
 *
 * Lit-segment set per digit:
 *   0: a b c d e f        5: a c d f g
 *   1: b c                6: a c d e f g
 *   2: a b d e g          7: a b c
 *   3: a b c d g          8: a b c d e f g
 *   4: b c f g            9: a b c d f g
 */
const DIGIT_SEGMENTS = {
	0: ['a', 'b', 'c', 'd', 'e', 'f'],
	1: ['b', 'c'],
	2: ['a', 'b', 'd', 'e', 'g'],
	3: ['a', 'b', 'c', 'd', 'g'],
	4: ['b', 'c', 'f', 'g'],
	5: ['a', 'c', 'd', 'f', 'g'],
	6: ['a', 'c', 'd', 'e', 'f', 'g'],
	7: ['a', 'b', 'c'],
	8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
	9: ['a', 'b', 'c', 'd', 'f', 'g'],
};

/**
 * Canvas + segment geometry. Pixel units match the WebP dimensions;
 * the React component scales the image down with CSS so we render
 * at 1.5x for retina sharpness.
 */
const WIDTH = 96;
const HEIGHT = 144;
// Inset from canvas edges to leave breathing room.
const PAD_X = 14;
const PAD_Y = 16;
const INNER_W = WIDTH - PAD_X * 2;
const INNER_H = HEIGHT - PAD_Y * 2;
// Segment stroke thickness.
const STROKE = 12;

/**
 * Coordinates of each segment as a (x1, y1, x2, y2) line. The lines
 * are drawn with `stroke-linecap="round"` so the LCD shape emerges
 * from the rounded ends of otherwise straight strokes.
 *
 * The horizontal segments (a, d, g) sit on the top, middle and
 * bottom thirds of the inner area; the vertical segments (b, c on
 * the right; e, f on the left) split the upper and lower halves
 * around the middle segment.
 */
const SEGMENT_LINES = {
	a: { x1: PAD_X, y1: PAD_Y, x2: PAD_X + INNER_W, y2: PAD_Y },
	g: { x1: PAD_X, y1: PAD_Y + INNER_H / 2, x2: PAD_X + INNER_W, y2: PAD_Y + INNER_H / 2 },
	d: { x1: PAD_X, y1: PAD_Y + INNER_H, x2: PAD_X + INNER_W, y2: PAD_Y + INNER_H },
	f: { x1: PAD_X, y1: PAD_Y + INNER_H / 4, x2: PAD_X, y2: PAD_Y + (INNER_H * 3) / 4 },
	b: {
		x1: PAD_X + INNER_W,
		y1: PAD_Y + INNER_H / 4,
		x2: PAD_X + INNER_W,
		y2: PAD_Y + (INNER_H * 3) / 4,
	},
	e: { x1: PAD_X, y1: PAD_Y + (INNER_H / 4) * 3, x2: PAD_X, y2: PAD_Y + (INNER_H * 5) / 4 },
	c: {
		x1: PAD_X + INNER_W,
		y1: PAD_Y + (INNER_H / 4) * 3,
		x2: PAD_X + INNER_W,
		y2: PAD_Y + (INNER_H * 5) / 4,
	},
};

// y-coordinate clamp — `e` and `c` go past the inner box to match
// the half-segment-on-the-junction look; clamp them at the canvas.
function clampLine(line) {
	const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
	return {
		x1: clamp(line.x1, 0, WIDTH),
		y1: clamp(line.y1, 0, HEIGHT),
		x2: clamp(line.x2, 0, WIDTH),
		y2: clamp(line.y2, 0, HEIGHT),
	};
}

/**
 * Compose the SVG for one digit. Lit segments draw with the
 * foreground stroke; unlit segments are omitted (transparent).
 *
 * `currentColor` is intentional: the React component sets `color`
 * on the parent so the segments inherit the tile's text color
 * (`text.default` for the enabled state, `text.muted` for the
 * disabled state). Without `currentColor` we'd have to regenerate
 * the WebPs for every color variant.
 */
function svgForDigit(digit) {
	const lit = new Set(DIGIT_SEGMENTS[digit]);
	const lines = Object.entries(SEGMENT_LINES)
		.filter(([key]) => lit.has(key))
		.map(([, line]) => clampLine(line))
		.map((line) => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" />`)
		.join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <g fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">
    ${lines}
  </g>
</svg>`;
}

async function main() {
	const here = dirname(fileURLToPath(import.meta.url));
	const outDir = resolve(here, '..', 'src', 'home', 'access', 'digits');
	await mkdir(outDir, { recursive: true });

	for (let digit = 0; digit <= 9; digit++) {
		const svg = svgForDigit(digit);
		const outPath = resolve(outDir, `${digit}.webp`);
		// sharp's SVG input goes through librsvg. We embed the SVG as
		// a Buffer; the `currentColor` keyword in the SVG inherits the
		// WebP's "render in the consumer's foreground color" behaviour.
		await sharp(Buffer.from(svg)).webp({ lossless: true }).toFile(outPath);
		process.stdout.write(`wrote ${outPath}\n`);
	}

	// Also drop a sibling `README.md` so the directory is self-explanatory
	// for anyone browsing the repo.
	const readme = `# access-counter digit images

Pre-rasterised 7-segment LCD digits (0-9), one per file. The
home page's \`04 — Access counter\` tile imports each digit as a
URL and renders the count as a sequence of \`<img>\` tags. The
"image swap" effect is what gives the tile its mechanical-counter
feel — see \`src/home/access/tiles.tsx\`.

Re-generate with:

\`\`\`
pnpm run generate:digits
\`\`\`

Visual: pure SVG paths, no font dependency. The \`currentColor\`
keyword in the SVG lets the React component inherit its parent's
text color, so the same WebP renders as \`text.default\` (enabled)
or \`text.muted\` (disabled) without a per-variant bake.

Canvas: ${WIDTH}x${HEIGHT}px (1.5x of the largest display size for
retina). Lossless WebP — edges stay sharp at the small display
size.
`;
	await writeFile(resolve(outDir, 'README.md'), readme, 'utf8');
	process.stdout.write(`wrote ${resolve(outDir, 'README.md')}\n`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
