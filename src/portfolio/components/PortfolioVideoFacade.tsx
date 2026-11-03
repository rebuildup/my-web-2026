import { useState } from 'react';
import { css, cx } from '../../../styled-system/css';
import type { PortfolioVideo } from '../video-facade';

/**
 * Click-to-load YouTube facade (Issue #870).
 *
 * The detail page composes this in place of a bare §07 link when the
 * project has a `kind: 'video'` row whose URL `video-facade.ts` could
 * validate.
 *
 * The contract is structural, not editorial: before activation this
 * component renders **no iframe and no image from a third-party
 * origin**, so "zero third-party requests on first paint" is a
 * property of the markup rather than a promise in the copy. That is
 * the same rule `/tools/<slug>` already implements
 * (`src/tools/embed-consent-notice.tsx`, Issue #498); this component
 * is Portfolio's own surface, not a shared abstraction, because the
 * two obligations answer different questions — a Tool frame is a
 * whole application, a Portfolio video is one play affordance.
 *
 * Pressing the button counts as consent, and the source is named
 * BEFORE the press: the notice says the video is delivered by YouTube
 * and the id is printed next to the control. Nothing is persisted —
 * no cookie, no `localStorage` — so a reload asks again. The privacy
 * notice (`src/privacy/data-lifecycle.ts`) therefore does not have to
 * describe a new stored value.
 *
 * The frame itself:
 *   - `src` is built from the validated 11-character id by
 *     `composeVideoEmbedUrl`, never copied from the stored URL;
 *   - `referrerpolicy="strict-origin-when-cross-origin"`,
 *   - `allow="accelerometer; encrypted-media; picture-in-picture"`
 *     and no `autoplay`,
 *   - `loading="lazy"` so the activation request starts when the frame
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
	const [activated, setActivated] = useState(false);
	const title = video.link.label ?? `YouTube の動画（${video.id}）`;

	if (activated) {
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

	return (
		<div className={cx(panelStyle, className)}>
			<p className={noticeStyle} id="portfolio-video-notice">
				この動画は YouTube から配信されます。押すまで YouTube への要求は送信しません。
			</p>
			<p className={metaStyle}>
				<span>YouTube</span>
				<span aria-hidden="true">·</span>
				<code className={idStyle}>{video.id}</code>
			</p>
			<div className={controlsStyle}>
				<button
					type="button"
					onClick={() => setActivated(true)}
					aria-describedby="portfolio-video-notice"
					className={buttonStyle}
				>
					動画を読み込む
				</button>
				<a href={video.watchUrl} target="_blank" rel="noopener noreferrer" className={linkStyle}>
					YouTube で開く
				</a>
			</div>
		</div>
	);
}

const panelStyle = css({
	margin: '0',
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	padding: '6',
	backgroundColor: 'bg.subtle',
	borderRadius: '6px',
});

const noticeStyle = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
	lineHeight: '1.6',
	maxWidth: '60ch',
});

const metaStyle = css({
	margin: '0',
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const idStyle = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: 'normal',
	textTransform: 'none',
});

const controlsStyle = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '4',
});

const buttonStyle = css({
	appearance: 'none',
	cursor: 'pointer',
	paddingInline: '5',
	paddingBlock: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.inverse',
	backgroundColor: 'bg.accent',
	borderRadius: '4px',
	_hover: {
		backgroundColor: 'accent.interactive',
	},
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const linkStyle = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.accent',
	textDecoration: 'underline',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

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
