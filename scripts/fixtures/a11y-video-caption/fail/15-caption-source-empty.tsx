/**
 * FAIL fixture — a playable video whose caption source is a placeholder.
 *
 * WCAG 2.2 SC 1.2.2 (A): the video DECLARES
 * `data-caption-status="verified"`, but the file the caption track points
 * at carries the `WEBVTT` header and no cue, so it is a placeholder
 * rather than a caption track. The gate could not VERIFY it. This file
 * must report exactly `video-caption-source-unverified`.
 */
export const CaptionSourceEmpty = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose caption file carries no cue"
		data-caption-status="verified"
		data-audio-description-status="not-required"
		src="/media/portfolio/example.mp4"
	>
		<track
			kind="captions"
			src="scripts/fixtures/a11y-video-caption/captions/placeholder.vtt"
			srcLang="en"
			label="English"
		/>
	</video>
);
