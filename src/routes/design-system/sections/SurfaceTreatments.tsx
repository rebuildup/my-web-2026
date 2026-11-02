import { css } from '../../../../styled-system/css';
import { Badge } from '../../../editorial/primitives/Badge';

/**
 * SurfaceTreatments — the three page-level surface tokens shown as
 * stacked bands, each painted in the token's own fill:
 *
 *   - `bg.canvas`    → the page background itself.
 *   - `bg.surface`   → the default card / panel tier.
 *   - `accent.surface` → the tinted feature surface (Hero / feature
 *                      card) per `colors.md` §"accent.* token roles".
 *
 * Issue #804 (owner feedback, 2026-11-01): the three samples were
 * cards outlined with `border.subtle`. On the light appearance that
 * outline is a near-white hairline on a near-white page — the "white
 * border" the owner read as decoration rather than structure. The
 * samples are now full-width bands laid on one `bg.subtle` substrate,
 * with no border and no divider: the only difference between a band
 * and the substrate, and between one band and the next, is the fill.
 * A band whose fill cannot separate itself from the substrate is
 * therefore visible as exactly that, instead of being propped up by
 * an outline.
 *
 * The substrate is `bg.subtle` rather than `bg.canvas` on purpose:
 * `bg.canvas` is the page fill, so a `bg.canvas` band would have no
 * edge at all against a `bg.canvas` substrate. On `bg.subtle` all
 * three tokens sit one step apart and can be compared honestly.
 */
export function SurfaceTreatments() {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '4',
				listStyle: 'none',
				display: 'grid',
				gridTemplateColumns: '1fr',
				rowGap: '3',
				backgroundColor: 'bg.subtle',
			})}
		>
			<li>
				<SurfaceBand
					token="bg.canvas"
					title="Canvas"
					description="Page background. The lightest step in the light appearance; the deepest step in the dark one."
					eyebrow="neutral.0"
					badges={<Badge tone="neutral">Default</Badge>}
					variant="canvas"
				/>
			</li>
			<li>
				<SurfaceBand
					token="bg.surface"
					title="Surface"
					description="Card / panel background. The default tier feature code falls back to when no specific surface is called for."
					eyebrow="neutral.50"
					badges={<Badge tone="neutral">Default</Badge>}
					variant="surface"
				/>
			</li>
			<li>
				<SurfaceBand
					token="accent.surface"
					title="Accent surface"
					description="Tinted feature surface — Hero / feature card background. Says 'this is the featured region' without competing with the primary CTA."
					eyebrow="brand.50"
					badges={<Badge tone="accent">Featured</Badge>}
					variant="accent"
				/>
			</li>
		</ul>
	);
}

interface SurfaceBandProps {
	token: string;
	title: string;
	description: string;
	eyebrow: string;
	badges: React.ReactNode;
	variant: 'canvas' | 'surface' | 'accent';
}

const BAND_FILL = {
	canvas: css({ backgroundColor: 'bg.canvas' }),
	surface: css({ backgroundColor: 'bg.surface' }),
	accent: css({ backgroundColor: 'accent.surface' }),
};

/**
 * One band. The fill is painted by the band element itself — there is
 * no inner "fill span" and no outer outlined card, so the measured
 * area and the painted area are the same rectangle.
 */
function SurfaceBand({ token, title, description, eyebrow, badges, variant }: SurfaceBandProps) {
	return (
		<article
			className={`${BAND_FILL[variant]} ${css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'minmax(0, 1fr) auto' },
				columnGap: '6',
				rowGap: '2',
				alignItems: 'start',
				paddingBlock: '6',
				paddingInline: '6',
			})}`}
			data-surface-token={token}
			data-surface-variant={variant}
		>
			<div className={css({ display: 'flex', flexDirection: 'column', gap: '2', minWidth: '0' })}>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					{eyebrow}
				</span>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: 'xl',
						fontWeight: '700',
						color: 'text.default',
						letterSpacing: '-0.01em',
					})}
				>
					{title}
				</h3>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.6',
						color: 'text.default',
					})}
				>
					{description}
				</p>
			</div>
			{/* Token reference and badge sit in the trailing column on
			    `md` and above, and under the copy on narrow widths. No
			    divider above or below — the gap does the separating. */}
			<div
				className={css({
					display: 'flex',
					alignItems: 'center',
					justifyContent: { base: 'flex-start', md: 'flex-end' },
					flexWrap: 'wrap',
					gap: '3',
				})}
			>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
					})}
				>
					{token}
				</code>
				{badges}
			</div>
		</article>
	);
}
