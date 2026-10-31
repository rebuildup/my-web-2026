/**
 * FAIL fixture — a video whose `controls` is a runtime value.
 *
 * WCAG 2.2 SC 2.1.1 (A): `controls={isPlaying}` may be off at runtime, so the
 * gate cannot certify that a keyboard user can start, pause or seek the
 * video. An undecided value is judged in the safe direction: the video
 * counts as having no controls. This file must report exactly
 * `video-without-controls`.
 */
const isPlaying = false;

export const DynamicControlsVideo = () => (
	<video
		controls={isPlaying}
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose controls are a runtime value"
		data-caption-status="verified"
		data-audio-description-status="not-required"
		src="/media/portfolio/example.mp4"
	>
		<track
			kind="captions"
			src="scripts/fixtures/a11y-video-caption/captions/example.en.vtt"
			srcLang="en"
			label="English"
		/>
	</video>
);
