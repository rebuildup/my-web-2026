/**
 * FAIL fixture — a playable video whose caption source is a remote URL.
 *
 * WCAG 2.2 SC 1.2.2 (A): a caption `src` on another host is not a file of
 * this repository, and a static gate cannot fetch it, so the caption
 * source is UNDECIDABLE. An undecidable source is not a verified one, and
 * the gate is fail-closed. This file must report exactly
 * `video-caption-source-unverified`.
 */
export const CaptionSourceRemote = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose caption source is a remote URL"
		data-caption-status="verified"
		data-audio-description-status="not-required"
		src="/media/portfolio/example.mp4"
	>
		<track
			kind="captions"
			src="https://cdn.example.com/media/portfolio/example.en.vtt"
			srcLang="en"
			label="English"
		/>
	</video>
);
