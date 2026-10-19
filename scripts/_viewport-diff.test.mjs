import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	DIFF_CHANNEL_TOLERANCE,
	MIN_BREAKAGE_RATIO,
	OVERLAY_CHANGED_RGB,
	STABLE_MAX_RATIO,
	comparePng,
	decodePng,
	diffRasters,
	renderOverlay,
} from './_viewport-diff.mjs';

/**
 * Unit tests for the Issue #417 pixel-diff contract.
 *
 * These run without a browser, in milliseconds, and they are what make
 * the viewport gate falsifiable: the gate's claim is "a layout change
 * shows up as a red diff, and an unchanged page does not". That claim
 * is only worth something if the comparison underneath it is proven to
 * distinguish the two — which is exactly what a synthetic raster pair
 * proves, without a 30 s Playwright round trip.
 */

const WIDTH = 4;
const HEIGHT = 2;
const CHANNELS = 4;

function raster(pixels, { width = WIDTH, height = HEIGHT } = {}) {
	const data = Buffer.alloc(width * height * CHANNELS);
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		const [r, g, b] = pixels[pixel] ?? [0, 0, 0];
		const offset = pixel * CHANNELS;
		data[offset] = r;
		data[offset + 1] = g;
		data[offset + 2] = b;
		data[offset + 3] = 255;
	}
	return { data, width, height, channels: CHANNELS };
}

function pixelOf({ data, channels }, index) {
	const offset = index * channels;
	return [data[offset], data[offset + 1], data[offset + 2]];
}

async function png(pixels, options) {
	const sharp = (await import('sharp')).default;
	const r = raster(pixels, options);
	return sharp(r.data, { raw: { width: r.width, height: r.height, channels: CHANNELS } })
		.png()
		.toBuffer();
}

describe('_viewport-diff — threshold window', () => {
	it('keeps the stability allowance strictly below the breakage floor', () => {
		// If these ever cross, every control in the gate becomes
		// unfalsifiable: a break would be allowed to hide inside the
		// noise budget, and an unchanged page could be called broken.
		assert.ok(STABLE_MAX_RATIO < MIN_BREAKAGE_RATIO);
	});

	it('pins the per-channel tolerance below a visible colour step', () => {
		assert.ok(DIFF_CHANNEL_TOLERANCE > 0);
		assert.ok(DIFF_CHANNEL_TOLERANCE < 64);
	});
});

describe('_viewport-diff — diffRasters', () => {
	it('reports no change for two identical captures', () => {
		const pixels = Array.from({ length: WIDTH * HEIGHT }, (_unused, index) => [index * 8, 12, 30]);
		const result = diffRasters(raster(pixels), raster(pixels));

		assert.equal(result.changedPixels, 0);
		assert.equal(result.ratio, 0);
		assert.equal(result.totalPixels, WIDTH * HEIGHT);
	});

	it('ignores a per-channel difference inside the tolerance', () => {
		const base = Array.from({ length: WIDTH * HEIGHT }, () => [40, 40, 40]);
		const nudged = base.map(([r, g, b]) => [r + DIFF_CHANNEL_TOLERANCE, g, b]);
		const result = diffRasters(raster(base), raster(nudged));

		assert.equal(result.changedPixels, 0, 'a channel step at the tolerance must not count');
	});

	it('counts every pixel that crosses the tolerance', () => {
		const base = Array.from({ length: WIDTH * HEIGHT }, () => [40, 40, 40]);
		const moved = base.map((pixel, index) => (index === 5 ? [200, 40, 40] : pixel));
		const result = diffRasters(raster(base), raster(moved));

		assert.equal(result.changedPixels, 1);
		assert.equal(result.ratio, 1 / (WIDTH * HEIGHT));
		assert.equal(result.changed[5], 1);
		assert.equal(result.changed[4], 0);
	});

	it('refuses to compare two different sizes instead of comparing a corner', () => {
		assert.throws(
			() => diffRasters(raster([[1, 1, 1]], { width: 1, height: 1 }), raster([[1, 1, 1]])),
			/raster size mismatch/,
		);
	});
});

describe('_viewport-diff — renderOverlay', () => {
	it('paints changed pixels red and dims everything else', () => {
		const base = Array.from({ length: WIDTH * HEIGHT }, () => [200, 200, 200]);
		const moved = base.map((pixel, index) => (index === 2 ? [10, 10, 10] : pixel));
		const result = diffRasters(raster(base), raster(moved));
		const overlay = renderOverlay(raster(moved), result.changed);

		assert.deepEqual(pixelOf({ data: overlay, channels: 4 }, 2), OVERLAY_CHANGED_RGB);

		const unchanged = pixelOf({ data: overlay, channels: 4 }, 0);
		assert.ok(unchanged[0] < 200 && unchanged[0] > 0, 'unchanged pixels are dimmed, not black');
		assert.deepEqual(unchanged, [unchanged[0], unchanged[0], unchanged[0]], 'dimmed to grey');
		assert.equal(overlay[3], 255, 'alpha is opaque so the overlay is legible');
	});
});

describe('_viewport-diff — comparePng', () => {
	it('classifies an unchanged re-capture as stable', async () => {
		const pixels = Array.from({ length: WIDTH * HEIGHT }, (_unused, index) => [
			index * 20,
			255 - index * 5,
			30,
		]);
		const result = await comparePng(await png(pixels), await png(pixels));

		assert.equal(result.changedPixels, 0);
		assert.equal(result.stable, true);
		assert.equal(result.broken, false);
		assert.ok(result.overlayPng.length > 0);
	});

	it('classifies a deliberately broken capture as broken, not stable', async () => {
		const base = Array.from({ length: WIDTH * HEIGHT }, () => [40, 60, 80]);
		// Half the image repainted black — a coarse stand-in for a
		// one-column reflow, which is what the real control injects.
		const moved = base.map((_pixel, index) => (index >= WIDTH ? [0, 0, 0] : [40, 60, 80]));
		const result = await comparePng(await png(base), await png(moved));

		assert.ok(result.ratio >= MIN_BREAKAGE_RATIO, `ratio ${result.ratio} must clear the floor`);
		assert.equal(result.stable, false);
		assert.equal(result.broken, true);
	});

	it('decodes any alpha layout to the same raster shape', async () => {
		const decoded = await decodePng(await png([[1, 2, 3]]));
		assert.equal(decoded.channels, 4);
		assert.deepEqual(pixelOf(decoded, 0), [1, 2, 3]);
	});
});
