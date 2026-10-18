#!/usr/bin/env node
/**
 * Generate the deterministic raster fixtures the CLS regression
 * surface measures (Issue #486).
 *
 * Why committed binaries
 * ----------------------
 * `e2e/image-cls.spec.ts` and `scripts/image-cls-report.mjs` need a
 * REAL image that is fetched over HTTP, arrives late enough to be
 * observable, and has an intrinsic size the test can state up front.
 * An inline data URI would defeat all three: it decodes synchronously
 * and carries no fetch. A screenshot of a real page would be both
 * large and non-reproducible.
 *
 * So the bytes are committed, and this script is the reason they can
 * be trusted: `public/fixtures/*.png` is fully derived from the SVG
 * source below, at fixed dimensions, with no timestamps and no
 * randomness.
 *
 *     node scripts/generate-image-fixtures.mjs            # (re)write
 *     node scripts/generate-image-fixtures.mjs --check    # verify, exit 1 on drift
 *
 * `--check` compares the committed bytes against what this script
 * would write today. It is the audit path for a reviewer who wants to
 * confirm the committed PNG is not an untracked artifact; it is NOT
 * wired into `pnpm run validate:*` (see `quality/profile.yaml` —
 * Issue #486 records that the quality profile is unchanged).
 *
 * Design constraints, deliberately narrow:
 *
 *   - **Raster, not SVG.** An SVG with width/height attributes has a
 *     well-defined intrinsic ratio too, but Chromium / WebKit differ
 *     in how they resolve it against `aspect-ratio`, which is exactly
 *     the behaviour under test. A raster exercises the same path a
 *     real portfolio cover does.
 *   - **No text.** Sharp's SVG rasteriser would pull in whatever font
 *     the host happens to have; text would make the output depend on
 *     the machine. Geometry only.
 *   - **Small.** Flat gradients compress to a few KB, so shipping the
 *     fixture to the static-assets binding costs nothing measurable.
 *
 * `sharp` is a devDependency (same precedent as
 * `scripts/generate-counter-digits.mjs`). The Worker / SSR runtime
 * never imports it; it only runs when a human or a regeneration step
 * invokes this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'public', 'fixtures');

const checkOnly = process.argv.includes('--check');

/**
 * The fixture inventory.
 *
 * `width` / `height` are load-bearing: the fixture section
 * (`src/routes/design-system/sections/ImageCls.tsx`) declares the
 * SAME numbers as the media row's intrinsic size, and the E2E spec
 * asserts the browser derives exactly this box. Changing a dimension
 * here without changing the section is a deliberate test failure, so
 * `e2e/image-cls.spec.ts` reads the values back out of the rendered
 * DOM rather than trusting this table.
 */
export const FIXTURES = [
	{
		file: 'cls-cover-1600x900.png',
		width: 1600,
		height: 900,
		from: '#101b26',
		to: '#2f5d73',
		band: '#e8eef2',
	},
	{
		file: 'cls-inline-1280x720.png',
		width: 1280,
		height: 720,
		from: '#241a2e',
		to: '#5c3b6e',
		band: '#f0e6f2',
	},
];

/**
 * Deterministic SVG source for one fixture. No text, no timestamps.
 *
 * Flat rectangles rather than a gradient, on purpose: a gradient is
 * incompressible, so it would put ~45KB of noise into the static
 * assets binding to prove a property that only depends on the pixel
 * dimensions. Four flat blocks compress to a few KB and carry exactly
 * the same signal — a real raster of a known size.
 */
export function fixtureSvg({ width, height, from, to, band }) {
	const bandHeight = Math.round(height / 6);
	const bandY = Math.round(height / 2 - bandHeight / 2);
	const inset = Math.round(width / 12);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`<rect width="${width}" height="${height}" fill="${from}"/>`,
		`<rect x="0" y="${Math.round(height / 3)}" width="${width}" height="${Math.round(height / 3)}" fill="${to}"/>`,
		`<rect x="${inset}" y="${bandY}" width="${width - inset * 2}" height="${bandHeight}" fill="${band}"/>`,
		`<rect x="${inset}" y="${bandY}" width="${width - inset * 2}" height="${bandHeight}" fill="none" stroke="${from}" stroke-width="4"/>`,
		'</svg>',
	].join('');
}

export async function render(fixture) {
	// sharp 0.35.x does not accept a raw SVG string as input — it must
	// be wrapped in a Buffer (same note as generate-counter-digits.mjs).
	return sharp(Buffer.from(fixtureSvg(fixture)))
		.png({ compressionLevel: 9, effort: 10, palette: false })
		.toBuffer();
}

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	const drifted = [];
	for (const fixture of FIXTURES) {
		const outPath = join(OUT_DIR, fixture.file);
		const expected = await render(fixture);
		if (checkOnly) {
			let actual = null;
			try {
				actual = readFileSync(outPath);
			} catch {
				actual = null;
			}
			const match = actual?.equals(expected) === true;
			process.stdout.write(
				`${match ? 'OK  ' : 'DRIFT'} public/fixtures/${fixture.file} ` +
					`(${fixture.width}x${fixture.height}, ${expected.length} bytes)\n`,
			);
			if (!match) drifted.push(fixture.file);
			continue;
		}
		writeFileSync(outPath, expected);
		process.stdout.write(
			`wrote public/fixtures/${fixture.file} (${fixture.width}x${fixture.height}, ${expected.length} bytes)\n`,
		);
	}

	if (drifted.length > 0) {
		const list = drifted.map((f) => `  - public/fixtures/${f}\n`).join('');
		const hint =
			'Re-run `node scripts/generate-image-fixtures.mjs` (without --check) and commit the result.';
		process.stderr.write(
			`\n${drifted.length} fixture(s) differ from this script's output:\n${list}\n${hint}\n`,
		);
		process.exit(1);
	}
}

/**
 * Run only when invoked directly.
 *
 * `scripts/generate-image-fixtures.test.mjs` imports the render
 * helpers to assert the committed bytes and the declared dimensions;
 * running `main()` on import would rewrite `public/fixtures/` as a
 * side effect of importing the module.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
