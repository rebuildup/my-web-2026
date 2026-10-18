import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FIXTURES, fixtureSvg, render } from './generate-image-fixtures.mjs';

/**
 * The raster fixtures behind the Issue #486 CLS measurement.
 *
 * Two properties are load-bearing, and neither is visible in a diff:
 *
 *   1. **The committed bytes are derived, not hand-edited.** A fixture
 *      PNG that nobody can regenerate is a fixture nobody can trust
 *      when the browser changes; `--check` exists for a human, this
 *      test makes it a build-time assertion.
 *   2. **The declared dimensions are the real dimensions.** The E2E
 *      spec asserts the browser reserves `1600×900` / `1280×720`
 *      because `src/routes/design-system/sections/ImageCls.tsx`
 *      declares those numbers as the media row's intrinsic size. A
 *      raster that quietly renders at a different size would make the
 *      gate assert a reservation the page never asked for.
 *
 * `sharp` is a devDependency and is used here exactly as
 * `scripts/generate-image-fixtures.mjs` uses it — the Worker and the
 * SSR runtime never load it.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('generate-image-fixtures — declared dimensions', () => {
	it('renders each fixture at exactly the size the table declares', async () => {
		for (const fixture of FIXTURES) {
			const buffer = await render(fixture);
			const metadata = await sharp(buffer).metadata();
			assert.equal(metadata.format, 'png', `${fixture.file} must be a PNG`);
			assert.equal(metadata.width, fixture.width, `${fixture.file} width`);
			assert.equal(metadata.height, fixture.height, `${fixture.file} height`);
		}
	});

	it('emits an SVG whose width/height match the table', () => {
		for (const fixture of FIXTURES) {
			const svg = fixtureSvg(fixture);
			assert.match(svg, new RegExp(`width="${fixture.width}"`));
			assert.match(svg, new RegExp(`height="${fixture.height}"`));
			assert.match(svg, new RegExp(`viewBox="0 0 ${fixture.width} ${fixture.height}"`));
		}
	});
});

describe('generate-image-fixtures — committed bytes are not drifted', () => {
	it('matches public/fixtures/*.png byte for byte', async () => {
		for (const fixture of FIXTURES) {
			const committed = readFileSync(join(REPO_ROOT, 'public', 'fixtures', fixture.file));
			const generated = await render(fixture);
			const driftHint = 'run `node scripts/generate-image-fixtures.mjs` and commit the result';
			assert.ok(
				committed.equals(generated),
				`public/fixtures/${fixture.file} differs from the generator output — ${driftHint}`,
			);
		}
	});

	it('is deterministic — the same input renders the same bytes twice', async () => {
		const [first, second] = await Promise.all([render(FIXTURES[0]), render(FIXTURES[0])]);
		assert.ok(first.equals(second));
	});
});
