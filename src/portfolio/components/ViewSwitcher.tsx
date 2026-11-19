import { useRouter, useSearch } from '@tanstack/react-router';
import { css } from '../../../styled-system/css';
import type { PortfolioView } from '../views';
import { PORTFOLIO_VIEWS, parsePortfolioView } from '../views';
import { FACET_LABEL } from '../vocabulary';

/**
 * ViewSwitcher — URL-synced exhibition-mode toggle (Issue #1048).
 *
 * The active view lives in the URL's `?view=` search param, the same
 * pattern `FacetFilter` established for `?facets=`: the route loader
 * does not refetch on a view change (the view is presentation, not
 * query), so state stays canonical without a server round trip.
 *
 * Param contract:
 *   - `all` is the DEFAULT and is written as an absent param, so the
 *     canonical `/portfolio` URL stays clean;
 *   - switching views PRESERVES `?facets=` verbatim — the two params
 *     are orthogonal (facets filter the catalogue, the view decides
 *     how the filtered set is exhibited);
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
		// Preserve the facet filter verbatim; the view is presentation,
		// not query, so it must not disturb the catalogue selection.
		const nextSearch: { facets?: string; view?: string } = {};
		if (typeof search.facets === 'string' && search.facets.length > 0) {
			nextSearch.facets = search.facets;
		}
		if (view !== 'all') nextSearch.view = view;
		router.navigate({ to: '/portfolio', search: nextSearch, replace: false });
	};

	return (
		<fieldset
			className={css({
				margin: '0',
				padding: '0',
				border: 'none',
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
			})}
		>
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
			<div
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					gap: '2',
				})}
			>
				{PORTFOLIO_VIEWS.map((view) => {
					const isActive = view === active;
					const label = VIEW_LABEL[view];
					return (
						<button
							key={view}
							type="button"
							aria-pressed={isActive}
							aria-label={`${label} view${isActive ? ' selected' : ''}`}
							onClick={onSelect(view)}
							className={css({
								display: 'inline-flex',
								alignItems: 'center',
								gap: '2',
								h: '8',
								px: '4',
								borderRadius: 'full',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: isActive ? 'border.strong' : 'border.subtle',
								backgroundColor: isActive ? 'bg.accent' : 'bg.surface',
								color: isActive ? 'text.inverse' : 'text.default',
								fontFamily: 'sans',
								fontSize: 'sm',
								fontWeight: '600',
								cursor: 'pointer',
								transition: 'background-color 120ms ease, color 120ms ease',
								_focusVisible: {
									outline: '2px solid {colors.border.focus}',
									outlineOffset: '2px',
								},
							})}
						>
							<span aria-hidden="true">{isActive ? '✓' : ''}</span>
							<span>{label}</span>
						</button>
					);
				})}
			</div>
		</fieldset>
	);
}
