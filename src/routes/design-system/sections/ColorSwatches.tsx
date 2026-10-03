import { css } from '../../../../styled-system/css';
import { semanticTokens } from '../../../editorial/semantic-tokens';
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
 * The token path is resolved through `semantic-tokens.ts` first and
 * only then dereferenced into `tokens.ts`. The viewer therefore has
 * no second hand-written raw-token mapping that can drift from the
 * actual semantic contract.
 */

interface TokenEntry {
	/** Semantic path, e.g. `accent.positive`. */
	path: string;
	/** Human-readable label, e.g. `Positive` / `Border subtle`. */
	label: string;
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
		role: 'Page background',
	},
	{
		path: 'bg.surface',
		label: 'Surface',
		role: 'Card surface (default)',
	},
	{
		path: 'bg.subtle',
		label: 'Subtle',
		role: 'Tinted separator',
	},
	{
		path: 'bg.accent',
		label: 'Accent fill',
		role: 'Primary CTA idle',
	},
	// Text (text.*)
	{
		path: 'text.default',
		label: 'Default',
		role: 'Body text',
	},
	{
		path: 'text.muted',
		label: 'Muted',
		role: 'Secondary text',
	},
	{
		path: 'text.accent',
		label: 'Accent text',
		role: 'Inline link',
	},
	{
		path: 'text.inverse',
		label: 'Inverse',
		role: 'Text on accent fill',
	},
	// Borders (border.*)
	{
		path: 'border.subtle',
		label: 'Subtle',
		role: 'Default divider',
	},
	{
		path: 'border.strong',
		label: 'Strong',
		role: 'Emphasis divider',
	},
	{
		path: 'border.focus',
		label: 'Focus ring',
		role: 'Focus outline',
	},
	// Accent features (accent.*)
	{
		path: 'accent.surface',
		label: 'Surface',
		role: 'Tinted feature surface',
	},
	{
		path: 'accent.interactive',
		label: 'Interactive',
		role: 'CTA hover / pressed',
	},
	{
		path: 'accent.positive',
		label: 'Positive',
		role: 'OK / live status',
	},
	{
		path: 'accent.negative',
		label: 'Negative',
		role: 'Error / unreachable',
	},
	{
		path: 'accent.warning',
		label: 'Warning',
		role: 'Degraded status',
	},
	// Category accents (accent.category.*)
	{
		path: 'accent.category.design',
		label: 'Design',
		role: 'Content category — design',
	},
	{
		path: 'accent.category.code',
		label: 'Code',
		role: 'Content category — code',
	},
	{
		path: 'accent.category.writing',
		label: 'Writing',
		role: 'Content category — writing',
	},
	{
		path: 'accent.category.tool',
		label: 'Tool',
		role: 'Content category — tool',
	},
];

type SemanticLeaf = {
	value?: string;
	base?: { value: string };
	_dark?: { value: string };
};

function rawRefFromSemanticValue(value: string): string {
	const match = /^\{colors\.([^}]+)\}$/.exec(value);
	if (!match) {
		throw new Error(`Unsupported semantic color reference: ${value}`);
	}
	return match[1];
}

function resolveSemanticRefs(path: string): { lightRef: string; darkRef: string | null } {
	let node: unknown = semanticTokens.colors;
	for (const segment of path.split('.')) {
		if (!node || typeof node !== 'object' || !(segment in node)) {
			throw new Error(`Unknown semantic color token: ${path}`);
		}
		node = (node as Record<string, unknown>)[segment];
	}

	const leaf = node as SemanticLeaf;
	const lightValue = leaf.value ?? leaf.base?.value;
	if (!lightValue) {
		throw new Error(`Semantic color token has no base value: ${path}`);
	}

	return {
		lightRef: rawRefFromSemanticValue(lightValue),
		darkRef: leaf._dark ? rawRefFromSemanticValue(leaf._dark.value) : null,
	};
}

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
			{TOKENS.map((entry) => {
				const { lightRef, darkRef } = resolveSemanticRefs(entry.path);
				return (
					<SwatchTile
						key={entry.path}
						path={entry.path}
						label={entry.label}
						role={entry.role}
						lightHex={resolveHex(lightRef)}
						darkHex={darkRef ? resolveHex(darkRef) : null}
						hasDark={darkRef !== null}
					/>
				);
			})}
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
