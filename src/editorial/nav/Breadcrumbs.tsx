import { Link, useMatches } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { BREADCRUMB_ORIGIN, ROUTE_LABELS, SUPPRESS_BREADCRUMB_LEAF_IDS } from './route-labels';

/**
 * Breadcrumbs — structural nav primitive (Issue #173, Issue #185, Issue #199).
 *
 * Style-agnostic by design. The component renders ONLY the semantic
 * markup for the breadcrumb chain and applies NO internal styling —
 * no Panda CSS, no class strings, no inline styles, no `<ol>` reset.
 * The page that renders this component supplies ALL visual styling
 * via the `className` prop on the outer `<nav>`. This is the
 * user-mandated contract (2026-09-29):
 *
 *   "スタイル依存の無いコンポーネントにする必要がある"
 *   — Breadcrumbs must not be a common layout element. Each page
 *     references it independently, and the component itself carries
 *     no style dependencies so per-page design freedom is preserved.
 *
 * The previous incarnation (#173 / #185) baked the editorial
 * breadcrumb chrome into the component itself. That coupling forced
 * every page to inherit a fixed visual rhythm — the exact failure
 * the user is fixing with #199. This refactor pulls the visual
 * decision out of the primitive and back into the pages that own
 * their own design.
 *
 * Chain resolution is unchanged: the chain is derived from
 * `useMatches()` against `ROUTE_LABELS` and is suppressed when the
 * leaf is in `SUPPRESS_BREADCRUMB_LEAF_IDS` (`/`, `/admin/login`,
 * `/admin/invitations_/accept`, `/design-system`). The helper is
 * exported as `resolveBreadcrumbChain` for unit testing and for
 * `BreadcrumbJsonLd` to share the same source of truth.
 *
 * **DOM structure** — the page styles the chain via the supplied
 * `className` and descendant selectors:
 *
 * ```html
 * <nav aria-label="パンくず" className={className}>
 *   <ol>
 *     <li>
 *       <a aria-label={label}>{label}</a>     <!-- non-leaf items -->
 *       <span aria-current="page">{label}</span>  <!-- leaf -->
 *       <span aria-hidden="true">/</span>     <!-- separator (not on leaf) -->
 *     </li>
 *     ...
 *   </ol>
 * </nav>
 * ```
 *
 * The page is responsible for:
 *
 *   - resetting `<ol>` browser defaults (list-style, margin, padding)
 *     — the component does NOT do this so it never imposes a visual
 *     decision the page can't override without `!important`.
 *   - laying out the chain (flex direction, gap, wrap behaviour).
 *   - styling the leaf vs. non-leaf vs. separator segments.
 *   - hover / focus / pressed affordances for the link segments.
 *
 * `BreadcrumbJsonLd` is unchanged — it is a `<script>` tag with no
 * visual rendering, so the style-agnostic directive does not apply.
 *
 * @example
 * ```tsx
 * <Breadcrumbs
 *   className={css({
 *     fontFamily: 'sans',
 *     fontSize: 'xs',
 *     color: 'text.muted',
 *     '& ol': { listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: '1', flexWrap: 'wrap' },
 *     '& li': { display: 'inline-flex', alignItems: 'center', gap: '1' },
 *     '& a': { color: 'text.muted', textDecoration: 'none' },
 *     '& [aria-current="page"]': { color: 'text.default', fontWeight: '500' },
 *     '& [aria-hidden="true"]': { userSelect: 'none' },
 *   })}
 * />
 * ```
 */

export interface BreadcrumbItem {
	routeId: string;
	label: string;
	href: string;
}

/**
 * Resolve the breadcrumb chain from the current match set. Pure
 * helper exported so `BreadcrumbJsonLd` (mounted in `<head>`) and
 * `Breadcrumbs` (mounted in a page body) stay in lock-step with the
 * same chain the user sees.
 *
 * Returns `null` when the chain should not render (suppressed leaf
 * or no labeled segments).
 */
