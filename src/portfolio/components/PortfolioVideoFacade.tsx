import { css, cx } from '../../../styled-system/css';
import type { PortfolioVideo } from '../video-facade';

/**
 * Direct YouTube embed (Issue #870; click-to-load removed per owner
 * decision 2026-11-05, Issue #910).
 *
 * The detail page composes this in place of a bare §07 link when the
 * project has a `kind: 'video'` row whose URL `video-facade.ts` could
 * validate. The frame mounts on first paint: no activation control,
 * no consent interruption.
 *
 * What stays from the #870 contract — the parts that made the embed
 * safe, not the parts that made it lazy:
 *
 *   - `src` is built from the validated 11-character id by
 *     `composeVideoEmbedUrl`, never copied from the stored URL;
 *   - the embed origin is `youtube-nocookie.com`, always https;
 *   - `referrerpolicy="strict-origin-when-cross-origin"`,
 *   - `allow="accelerometer; encrypted-media; picture-in-picture"`
 *     and no `autoplay`,
 *   - `loading="lazy"` so the frame's request starts when it
 *     approaches the viewport.
 *
 * No `sandbox` attribute: the framed document is YouTube's own player,
 * and the sandbox grammar in this repository (`src/tools/embed-policy.ts`,
 * ADR-0020) is about Tools this platform serves, not about a third
 * party's player. A sandbox without the tokens the player needs would
 * be a broken control that looks like a security measure.
 */
export interface PortfolioVideoFacadeProps {
	video: PortfolioVideo;
	className?: string;
}

export function PortfolioVideoFacade({ video, className }: PortfolioVideoFacadeProps) {
	const title = video.link.label ?? `YouTube の動画（${video.id}）`;

	return (
		<div className={cx(frameStyle, className)}>
			<iframe
				src={video.embedUrl}
				title={title}
				className={iframeStyle}
				referrerPolicy="strict-origin-when-cross-origin"
				allow="accelerometer; encrypted-media; picture-in-picture"
				loading="lazy"
				allowFullScreen
			/>
		</div>
	);
}

const frameStyle = css({
	position: 'relative',
	width: '100%',
	aspectRatio: '16 / 9',
	backgroundColor: 'bg.subtle',
	borderRadius: '6px',
	overflow: 'hidden',
});

const iframeStyle = css({
	position: 'absolute',
	inset: '0',
	width: '100%',
	height: '100%',
	border: 'none',
});
