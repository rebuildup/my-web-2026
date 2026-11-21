import { useRouter, useSearch } from '@tanstack/react-router';
import { css } from '../../../styled-system/css';
import { Cluster, Stack } from '../../editorial/primitives/Flow';
import { ToggleChip } from '../../editorial/primitives/ToggleChip';
import type { PortfolioView } from '../views';
import { PORTFOLIO_VIEWS, parsePortfolioView } from '../views';
import { FACET_LABEL } from '../vocabulary';

/**
 * ViewSwitcher — URL-synced exhibition-mode toggle (Issue #1048).
 *
 * The active view lives in the URL's `?view=` search param, the same
 * pattern `FacetFilter` established for `?facets=`. A named view also
 * implies a default facet scope for the catalogue query (the
 * predecessor's galleries were category-scoped pages — Issue #1048),
 * so a view change DOES rerun the loader; an explicit `?facets=`
 * selection overrides the implied scope.
 *
 * Param contract:
 *   - `all` is the DEFAULT and is written as an absent param, so the
 *     canonical `/portfolio` URL stays clean;
 *   - switching views PRESERVES `?facets=` verbatim — an explicit
 *     facet selection is the visitor's override of the view's scope;
 *   - `FacetFilter` preserves `?view=` the same way in return.
 *
 * Labels reuse `FACET_LABEL` for the three facet-named views so the
 * switcher cannot invent a second word for the same concept; `All`
 * is the only new word and it is English-only, matching the eyebrow
 * register of the page header.
 *
 * Accessibility mirrors `FacetFilter`: `<fieldset>` + `<legend>`,
 * `aria-pressed` chips whose active state is not colour-only.
 */
export interface ViewSwitcherProps {
	value: PortfolioView;
}

const VIEW_LABEL: Readonly<Record<PortfolioView, string>> = {
	all: 'All',
	develop: FACET_LABEL.develop,
	video: FACET_LABEL.video,
	design: FACET_LABEL.design,
};

export function ViewSwitcher({ value }: ViewSwitcherProps) {
	const router = useRouter();
	const search = useSearch({ strict: false }) as {
		facets?: string | undefined;
		view?: string | undefined;
	};
	const active = parsePortfolioView(value);

	const onSelect = (view: PortfolioView) => () => {
		// Preserve the facet filter verbatim: an explicit `?facets=`
		// selection overrides the view's implied catalogue scope, so
		// the switcher must not disturb it.
		const nextSearch: { facets?: string; view?: string } = {};
		if (typeof search.facets === 'string' && search.facets.length > 0) {
			nextSearch.facets = search.facets;
		}
		if (view !== 'all') nextSearch.view = view;
		router.navigate({ to: '/portfolio', search: nextSearch, replace: false });
	};

	return (
		<Stack as="fieldset" gap="3" className={css({ margin: '0', padding: '0', border: 'none' })}>
			<legend
				className={css({
					fontFamily: 'sans',
					fontSize: 'sm',
					fontWeight: '600',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				View
			</legend>
			{/* No `aria-label` here: the `<fieldset>`/`<legend>` above
			    already names this group, and a bare `<div>` cannot carry
			    one anyway (implicit role `generic` — the Issue #490
			    prohibited-attribute defect). */}
			<Cluster gap="2">
				{PORTFOLIO_VIEWS.map((view) => {
					const isActive = view === active;
					const label = VIEW_LABEL[view];
					return (
						<ToggleChip
							key={view}
							active={isActive}
							aria-label={`${label} view${isActive ? ' selected' : ''}`}
							onClick={onSelect(view)}
						>
							{label}
						</ToggleChip>
					);
				})}
			</Cluster>
		</Stack>
	);
}
