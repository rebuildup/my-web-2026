/**
 * Audited public routes for the axe-core scan (Issue #393).
 *
 * Why this file exists
 * --------------------
 * The static gates (#396 / #397 / #398 / #399) read the SOURCE. This
 * manifest reads the RENDERED page: `e2e/a11y/axe-public-routes.spec.ts`
 * opens every route listed here in a real browser and asks axe-core
 * whether the document that a visitor actually receives violates
 * WCAG 2.2 A / AA.
 *
 * The list is written out BY HAND on purpose. It is the record of
 * "which surfaces were audited", so it must not be derived at run
 * time from another roster (`e2e/nav-roster.ts` mirrors the primary
 * navigation, which is a different question: what the nav links to
 * is not the same as what was measured). A generated list would make
 * the audit trail unfalsifiable — adding a page to the nav would
 * silently add it to the audit, and removing one would silently drop
 * a measurement nobody noticed was gone.
 *
 * Each entry declares
 *   - `path`      — the URL the browser opens;
 *   - `title`     — the document title the route must publish (a
 *                    minimal content contract, so the scan cannot
 *                    silently measure an error page instead of the
 *                    route);
 *   - `expect`    — the verdict the manifest claims for this route
 *                    (`pass` = no violation at all, `baseline` = every
 *                    observed violation is recorded in
 *                    `e2e/a11y/axe-baseline.json`). The spec compares
 *                    the declaration with the measurement and goes red
 *                    when they disagree, so the manifest cannot drift
 *                    away from reality without failing the gate.
 *
 * The manifest CANNOT declare that a route is allowed to fail.
 * ------------------------------------------------------------
 * `AxeVerdict` has no `fail` member, and the spec refuses a
 * declaration outside `{pass, baseline}` at run time as well. If the
 * manifest could say "this route is expected to fail", then editing
 * one word here would turn a newly-introduced violation into a green
 * run — the gate's central promise ("a violation that is not recorded
 * fails the release candidate") would be one edit away from void.
 *
 * The place where a known violation is ALLOWED to exist is the
 * ledger, `e2e/a11y/axe-baseline.json`: one record per route × rule,
 * with the reason it is tolerated. That is a separate, explicit
 * artefact with its own diff, so allowing a violation is a visible
 * decision rather than a word in a declaration.
 *
 * A route that is NOT listed here is not measured. That is only
 * acceptable when the omission has a reason, so the skipped routes
 * are listed with their reasons in {@link SKIPPED_ROUTES} rather
 * than being silently absent.
 */

/**
 * The axe-core rule tags this scan runs.
 *
 * WCAG 2.2 A / AA. axe-core 4.14.0 ships a `wcag22aa` tag, so all
 * five are accepted by `axe.run` (verified against the installed
 * version — an unknown tag makes axe throw instead of scanning).
 * `best-practice` is deliberately NOT included: those rules are not
 * WCAG success criteria, and a gate that fails on them would report
 * a house style as a conformance defect.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/**
 * The verdict a route may declare in the manifest.
 *
 * There is deliberately no `fail` member: the manifest may not say
 * "this route is allowed to fail". A route whose violations are
 * tolerated declares `baseline`, and the tolerance itself lives in
 * the ledger (`e2e/a11y/axe-baseline.json`) with a reason — not in a
 * declaration that a one-word edit could turn into a permission slip.
 */
export type AxeVerdict = 'pass' | 'baseline';

/** One audited route. */
export interface AuditedRoute {
	/** The URL the browser opens, relative to the preview origin. */
	readonly path: string;
	/** The document title the route must publish. */
	readonly title: string;
	/** The verdict this route is expected to produce. */
	readonly expect: AxeVerdict;
	/** What this route is, in one line — the audit record's prose. */
	readonly note: string;
}

/**
 * The audited routes.
 *
 * Order is editorial (the order a reader meets the pages), not
 * alphabetical.
 */
export const AUDITED_ROUTES: readonly AuditedRoute[] = [
	{
		path: '/',
		title: 'my-web-2026 — rebuildup.dev',
		expect: 'pass',
		note: 'Home — the entry surface every visitor meets first.',
	},
	{
		path: '/about',
		title: '木村友亮 / Yusuke Kimura — About',
		expect: 'pass',
		note: 'About — the approved person identity rendered as a document.',
	},
	{
		path: '/keyboard',
		title: 'キーボード配列 — 大西配列と Kanata',
		expect: 'pass',
		note: 'Keyboard — the read-only layout reference (Issue #620).',
	},
	{
		path: '/contact',
		title: 'Contact — rebuildup.dev',
		expect: 'pass',
		note: 'Contact — the form surface a visitor writes into.',
	},
	{
		path: '/portfolio',
		title: 'Portfolio — rebuildup.dev',
		expect: 'pass',
		note: 'Portfolio list — the published project index.',
	},
	{
		path: '/portfolio/my-web-2026',
		title: 'my-web-2026 — Personal Web Platform on Cloudflare Workers — Portfolio',
		expect: 'pass',
		note: 'Portfolio detail — the seeded sample slug of /portfolio/$slug.',
	},
	{
		path: '/projects/dotfiles',
		title: 'dotfiles — rebuildup.dev',
		expect: 'pass',
		note: 'Project introduction — the committed snapshot surface (Issue #621).',
	},
	{
		path: '/tools',
		title: 'Tools — my-web-2026',
		expect: 'pass',
		note: 'Tool index — the host shell of the Tool surfaces.',
	},
	{
		path: '/design-system',
		title: 'Design System — rebuildup.dev',
		expect: 'pass',
		note: 'Design system showcase — the editorial primitives rendered together.',
	},
	{
		path: '/admin/login',
		title: 'my-web-2026',
		expect: 'pass',
		note: 'Sign-in document — public, reachable without a session, and the highest-value form surface.',
	},
];

/** One route that is deliberately not audited, with the reason. */
export interface SkippedRoute {
	/** The path that is not measured. */
	readonly path: string;
	/** Why this route is not measured — never empty. */
	readonly reason: string;
}

/**
 * The published routes this scan does NOT measure.
 *
 * Every entry states a reason. A route that is merely "not
 * implemented yet" or "behind a session" is listed here rather than
 * dropped, so the gap is visible in the record instead of being
 * indistinguishable from an oversight.
 */
export const SKIPPED_ROUTES: readonly SkippedRoute[] = [
	{
		path: '/tools/prototype',
		reason: 'third-party-content',
	},
	{
		path: '/admin',
		reason: 'layout-route-without-a-surface',
	},
	{
		path: '/admin/invitations',
		reason: 'authentication-required',
	},
	{
		path: '/admin/invitations/accept',
		reason: 'not-reachable-without-a-fixture',
	},
	{
		path: '/admin/keys',
		reason: 'authentication-required',
	},
	{
		path: '/admin/images',
		reason: 'authentication-required',
	},
	{
		path: '/admin/emoji-catalog',
		reason: 'authentication-required',
	},
];
