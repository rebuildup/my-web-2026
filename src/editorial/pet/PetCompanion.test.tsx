import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PetCompanion } from './PetCompanion';

/**
 * The companion is loaded after hydration (Issue #274).
 *
 * The bundle budget (`quality/bundle-budget.json`) charges everything a
 * route imports STATICALLY to first paint. That budget is the only place
 * the platform decides what an ornament may cost, so this wrapper — not
 * the sprite — is what a page imports, and the sprite arrives as a
 * dynamic chunk.
 *
 * What static markup can prove: the server document carries nothing at
 * all. That is the "decoration is not first paint" half of the contract.
 * The other half — that the chunk loads and the sprite then renders — is
 * a browser question and is recorded in
 * `docs/verification/visual/pet-companion/overlay-verification.md`.
 */
describe('PetCompanion (Issue #274)', () => {
	it('renders nothing in the server document', () => {
		expect(renderToStaticMarkup(<PetCompanion />)).toBe('');
	});

	it('does not reference a sprite asset before the chunk loads', () => {
		expect(renderToStaticMarkup(<PetCompanion />)).not.toContain('/pets/melty/');
	});
});