export function resolveBreadcrumbChain(
	matches: ReadonlyArray<{
		routeId: string;
		pathname: string;
		params: Record<string, unknown>;
		loaderData?: unknown;
	}>,
): BreadcrumbItem[] | null {
	// Leaf suppression: the LAST non-root match's routeId is the
	// gate. The home surface `/` only ever has two matches
	// (`__root__` + `/`); auth pages have three
	// (`__root__` + `/admin` + the auth leaf); the design-system
	// showcase is a top-level entry — all three cases fall through
	// to null below.
	const lastNonRoot = findLast(matches, (m) => m.routeId !== '__root__');
	if (!lastNonRoot) return null;
	if (SUPPRESS_BREADCRUMB_LEAF_IDS.has(lastNonRoot.routeId)) return null;

	const items: BreadcrumbItem[] = [];
	for (const match of matches) {
		if (match.routeId === '__root__') continue;

		const entry = ROUTE_LABELS[match.routeId];
		if (!entry) continue;

		// Issue #183: when the loader threw `notFound()` (loaderData
		// is undefined) AND the route opted into the drop-on-missing
		// contract, skip this match. This keeps the visible chain
		// honest — a slug that does not exist in the registry must
		// not show a placeholder leaf segment in the breadcrumb.
		if (entry.dropOnMissingLoaderData && match.loaderData === undefined) {
			continue;
		}

		const params = match.params as Record<string, string | undefined>;
		const resolved = entry.resolve
			? entry.resolve({ params, loaderData: match.loaderData })
			: undefined;
		const label = resolved ?? entry.label;
		if (!label) continue;

		items.push({
			routeId: match.routeId,
			label,
			href: match.pathname,
		});
	}

	if (items.length === 0) return null;
	return items;
}

function findLast<T>(array: ReadonlyArray<T>, predicate: (item: T) => boolean): T | undefined {
	for (let i = array.length - 1; i >= 0; i--) {
		const item = array[i];
		if (item !== undefined && predicate(item)) return item;
	}
	return undefined;
}

export interface BreadcrumbsProps {
	/**
	 * Class applied to the outer `<nav>` element. The page styles
	 * the chain via this className and descendant selectors — see
	 * the module docstring for the DOM structure the selectors
	 * target. No-op when omitted (the chain renders with browser
	 * defaults).
	 */
	className?: string;
}

/**
 * Visible breadcrumb nav. Returns `null` when the leaf match is
 * suppressed (home + auth + design-system showcase) or no segment
 * is labeled. Style-agnostic — see the module docstring.
 */
export function Breadcrumbs({ className }: BreadcrumbsProps): ReactElement | null {
	const matches = useMatches();
	const items = resolveBreadcrumbChain(matches);
	if (!items) return null;

	return (
		<nav aria-label="パンくず" className={className}>
			<ol>
				{items.map((item, index) => {
					const isLast = index === items.length - 1;
					return (
						<li key={item.routeId}>
							{isLast ? (
								<span aria-current="page">{item.label}</span>
							) : (
								<Link to={item.href} aria-label={item.label}>
									{item.label}
								</Link>
							)}
							{!isLast && <span aria-hidden="true">/</span>}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

/**
 * JSON-LD companion to the visible breadcrumb chain. Rendered
 * inside any element that becomes part of the SSR'd document so
 * structured data lands in the page output. The `BreadcrumbList`
 * shape is the schema.org-prescribed breadcrumb contract.
 *
 * Returns `null` (no script tag) when the chain would not render.
 * The shape mirrors `Breadcrumbs` 1:1 — both consult
 * `resolveBreadcrumbChain` so suppression / label / href stay
 * identical.
 */
export function BreadcrumbJsonLd(): ReactElement | null {
	const matches = useMatches();
	const items = resolveBreadcrumbChain(matches);
	if (!items) return null;

	const jsonLd = {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: item.label,
			item: `${BREADCRUMB_ORIGIN}${item.href}`,
		})),
	};

	return (
		<script
			type="application/ld+json"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: `JSON.stringify` of a controlled literal — no user input is interpolated, so this never produces a `</script>` injection vector. React's normal text escape would HTML-escape the JSON braces and break the script payload.
			dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
		/>
	);
}
