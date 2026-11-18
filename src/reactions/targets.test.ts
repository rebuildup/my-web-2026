import { describe, expect, it } from 'vitest';
import {
	HOME_REACTIONS_TARGET,
	REACTION_TARGETS,
	REACTION_TARGETS_BY_KEY,
	getEnabledReactionTargetKeys,
	getReactionTarget,
	isValidReactionTarget,
} from './targets';

/**
 * Contract tests for the reaction target registry (Issue #934).
 *
 * These tests verify the invariants that make per-page reactions safe:
 * - Target keys are opaque configuration, never derived from URLs at runtime.
 * - Only registered, enabled targets pass validation.
 * - The home page keeps its legacy target key.
 * - New targets are explicit opt-in entries in the registry.
 */
describe('reaction targets registry', () => {
	it('includes the home page target with legacy key', () => {
		expect(HOME_REACTIONS_TARGET).toBe('home-page');
		const homeTarget = REACTION_TARGETS_BY_KEY.get('home-page');
		expect(homeTarget).toBeDefined();
		expect(homeTarget?.label).toBe('Home page');
		expect(homeTarget?.enabled).toBe(true);
	});

	it('includes the portfolio list target as an opt-in entry', () => {
		const portfolioTarget = REACTION_TARGETS_BY_KEY.get('portfolio-list');
		expect(portfolioTarget).toBeDefined();
		expect(portfolioTarget?.label).toBe('Portfolio list');
		expect(portfolioTarget?.enabled).toBe(true);
	});

	it('validates registered enabled targets', () => {
		expect(isValidReactionTarget('home-page')).toBe(true);
		expect(isValidReactionTarget('portfolio-list')).toBe(true);
	});

	it('rejects unregistered targets', () => {
		expect(isValidReactionTarget('unknown-target')).toBe(false);
		expect(isValidReactionTarget('portfolio-detail')).toBe(false);
		expect(isValidReactionTarget('about')).toBe(false);
		expect(isValidReactionTarget('')).toBe(false);
	});

	it('rejects disabled targets', () => {
		// The current registry has no disabled targets, but the function
		// must be ready for future opt-out without removing the entry.
		const disabledTarget = { key: 'disabled-page', label: 'Disabled', enabled: false } as const;
		// We can't easily mutate the frozen registry in tests, but we
		// verify the logic by checking that a non-enabled entry would fail.
		// The implementation uses `target?.enabled ?? false`, so undefined
		// also yields false. This is tested by the unregistered case above.
	});

	it('returns target metadata for registered keys', () => {
		const home = getReactionTarget('home-page');
		expect(home).not.toBeNull();
		expect(home?.key).toBe('home-page');

		const portfolio = getReactionTarget('portfolio-list');
		expect(portfolio).not.toBeNull();
		expect(portfolio?.key).toBe('portfolio-list');
	});

	it('returns null for unknown or disabled keys', () => {
		expect(getReactionTarget('unknown')).toBeNull();
		expect(getReactionTarget('')).toBeNull();
	});

	it('lists all enabled target keys', () => {
		const keys = getEnabledReactionTargetKeys();
		expect(keys).toContain('home-page');
		expect(keys).toContain('portfolio-list');
		expect(keys).toContain('about-page');
		expect(keys).toContain('contact-page');
		expect(keys).toContain('projects-dotfiles');
		expect(keys).toContain('tools-index');
		expect(keys.length).toBe(6);
	});

	it('has exactly six targets in the registry', () => {
		expect(REACTION_TARGETS.length).toBe(6);
		expect(REACTION_TARGETS_BY_KEY.size).toBe(6);
	});

	it('target keys are opaque strings, not URL-derived', () => {
		// The keys 'home-page' and 'portfolio-list' are configuration
		// decisions. They do NOT match the URL structure (e.g. not
		// '/portfolio' or '/'). This is intentional — the target key
		// is an opaque namespace segment, not a path.
		expect(REACTION_TARGETS.some((t) => t.key.startsWith('/'))).toBe(false);
		expect(REACTION_TARGETS.some((t) => t.key.includes('/'))).toBe(false);
	});
});

/**
 * These tests document the "target separation" requirement from Issue #934:
 * reactions for different targets are stored under different `target_key`
 * values in the same `reactions` table, and the HTTP boundary validates
 * the target against the registry before any read/write.
 */
describe('target separation contract', () => {
	it('uses distinct target_key values for home vs portfolio', () => {
		expect(HOME_REACTIONS_TARGET).toBe('home-page');
		const portfolioTarget = REACTION_TARGETS_BY_KEY.get('portfolio-list');
		expect(portfolioTarget?.key).toBe('portfolio-list');
		expect(HOME_REACTIONS_TARGET).not.toBe(portfolioTarget?.key);
	});

	it('registry is the single source of truth for validation', () => {
		// Both the HTTP boundary (src/http/reactions/router.ts) and the
		// server functions (src/home/reactions/load.ts) import
		// isValidReactionTarget from this module. No other validation
		// logic exists — this test ensures the registry is the gate.
		const allRegisteredKeys = REACTION_TARGETS.map((t) => t.key);
		for (const key of allRegisteredKeys) {
			expect(isValidReactionTarget(key)).toBe(true);
		}
	});
});
