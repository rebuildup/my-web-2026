/**
 * PASS fixture — a playable video with captions and audio description.
 *
 * WCAG 2.2 SC 1.2.2 / SC 1.2.3 / SC 1.2.5 / SC 1.1.1 / SC 2.1.1 (A / AA):
 * the video declares `controls`, a `poster` and an accessible name, carries
 * a `<track kind="captions">` with `data-caption-status="verified"` and a
 * `<track kind="descriptions">` with `data-audio-description-status="provided"`.
 * This file must produce NO violation.
 */
export const CaptionedVideo = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording of the MultiSlicer plugin"
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
