/**
 * Which declared quality-gate components may run concurrently
 * (Issue #1007).
 *
 * Why an allowlist, not a heuristic
 * ---------------------------------
 * `scripts/run-quality-gates.mjs` used to run every component of
 * `quality/profile.yaml#gates.<name>.components` strictly serially.
 * Most components are read-only `node scripts/check-*.mjs` /
 * `biome` / `tsc --noEmit` invocations with no shared state, but
 * "most" is not a contract: a gate that regenerates a file, waits on
 * a build artefact or assumes exclusive repository access must keep
 * its serial position. The profile format has no per-component
 * metadata (one list entry is exactly one command — see
 * `scripts/_quality-gate-plan.mjs`), so safety is decided HERE, in
 * one auditable set, and everything not named stays serial.
 *
 * The membership rule
 * -------------------
 * A component is parallel-safe only when it is EXACTLY
 * `pnpm run <script>` (no trailing arguments — an argument such as
 * `-- --report out.html` can turn a read-only check into a writer)
 * AND `<script>` is in `PARALLEL_SAFE_SCRIPTS`. Every member was
 * audited for the fast plan: the underlying command is a pure-local
 * read of tracked files (or `git`/`biome`/`tsc` read-only modes), and
 * every `writeFileSync`/`mkdirSync` inside those scripts sits behind
 * an explicit `--update` / `--report` / `--json` flag the gate
 * invocation never passes. `pnpm run test` is a member: its vitest
 * pool binds no fixed port and `scripts/run-script-tests.mjs` already
 * isolates every script test behind a private TMPDIR, so it tolerates
 * neighbouring gates the same way it tolerates its own 8 workers.
 *
 * A NEW fast gate is therefore serial until a reviewer adds its
 * script name here — the failure mode is "one step slower", never
 * "two gates racing on shared state". The companion test in
 * `scripts/_quality-gate-plan.test.mjs` pins the current fast plan so
 * the allowlist cannot silently drift from the declaration.
 */

/**
 * npm script names whose bare `pnpm run <script>` component is
 * parallel-safe. One entry per audited `gates.fast.components`
 * `pnpm run` line, in profile order.
 */
export const PARALLEL_SAFE_SCRIPTS = new Set([
	'format:check',
	'lint:check',
	'architecture:check',
	'log:redaction:check',
	'docs:contamination:check',
	'structured-data:check',
	'projects:check',
	'current:facts:check',
	'keyboard:check',
	'ogp:card:check',
	'index:boundary:check',
	'tools:check',
	'install:scripts:check',
	'wrangler:independence:check',
	'cloudflare:contract:check',
	'cf:config:drift:check',
	'test:wiring:check',
	'release:assets:check',
	'version:check',
	'typecheck',
	'infisical:check:coverage',
	'secrets:status:check',
	'sbom:check',
	'csrf:contract:check',
	'compat:check',
	'tools:provenance:check',
	'storybook:ownership:check',
	'copy:i18n:check',
	'copy:stale:check',
	'copy:internal-ids:check',
	'publication:check',
	'portfolio:ledger:check',
	'sitemap:ledger:check',
	'content:links:check',
	'publication:redaction:check',
	'routes:quality:check',
	'security:headers:check',
	'security:disclosure:check',
	'asvs:check',
	'html:standards:check',
	'i18n:policy:check',
	'test',
	'seo:status:check',
	'ci:pins:check',
	'knip:check',
	'secret:scan',
	'a11y:reduced-motion:check',
	'a11y:icon-button-names:check',
	'a11y:table:code:check',
	'a11y:image-alt:check',
	'a11y:reflow:check',
	'a11y:language-of-parts:check',
	'a11y:heading-landmarks:check',
	'a11y:wcag-review-matrix:check',
	'css:check',
	'a11y:contrast:check',
	'a11y:target-size:check',
	'a11y:dialog-focus:check',
	'a11y:screenreader-steps:check',
	'a11y:live-region:check',
	'a11y:focus-visible:check',
	'a11y:axe-storybook:check',
	'a11y:video-caption:check',
	'app:icons:check',
	'threat:model:check',
	'release:gate:check',
	'integration:scope:check',
	'tools:artifact:check',
	'assets:license:check',
	'issue:closure:check',
]);

/** `pnpm run <script>` with NO trailing arguments — the only shape the allowlist covers. */
const BARE_PNPM_RUN = /^pnpm run ([A-Za-z0-9:._-]+)$/;

/**
 * The npm script a component invokes, or null when the component is
 * not a bare `pnpm run <script>` invocation.
 */
export function pnpmRunScriptOf(component) {
	const match = BARE_PNPM_RUN.exec(component);
	return match ? match[1] : null;
}

/**
 * Whether one resolved plan component may share the runner with its
 * neighbours. See the module comment for the membership rule.
 */
export function isParallelSafeComponent(component) {
	const script = pnpmRunScriptOf(component);
	return script !== null && PARALLEL_SAFE_SCRIPTS.has(script);
}

/**
 * Group a resolved plan into ordered segments.
 *
 * Returns `[{ parallel, items }]` where `items` are
 * `{ index, command }` pairs carrying the plan-global 0-based index
 * (the runner prints `[index + 1 / plan.length]`, exactly like the
 * serial path). Consecutive parallel-safe components form one
 * `parallel: true` segment; every other component is a
 * `parallel: false` segment of exactly one item, so a build step or
 * an un-audited gate keeps its serial slot and its live output.
 */
export function segmentPlan(plan) {
	const segments = [];
	for (const [index, command] of plan.entries()) {
		if (isParallelSafeComponent(command)) {
			const last = segments.at(-1);
			if (last?.parallel) {
				last.items.push({ index, command });
			} else {
				segments.push({ parallel: true, items: [{ index, command }] });
			}
		} else {
			segments.push({ parallel: false, items: [{ index, command }] });
		}
	}
	return segments;
}
