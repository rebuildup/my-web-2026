#!/usr/bin/env node
/**
 * Build the Melty pet sprites for the web (Issue #274).
 *
 * What this produces
 * ------------------
 * Two committed WebP files under `public/pets/melty/`:
 *
 *   idle-rest.webp  192 x 208   1 frame   the resting character
 *   waving.webp     768 x 208   4 frames  the greeting strip (8 columns
 *                                         worth of cells, only the 4 the
 *                                         v2 contract defines)
 *
 * Why a generator instead of a committed 1.5 MB atlas
 * ---------------------------------------------------
 * The upstream artefact is a 1536 x 2288 PNG atlas (73 frames + 15
 * transparent cells). Shipping it unchanged would put 1.5 MB into the
 * git history and into the public asset tree for two frames the site
 * actually draws. The atlas stays OUT of the repository; this script
 * is the reproducible bridge from it to the two files that ship.
 *
 * The atlas is not reproducible: it came out of a generative model, so
 * re-running the prompt yields different bytes. The input is therefore
 * pinned by digest instead of by path, and the script REFUSES an atlas
 * whose sha256 is not the recorded one. That refusal is the point —
 * "some PNG with the right dimensions" is not the character.
 *
 * Determinism of the OUTPUT, given the pinned INPUT, holds: crop and
 * WebP encode are pure functions of the bytes plus the sharp version.
 * `docs/verification/legal/pet-melty-rights-review.md` records both.
 *
 * Usage
 * -----
 *   node scripts/build-pet-sprites.mjs --atlas=<path to spritesheet-extended.png>
 *   pnpm run generate:pets -- --atlas=<path>
 *
 * Status-only output: sizes, digests, verdicts. No image content, no
 * environment values.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const OUT_DIR = resolve(repoRoot, 'public', 'pets', 'melty');

/**
 * The one atlas this script accepts.
 *
 * `spritesheet-extended.png` (v2) from the owner's ChatGPT Library for
 * pet `pet_6ac5adc2388481919ad57cc91ead3f51`. v1 (`spritesheet.png`,
 * 1536 x 1872) is rejected on purpose: it has no look rows, and the
 * web surface has no use for the desktop-only rows either — pinning
 * one artefact keeps "which bytes does the site show" answerable.
 */
export const ATLAS_SHA256 = '78aa007c7d183e6087593463d77297bb0c707368f9c05cd871145281bbf63902';
export const ATLAS_WIDTH = 1536;
export const ATLAS_HEIGHT = 2288;

/** The v2 cell geometry (`work-pets` sprite-sheet-contract v2). */
export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;

/**
 * The rows the web surface draws.
 *
 * Row indices are contract values, not preferences: row 0 is `idle`
 * and row 3 is `waving` in every v2 atlas. Rows 1-2 are the draggable
 * desktop overlay's left/right travel, 9-10 are pointer-following look
 * directions — none of them has a meaning on a web page.
 */
export const SPRITES = [
	{
		file: 'idle-rest.webp',
		row: 0,
		frames: 1,
		description: 'idle の 0 フレーム目（静止）',
	},
	{
		file: 'waving.webp',
		row: 3,
		frames: 4,
		description: 'waving の 4 フレーム横ストリップ',
	},
];

/** Lowercase hex sha256 of a buffer. */
function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

function parseArgs(argv) {
	let atlas = null;
	for (const arg of argv) {
		if (arg.startsWith('--atlas=')) atlas = arg.slice('--atlas='.length);
		else throw new Error(`unknown option: ${arg}`);
	}
	if (atlas === null || atlas.trim() === '') {
		throw new Error(
			'--atlas=<path> is required. The atlas is intentionally not committed; point this at the spritesheet-extended.png recorded in docs/verification/legal/pet-melty-rights-review.md',
		);
	}
	return { atlas: resolve(process.cwd(), atlas) };
}

/**
 * Refuse anything that is not the pinned atlas.
 *
 * Checking the digest BEFORE decoding means a wrong file never reaches
 * sharp, so a mistake cannot produce "plausible" output that then has
 * to be detected by eye.
 */
async function readPinnedAtlas(path) {
	let bytes;
	try {
		bytes = await readFile(path);
	} catch {
		throw new Error(`atlas is not readable: ${path}`);
	}
	const digest = sha256(bytes);
	if (digest !== ATLAS_SHA256) {
		throw new Error(
			`atlas digest mismatch: expected ${ATLAS_SHA256}, got ${digest}. This is not the recorded artefact.`,
		);
	}
	const meta = await sharp(bytes).metadata();
	if (meta.width !== ATLAS_WIDTH || meta.height !== ATLAS_HEIGHT) {
		throw new Error(
			`atlas geometry mismatch: expected ${ATLAS_WIDTH}x${ATLAS_HEIGHT}, got ${meta.width}x${meta.height}`,
		);
	}
	return { bytes, size: (await stat(path)).size };
}

/** Crop one row's leading `frames` cells and encode it as WebP. */
async function buildSprite(atlasBytes, sprite) {
	const width = CELL_WIDTH * sprite.frames;
	const height = CELL_HEIGHT;
	if (sprite.frames > ATLAS_WIDTH / CELL_WIDTH) {
		throw new Error(`${sprite.file}: ${sprite.frames} frames exceeds the atlas row width`);
	}
	if ((sprite.row + 1) * CELL_HEIGHT > ATLAS_HEIGHT) {
		throw new Error(`${sprite.file}: row ${sprite.row} is outside the atlas`);
	}
	return sharp(atlasBytes)
		.extract({ left: 0, top: sprite.row * CELL_HEIGHT, width, height })
		.webp({ quality: 85, alphaQuality: 100, effort: 6 })
		.toBuffer();
}

async function main() {
	const { atlas } = parseArgs(process.argv.slice(2));
	const { bytes, size } = await readPinnedAtlas(atlas);
	process.stdout.write(`atlas: ${atlas}\n`);
	process.stdout.write(`atlas sha256: ${ATLAS_SHA256} (pinned, matched)\n`);
	process.stdout.write(`atlas bytes: ${size}\n`);

	await mkdir(OUT_DIR, { recursive: true });
	const outputs = [];
	for (const sprite of SPRITES) {
		const encoded = await buildSprite(bytes, sprite);
		const outPath = resolve(OUT_DIR, sprite.file);
		// Write the encoded buffer directly. Handing it back to sharp
		// (`sharp(encoded).toFile(...)`) would decode and re-encode at the
		// default quality, so the shipped bytes would be the SECOND
		// generation — smaller, softer, and not what `buildSprite`
		// produced. One encode, one artefact.
		await writeFile(outPath, encoded);
		outputs.push({
			file: `public/pets/melty/${sprite.file}`,
			description: sprite.description,
			width: CELL_WIDTH * sprite.frames,
			height: CELL_HEIGHT,
			bytes: encoded.length,
			sha256: sha256(encoded),
		});
		process.stdout.write(
			`wrote public/pets/melty/${sprite.file} (${outputs[outputs.length - 1].bytes} B)\n`,
		);
	}

	process.stdout.write('\noutput summary\n');
	for (const entry of outputs) {
		process.stdout.write(
			`  ${entry.width}x${entry.height}  ${String(entry.bytes).padStart(7)} B  ${entry.sha256}  ${entry.file}\n`,
		);
	}
	process.stdout.write(`total: ${outputs.reduce((sum, entry) => sum + entry.bytes, 0)} B\n`);
}

main().catch((error) => {
	process.stderr.write(`build-pet-sprites: ${error.message}\n`);
	process.exit(1);
});
