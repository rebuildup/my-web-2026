/**
 * PASS fixture — a work whose caption source is not yet confirmed.
 *
 * WCAG 2.2 SC 1.2.2 (A): the work is NOT playable (it has no `src` /
 * `<source>`), so it is not presented as playable while the caption source
 * is undetermined. It still carries a poster and an accessible name — and
 * because it is not playable, no audio-description disposition is demanded
 * yet. This file must produce NO violation.
 */
export const AwaitingCaptionSource = () => (
	<video
		poster="/media/portfolio/example-poster.webp"
		aria-label="A work whose caption source is not yet confirmed"
	>
		<track
			kind="captions"
			src="/media/portfolio/example.pending.vtt"
			srcLang="en"
			label="English"
		/>
	</video>
);
