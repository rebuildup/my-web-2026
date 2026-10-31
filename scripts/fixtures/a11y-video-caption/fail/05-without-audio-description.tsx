/**
 * FAIL fixture — a playable video with no audio-description disposition.
 *
 * WCAG 2.2 SC 1.2.3 (A) / SC 1.2.5 (AA): the video declares captions,
 * controls, a poster and an accessible name, but nothing about audio
 * description. The gate is fail-closed: it does not accept the absence of a
 * decision, and it does not accept `not-required` without a human saying so.
 * This file must report exactly `video-without-audio-description`.
 */
export const WithoutAudioDescription = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A work without an audio-description disposition"
		data-caption-status="verified"
	>
		<source src="/media/portfolio/example.mp4" type="video/mp4" />
		<track
			kind="captions"
			src="scripts/fixtures/a11y-video-caption/captions/example.en.vtt"
			srcLang="en"
			label="English"
		/>
	</video>
);
