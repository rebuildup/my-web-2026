import { css } from '../../../../styled-system/css';
import { rawTokens } from '../../../editorial/tokens';

/**
 * SpacingRuler — visual bars showing the spacing scale declared in
 * `src/editorial/tokens.ts#spacing`.
 *
 * The scale steps at roughly 1.618x (golden ratio) so the contrast
 * between the small clusters (`4`/`8` px) and the page-level beats
 * (`96`/`128` px) is dramatic. Each bar in the ruler maps a hex
 * value to one raw `spacing.*` token (and its resolved px value)
 * so a designer can pick a tier by visual weight rather than by
 * memorizing the scale.
 *
 * Bars are drawn as a fixed-height stripe at the resolved width.
 * The token name and the resolved px value sit in the gutter so
 * both the abstract reference and the concrete value are visible
 * at once.
 */

interface SpacingEntry {
	token: keyof typeof rawTokens.spacing;
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
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
			})}
		>
			{STEPS.map((step) => (
				<SpacingRow key={step.token} step={step} />
			))}
		</ul>
	);
}

function SpacingRow({ step }: { step: SpacingEntry }) {
	const raw = rawTokens.spacing[step.token];
	const pxValue = raw?.value ?? '0';
	return (
		<li
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'minmax(7.5rem, auto) minmax(0, 1fr)' },
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
				})}
			>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
						color: 'text.default',
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
					backgroundColor: 'accent.surface',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: 'border.subtle',
				})}
				data-spacing-token={step.token}
				data-spacing-value={pxValue}
				style={{ width: pxValue }}
			/>
		</li>
	);
}
