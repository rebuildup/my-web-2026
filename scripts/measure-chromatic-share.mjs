#!/usr/bin/env node

/**
 * measure-chromatic-share — the chromatic-area observation of the UI
 * visual review (Issue #1110, ADR-0022 §3.3/§5.2,
 * docs/runbook/ui-visual-review.md §5).
 *
 * Method — identical to `docs/verification/design/887-current-recheck.md`
 * §方法 so the numbers stay comparable across releases:
 *
 *   chroma        = max(R,G,B) − min(R,G,B)   per pixel
 *   chromatic px  = chroma > 12
 *   chromatic share = chromatic pixels ÷ total pixels
 *
 * The input is decoded to raw RGB with sharp — PNG captures from
 * `capture-design-matrix.mjs` are the intended input (a lossy
 * intermediate would measure the encoder, not the page).
 *
 * This is an OBSERVATION, not a gate: the script reports shares and
 * the dominant chromatic colours and exits 0 regardless of the
 * numbers. Whether a share is acceptable is the visual review's
 * judgement (ADR-0022 §5.2 — no threshold is encoded here).
 *
 * Usage:
 *   node scripts/measure-chromatic-share.mjs <image-or-dir> [more…]
 *   node scripts/measure-chromatic-share.mjs .tmp/design-matrix --json
 *
 * Accepts .png / .webp / .jpg files or directories (recursed one
 * level). Writes nothing; prints one row per image plus a total.
 *
 * Exit: 0 measured / 2 usage or unreadable input.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';

const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const CHROMA_THRESHOLD = 12;
/** Cap the per-colour histogram so the report stays status-sized. */
const TOP_COLOURS = 8;

function collectImages(inputs) {
	const files = [];
	for (const input of inputs) {
		const full = resolve(input);
		const st = statSync(full, { throwIfNoEntry: false });
		if (!st) throw new Error(`no such path: ${input}`);
		if (st.isDirectory()) {
			for (const name of readdirSync(full).sort()) {
				if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) continue;
				files.push(join(full, name));
			}
		} else if (IMAGE_EXTENSIONS.has(extname(full).toLowerCase())) {
			files.push(full);
		} else {
			throw new Error(`not an image: ${input}`);
		}
	}
	return files;
}

/**
 * Decode to sRGB raw pixels and count chromatic ones.
 *
 * `sharp.raw()` without an explicit channels count keeps the file's
 * own channel layout; screenshots are always 3- or 4-channel sRGB,
 * and the chroma formula only reads R/G/B, so alpha is ignored by
 * taking the first three channels of each pixel.
 */
export async function measureFile(file) {
	const { data, info } = await sharp(file)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const channels = info.channels;
	const pixels = info.width * info.height;
	let chromatic = 0;
	const colours = new Map();
	for (let i = 0; i < pixels; i += 1) {
		const o = i * channels;
		const r = data[o];
		const g = data[o + 1];
		const b = data[o + 2];
		const lo = Math.min(r, g, b);
		const hi = Math.max(r, g, b);
		if (hi - lo > CHROMA_THRESHOLD) {
			chromatic += 1;
			// Quantize to whole-percent buckets so near-identical antialiased
			// edges do not explode the histogram; the report names the
			// dominant flat fills, not the edge noise.
			const key = `${Math.round((r / 255) * 20) * 13}-${Math.round((g / 255) * 20) * 13}-${Math.round((b / 255) * 20) * 13}`;
			colours.set(key, (colours.get(key) ?? 0) + 1);
		}
	}
	const top = [...colours.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, TOP_COLOURS)
		.map(([key, count]) => ({ bucket: key, pixels: count }));
	return {
		file: basename(file),
		width: info.width,
		height: info.height,
		pixels,
		chromaticPixels: chromatic,
		chromaticShare: pixels === 0 ? 0 : chromatic / pixels,
		topChromatic: top,
	};
}

async function main(argv) {
	const jsonOut = argv.includes('--json');
	const inputs = argv.filter((a) => !a.startsWith('--'));
	if (inputs.length === 0) {
		process.stderr.write(
			'usage: node scripts/measure-chromatic-share.mjs <image-or-dir> [more…] [--json]\n',
		);
		return 2;
	}
	let files;
	try {
		files = collectImages(inputs);
	} catch (error) {
		process.stderr.write(`[measure-chromatic-share] ${error.message}\n`);
		return 2;
	}
	if (files.length === 0) {
		process.stderr.write('[measure-chromatic-share] no images found\n');
		return 2;
	}

	const rows = [];
	for (const file of files) {
		try {
			rows.push(await measureFile(file));
		} catch (error) {
			process.stderr.write(`[measure-chromatic-share] cannot decode ${file}: ${error.message}\n`);
			return 2;
		}
	}

	if (jsonOut) {
		process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
		return 0;
	}
	let totalPixels = 0;
	let totalChromatic = 0;
	for (const row of rows) {
		totalPixels += row.pixels;
		totalChromatic += row.chromaticPixels;
		const top = row.topChromatic
			.map((c) => `${c.bucket} ${(100 * c.pixels) / Math.max(1, row.chromaticPixels)}%`)
			.join(', ');
		process.stdout.write(
			`${row.file}\t${(row.chromaticShare * 100).toFixed(4)}%\t${row.chromaticPixels}/${row.pixels}\t${top}\n`,
		);
	}
	process.stdout.write(
		`TOTAL\t${totalPixels === 0 ? '0.0000' : ((totalChromatic / totalPixels) * 100).toFixed(4)}%\t${totalChromatic}/${totalPixels}\t(observation only — the visual review decides)\n`,
	);
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(await main(process.argv.slice(2)));
}
