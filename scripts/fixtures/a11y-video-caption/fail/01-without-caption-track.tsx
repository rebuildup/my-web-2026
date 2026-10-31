/**
 * FAIL fixture — a playable video with no caption track.
 *
 * WCAG 2.2 SC 1.2.2 (A): the spoken content is not captioned. A `<track>`
 * whose `kind` is omitted defaults to `subtitles`, so only an explicit
 * `kind="captions"` counts. The audio-description disposition is declared,
 * so this file reports exactly `video-without-caption-track`.
 */
export const WithoutCaptionTrack = () => (
	// biome-ignore lint/a11y/useMediaCaption: this fixture reproduces the defect the gate rejects.
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording with no captions"
		data-audio-description-status="provided"
	>
		<source src="/media/portfolio/example.mp4" type="video/mp4" />
		<track
			kind="descriptions"
			src="scripts/fixtures/a11y-video-caption/captions/example.en.desc.vtt"
			srcLang="en"
			label="Audio description"
		/>
	</video>
);
