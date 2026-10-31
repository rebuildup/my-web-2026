/**
 * FAIL fixture — a playable video with no playback controls.
 *
 * WCAG 2.2 SC 2.1.1 (A): without `controls` there is no keyboard-operable
 * way to start, pause or seek the video. Captions and audio description are
 * declared, so this file reports exactly `video-without-controls`.
 */
export const WithoutControls = () => (
	<video
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording with no controls"
		data-caption-status="verified"
		data-audio-description-status="provided"
	>
		<source src="/media/portfolio/example.mp4" type="video/mp4" />
		<track
			kind="captions"
			src="scripts/fixtures/a11y-video-caption/captions/example.en.vtt"
			srcLang="en"
			label="English"
		/>
		<track
			kind="descriptions"
			src="scripts/fixtures/a11y-video-caption/captions/example.en.desc.vtt"
			srcLang="en"
			label="Audio description"
		/>
	</video>
);
