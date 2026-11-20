import type { ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * MediaFrame — the owned treatment for images / embeds / figures
 * (ADR-0022 C-4/C-6, layout-system.md §5).
 *
 * Owns the aspect-ratio box, the sunken well behind media, the corner
 * radius and the optional caption measure. Callers supply the media
 * and the caption text; they never set the frame's own padding or
 * background.
 */

export type MediaRatio = '16/9' | '4/3' | '1/1' | '3/2' | 'auto';

const RATIO_MAP: Record<MediaRatio, string> = {
	'16/9': '16 / 9',
	'4/3': '4 / 3',
	'1/1': '1 / 1',
	'3/2': '3 / 2',
	auto: 'auto',
};

export interface MediaFrameProps {
	ratio?: MediaRatio;
	/** Optional caption rendered under the frame inside the same measure. */
	caption?: ReactNode;
	className?: string;
	children?: ReactNode;
}

export function MediaFrame({ ratio = '16/9', caption, className, children }: MediaFrameProps) {
	return (
		<figure className={cx(css({ margin: '0' }), className)}>
			<div
				className={css({
					position: 'relative',
					width: '100%',
					aspectRatio: RATIO_MAP[ratio],
					backgroundColor: 'bg.subtle',
					borderRadius: 'md',
					overflow: 'hidden',
				})}
			>
				{children}
			</div>
			{caption ? (
				<figcaption
					className={css({
						marginBlockStart: '2',
						fontSize: 'sm',
						lineHeight: '1.6',
						color: 'text.muted',
					})}
				>
					{caption}
				</figcaption>
			) : null}
		</figure>
	);
}
