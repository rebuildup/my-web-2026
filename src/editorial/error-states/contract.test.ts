import { describe, expect, it } from 'vitest';
import {
	DEPENDENCY_FREE_SURFACES,
	ERROR_STATE_DEFINITIONS,
	ERROR_STATE_EXTERNAL_COMMUNICATIONS,
	ERROR_STATE_KINDS,
	ERROR_STATE_PUBLICATION_EXCEPTIONS,
	ERROR_STATE_PUBLISHED_INFO,
	ERROR_STATE_WITHHELD_INFO,
	PUBLIC_SURFACE_DEPENDENCIES,
	PUBLIC_SURFACE_LABELS,
	alternativesFor,
	errorStateDefinition,
	withheldDetailNeedles,
} from './contract';

/**
 * Contract invariants for the failure surfaces (Issue #501).
 *
 * These are pure assertions about the PUBLISHED contract — no rendering.
 * The rendered half lives in `error-states.test.tsx`; the end-to-end SSR
 * half lives in `test/integration/error-states.test.ts`.
 */

const CANONICAL_ROSTER = Object.keys(PUBLIC_SURFACE_DEPENDENCIES);
const ACTION_VOCABULARY = ['back', 'retry', 'alternative'] as const;

describe('error-state contract', () => {
	it('defines every kind in the closed set, and nothing else', () => {
		expect(Object.keys(ERROR_STATE_DEFINITIONS).sort()).toEqual([...ERROR_STATE_KINDS].sort());
	});

	it.each(ERROR_STATE_KINDS)('kind "%s" publishes a complete bilingual surface', (kind) => {
		const definition = errorStateDefinition(kind);
		expect(definition.kind).toBe(kind);
		expect(definition.status).toBeGreaterThanOrEqual(400);
		expect(definition.statusLabel.length).toBeGreaterThan(0);
		// Japanese first, ' / ', English — the editorial bilingual voice.
		for (const copy of [definition.headline, definition.condition, definition.description]) {
			expect(copy).toContain(' / ');
			expect(copy.length).toBeGreaterThan(10);
		}
		expect(definition.recovery.length).toBeGreaterThan(0);
	});

	it.each(ERROR_STATE_KINDS)('kind "%s" never names a platform binding in public copy', (kind) => {
		const definition = errorStateDefinition(kind);
		// The public surface cannot know WHICH dependency failed, so the
		// copy must not claim one. `D1` / `R2` appearing in visitor-facing
		// text would be a guess.
		const publicCopy = [
			definition.statusLabel,
			definition.eyebrow,
			definition.headline,
			definition.condition,
			definition.description,
			definition.alternativesNote ?? '',
		].join('\n');
		expect(publicCopy).not.toMatch(/D1|R2|binding/i);
	});

	it.each(ERROR_STATE_KINDS)('kind "%s" offers only recovery affordances it can honour', (kind) => {
		const recovery = errorStateDefinition(kind).recovery;
		for (const action of recovery) {
			expect(ACTION_VOCABULARY).toContain(action);
		}
		expect(new Set(recovery).size).toBe(recovery.length);
		// The alternative list is rendered from the recovery order; a state
		// that does not declare `alternative` must not render one.
		expect(recovery).toContain('alternative');
	});

	it('a 404 offers no retry: re-requesting a resolved-missing URL cannot succeed', () => {
		expect(errorStateDefinition('not_found').recovery).toEqual(['back', 'alternative']);
		expect(errorStateDefinition('not_found').recovery).not.toContain('retry');
	});

	it.each(['service_unavailable', 'dependency_failure'] as const)(
		'kind "%s" offers retry as the primary affordance',
		(kind) => {
			expect(errorStateDefinition(kind).recovery[0]).toBe('retry');
		},
	);

	it.each(ERROR_STATE_KINDS)('kind "%s" only offers surfaces that exist', (kind) => {
		const alternatives = alternativesFor(kind);
		expect(alternatives.length).toBeGreaterThan(0);
		for (const alternative of alternatives) {
			expect(CANONICAL_ROSTER).toContain(alternative.href);
			// Same roster `PublicNav` publishes — see PublicNav.tsx#PUBLIC_NAV_ITEMS.
			expect(alternative.label).toBe(PUBLIC_SURFACE_LABELS[alternative.href]);
			expect(alternative.label).toContain(' / ');
			// Internal navigation only. An absolute URL on a failure surface
			// would send the visitor off-origin for no reason.
			expect(alternative.href.startsWith('/')).toBe(true);
			expect(alternative.href).not.toMatch(/^[a-z]+:/i);
		}
	});

	it('the 404 alternative list is the whole canonical roster', () => {
		expect(alternativesFor('not_found').map((link) => link.href)).toEqual(CANONICAL_ROSTER);
	});

	it.each(['service_unavailable', 'dependency_failure'] as const)(
		'kind "%s" only offers surfaces that read no platform binding',
		(kind) => {
			const hrefs = alternativesFor(kind).map((link) => link.href);
			expect(hrefs).toEqual([...DEPENDENCY_FREE_SURFACES]);
			for (const href of hrefs) {
				expect(PUBLIC_SURFACE_DEPENDENCIES[href]).toEqual([]);
			}
			// The note is what makes that list an honest promise rather than
			// decoration, so it must be present on both failure states.
			expect(errorStateDefinition(kind).alternativesNote).toBeTruthy();
		},
	);

	it('the dependency table is never empty for the whole roster', () => {
		// Guards the derivation itself: if every surface were marked
		// dependency-free, the failure states would promise surfaces that
		// fail with the outage.
		expect(DEPENDENCY_FREE_SURFACES.length).toBeGreaterThan(0);
		expect(DEPENDENCY_FREE_SURFACES.length).toBeLessThan(CANONICAL_ROSTER.length);
	});
});

