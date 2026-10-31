/**
 * PASS fixture — a decorative background video.
 *
 * WCAG 2.2 SC 1.1.1 (A): a video that carries no information of its own is
 * exempt from captions, audio description and controls only when it is BOTH
 * silenced (`muted`) and hidden from assistive technology
 * (`aria-hidden="true"`). This file must produce NO violation.
 */
export const DecorativeVideo = () => (
	// biome-ignore lint/a11y/useMediaCaption: decorative background video — no speech to caption.
	// biome-ignore lint/a11y/noAriaHiddenOnFocusable: the video has no controls, so it is not focusable.
	<video muted aria-hidden="true" autoPlay loop playsInline>
		<source src="/media/portfolio/background.mp4" type="video/mp4" />
	</video>
);
