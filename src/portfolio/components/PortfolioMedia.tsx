import { type ReactEventHandler, useState } from 'react';
import { css, cx } from '../../../styled-system/css';
import type { PortfolioMedia as PortfolioMediaData } from '../schema';

/**
 * Render a single portfolio media asset.
 *
 * Contract — `media.url === null` renders a placeholder. The
 * loader returns `null` when the R2 custom domain has not been
 * configured (Decision 5); the placeholder is part of the public
 * surface, not an error state.
 *
 * Image load failures are also rendered through the placeholder
 * branch — when an `<img>` fires its `error` event (network
 * failure, 404 on the custom domain, an unsupported content
 * type, …) we flip React state to `errored` and the next render
 * emits the styled frame instead of the broken-image glyph. The
 * `<figure role="img" aria-label>` keeps the alt text reachable
 * for assistive tech, and the same aspect-ratio frame keeps the
 * page layout from collapsing.
 *
 * Reserved box (Issue #486)
 * -------------------------
 * `portfolio_media.width` / `.height` already travel with every
 * loaded row (`src/portfolio/schema.ts`), but the `<img>` never
 * emitted them. With `width: 100%` + `height: auto` and no
 * intrinsic size, the box is 0px tall until the bytes arrive, so a
 * `loading="lazy"` cover that resolves after the visitor scrolled
 * to it pushes every element below it down — a pure CLS shift on a
 * surface whose whole point is imagery.
 *
 * The fix is confined to this one element:
 *
 *   - `width` / `height` attributes are emitted whenever the row
 *     carries a positive intrinsic size, so the UA derives
 *     `aspect-ratio: auto <w> / <h>` and reserves the box from the
 *     first paint,
 *   - an explicit `aspect-ratio` inline style repeats that ratio so
 *     the reservation also holds on engines that do not derive it
 *     from the attributes, and
 *   - the placeholder branch is painted with the SAME data-derived
 *     ratio, so the `error` swap never changes the box height.
 *
 * The inline style is deliberate and matches existing precedent
 * (`src/routes/design-system/sections/ColorSwatches.tsx`,
 * `SpacingRuler.tsx`): the ratio is data derived from the media row,
 * not a design token, so it does not belong in the Panda layer.
 *
 * `srcset` / `sizes` are intentionally NOT emitted. A truthful
 * `srcset` needs a second, smaller rendition of every asset, and
 * this repository has no variant pipeline: `composeMediaUrl`
 * (`src/portfolio/media.ts`) resolves one object key to exactly one
 * R2 URL, and nothing in front of the bucket resizes it. Emitting
 * `srcset` would mean inventing URL syntax for a transformation the
 * delivery surface does not perform. The measured state and the
 * options are recorded in `docs/verification/perf/README.md`; the
 * variant pipeline is an owner decision (Cloudflare Image Resizing
 * vs. pre-generated R2 variants), not a rendering detail.
 */
export interface PortfolioMediaProps {
	media: PortfolioMediaData;
	loading?: 'eager' | 'lazy';
	className?: string;
	/**
	 * Issue #912 — render this media inside a FIXED frame instead of
	 * the row's intrinsic ratio.
	 *
	 * The `/portfolio` list card needs every thumbnail box to be the
	 * same shape so the covers line up on the grid: the box ratio is
	 * then a layout decision (`16 / 9`, passed by the card) rather
	 * than a property of whatever bitmap happens to be the cover, and
	 * `object-fit: cover` crops the bitmap into it instead of
	 * stretching it.
	 *
	 * The Issue #486 reservation contract is unchanged and gets
	 * stronger: `width` / `height` attributes are still emitted from
	 * the row's intrinsic size, and the inline `aspect-ratio` now
	 * carries the FRAME ratio — which is server-rendered, so the box
	 * is reserved from the first paint even when the row declares no
	 * intrinsic size (a state the default path cannot reserve). The
	 * placeholder branch paints the same frame ratio, so the error
	 * swap still cannot move the layout.
	 */
	frameAspectRatio?: string;
}

/**
 * Intrinsic size of a media row, or `null` when the row does not
 * declare one.
 *
 * `portfolio_media.width` / `.height` are nullable in the D1 schema,
 * so "unknown" is a real state and must not be coerced into a bogus
 * `0` (a `width="0"` attribute is invalid and browsers treat it as
 * unparseable). A non-positive or non-integer value is rejected the
 * same way, so a corrupt row degrades to the un-reserved rendering
 * that predates Issue #486 rather than to a collapsed box.
 */
function intrinsicSize(media: PortfolioMediaData): { width: number; height: number } | null {
	const { width, height } = media;
	if (width === null || height === null) return null;
	if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
	if (width <= 0 || height <= 0) return null;
	return { width, height };
}

/** CSS `aspect-ratio` value for the media box, or `undefined` when unknown. */
function boxAspectRatio(media: PortfolioMediaData): string | undefined {
	const size = intrinsicSize(media);
	return size ? `${size.width} / ${size.height}` : undefined;
}

export function PortfolioMediaFigure({
	media,
	loading = 'lazy',
	className,
	frameAspectRatio,
}: PortfolioMediaProps) {
	const [errored, setErrored] = useState(false);
	const handleError: ReactEventHandler<HTMLImageElement> = () => {
		setErrored(true);
	};

	const size = intrinsicSize(media);
	// Issue #912: a frame ratio, when given, is the box decision — it
	// wins over the row's intrinsic ratio for BOTH branches below, so
	// the loaded image and the placeholder paint the same box.
	const aspectRatio = frameAspectRatio ?? boxAspectRatio(media);

	if (media.url === null || errored) {
		return (
			<figure
				role="img"
				aria-label={media.alt}
				className={cx(mediaFrameStyle, className)}
				style={aspectRatio ? { aspectRatio } : undefined}
			>
				<span className={mediaFrameLabel}>placeholder</span>
			</figure>
		);
	}

	return (
		<figure className={cx(figureStyle, className)}>
			<img
				src={media.url}
				alt={media.alt}
				width={size?.width}
				height={size?.height}
				loading={loading}
				decoding="async"
				onError={handleError}
				className={cx(imageStyle, frameAspectRatio ? frameCropStyle : undefined)}
				style={aspectRatio ? { aspectRatio } : undefined}
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

/**
 * Issue #912 — `object-fit: cover` for a fixed-frame render.
 *
 * Applied ONLY when `frameAspectRatio` is set: the default path keeps
 * the row's intrinsic ratio as its box, where the UA default
 * `object-fit: fill` draws the bitmap 1:1 into its own box (no
 * distortion possible). A frame box has a DIFFERENT ratio than the
 * bitmap, so `fill` would stretch it — `cover` crops instead.
 */
const frameCropStyle = css({
	objectFit: 'cover',
});

const captionStyle = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
	lineHeight: '1.5',
});
