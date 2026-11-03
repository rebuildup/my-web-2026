import type { CSSProperties } from 'react';
import { css } from '../../../../styled-system/css';

/**
 * InteractiveStates — `<a>` and `<button>` samples at default /
 * hover / focus / pressed so a designer can audit how the semantic
 * tokens translate into a real interaction.
 *
 * The state matrix is rendered as a static grid: every state for
 * every element type is its own cell. Each cell renders the real
 * element with the matching CSS override applied as inline style,
 * so the visitor sees the state without having to hover / focus /
 * press anything. The override resolves the same semantic tokens
 * (`signal.actionActive`, `border.strong`, `surface.raised`,
 * `border.focus`) the live `:hover` / `:active` /
 * `:focus-visible` rule would have applied — the demo is honest
 * about which token is doing the work.
 *
 * Tokens consumed:
 *
 *   - `signal.action`        primary CTA fill, idle.
 *   - `signal.actionActive`  CTA fill on hover / pressed / focus.
 *   - `text.inverse`         CTA foreground.
 *   - `surface.control`      secondary CTA fill, idle.
 *   - `text.default` / `surface.canvas`  secondary CTA ink inversion on hover.
 *   - `signal.actionActive`  secondary CTA fill on press.
 *   - `border.focus`         keyboard focus ring.
 *   - `text.accent`          inline link text.
 *
 * Issue #764 (direction B): the secondary CTA now rests on
 * `surface.control`, the role that means "a pressable fill" — a fill
 * that gains contrast against the ground without a border. The
 * previous fill (`surface.sunken`) still worked, but it named a
 * recessed region, not a control; the two roles share a neighbourhood
 * on the ladder and should not share a name. The outline is still
 * gone: the button is identified by fill alone, the hover inverts to
 * ink, and the press uses the operation hue. `border.focus` stays,
 * because a keyboard focus ring is a focus indicator, not a surface
 * divider.
 *
 * IMPORTANT: the inline `style` override does NOT bypass the
 * token layer. Each override still resolves to the same hex
 * Panda would have used, but the override uses the raw CSS
 * variable names (`var(--colors-…)`) so the demo follows the
 * actual rendered palette rather than the JS-side token path.
 */

export function InteractiveStates() {
	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '10',
			})}
		>
			<Row
				label="Primary CTA — anchor"
				caption="<a> filled with signal.action (idle) → signal.actionActive (hover / pressed) → outline 2px border.focus (focus)"
				overrides={primaryOverrides}
				render={(state) => (
					<a
						href="#design-system-cta-anchor"
						data-state={state}
						data-element="cta-primary"
						className={ctaPrimaryClass()}
						style={primaryOverrides[state]}
					>
						Primary CTA
					</a>
				)}
			/>
			<Row
				label="Secondary — anchor"
				caption="<a> filled with surface.control, color text.default → ink inversion on hover → signal.actionActive on press. No border."
				overrides={secondaryOverrides}
				render={(state) => (
					<a
						href="#design-system-secondary-anchor"
						data-state={state}
						data-element="cta-secondary"
						className={ctaSecondaryClass()}
						style={secondaryOverrides[state]}
					>
						Secondary
					</a>
				)}
			/>
			<Row
				label="Primary CTA — button"
				caption="<button type=button> same CTA contract as the anchor above, equivalent activation."
				overrides={primaryOverrides}
				render={(state) => (
					<button
						type="button"
						data-state={state}
						data-element="cta-primary"
						className={ctaPrimaryClass()}
						style={primaryOverrides[state]}
					>
						Primary CTA
					</button>
				)}
			/>
			<Row
				label="Inline link"
				caption="<a> rendered as text.accent with underline-on-hover. No fill, no border — minimal chrome."
				overrides={inlineLinkOverrides}
				render={(state) => (
					<a
						href="#design-system-inline-link"
						data-state={state}
						data-element="inline-link"
						className={inlineLinkClass()}
						style={inlineLinkOverrides[state]}
					>
						Inline link
					</a>
				)}
			/>
		</div>
	);
}

type State = 'default' | 'hover' | 'pressed' | 'focus';
type OverrideMap = Record<State, CSSProperties>;

/**
 * Inline-style overrides per state. The override uses the same
 * Panda semantic tokens (resolved to CSS variables at codegen time)
 * so the demo cell renders exactly what the live interaction would
 * render.
 */
const primaryOverrides: OverrideMap = {
	default: {},
	hover: { backgroundColor: 'var(--colors-signal-action-active)' },
	pressed: { backgroundColor: 'var(--colors-signal-action-active)' },
	focus: {
		outline: '2px solid var(--colors-border-focus)',
		outlineOffset: '2px',
	},
};

