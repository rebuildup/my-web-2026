/**
 * Attacker-shaped probe data for the R2 visibility suite (Issue #459).
 *
 * This lives under `test/` and not in `src/cloudflare/media-visibility.ts`
 * on purpose: the sequential sweep is what an *attacker* would run
 * against a public R2 custom domain, so shipping it inside the
 * production module would put probe data next to policy (AGENTS.md §3
 * — a shipped module carries the contract, not the attacker's script).
 * The policy module exposes the gate; the probe asks it a question.
 *
 * Consumed by `test/integration/r2-media-visibility.test.ts`. The unit
 * test next to the module (`src/cloudflare/media-visibility.test.ts`)
 * writes its sweep out inline instead: a test file under
 * `src/cloudflare/` cannot import from `test/` under the workerd pool
 * (the specifier is left unresolved inside the worker).
 */

/**
 * The sequential-key sweep an attacker would run against a public
 * custom domain, expressed as data so the unit test, the integration
 * test and the verification report share one definition. It probes
 * `portfolio/<slug>/cover-<n>.webp` for a range of `n` — the layout
 * real media uses, so an unpublished object stored next to a published
 * one would be found here if the boundary did not hold.
 */
export function sequentialGuessKeys(slug: string, count: number): string[] {
	const keys: string[] = [];
	for (let n = 1; n <= count; n += 1) {
		keys.push(`portfolio/${slug}/cover-${n}.webp`);
	}
	return keys;
}
