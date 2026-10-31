/**
 * FAIL fixture — a video whose `muted` is a runtime value.
 *
 * WCAG 2.2 SC 1.2.2 (A): `muted={isMuted}` may be off at runtime, so the
 * gate cannot certify that the video is silent and therefore cannot certify
 * that it is decorative. An undecided value is judged in the safe
 * direction: the video counts as making sound, so the caption / controls /
 * audio-description rules apply to it. This file must report exactly
 * `video-without-controls`.
 */
const isMuted = true;

export const DynamicMutedVideo = () => (
	// biome-ignore lint/a11y/noAriaHiddenOnFocusable: this fixture reproduces the defect the gate rejects — the video may make sound, so the decorative exemption cannot be certified.
	<video
		muted={isMuted}
		aria-hidden="true"
		poster="/media/portfolio/example-poster.webp"
		aria-label="A clip whose mutedness is a runtime value"
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
