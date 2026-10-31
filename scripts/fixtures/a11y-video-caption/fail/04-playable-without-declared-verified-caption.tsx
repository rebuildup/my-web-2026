/**
 * FAIL fixture — a playable video that DECLARES no verified caption status.
 *
 * WCAG 2.2 SC 1.2.2 (A): the video carries a `<track kind="captions">` but
 * does not declare `data-caption-status="verified"`, so a work whose
 * caption source is undetermined is presented as playable. The gate is
 * fail-closed: absence of the marker is not evidence. The caption source
 * of this fixture IS a verified one (the gate reads the file), so the
 * only thing this file proves is the missing DECLARATION. The
 * audio-description disposition is declared, so this file reports exactly
 * `video-playable-without-declared-verified-caption`.
 */
export const PlayableWithoutDeclaredVerifiedCaption = () => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose caption source is unconfirmed"
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
