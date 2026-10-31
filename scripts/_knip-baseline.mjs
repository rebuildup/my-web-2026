/**
 * The knip baseline contract (Issue #733, V-6).
 *
 * `quality/knip-baseline.json` is **recorded debt**: the unused-code
 * findings the repository has accepted for now, tracked for a separate
 * cleanup ticket. The diff gate (`scripts/check-knip.mjs`) already
 * refused *new* findings, but nothing stopped the recorded debt from
 * growing: `pnpm run knip:update` rewrote the baseline, the PR diff
 * showed the growth, and a reviewer who did not count the lines had no
 * signal that the number moved.
 *
 * This module owns the two questions the CLI asks about that file:
 *
 * 1. **Is this baseline allowed to exist?** — a baseline without a
 *    ceiling is unbounded debt, and a ceiling nobody can explain is not
 *    a decision anybody made.
 * 2. **May an update grow the debt?** — no. `--update` may shrink the
 *    record; growing it is a hand-edited change to the file, with a new
 *    stated reason, that a reviewer reads in the diff.
 *
 * The logic lives here, apart from the CLI, so it can be tested without
 * rewriting the repository's own baseline.
 */

/** The schema version this module writes. */
export const BASELINE_SCHEMA = 2;

/**
 * The rationale a baseline written from scratch carries.
 *
 * It is never generated from the findings themselves: a number that
 * explains itself is not a decision anybody made.
 */
export const DEFAULT_CEILING_RATIONALE =
	'Created by `pnpm run knip:update`: the recorded unused-code debt at the moment this baseline was written. Raising the ceiling is a hand-edited change with a stated reason (Issue #733).';

/**
 * Why a baseline is not allowed to exist as it stands.
 *
 * @param {{ceiling?: unknown, ceiling_rationale?: unknown, findings?: unknown}} baseline
 * @returns {string[]} one message per violation; empty when the baseline is sound.
 */
export function baselineViolations(baseline) {
	const violations = [];
	if (!Number.isInteger(baseline?.ceiling) || baseline.ceiling < 0) {
		violations.push(
			'the knip baseline records no usable `ceiling`. The recorded debt needs a maximum, and the reason for it (Issue #733).',
		);
	}
	if (typeof baseline?.ceiling_rationale !== 'string' || baseline.ceiling_rationale.trim() === '') {
		violations.push(
			'the knip baseline records no `ceiling_rationale`. A ceiling nobody can explain is not a decision (Issue #733).',
		);
	}
	const findings = Array.isArray(baseline?.findings) ? baseline.findings : [];
	if (Number.isInteger(baseline?.ceiling) && findings.length > baseline.ceiling) {
		violations.push(
			`the knip baseline records ${findings.length} findings, which is more than its ceiling of ${baseline.ceiling}. Fix the findings or raise the ceiling by hand with a stated reason.`,
		);
	}
	return violations;
}

/**
 * What an update may write.
 *
 * The ceiling is read, never raised: an update may shrink the recorded
 * debt, but the recorded debt may not grow past the ceiling that was
 * decided for it. A baseline that predates the ceiling rule is
 * migrated by taking today's count as its ceiling — the migration is
 * visible in the diff, and the next growth is refused.
 *
 * @param {object | null} previous the baseline as it stands now, or null.
 * @param {string[]} findings the findings the current run reports.
 * @returns {{allowed: true, ceiling: number, rationale: string} | {allowed: false, ceiling: number, reason: string}}
 */
export function planBaselineUpdate(previous, findings) {
	const ceiling = Number.isInteger(previous?.ceiling) ? previous.ceiling : findings.length;
	if (findings.length > ceiling) {
		return {
			allowed: false,
			ceiling,
			reason: `knip reports ${findings.length} findings, which is more than the recorded ceiling of ${ceiling}. Fix the new findings, or raise the ceiling in \`quality/knip-baseline.json\` by hand with a stated reason — \`knip:update\` will not grow the recorded debt for you.`,
		};
	}
	const rationale =
		typeof previous?.ceiling_rationale === 'string' && previous.ceiling_rationale.trim() !== ''
			? previous.ceiling_rationale
			: DEFAULT_CEILING_RATIONALE;
	return { allowed: true, ceiling, rationale };
}

/**
 * The baseline document an update writes.
 *
 * @param {{ceiling: number, ceiling_rationale: string, findings: string[]}} plan
 * @returns {object} the JSON-ready baseline.
 */
export function baselineDocument(plan) {
	return {
		_schema: BASELINE_SCHEMA,
		// Regenerate with `pnpm run knip:update`. Do not hand-edit to
		// silence findings: remove the underlying cause instead (Issue #531).
		updated_with: 'scripts/check-knip.mjs --update',
		// Issue #733 (V-6): the ceiling is the maximum number of baselined
		// findings the repository tolerates. It is written by hand, with its
		// reason, and `--update` never raises it.
		ceiling: plan.ceiling,
		ceiling_rationale: plan.rationale,
		findings: plan.findings,
	};
}
