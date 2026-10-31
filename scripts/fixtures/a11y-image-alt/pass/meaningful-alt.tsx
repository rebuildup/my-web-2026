/**
 * PASS fixture — a meaningful image.
 *
 * WCAG 2.2 SC 1.1.1 (A): an image that carries information carries an `alt`
 * that says what it carries. This file must produce NO violation.
 */
export const MeaningfulAlt = () => (
	<figure>
		<img
			src="/media/portfolio/example-terminal.png"
			alt="A terminal window showing a completed production build log"
			width={640}
			height={360}
		/>
		<figcaption>An example production build</figcaption>
	</figure>
);
