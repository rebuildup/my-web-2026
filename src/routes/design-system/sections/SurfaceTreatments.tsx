import { css } from '../../../../styled-system/css';
import { Badge } from '../../../editorial/primitives/Badge';

/**
 * SurfaceTreatments — the three PAGE-LEVEL surface tokens shown as
 * stacked bands, each painted in the token's own fill:
 *
 *   - `surface.canvas`    → the page background itself.
 *   - `surface.raised`    → the default card / panel tier.
 *   - `surface.feature`   → the barely-tinted feature surface
 *                          (Hero / feature card).
 *
 * Direction B (Issue #764) separates surfaces by fill alone. The
 * bands are laid on one `surface.sunken` substrate, with no border and
 * no divider: the only difference between a band and the substrate,
 * and between one band and the next, is the fill. A band whose fill
 * cannot separate itself from the substrate is therefore visible as
 * exactly that, instead of being propped up by an outline.
 *
 * The substrate is `surface.sunken` rather than `surface.canvas` on
 * purpose: `surface.canvas` is the page fill, so a `surface.canvas`
 * band would have no edge at all against a `surface.canvas` substrate.
 * On `surface.sunken` the three page-level tokens sit one step apart
 * and can be compared honestly. The remaining ladder steps
 * (`surface.control`, `surface.inverse`) are listed with every other
 * role in the colour section.
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
				backgroundColor: 'surface.sunken',
			})}
		>
			<li>
				<SurfaceBand
					token="surface.canvas"
					title="Canvas"
					description="Page background. The ground every other surface is measured against."
					eyebrow="neutral.50"
					badges={<Badge tone="neutral">Default</Badge>}
					variant="canvas"
				/>
			</li>
			<li>
				<SurfaceBand
					token="surface.raised"
					title="Raised"
					description="Card / panel background. One step above the ground; the default tier feature code falls back to."
					eyebrow="neutral.25"
					badges={<Badge tone="neutral">Default</Badge>}
					variant="raised"
				/>
			</li>
			<li>
				<SurfaceBand
					token="surface.feature"
					title="Feature"
					description="Barely-tinted featured region — Hero / feature card background. Not a signal, and never a large saturated fill."
					eyebrow="brand.50"
					badges={<Badge tone="accent">Featured</Badge>}
					variant="feature"
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
	variant: 'canvas' | 'raised' | 'feature';
}

const BAND_FILL = {
	canvas: css({ backgroundColor: 'surface.canvas' }),
	raised: css({ backgroundColor: 'surface.raised' }),
	feature: css({ backgroundColor: 'surface.feature' }),
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
