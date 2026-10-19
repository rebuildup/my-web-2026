import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	FALLBACK_CARD,
	fallbackCardSvg,
	renderFallbackCard,
} from './generate-og-fallback-card.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CONTRACT = JSON.parse(
	readFileSync(join(ROOT, 'src/editorial/social-card/contract.json'), 'utf8'),
);

/**
 * The committed card is only auditable if it is reproducible, so this
 * file asserts the three properties that make it so: deterministic
 * bytes, geometry only (no host font), and a shape that matches the
 * contract every head publishes.
 */
describe('og fallback card generator', () => {
	it('agrees with the contract the heads publish', () => {
		assert.equal(FALLBACK_CARD.path, CONTRACT.fallbackCard.path);
		assert.equal(FALLBACK_CARD.width, CONTRACT.fallbackCard.width);
		assert.equal(FALLBACK_CARD.height, CONTRACT.fallbackCard.height);
	});

	it('declares a large-image ratio, so summary_large_image is not a lie', () => {
		assert.ok(FALLBACK_CARD.width / FALLBACK_CARD.height > 1.5);
	});

	it('draws no text, so the bytes never depend on a host font', () => {
		const svg = fallbackCardSvg(FALLBACK_CARD);
		assert.ok(!svg.includes('<text'), 'no <text> element');
		assert.ok(!svg.includes('font-family'), 'no font dependency');
	});

	it('uses only the shipped palette', () => {
		const svg = fallbackCardSvg(FALLBACK_CARD);
		for (const color of Object.values(FALLBACK_CARD.colors)) {
			assert.ok(svg.includes(color), `${color} unused`);
		}
		const hexes = svg.match(/#[0-9a-f]{6}/gi) ?? [];
		for (const hex of hexes) {
			assert.ok(
				Object.values(FALLBACK_CARD.colors).includes(hex.toLowerCase()),
				`unexpected colour ${hex}`,
			);
		}
	});

	it('renders deterministically at the declared size', async () => {
		const first = await renderFallbackCard();
		const second = await renderFallbackCard();
		assert.ok(first.equals(second), 'two renders are byte-identical');
		const meta = await sharpMeta(first);
		assert.equal(meta.width, FALLBACK_CARD.width);
		assert.equal(meta.height, FALLBACK_CARD.height);
		assert.equal(meta.format, 'png');
	});

	it('is committed at the declared path and matches a fresh render', async () => {
		const committed = readFileSync(join(ROOT, 'public', FALLBACK_CARD.path));
		assert.ok(
			committed.equals(await renderFallbackCard()),
			'public/og/default-card.png drifted from the generator — run `pnpm run generate:og-fallback-card`',
		);
	});
});

/** Minimal PNG header read, so the test does not need sharp itself. */
function sharpMeta(buffer) {
	assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', 'PNG signature');
	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20),
		format: 'png',
	};
}
