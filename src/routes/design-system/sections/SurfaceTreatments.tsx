import { css } from '../../../../styled-system/css';
import { Badge } from '../../../editorial/primitives/Badge';

/**
 * SurfaceTreatments — three card-style tiles assembled from the
 * existing editorial primitives, each demonstrating one of the
 * three page-level surface tokens:
 *
 *   - `bg.canvas`  → the page background itself, lifted slightly
 *                    via a `border.subtle` outline.
 *   - `bg.surface` → the default card surface (the
 *                    `neutral.50` tier).
 *   - `accent.surface` → the tinted feature surface, used for
 *                    Hero / feature card backgrounds per
 *                    `colors.md` §"accent.* token roles".
 *
 * Each tile is composed with the same primitives the rest of the
 * site uses (`Container`-less card, badge pair, monochrome label
 * cluster) so the showcase matches real feature code.
 */
export function SurfaceTreatments() {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
				gap: '4',
			})}
		>
			<li>
				<SurfaceTile
					token="bg.canvas"
					title="Canvas"
					description="Page background. Outlined so the card reads as a region without leaving the page surface."
					eyebrow="neutral.0"
					badges={<Badge tone="neutral">Default</Badge>}
					variant="canvas"
				/>
			</li>
			<li>
				<SurfaceTile
					token="bg.surface"
					title="Surface"
					description="Card / panel background. The default tier feature code falls back to when no specific surface is called for."
					eyebrow="neutral.50"
					badges={<Badge tone="neutral">Default</Badge>}
					variant="surface"
				/>
			</li>
			<li>
				<SurfaceTile
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

interface SurfaceTileProps {
	token: string;
	title: string;
	description: string;
	eyebrow: string;
	badges: React.ReactNode;
	variant: 'canvas' | 'surface' | 'accent';
}

const SURFACE_CLASS = {
	canvas: css({
		backgroundColor: 'bg.canvas',
		borderColor: 'border.subtle',
	}),
	surface: css({
		backgroundColor: 'bg.surface',
		borderColor: 'border.subtle',
	}),
	accent: css({
		backgroundColor: 'accent.surface',
		borderColor: 'border.subtle',
	}),
};

function SurfaceTile({ token, title, description, eyebrow, badges, variant }: SurfaceTileProps) {
	return (
		<article
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '6',
				paddingInline: '6',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				height: '100%',
			})}
			data-surface-token={token}
			data-surface-variant={variant}
		>
			{/* Surface fill is applied to an inner span so the
			    `bg.canvas` / `bg.surface` / `accent.surface` semantic
			    token — and ONLY that token — paints the tile body.
			    The outer card keeps its border + padding as
			    primitives-only chrome. */}
			<span
				aria-hidden="true"
				className={css({
					position: 'absolute',
					display: 'none',
				})}
			/>
			<div className={SURFACE_CLASS[variant]}>
				<header
					className={css({
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '3',
						paddingBlock: '4',
						paddingInline: '4',
					})}
				>
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
					{badges}
				</header>
				<h3
					className={css({
						margin: '0',
						paddingInline: '4',
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
						paddingInline: '4',
						paddingBlock: '3',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.6',
						color: 'text.default',
					})}
				>
					{description}
				</p>
				<footer
					className={css({
						paddingBlock: '4',
						paddingInline: '4',
						borderTop: '1px solid {colors.border.subtle}',
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
				</footer>
			</div>
		</article>
	);
}
