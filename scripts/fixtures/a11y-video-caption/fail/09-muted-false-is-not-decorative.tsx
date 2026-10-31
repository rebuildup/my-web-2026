/**
 * FAIL fixture — a video that is hidden from assistive technology but NOT
 * silenced.
 *
 * WCAG 2.2 SC 1.2.2 (A): the decorative exemption needs BOTH `muted` AND a
 * mark that hides the video from assistive technology. `muted={false}` is a
 * decision the author made, so the video still makes sound and it is NOT
 * decorative: the caption / controls / audio-description rules apply to it.
 * The file reports exactly `video-without-controls` — the missing controls
 * is the first thing the exemption used to hide.
 */
export const MutedFalseIsNotDecorativeVideo = () => (
	// biome-ignore lint/a11y/noAriaHiddenOnFocusable: this fixture reproduces the defect the gate rejects — the video is hidden from assistive technology but still makes sound.
	<video
		muted={false}
		aria-hidden="true"
		poster="/media/portfolio/example-poster.webp"
		aria-label="A clip that is hidden from assistive technology but still makes sound"
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
