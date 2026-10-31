/**
 * FAIL fixture — a video whose attributes are spread in.
 *
 * WCAG 2.2 SC 2.1.1 (A): `{...props}` can carry `controls` (and `muted`,
 * and `aria-hidden`), so the gate cannot certify that a keyboard user can
 * start, pause or seek the video. JSX lets a later prop win, so the
 * attributes written AFTER the spread are final — but an attribute the
 * spread may still carry is undecided, and an undecided value is judged in
 * the safe direction. This file must report exactly `video-without-controls`.
 */
type VideoProps = {
	controls?: boolean;
	muted?: boolean;
};

export const SpreadAttributesVideo = ({ ...props }: VideoProps) => (
	<video
		{...props}
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose attributes are spread in"
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
