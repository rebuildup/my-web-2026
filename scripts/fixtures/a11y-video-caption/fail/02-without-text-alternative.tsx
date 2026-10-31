/**
 * FAIL fixture — a playable video with no static / text alternative.
 *
 * WCAG 2.2 SC 1.1.1 (A): the video declares no `poster` and no accessible
 * name, so a reader who cannot play it has nothing to read. Captions and
 * audio description are declared, so this file reports exactly
 * `video-without-text-alternative`.
 */
export const WithoutTextAlternative = () => (
	<video controls data-caption-status="verified" data-audio-description-status="provided">
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
