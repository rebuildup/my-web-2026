/**
 * FAIL fixture — a video whose attributes are spread in AFTER they are
 * written.
 *
 * WCAG 2.2 SC 1.2.2 / SC 1.1.1 / SC 2.1.1 / SC 1.2.3 (A): JSX lets a later
 * prop win, so `{...props}` may replace every attribute written before it.
 * The gate therefore judges the video in the safe direction: the poster,
 * the name, the controls, the caption status and the audio-description
 * disposition are all undecided, and the video counts as playable. This is
 * the ONE fixture that states more than one rule, because a spread
 * shadows every attribute at once.
 */
type VideoProps = {
	controls?: boolean;
	muted?: boolean;
	poster?: string;
};

export const SpreadOverridesEarlierAttributesVideo = ({ ...props }: VideoProps) => (
	<video
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose attributes are spread over"
		data-caption-status="verified"
		data-audio-description-status="not-required"
		src="/media/portfolio/example.mp4"
		{...props}
	>
		<track
			kind="captions"
			src="scripts/fixtures/a11y-video-caption/captions/example.en.vtt"
			srcLang="en"
			label="English"
		/>
	</video>
);
