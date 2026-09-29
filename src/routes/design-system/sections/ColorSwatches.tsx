import { css } from '../../../../styled-system/css';
import { rawTokens } from '../../../editorial/tokens';

/**
 * ColorSwatches — every editorial semantic token rendered in a 4-column
 * grid, with each tile displayed against BOTH a light surface (`bg.canvas`)
 * and a dark surface (`bg.inverse`).
 *
 * The light / dark pair is the educational point of the section:
 *
 *   - `accent.*` semantic tokens carry `{ base, _dark }` values per
 *     `src/editorial/semantic-tokens.ts`. The dark variant only
 *     activates when a dark mode is bound (currently deferred per
 *     `colors.md`); on this page we render the dark variant explicitly
 *     in the right pane so the visitor can see the contrast pair
 *     regardless of the current OS theme.
 *   - `bg.*` / `text.*` / `border.*` are mode-agnostic today; they
 *     compose correctly in either mode. They are shown here so a
 *     designer can audit the full semantic surface in one glance.
 *
 * The hex values shown alongside each token name are derived from
 * the raw layer (`src/editorial/tokens.ts`) at render time — the
 * data flows through the SAME source the Panda config consumes, so
 * the displayed hex cannot drift from the rendered token.
 */

interface TokenEntry {
	/** Semantic path, e.g. `accent.positive`. */
	path: string;
	/** Human-readable label, e.g. `Positive` / `Border subtle`. */
	label: string;
	/** Raw palette family + step that powers `base`, e.g. `positive.700`. */
	rawLightRef: string;
	/** Raw palette family + step that powers `_dark`, when one is declared. */
	rawDarkRef: string | null;
	/** Plain-English role description from `colors.md`. */
	role: string;
}

/**
 * Canonical catalog. Order is editorial, not alphabetic — surface
 * tokens first, then status, then category. The order mirrors the
 * table in `src/editorial/colors.md` so a reader cross-referencing
 * the guide finds the same row.
 */
const TOKENS: ReadonlyArray<TokenEntry> = [
	// Page surfaces (bg.*)
	{
		path: 'bg.canvas',
		label: 'Canvas',
		rawLightRef: 'neutral.0',
		rawDarkRef: null,
		role: 'Page background',
	},
	{
		path: 'bg.surface',
		label: 'Surface',
		rawLightRef: 'neutral.50',
		rawDarkRef: null,
		role: 'Card surface (default)',
	},
	{
		path: 'bg.subtle',
		label: 'Subtle',
		rawLightRef: 'neutral.100',
		rawDarkRef: null,
		role: 'Tinted separator',
	},
	{
		path: 'bg.accent',
		label: 'Accent fill',
		rawLightRef: 'brand.500',
		rawDarkRef: null,
		role: 'Primary CTA idle',
	},
	// Text (text.*)
	{
		path: 'text.default',
		label: 'Default',
		rawLightRef: 'neutral.900',
		rawDarkRef: null,
		role: 'Body text',
	},
	{
		path: 'text.muted',
		label: 'Muted',
		rawLightRef: 'neutral.500',
		rawDarkRef: null,
		role: 'Secondary text',
	},
	{
		path: 'text.accent',
		label: 'Accent text',
		rawLightRef: 'brand.600',
		rawDarkRef: null,
		role: 'Inline link',
	},
	{
		path: 'text.inverse',
		label: 'Inverse',
		rawLightRef: 'neutral.0',
		rawDarkRef: null,
		role: 'Text on accent fill',
	},
	// Borders (border.*)
	{
		path: 'border.subtle',
		label: 'Subtle',
		rawLightRef: 'neutral.100',
		rawDarkRef: null,
		role: 'Default divider',
	},
	{
		path: 'border.strong',
		label: 'Strong',
		rawLightRef: 'neutral.500',
		rawDarkRef: null,
		role: 'Emphasis divider',
	},
	{
		path: 'border.focus',
		label: 'Focus ring',
		rawLightRef: 'brand.500',
		rawDarkRef: null,
		role: 'Focus outline',
	},
	// Accent features (accent.*)
	{
		path: 'accent.surface',
		label: 'Surface',
		rawLightRef: 'brand.50',
		rawDarkRef: 'brand.800',
		role: 'Tinted feature surface',
	},
	{
		path: 'accent.interactive',
		label: 'Interactive',
		rawLightRef: 'brand.600',
		rawDarkRef: 'brand.300',
		role: 'CTA hover / pressed',
	},
	{
		path: 'accent.positive',
		label: 'Positive',
		rawLightRef: 'positive.700',
		rawDarkRef: 'positive.300',
		role: 'OK / live status',
	},
	{
		path: 'accent.negative',
		label: 'Negative',
		rawLightRef: 'negative.700',
		rawDarkRef: 'negative.300',
		role: 'Error / unreachable',
	},
	{
		path: 'accent.warning',
		label: 'Warning',
		rawLightRef: 'warning.700',
		rawDarkRef: 'warning.300',
		role: 'Degraded status',
	},
	// Category accents (accent.category.*)
	{
		path: 'accent.category.design',
		label: 'Design',
		rawLightRef: 'design.700',
		rawDarkRef: 'design.300',
		role: 'Content category — design',
	},
	{
		path: 'accent.category.code',
		label: 'Code',
		rawLightRef: 'code.700',
		rawDarkRef: 'code.300',
		role: 'Content category — code',
	},
	{
		path: 'accent.category.writing',
		label: 'Writing',
		rawLightRef: 'writing.700',
		rawDarkRef: 'writing.300',
		role: 'Content category — writing',
	},
	{
		path: 'accent.category.tool',
		label: 'Tool',
		rawLightRef: 'tool.700',
		rawDarkRef: 'tool.300',
		role: 'Content category — tool',
	},
];

