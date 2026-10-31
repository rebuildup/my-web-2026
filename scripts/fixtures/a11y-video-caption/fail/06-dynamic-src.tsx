/**
 * FAIL fixture — a video whose `src` is a runtime value.
 *
 * WCAG 2.2 SC 1.2.2 (A): the gate cannot tell whether `src={clipUrl}` points
 * at media, so the video is judged as PLAYABLE and the caption / controls /
 * audio-description rules apply to it. Reading "the `src` is dynamic" as
 * "the video cannot play" would let a work with no captions pass as
 * playable. This file must report exactly `video-without-caption-track`.
 */
const clipUrl = '/media/portfolio/example.mp4';

export const DynamicSrcVideo = () => (
	// biome-ignore lint/a11y/useMediaCaption: this fixture reproduces the defect the gate rejects.
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose source is a runtime value"
		data-audio-description-status="not-required"
		src={clipUrl}
	/>
);
