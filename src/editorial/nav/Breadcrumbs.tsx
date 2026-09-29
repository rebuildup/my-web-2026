import { Link, useMatches } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { css, cx } from '../../../styled-system/css';
import { BREADCRUMB_ORIGIN, ROUTE_LABELS, SUPPRESS_BREADCRUMB_LEAF_IDS } from './route-labels';

/**
 * Breadcrumbs — nav primitive (Issue #173).
 *
 * Builds the breadcrumb chain from `useMatches()` by walking the
 * matched route tree from root to leaf and consulting
 * `ROUTE_LABELS` for each route's contribution. The chain is
 * suppressed entirely when the leaf match belongs to
 * `SUPPRESS_BREADCRUMB_LEAF_IDS` (home + auth pages).
 *
 * The component renders two things:
 *
 *   - `Breadcrumbs` — the visible `<nav aria-label="パンくず">`
 *     block. Sits before `<Outlet />` in `src/routes/__root.tsx`.
 *     Intermediate entries are `<Link>`s to the segment's
 *     `pathname`; the leaf carries `aria-current="page"` so screen
 *     readers announce it as the current location.
 *
 *   - `BreadcrumbJsonLd` — a `<script type="application/ld+json">`
 *     tag that mirrors the visible chain in the
 *     schema.org/BreadcrumbList shape. Rendered in `<head>` so
 *     search engines pick it up before parsing the visible DOM.
 *     The `item` URLs are anchored at the canonical production
 *     origin (`https://rebuildup.dev`, ADR-0014) regardless of
 *     where the page is being served.
 *
 * Style:
 *
 *   - Reuses the existing `text.muted` / `text.default` semantic
 *     token pair, the `sans` body family, and the type scale's
 *     `xs`/`sm` tiers — no new design tokens are introduced.
 *   - The chevron separator is `aria-hidden="true"` so the
 *     announced chain is the labels only, not the slashes.
 *   - The font-size shrinks on `<600px` so the breadcrumb chain
 *     fits without wrapping inside narrow viewports.
 */

export interface BreadcrumbItem {
	routeId: string;
	label: string;
	href: string;
}

/**
 * Resolve the breadcrumb chain from the current match set. Pure
 * helper exported so `BreadcrumbJsonLd` (mounted in `<head>`) and
 * `Breadcrumbs` (mounted before `<Outlet />`) stay in lock-step.
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
	// (`__root__` + `/admin` + the auth leaf) — both cases fall
	// through to null below.
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
	className?: string;
}

/**
 * Visible breadcrumb nav. Returns `null` when the leaf match is
 * suppressed (home + auth pages) or no segment is labeled.
 */
export function Breadcrumbs({ className }: BreadcrumbsProps): ReactElement | null {
	const matches = useMatches();
	const items = resolveBreadcrumbChain(matches);
	if (!items) return null;

	return (
		<nav
			aria-label="パンくず"
			className={cx(
				css({
					fontFamily: 'sans',
					color: 'text.muted',
					// Smaller on the tightest viewport so the chain
					// fits without overflowing; settles to `sm` (14px)
					// at the first breakpoint.
					fontSize: { base: 'xs', sm: 'sm' },
					lineHeight: '1.5',
				}),
				className,
			)}
		>
			<ol
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					alignItems: 'center',
					gap: '2',
					margin: '0',
					padding: '0',
					listStyle: 'none',
				})}
			>
				{items.map((item, index) => {
					const isLast = index === items.length - 1;
					return (
						<li
							key={item.routeId}
							className={css({
								display: 'inline-flex',
								alignItems: 'center',
								gap: '2',
								minWidth: '0',
							})}
						>
							{isLast ? (
								<span
									aria-current="page"
									className={css({
										color: 'text.default',
										fontWeight: '600',
										// `text-overflow: ellipsis` so an
										// unexpectedly long project title
										// truncates instead of pushing the
										// next viewport-overflow bug.
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
										maxWidth: '100%',
									})}
								>
									{item.label}
								</span>
							) : (
								<Link
									to={item.href}
									aria-label={item.label}
									className={css({
										color: 'text.muted',
										textDecoration: 'none',
										borderRadius: 'sm',
										paddingBlock: '1',
										paddingInline: '1',
										transition: 'color 120ms ease',
										_hover: {
											color: 'text.default',
											textDecoration: 'underline',
										},
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
											color: 'text.default',
										},
									})}
								>
									{item.label}
								</Link>
							)}
							{!isLast && (
								<span
									aria-hidden="true"
									className={css({
										color: 'text.muted',
										userSelect: 'none',
									})}
								>
									/
								</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

/**
 * JSON-LD companion to the visible breadcrumb chain. Rendered
 * inside `<head>` so the structured data lands in the document's
 * metadata layer; the `BreadcrumbList` shape is the
 * schema.org-prescribed breadcrumb contract.
 *
 * Returns `null` (no script tag) when the chain would not render.
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
