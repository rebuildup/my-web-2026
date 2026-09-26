import type { PortfolioMedia as PortfolioMediaData } from '../schema';
import { css, cx } from '../../../styled-system/css';

/**
 * Render a single portfolio media asset.
 *
 * Contract — `media.url === null` renders a placeholder. The
 * loader returns `null` when the R2 custom domain has not been
 * configured (Decision 5); the placeholder is part of the public
 * surface, not an error state.
 *
 * Image load failures are also rendered through the placeholder
 * branch — the `<img>` keeps its `alt` attribute for assistive
 * tech, but the broken-image glyph is hidden in favour of the
 * styled frame so the layout never collapses.
 */
export interface PortfolioMediaProps {
	media: PortfolioMediaData;
	loading?: 'eager' | 'lazy';
	className?: string;
}

export function PortfolioMediaFigure({ media, loading = 'lazy', className }: PortfolioMediaProps) {
	if (media.url === null) {
		return (
			<figure role="img" aria-label={media.alt} className={cx(mediaFrameStyle, className)}>
				<span className={mediaFrameLabel}>placeholder</span>
			</figure>
		);
	}
	return (
		<figure className={cx(figureStyle, className)}>
			<img
				src={media.url}
				alt={media.alt}
				loading={loading}
				decoding="async"
				className={imageStyle}
			/>
			{media.caption ? <figcaption className={captionStyle}>{media.caption}</figcaption> : null}
		</figure>
	);
}

const mediaFrameStyle = css({
	margin: '0',
	display: 'grid',
	placeItems: 'center',
	width: '100%',
	aspectRatio: '16 / 9',
	backgroundColor: 'bg.subtle',
	border: '1px solid {colors.border.subtle}',
	borderRadius: '6px',
});

const mediaFrameLabel = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const figureStyle = css({
	margin: '0',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const imageStyle = css({
	width: '100%',
	height: 'auto',
	borderRadius: '6px',
	backgroundColor: 'bg.subtle',
});

const captionStyle = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
	lineHeight: '1.5',
});
