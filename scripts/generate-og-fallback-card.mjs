#!/usr/bin/env node
/**
 * Generate the site fallback card (Issue #421).
 *
 * Why a committed binary
 * ----------------------
 * `src/editorial/social-card/contract.json#fallbackCard` promises a
 * real, fetchable `og:image` for every surface whose own media does
 * not resolve (no media row, unbound R2 custom domain, a media row
 * with no alt text). A crawler fetches that URL directly, so the card
 * has to be an actual image served from the static-assets binding —
 * there is no Worker route that could render it on demand, and no
 * data URI a head tag may carry.
 *
 * Why it is generated, not drawn
 * ------------------------------
 * The bytes are fully derived from the SVG below at fixed dimensions,
 * with no timestamp, no randomness and no host font, so the committed
 * PNG can be audited: `--check` re-renders and compares byte-for-byte.
 * Same precedent and the same constraints as
 * `scripts/generate-image-fixtures.mjs`, for the same reason:
 *
 *   - **No text.** Sharp's SVG rasteriser resolves whatever font the
 *     host happens to have; a wordmark would make the output depend
 *     on the machine that generated it, and a card that renders as
 *     different glyphs is not evidence of anything.
 *   - **Geometry only**, on the shipped palette from
 *     `src/editorial/tokens.ts` (charcoal 950 canvas, neutral 400
 *     hairline, brand 500 accent) so the card reads as part of the
 *     site instead of as an unrelated placeholder.
 *   - **Small.** Flat fills and hairlines compress to a few KB, and it
 *     is only fetched by unfurlers, never by a page render.
 *
 * `sharp` is a devDependency; the Worker never imports it.
 *
 *   node scripts/generate-og-fallback-card.mjs            # (re)write
 *   node scripts/generate-og-fallback-card.mjs --check    # verify, exit 1 on drift
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The card's identity comes from the contract, not from a second copy
 * of it: `contract.json#fallbackCard` is the declaration the engine and
 * the report compare documents against, so the generator reads it here
 * instead of asking a comment to keep two literals in step. Only the
 * rendering decisions — file name and palette — are local.
 */
const CONTRACT = JSON.parse(
	readFileSync(join(REPO_ROOT, 'src', 'editorial', 'social-card', 'contract.json'), 'utf8'),
);

export const FALLBACK_CARD = {
	file: 'default-card.png',
	/** Origin-relative path served from the static-assets binding. */
	path: CONTRACT.fallbackCard.path,
	width: CONTRACT.fallbackCard.width,
	height: CONTRACT.fallbackCard.height,
	/** Palette roles, named after `src/editorial/tokens.ts`. */
	colors: {
		canvas: '#0a0b0e', // charcoal 950 — the page background
		surface: '#111317', // charcoal 900 — the raised surface
		hairline: '#8b9099', // charcoal 400 — secondary text / rule
		accent: '#0ea5e9', // brand 500 — the only saturated colour
	},
};

const TARGET = join(REPO_ROOT, 'public', 'og', FALLBACK_CARD.file);

/**
 * The card, as SVG geometry.
 *
 * Layout: an inset hairline frame (the "card" edge), a filled accent
 * bar on the left edge (the site's brand signal, the one saturated
 * element), and a 3x2 grid of hairline squares — the same
 * "component grid" reading the portfolio facets use, at card scale.
 */
export function fallbackCardSvg({ width, height, colors }) {
	const margin = Math.round(width * 0.075);
	const frame = { x: margin, y: margin, w: width - margin * 2, h: height - margin * 2 };
	const barWidth = Math.round(width * 0.014);
	const cell = Math.round(width * 0.055);
	const gap = Math.round(cell * 0.34);
	const gridColumns = 3;
	const gridRows = 2;
	const gridWidth = gridColumns * cell + (gridColumns - 1) * gap;
	const gridX = frame.x + Math.round((frame.w - gridWidth) / 2);
	const gridY = frame.y + Math.round((frame.h - (gridRows * cell + (gridRows - 1) * gap)) / 2);

	const cells = [];
	for (let row = 0; row < gridRows; row++) {
		for (let column = 0; column < gridColumns; column++) {
			const x = gridX + column * (cell + gap);
			const y = gridY + row * (cell + gap);
			cells.push(
				`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="none" stroke="${
					colors.hairline
				}" stroke-width="4" />`,
			);
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${colors.canvas}" />
  <rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="${colors.surface}" stroke="${colors.hairline}" stroke-width="4" />
  <rect x="0" y="0" width="${barWidth}" height="${height}" fill="${colors.accent}" />
${cells.join('\n')}
</svg>
`;
}

/**
 * Rasterise the card. PNG: the broadest OG/Twitter image support.
 *
 * No `density` override: sharp/librsvg rasterises at 72 dpi by default,
 * where 1 SVG px is 1 output px. Raising the density (96 is the
 * tempting value — it is the CSS reference) would silently render a
 * 1600px card from a 1200px drawing, and the contract would then
 * promise a size the committed bytes do not have.
 */
export async function renderFallbackCard() {
	return sharp(Buffer.from(fallbackCardSvg(FALLBACK_CARD)))
		.png({ compressionLevel: 9, effort: 10, palette: false })
		.toBuffer();
}

async function main() {
	const checkOnly = process.argv.includes('--check');
	const expected = await renderFallbackCard();
	mkdirSync(dirname(TARGET), { recursive: true });

	if (checkOnly) {
		let current = null;
		try {
			current = readFileSync(TARGET);
		} catch {
			current = null;
		}
		const ok = current?.equals(expected) === true;
		process.stdout.write(
			`[og-fallback-card] ${ok ? 'OK  ' : 'DRIFT'} public/og/${FALLBACK_CARD.file} (${FALLBACK_CARD.width}x${FALLBACK_CARD.height}, ${expected.length} B)\n`,
		);
		if (!ok) {
			process.stderr.write(
				'Remedy: run `node scripts/generate-og-fallback-card.mjs` and commit the result. The committed PNG must be reproducible from the SVG in this script (no timestamp, no host font).\n',
			);
		}
		return ok ? 0 : 1;
	}

	writeFileSync(TARGET, expected);
	process.stdout.write(
		`[og-fallback-card] wrote public/og/${FALLBACK_CARD.file} (${FALLBACK_CARD.width}x${FALLBACK_CARD.height}, ${expected.length} B)\n`,
	);
	return 0;
}

// Running main() on import would rewrite a committed binary from inside
// the unit test that imports it.
const invokedDirectly =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	process.exitCode = await main();
}
