/**
 * FAIL fixture — a playable video whose caption source is not WebVTT.
 *
 * WCAG 2.2 SC 1.2.2 (A): the video DECLARES
 * `data-caption-status="verified"`, but the file the caption track points
 * at carries no `WEBVTT` header, so it is not a caption track a browser
 * can render and the gate could not VERIFY it. This file must report
 * exactly `video-caption-source-unverified`.
 */
export const CaptionSourceNotWebvtt = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose caption file is not a WebVTT document"
		data-caption-status="verified"
		data-audio-description-status="not-required"
		src="/media/portfolio/example.mp4"
	>
		<track
			kind="captions"
			src="scripts/fixtures/a11y-video-caption/captions/not-webvtt.vtt"
			srcLang="en"
			label="English"
		/>
	</video>
);
