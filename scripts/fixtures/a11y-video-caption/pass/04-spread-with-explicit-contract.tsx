/**
 * PASS fixture — a video that spreads attributes in, and then writes the
 * contract explicitly.
 *
 * WCAG 2.2 SC 1.2.2 / SC 1.2.3 / SC 1.2.5 / SC 1.1.1 / SC 2.1.1 (A / AA):
 * JSX lets a later prop win, so the attributes written AFTER the spread are
 * final. The video declares `controls`, a `poster` and an accessible name,
 * carries a `<track kind="captions">` with `data-caption-status="verified"`
 * and declares `data-audio-description-status="not-required"`, so this file
 * must produce NO violation.
 */
type VideoProps = {
	controls?: boolean;
	muted?: boolean;
};

export const SpreadAttributesWithExplicitContractVideo = ({ ...props }: VideoProps) => (
	<video
		{...props}
		controls
		poster="/media/portfolio/example-poster.webp"
		aria-label="A screen recording whose contract is written explicitly"
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
