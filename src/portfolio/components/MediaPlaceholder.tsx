import { css } from '../../../styled-system/css';

/**
 * MediaPlaceholder — the honest "this project has no usable media"
 * frame for the exhibition views (Issue #1048).
 *
 * The `all` view never needs this: `ProjectCard` simply omits the
 * cover block when a project has no media. The `develop` / `video` /
 * `design` views are media-first presentations, so a project without
 * a cover still occupies its slot — painted as this labelled frame
 * rather than a fabricated thumbnail. The same posture
 * `PortfolioMediaFigure` takes when `media.url === null`: the
 * placeholder is part of the public surface, not an error state.
 *
 * `ratio` is an explicit `aspect-ratio` so the box is reserved from
 * the first paint exactly like a loaded figure (the Issue #486 CLS
 * contract), and `label` defaults to `no media` — a statement of
 * fact, not a stock image.
 */
export interface MediaPlaceholderProps {
	/** CSS `aspect-ratio` value, e.g. `'16 / 9'`. */
	ratio?: string;
	/** Visible label inside the frame. */
	label?: string;
}

export function MediaPlaceholder({ ratio = '4 / 3', label = 'no media' }: MediaPlaceholderProps) {
	return (
		<div
			className={css({
				margin: '0',
				display: 'grid',
				placeItems: 'center',
				width: '100%',
				backgroundColor: 'bg.subtle',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				borderRadius: '6px',
			})}
			style={{ aspectRatio: ratio }}
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
				{label}
			</span>
		</div>
	);
}
