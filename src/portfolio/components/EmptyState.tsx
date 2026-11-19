import { css } from '../../../styled-system/css';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';

/**
 * PortfolioEmptyState — `/portfolio` surface for the
 * pre-migration period (Issue #182).
 *
 * Rendered when there are no public+published entries to show —
 * i.e. the catalogue is genuinely empty, not just filtered down
 * to nothing. The pre-existing `<output>` branch in `PortfolioList`
 * already handles the filtered-but-empty case with
 * "該当する project はありません", so this component exists
 * exclusively for the truly-empty case.
 *
 * Visual contract:
 *   - `SectionHeading` (default variant) carries the heading
 *     cluster so the heading rhythm matches other portfolio
 *     surfaces.
 *   - One secondary action: a link to the surface where the
 *     publication progress actually lives — the home page's
 *     現在地 section (Issue #835: GitHub Releases is site update
 *     history, not work progress, so it is not the default).
 *     External overrides open in a new tab with
 *     `rel="noopener noreferrer"`; the internal default navigates
 *     in place.
 *
 * Placement:
 *   The route (`src/routes/portfolio/index.tsx` →
 *   `PortfolioList`) keeps ownership of the surrounding
 *   `<section id="portfolio-list">` and `Container` wrapper.
 *   This component is content-only so it slots in where the
 *   card `<ol>` would otherwise render.
 */
export interface PortfolioEmptyStateProps {
	/**
	 * Override the URL the secondary action links to. Defaults
	 * to `/` — the home page's 現在地 section is the public
	 * surface that shows publication progress (Issue #835).
	 * Kept overridable so the loader / route can route to a
	 * different public status surface without touching the
	 * component itself.
	 */
	statusHref?: string;
}

const DEFAULT_STATUS_HREF = '/';
const EXTERNAL_HREF = /^https?:\/\//;

export function PortfolioEmptyState({
	statusHref = DEFAULT_STATUS_HREF,
}: PortfolioEmptyStateProps = {}) {
	const external = EXTERNAL_HREF.test(statusHref);
	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '6',
				paddingBlock: '8',
			})}
		>
			<SectionHeading
				eyebrow="Status"
				title="ポートフォリオ準備中"
				description="公開できる project はまだありません。公開済みの作品は /portfolio とトップページの現在地セクションから確認できます。"
			/>
			<a
				href={statusHref}
				rel={external ? 'noopener noreferrer' : undefined}
				target={external ? '_blank' : undefined}
				className={css({
					display: 'inline-flex',
					alignItems: 'center',
					gap: '2',
					alignSelf: 'flex-start',
					height: '10',
					paddingInline: '5',
					borderRadius: 'full',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: 'border.subtle',
					backgroundColor: 'bg.surface',
					color: 'text.default',
					fontFamily: 'sans',
					fontSize: 'md',
					fontWeight: '600',
					textDecoration: 'none',
					transition: 'border-color 120ms ease, background-color 120ms ease',
					_hover: { borderColor: 'border.strong' },
					_focusVisible: {
						outline: '2px solid {colors.border.focus}',
						outlineOffset: '2px',
					},
				})}
			>
				<span>公開状況を確認する</span>
				<span aria-hidden="true">→</span>
			</a>
		</div>
	);
}
