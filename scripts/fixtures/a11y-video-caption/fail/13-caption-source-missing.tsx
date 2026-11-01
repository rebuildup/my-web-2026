/**
 * FAIL fixture — a playable video whose caption source does not exist.
 *
 * WCAG 2.2 SC 1.2.2 (A): the video DECLARES
 * `data-caption-status="verified"`, but the file the caption track points
 * at is not in the repository, so the gate could not VERIFY the caption
 * source. A declaration is not a proof: the gate is fail-closed, and a
 * caption delivery it cannot read is not a verified caption delivery.
 * This file must report exactly `video-caption-source-unverified`.
 */
export const CaptionSourceMissing = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose caption file does not exist"
		data-caption-status="verified"
		data-audio-description-status="not-required"
		src="/media/portfolio/example.mp4"
	>
		<track
			kind="captions"
			src="scripts/fixtures/a11y-video-caption/captions/does-not-exist.vtt"
			srcLang="en"
			label="English"
		/>
	</video>
);