function resolveHex(ref: string): string {
	const [family, step] = ref.split('.');
	const palette = rawTokens.colors[family as keyof typeof rawTokens.colors] as
		| Record<string, { value: string }>
		| undefined;
	return palette?.[step as string]?.value ?? '';
}

export function ColorSwatches() {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'grid',
				gridTemplateColumns: {
					base: '1fr',
					sm: 'repeat(2, minmax(0, 1fr))',
					lg: 'repeat(4, minmax(0, 1fr))',
				},
				gap: '4',
			})}
		>
			{TOKENS.map((entry) => (
				<SwatchTile
					key={entry.path}
					path={entry.path}
					label={entry.label}
					role={entry.role}
					lightHex={resolveHex(entry.rawLightRef)}
					darkHex={entry.rawDarkRef ? resolveHex(entry.rawDarkRef) : null}
					hasDark={entry.rawDarkRef !== null}
				/>
			))}
		</ul>
	);
}

interface TileProps {
	path: string;
	label: string;
	role: string;
	lightHex: string;
	darkHex: string | null;
	hasDark: boolean;
}

function SwatchTile({ path, label, role, lightHex, darkHex, hasDark }: TileProps) {
	return (
		<li
			className={css({
				display: 'flex',
				flexDirection: 'column',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				overflow: 'hidden',
			})}
		>
			{/* Header — always on the page surface, not on the swatch surface. */}
			<div
				className={css({
					padding: '3',
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
					backgroundColor: 'bg.canvas',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					{label}
				</span>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.default',
						wordBreak: 'break-all',
					})}
				>
					{path}
				</code>
				<span
					className={css({
						fontFamily: 'sans',
						fontSize: 'xs',
						color: 'text.muted',
						lineHeight: '1.4',
					})}
				>
					{role}
				</span>
			</div>
			{/* Swatch pane pair — the left half paints the `base` value onto `bg.canvas`,
			    the right half paints the `_dark` value onto `bg.inverse`. When the token
			    is mode-agnostic the right pane shows the same `base` value with the
			    same hex annotation so the visitor sees "no dark variant declared". */}
			<div
				className={css({
					display: 'grid',
					gridTemplateColumns: '1fr 1fr',
					minHeight: '20',
				})}
			>
				<SwatchPane label="light" hex={lightHex} variant="light" hasDark={hasDark} />
				<SwatchPane label="dark" hex={darkHex ?? lightHex} variant="dark" hasDark={hasDark} />
			</div>
			{/* Token hex readout — sits below the swatch panes on the page surface. */}
			<div
				className={css({
					padding: '2',
					paddingInline: '3',
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'baseline',
					gap: '2',
					backgroundColor: 'bg.canvas',
					borderTop: '1px solid {colors.border.subtle}',
				})}
			>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.default',
					})}
				>
					{lightHex}
				</code>
				{hasDark && darkHex ? (
					<code
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							color: 'text.muted',
						})}
					>
						→ {darkHex}
					</code>
				) : null}
			</div>
		</li>
	);
}

function SwatchPane({
	label,
	hex,
	variant,
	hasDark,
}: {
	label: 'light' | 'dark';
	hex: string;
	variant: 'light' | 'dark';
	hasDark: boolean;
}) {
	const isDark = variant === 'dark';
	return (
		<div
			className={css({
				position: 'relative',
				padding: '3',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'flex-end',
				gap: '1',
				backgroundColor: isDark ? 'bg.inverse' : 'bg.canvas',
			})}
		>
			<div
				aria-hidden="true"
				className={css({
					position: 'absolute',
					insetBlockStart: '2',
					insetInlineStart: '2',
					fontFamily: 'mono',
					fontSize: 'xs',
					letterSpacing: '0.06em',
					textTransform: 'uppercase',
					color: isDark ? 'text.inverse' : 'text.muted',
				})}
			>
				{label}
			</div>
			{/* Token swatch — the actual semantic token value rendered as the
			    swatch fill. We inline the hex (NOT a raw color literal as a
			    feature decision) so the demo shows the same color the token
			    resolves to. */}
			<div
				aria-hidden="true"
				className={css({
					height: '8',
					borderRadius: 'sm',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: isDark ? 'border.strong' : 'border.subtle',
				})}
				data-token-swatch
				data-variant={variant}
				data-has-dark={hasDark}
				data-hex={hex}
				style={{ backgroundColor: hex }}
			/>
			<code
				className={css({
					fontFamily: 'mono',
					fontSize: 'xs',
					color: isDark ? 'text.inverse' : 'text.muted',
				})}
			>
				{hex}
			</code>
		</div>
	);
}
