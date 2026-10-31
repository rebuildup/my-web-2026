/**
 * FAIL fixture — a video whose `controls` is explicitly off.
 *
 * WCAG 2.2 SC 2.1.1 (A): `controls={false}` is a decision the author made,
 * so the video has no playback controls and a keyboard user cannot start,
 * pause or seek it. The attribute being PRESENT is not the same as the
 * control being ON. This file must report exactly `video-without-controls`.
 */
export const ControlsFalseVideo = () => (
	<video
		controls={false}
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose controls are explicitly off"
		data-caption-status="verified"
		data-audio-description-status="not-required"
		src="/media/portfolio/example.mp4"
	>
		<track kind="captions" src="/media/portfolio/example.en.vtt" srcLang="en" label="English" />
	</video>
);
