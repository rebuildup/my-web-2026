import { describe, expect, it } from 'vitest';
import baselineJson from '../../quality/public-internal-identifier-baseline.json';
import triageJson from '../../quality/public-internal-identifier-triage.json';

/**
 * Bijection between the detector baseline and its per-finding
 * classification (Issue #994).
 *
 * `quality/public-internal-identifier-baseline.json` lists every
 * pending-review finding the copy gate tolerates. A baseline entry
 * without a classification is an unexplained exception; a
 * classification without a baseline entry is stale. This test makes
 * both impossible: every baseline finding must have exactly one
 * triage record, and every triage record must name a live finding.
 */

interface Finding {
	readonly file: string;
	readonly rule: string;
	readonly match: string;
}

interface TriageEntry extends Finding {
	readonly classification: string;
	readonly rationale: string;
}

const CLASSES = new Set([
	'non-rendered-field',
	'operator-metadata',
	'internal-error',
	'detector-artifact',
	'intentional-public',
	'fixed',
]);

function key(f: Finding): string {
	return `${f.file}${f.rule}${f.match}`;
}

describe('public-internal-identifier triage ledger', () => {
	const baseline = baselineJson as { findings: Finding[] };
	const triage = triageJson as { classifications: TriageEntry[] };

	it('has exactly one classification per baseline finding and vice versa', () => {
		const baselineKeys = baseline.findings.map(key).sort();
		const triageKeys = triage.classifications.map(key).sort();
		expect(triageKeys).toEqual(baselineKeys);
	});

	it('classifies every finding into a known class with a rationale', () => {
		for (const entry of triage.classifications) {
			expect(CLASSES.has(entry.classification), `${key(entry)}: unknown class`).toBe(true);
			expect(entry.rationale.length, `${key(entry)}: empty rationale`).toBeGreaterThan(0);
		}
	});

	it('keeps intentional-public entries explicit and few', () => {
		const intentional = triage.classifications.filter(
			(entry) => entry.classification === 'intentional-public',
		);
		// These are the only findings allowed to reach a visitor as
		// authored technical explanation; every addition needs owner
		// review, so the set must stay small and file-scoped.
		expect(intentional.every((entry) => entry.file === 'src/portfolio/seed.ts')).toBe(true);
		expect(intentional.length).toBeLessThanOrEqual(10);
	});
});
