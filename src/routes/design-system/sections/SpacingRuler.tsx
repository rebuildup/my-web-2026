import { css } from '../../../../styled-system/css';
import { spacingTokens } from '../../../editorial/tokens';

/**
 * SpacingRuler — visual bars showing the spacing scale declared in
 * `src/editorial/tokens.ts#spacing`.
 *
 * The scale steps at roughly 1.618x (golden ratio) so the contrast
 * between the small clusters (`4`/`8` px) and the page-level beats
 * (`96`/`128` px) is dramatic. Each bar in the ruler maps a raw
 * `spacing.*` token to its resolved px value so a designer can pick a
 * tier by visual weight rather than by memorizing the scale.
 *
 * Issue #804 (owner feedback, 2026-11-01): the bars did not share a
 * left edge. The label column was `minmax(7.5rem, auto)`, so a row
 * whose role sentence was wider than 7.5rem pushed its own bar to the
 * right and every bar started at a different x. The column is now a
 * fixed `10rem` at `md` and above, so all eight bars begin on the
 * same vertical line; below `md` the label stacks above the bar and
 * every bar starts at the container's left edge. The bar's 1px
 * `border.subtle` outline is gone — the fill alone carries the bar,
 * as the owner's grid rule requires. The fill moved from
 * `accent.surface` (a near-canvas tint that only read as a bar
 * *because* of its outline) to `border.strong`, the editorial
 * neutral measured for emphasis rules: with no outline the bar has to
 * carry its own contrast, and `border.strong` keeps it visible in
 * both appearances without adding a colour.
 */

interface SpacingEntry {
	token: keyof typeof spacingTokens;
	label: string;
	role: string;
}

const STEPS: ReadonlyArray<SpacingEntry> = [
	{ token: 1, label: '1', role: 'decoration on title, ordinal gap' },
	{ token: 2, label: '2', role: 'tight cluster, sibling gap' },
	{ token: 4, label: '4', role: 'cluster close, body block end' },
	{ token: 6, label: '6', role: 'cluster separator, column gap' },
	{ token: 10, label: '10', role: 'section block end, list gap' },
	{ token: 16, label: '16', role: 'section padding' },
	{ token: 24, label: '24', role: 'page-level beat' },
	{ token: 32, label: '32', role: 'hero entry breath' },
];

export function SpacingRuler() {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'grid',
				gridTemplateColumns: '1fr',
				rowGap: '3',
			})}
		>
			{STEPS.map((step) => (
				<SpacingRow key={step.token} step={step} />
			))}
		</ul>
	);
}

function SpacingRow({ step }: { step: SpacingEntry }) {
	const raw = spacingTokens[step.token];
	const pxValue = raw?.value ?? '0';
	return (
		<li
			className={css({
				display: 'grid',
				// Fixed gutter: every bar in the ruler starts at the same x.
				// `minmax(7.5rem, auto)` let a wide role sentence widen its own
				// row, which is what made the left edges ragged (Issue #804).
				gridTemplateColumns: { base: '1fr', md: '10rem minmax(0, 1fr)' },
				columnGap: { base: '0', md: '6' },
				rowGap: { base: '1', md: '0' },
				alignItems: 'center',
			})}
		>
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
					minWidth: '0',
				})}
			>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
						color: 'text.default',
						whiteSpace: 'nowrap',
					})}
				>
					spacing.{step.label} · {pxValue}
				</code>
				<span
					className={css({
						fontFamily: 'sans',
						fontSize: 'xs',
						color: 'text.muted',
					})}
				>
					{step.role}
				</span>
			</div>
			<div
				aria-hidden="true"
				className={css({
					height: '2',
					borderRadius: 'sm',
					backgroundColor: 'border.strong',
				})}
				data-spacing-token={step.token}
				data-spacing-value={pxValue}
				style={{ width: pxValue }}
			/>
		</li>
	);
}
