import { useRouter, useSearch } from '@tanstack/react-router';
import { css } from '../../../styled-system/css';
import { Cluster, Stack } from '../../editorial/primitives/Flow';
import { ToggleChip } from '../../editorial/primitives/ToggleChip';
import { eyebrowSans } from '../../editorial/primitives/shared-styles';
import type { PortfolioFacet } from '../schema';
import { PORTFOLIO_FACETS } from '../schema';
import { FACET_LABEL, FACET_LABEL_JA } from '../vocabulary';

/**
 * FacetFilter — URL-synced facet toggle (Issue #77).
 *
 * The selected facets live in the URL's `q.facets` search param
 * (TanStack Router pattern). Toggling a chip adds / removes the
 * facet; the route loader refetches on every URL change so
 * faceted state stays canonical — no client-side caching, no
 * server-state drift.
 *
 * Filter semantics: **any-of**. A project is included when its
 * facet list shares at least one value with the active filter
 * set. `?facets=develop,design` matches a project tagged either
 * (or both).
 *
 * Empty selection = no filter. The chip group always renders all
 * four closed-enum facets so layout does not shift on toggle.
 *
 * Accessibility:
 *   - The filter is wrapped in `<fieldset>` + `<legend>` so
 *     screen readers announce the group.
 *   - Each chip is a `<button type="button">` with
 *     `aria-pressed` reflecting the active state. Active state is
 *     **not** colour-only — the `aria-pressed` attribute plus a
 *     checkmark glyph (`✓`) inside the chip is the second channel.
 *   - The chip's accessible name carries the visible label (the JA
 *     label and the EN label the chip shows) before the word
 *     `facet`, because WCAG 2.2 SC 2.5.3 (Label in Name) requires
 *     the accessible name to contain the visible text (Issue #718).
 *     The visible chip itself is unchanged.
 */
export interface FacetFilterProps {
	value: readonly PortfolioFacet[];
}

export function FacetFilter({ value }: FacetFilterProps) {
	const router = useRouter();
	const search = useSearch({ strict: false }) as {
		facets?: string | undefined;
		view?: string | undefined;
	};
	const active = new Set(value);

	const onToggle = (facet: PortfolioFacet) => () => {
		const current = parseFacets(search.facets);
		const next = new Set(current);
		if (next.has(facet)) next.delete(facet);
		else next.add(facet);
		// Preserve canonical order to keep URLs stable for caching.
		const ordered = PORTFOLIO_FACETS.filter((f) => next.has(f));
		// Issue #1048: `?view=` supplies the catalogue's default facet
		// scope when no explicit facets are chosen, so the exhibition
		// mode must survive a facet toggle (and `ViewSwitcher`
		// preserves `?facets=` the same way in return).
		const nextSearch: { facets?: string; view?: string } = {};
		if (ordered.length > 0) nextSearch.facets = ordered.join(',');
		if (typeof search.view === 'string' && search.view.length > 0) {
			nextSearch.view = search.view;
		}
		router.navigate({
			to: '/portfolio',
			search: nextSearch,
			replace: false,
		});
	};

	const onClear = () => {
		// Clearing the facet filter keeps the exhibition view.
		router.navigate({
			to: '/portfolio',
			search:
				typeof search.view === 'string' && search.view.length > 0 ? { view: search.view } : {},
			replace: false,
		});
	};

	return (
		<Stack as="fieldset" gap="3" className={css({ margin: '0', padding: '0', border: 'none' })}>
			<legend className={css(eyebrowSans)}>Facet filter</legend>
			<Cluster aria-label="facet filter chips" gap="2">
				{PORTFOLIO_FACETS.map((facet) => {
					const isActive = active.has(facet);
					const label = { ja: FACET_LABEL_JA[facet], en: FACET_LABEL[facet] };
					return (
						<ToggleChip
							key={facet}
							active={isActive}
							aria-label={`${label.ja} / ${label.en} facet${isActive ? ' selected' : ''}`}
							onClick={onToggle(facet)}
							sublabel={label.en}
						>
							{label.ja}
						</ToggleChip>
					);
				})}
				{active.size > 0 ? (
					<ToggleChip tone="clear" onClick={onClear}>
						Clear
					</ToggleChip>
				) : null}
			</Cluster>
		</Stack>
	);
}

/** Parse the `?facets=a,b,c` query into a typed array, defensively. */
function parseFacets(raw: string | undefined): PortfolioFacet[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter((s): s is PortfolioFacet => (PORTFOLIO_FACETS as readonly string[]).includes(s));
}
