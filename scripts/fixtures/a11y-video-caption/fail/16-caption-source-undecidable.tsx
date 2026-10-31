/**
 * FAIL fixture — a playable video whose caption source is a runtime value.
 *
 * WCAG 2.2 SC 1.2.2 (A): the caption `src` is a runtime expression, so
 * the gate cannot read the caption source at all. The source is
 * UNDECIDABLE, and an undecidable source is not a verified one: the gate
 * is fail-closed, so a work whose caption source the gate cannot read
 * must not be presented as playable with verified captions. This file
 * must report exactly `video-caption-source-unverified`.
 */
const captionUrl = '/media/portfolio/example.en.vtt';

export const CaptionSourceUndecidable = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose caption source is a runtime value"
		data-caption-status="verified"
		data-audio-description-status="not-required"
		src="/media/portfolio/example.mp4"
	>
		<track kind="captions" src={captionUrl} srcLang="en" label="English" />
	</video>
);
