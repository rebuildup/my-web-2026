import { useRouter, useSearch } from '@tanstack/react-router';
import type { PortfolioFacet } from '../schema';
import { PORTFOLIO_FACETS } from '../schema';
import { css } from '../../../styled-system/css';

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
 */
export interface FacetFilterProps {
	value: readonly PortfolioFacet[];
}

const FACET_LABELS: Readonly<Record<PortfolioFacet, { ja: string; en: string }>> = {
	develop: { ja: '開発', en: 'Develop' },
	video: { ja: '映像', en: 'Video' },
	design: { ja: 'デザイン', en: 'Design' },
	other: { ja: 'その他', en: 'Other' },
};

export function FacetFilter({ value }: FacetFilterProps) {
	const router = useRouter();
	const search = useSearch({ strict: false }) as { facets?: string | undefined };
	const active = new Set(value);

	const onToggle = (facet: PortfolioFacet) => () => {
		const current = parseFacets(search.facets);
		const next = new Set(current);
		if (next.has(facet)) next.delete(facet);
		else next.add(facet);
		// Preserve canonical order to keep URLs stable for caching.
		const ordered = PORTFOLIO_FACETS.filter((f) => next.has(f));
		const nextSearch = ordered.length > 0 ? { facets: ordered.join(',') } : {};
		router.navigate({
			to: '/portfolio',
			search: nextSearch,
			replace: false,
		});
	};

	const onClear = () => {
		router.navigate({ to: '/portfolio', search: {}, replace: false });
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
				Facet filter
			</legend>
			<div
				aria-label="facet filter chips"
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					gap: '2',
				})}
			>
				{PORTFOLIO_FACETS.map((facet) => {
					const isActive = active.has(facet);
					const label = FACET_LABELS[facet];
					return (
						<button
							key={facet}
							type="button"
							aria-pressed={isActive}
							aria-label={`${label.en} facet${isActive ? ' selected' : ''}`}
							onClick={onToggle(facet)}
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
							<span>{label.ja}</span>
							<span
								aria-hidden="true"
								className={css({
									fontFamily: 'mono',
									fontSize: 'xs',
									color: isActive ? 'text.inverse' : 'text.muted',
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
								})}
							>
								{label.en}
							</span>
						</button>
					);
				})}
				{active.size > 0 ? (
					<button
						type="button"
						onClick={onClear}
						className={css({
							display: 'inline-flex',
							alignItems: 'center',
							gap: '2',
							h: '8',
							px: '4',
							borderRadius: 'full',
							borderWidth: '1px',
							borderStyle: 'dashed',
							borderColor: 'border.subtle',
							backgroundColor: 'transparent',
							color: 'text.muted',
							fontFamily: 'sans',
							fontSize: 'sm',
							cursor: 'pointer',
							_focusVisible: {
								outline: '2px solid {colors.border.focus}',
								outlineOffset: '2px',
							},
						})}
					>
						Clear
					</button>
				) : null}
			</div>
		</fieldset>
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
