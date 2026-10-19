import type { ReactNode } from 'react';
import { css } from '../styled-system/css';

/**
 * MonochromeProof — the greyscale wrapper the Issue #411
 * verification fixtures render their subject in.
 *
 * What it is for
 * --------------
 * WCAG 2.2 SC 1.4.1 Use of Color (Level A) says colour must not be
 * the only visual means of conveying information. The property that
 * has to hold is therefore a NEGATIVE one: take the hue away and the
 * information must survive. Greyscale is the cheap, deterministic
 * approximation of that removal — it is not a colour-vision-
 * deficiency simulator, and it is not Windows High Contrast. What it
 * does prove is that no state on the surface depends on hue at all:
 * if two states are still identical here, the only thing separating
 * them was colour.
 *
 * It lives in `.storybook/` rather than in `src/` because it is a
 * FIXTURE concern shared by two obligations (home status, portfolio
 * category) and never ships. The obligation that owns a surface still
 * owns that surface's own markup; this only decides how the proof is
 * displayed.
 *
 * The caption is rendered inside the filtered subtree: greyscale
 * does not cost legibility, and keeping the whole frame — canvas,
 * rule, marks, caption — in one appearance is what lets the
 * committed capture be checked mechanically (every pixel of the
 * frame must be `r === g === b`).
 */
export function MonochromeProof({ children, caption }: { children: ReactNode; caption: string }) {
	return (
		<div
			data-monochrome-proof="true"
			/*
			 * An inline style, not a Panda utility: Panda's `filter`
			 * recipe expects named filter functions
			 * (`{ grayscale: '…' }`) and silently drops a raw
			 * `grayscale(1)` string, which would leave the proof
			 * rendering in full colour while still looking like it
			 * had been applied. Greyscale only —
			 * `contrast()` / `invert()` would change perceived
			 * contrast and make the capture a different claim than
			 * the one being made.
			 */
			style={{ filter: 'grayscale(1)' }}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '4',
				padding: '6',
				backgroundColor: 'bg.canvas',
				color: 'text.default',
			})}
		>
			<p
				className={css({
					margin: '0',
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				{caption}
			</p>
			{children}
		</div>
	);
}