describe('published / withheld disclosure', () => {
	it('records what is published and what is withheld', () => {
		expect(ERROR_STATE_PUBLISHED_INFO.length).toBeGreaterThan(0);
		expect(ERROR_STATE_WITHHELD_INFO.length).toBeGreaterThan(0);
		for (const entry of ERROR_STATE_WITHHELD_INFO) {
			// Every withheld class names a concrete thing, not a principle.
			expect(entry.length).toBeGreaterThan(20);
		}
	});

	it('records the measured publication exception instead of hiding it', () => {
		// The SSR hydration payload carries the failed match's message. That is
		// a fact about the response, so the contract states it and a test pins
		// it — see `test/integration/error-states.test.ts`.
		expect(ERROR_STATE_PUBLICATION_EXCEPTIONS.length).toBeGreaterThan(0);
		expect(ERROR_STATE_PUBLICATION_EXCEPTIONS.join(' ')).toContain('$_TSR');
		expect(ERROR_STATE_PUBLICATION_EXCEPTIONS.join(' ')).toContain('ShallowErrorPlugin');
	});

	it('records every outbound party an error-state document can still reach', () => {
		const parties = ERROR_STATE_EXTERNAL_COMMUNICATIONS.map((row) => row.party);
		expect(parties).toContain('Google Fonts');
		expect(parties).toContain('Google Analytics 4');
		expect(parties).toContain('third-party API');
		for (const row of ERROR_STATE_EXTERNAL_COMMUNICATIONS) {
			// The failure message must be readable with every third party
			// blocked — that is the point of the async font loading.
			expect(row.requiredForMessage).toBe(false);
			expect(row.evidence.length).toBeGreaterThan(0);
		}
		// No server-side outbound integration is promoted, so the only
		// server-side row is the explicit "none".
		const serverRows = ERROR_STATE_EXTERNAL_COMMUNICATIONS.filter(
			(row) => row.initiatedBy === 'server',
		);
		expect(serverRows).toHaveLength(0);
	});
});

describe('withheldDetailNeedles', () => {
	it('turns a throwable into probe strings that must not be rendered', () => {
		const error = new Error('D1_ERROR: SELECT * FROM counter failed');
		error.stack = 'Error: D1_ERROR\n    at load (src/home/access/load.ts:12:3)';
		(error as { cause?: unknown }).cause = new Error('SQLITE_CONSTRAINT: UNIQUE failed');

		const needles = withheldDetailNeedles(error);
		expect(needles).toContain('D1_ERROR: SELECT * FROM counter failed');
		expect(needles).toContain('SQLITE_CONSTRAINT: UNIQUE failed');
		// The stack itself, plus the generic frame marker any stack starts with.
		expect(needles).toContain('Error: D1_ERROR\n    at load (src/home/access/load.ts:12:3)');
		expect(needles).toContain('\n    at ');
	});

	it('still probes the generic leak markers when no throwable is in scope', () => {
		expect(withheldDetailNeedles()).toContain('Error:');
		expect(withheldDetailNeedles()).toContain('SELECT ');
		expect(withheldDetailNeedles()).toContain('\n    at ');
	});
});
