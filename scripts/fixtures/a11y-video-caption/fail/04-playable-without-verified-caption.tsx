/**
 * FAIL fixture — a playable video whose caption source is not verified.
 *
 * WCAG 2.2 SC 1.2.2 (A): the video carries a `<track kind="captions">` but
 * does not declare `data-caption-status="verified"`, so a work whose
 * caption source is undetermined is presented as playable. The gate is
 * fail-closed: absence of the marker is not evidence. The audio-description
 * disposition is declared, so this file reports exactly
 * `video-playable-without-verified-caption`.
 */
export const PlayableWithoutVerifiedCaption = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose caption source is unconfirmed"
		data-audio-description-status="provided"
	>
		<source src="/media/portfolio/example.mp4" type="video/mp4" />
		<track
			kind="captions"
			src="/media/portfolio/example.pending.vtt"
			srcLang="en"
			label="English"
		/>
		<track
			kind="descriptions"
			src="/media/portfolio/example.en.desc.vtt"
			srcLang="en"
			label="Audio description"
		/>
	</video>
);
