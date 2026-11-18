import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	declaredPortfolioSlugs,
	evaluatePortfolioLedger,
} from './check-portfolio-ledger.mjs';

describe('check-portfolio-ledger (Issue #834)', () => {
	it('passes when declared and producible slug sets agree', () => {
		assert.deepEqual(
			evaluatePortfolioLedger({ declared: ['a', 'b'], producible: ['a', 'b'] }),
			[],
		);
	});

	it('negative control: a declared slug the canonical set cannot produce fails', () => {
		const violations = evaluatePortfolioLedger({
			declared: ['a', 'ghost'],
			producible: ['a'],
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /\/portfolio\/ghost.*not producible/);
	});

	it('negative control: a producible slug missing from the ledger fails', () => {
		const violations = evaluatePortfolioLedger({
			declared: ['a'],
			producible: ['a', 'b'],
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /\/portfolio\/b.*missing/);
	});

	it('extracts only top-level /portfolio/<slug> URLs from the surface snapshot', () => {
		const surface = {
			surface: {
				publicUrls: [
					'/portfolio',
					'/portfolio/alpha',
					'/portfolio/alpha/extra',
					'/portfolio/beta',
					'/tools/x',
				],
			},
		};
		assert.deepEqual(declaredPortfolioSlugs(surface), ['alpha', 'beta']);
	});

	it('returns null when the surface snapshot lacks publicUrls', () => {
		assert.equal(declaredPortfolioSlugs({}), null);
		assert.equal(declaredPortfolioSlugs({ surface: {} }), null);
	});
});