const secondaryOverrides: OverrideMap = {
	default: {},
	hover: {
		backgroundColor: 'var(--colors-text-default)',
		color: 'var(--colors-surface-canvas)',
	},
	pressed: {
		backgroundColor: 'var(--colors-signal-action-active)',
		color: 'var(--colors-text-inverse)',
	},
	focus: {
		outline: '2px solid var(--colors-border-focus)',
		outlineOffset: '2px',
	},
};

const inlineLinkOverrides: OverrideMap = {
	default: {},
	hover: { textDecoration: 'underline' },
	pressed: { textDecoration: 'underline' },
	focus: {
		outline: '2px solid var(--colors-border-focus)',
		outlineOffset: '2px',
	},
};

interface RowProps {
	label: string;
	caption: string;
	overrides: OverrideMap;
	render: (state: State) => React.ReactNode;
}

function Row({ label, caption, render }: RowProps) {
	return (
		<section
			className={css({
				// Issue #804: the hairline above each row was another
				// border doing a layout job. The rows are separated by
				// the parent's `gap` and this header-to-samples gap
				// only; no divider is drawn.
				display: 'flex',
				flexDirection: 'column',
				gap: '6',
			})}
		>
			<header
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					{label}
				</span>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{caption}
				</p>
			</header>
			<div
				className={css({
					display: 'grid',
					// Issue #300: a fixed 4-column row put the state
					// buttons at ~77px each at 375px while the button
					// itself needs ~106px — the page grew to 388px and
					// scrolled sideways. Two columns until `md`, four
					// once the span has room.
					gridTemplateColumns: {
						base: 'repeat(2, minmax(0, 1fr))',
						md: 'repeat(4, minmax(0, 1fr))',
					},
					gap: '3',
					alignItems: 'center',
				})}
			>
				{(['default', 'hover', 'pressed', 'focus'] as const).map((state) => (
					<div
						key={state}
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '2',
							alignItems: 'flex-start',
						})}
					>
						<span
							aria-hidden="true"
							className={css({
								fontFamily: 'mono',
								fontSize: 'xs',
								letterSpacing: '0.06em',
								textTransform: 'uppercase',
								color: 'text.muted',
							})}
						>
							{state}
						</span>
						{render(state)}
					</div>
				))}
			</div>
		</section>
	);
}

function ctaPrimaryClass() {
	return css({
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '2',
		paddingBlock: '2',
		paddingInline: '4',
		borderRadius: 'md',
		borderWidth: '0',
		borderStyle: 'solid',
		backgroundColor: 'signal.action',
		color: 'text.inverse',
		fontFamily: 'sans',
		fontSize: 'sm',
		fontWeight: '600',
		textDecoration: 'none',
		cursor: 'pointer',
		_hover: {
			backgroundColor: 'signal.actionActive',
		},
		_active: {
			backgroundColor: 'signal.actionActive',
		},
		_focusVisible: {
			outline: '2px solid {colors.border.focus}',
			outlineOffset: '2px',
		},
	});
}

function ctaSecondaryClass() {
	return css({
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '2',
		paddingBlock: '2',
		paddingInline: '4',
		borderRadius: 'md',
		// Issue #764: fill, not outline, and the fill names the role.
		// `surface.control` gains contrast against the ground in both
		// appearances, so the button is identifiable at rest without a
		// border; hover and press each move one step further from it.
		borderWidth: '0',
		borderStyle: 'solid',
		backgroundColor: 'surface.control',
		color: 'text.default',
		fontFamily: 'sans',
		fontSize: 'sm',
		fontWeight: '600',
		textDecoration: 'none',
		cursor: 'pointer',
		_hover: {
			backgroundColor: 'text.default',
			color: 'surface.canvas',
		},
		_active: {
			backgroundColor: 'signal.actionActive',
			color: 'text.inverse',
		},
		_focusVisible: {
			outline: '2px solid {colors.border.focus}',
			outlineOffset: '2px',
		},
	});
}

function inlineLinkClass() {
	return css({
		display: 'inline-flex',
		alignItems: 'baseline',
		gap: '1',
		color: 'text.accent',
		fontFamily: 'sans',
		fontSize: 'md',
		textDecoration: 'none',
		_hover: {
			textDecoration: 'underline',
		},
		_focusVisible: {
			outline: '2px solid {colors.border.focus}',
			outlineOffset: '2px',
		},
	});
}
