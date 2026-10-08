import { css } from '../../../../styled-system/css';
import { semanticTokens } from '../../../editorial/semantic-tokens';
import { rawTokens } from '../../../editorial/tokens';

/**
 * ColorSwatches — every editorial semantic token rendered in a 4-column
 * grid as a side-by-side light / dark pair.
 *
 * The pair is the educational point of the section:
 *
 *   - Every semantic token carries `{ value: { base, _dark } }` per
 *     `src/editorial/semantic-tokens.ts`, and `panda.config.ts` binds
 *     `_dark` to `@media (prefers-color-scheme: dark)`. The left pane
 *     paints the `base` value on the light canvas; the right pane
 *     paints the `_dark` value on the dark canvas. That is exactly
 *     what a visitor sees in each appearance, side by side, whatever
 *     OS setting the page itself is currently being browsed with.
 *   - A token that declares no `_dark` binding throws here, so this
 *     section doubles as the regression guard for the Issue #290
 *     token audit.
 *
 * The panes are painted from the resolved hex values instead of from
 * `bg.inverse` / `text.inverse`. Those two tokens are a
 * self-contained inverse pair that does NOT follow the appearance, so
 * building the "dark" pane out of them only ever *simulated* a dark
 * surface (the fake removed by Issue #290). Reading the hexes also
 * keeps the comparison stable when the page itself flips: under
 * `prefers-color-scheme: dark` the surrounding chrome switches
 * through the real tokens while both panes keep showing both
 * appearances.
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
	{
		path: 'bg.inverse',
		label: 'Inverse',
		role: 'Inverse panel (static pair)',
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
	value?: string | { base?: string; _dark?: string };
};

function rawRefFromSemanticValue(value: string): string {
	const match = /^\{colors\.([^}]+)\}$/.exec(value);
	if (!match) {
		throw new Error(`Unsupported semantic color reference: ${value}`);
	}
	return match[1];
}

/**
 * Resolve a semantic path to its raw palette reference in each
 * appearance. Both bindings are mandatory: Issue #290's audit rule is
 * that every semantic token carries a meaningful `_dark` value, and
 * this function is where that rule is enforced for the showcase.
 */
function resolveSemanticRefs(path: string): { lightRef: string; darkRef: string } {
	let node: unknown = semanticTokens.colors;
	for (const segment of path.split('.')) {
		if (!node || typeof node !== 'object' || !(segment in node)) {
			throw new Error(`Unknown semantic color token: ${path}`);
		}
		node = (node as Record<string, unknown>)[segment];
	}

	const value = (node as SemanticLeaf).value;
	if (!value || typeof value === 'string') {
		throw new Error(`Semantic color token must declare { base, _dark }: ${path}`);
	}
	if (!value.base || !value._dark) {
		throw new Error(`Semantic color token has no _dark binding: ${path}`);
	}

	return {
		lightRef: rawRefFromSemanticValue(value.base),
		darkRef: rawRefFromSemanticValue(value._dark),
	};
}

function resolveHex(ref: string): string {
	const [family, step] = ref.split('.');
	const palette = rawTokens.colors[family as keyof typeof rawTokens.colors] as
		| Record<string, { value: string }>
		| undefined;
	return palette?.[step as string]?.value ?? '';
}

/**
 * Pane chrome for each appearance, sourced through the same
 * semantic → raw resolution every swatch uses: the surface the pane
 * sits on (`bg.canvas`), the text painted on it (`text.default`) and
 * the swatch hairline (`border.subtle`). Resolved once so the light
 * pane and the dark pane are guaranteed to be a faithful rendering of
 * the two appearances rather than a hand-picked "dark-ish" colour.
 */
const PANE = {
	light: {
		surface: resolveHex(resolveSemanticRefs('bg.canvas').lightRef),
		label: resolveHex(resolveSemanticRefs('text.default').lightRef),
		border: resolveHex(resolveSemanticRefs('border.subtle').lightRef),
	},
	dark: {
		surface: resolveHex(resolveSemanticRefs('bg.canvas').darkRef),
		label: resolveHex(resolveSemanticRefs('text.default').darkRef),
		border: resolveHex(resolveSemanticRefs('border.subtle').darkRef),
	},
} as const;

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
						darkHex={resolveHex(darkRef)}
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
	darkHex: string;
}

function SwatchTile({ path, label, role, lightHex, darkHex }: TileProps) {
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
			{/* Header — sits on the page surface and follows the current
			    appearance through the real tokens: this is the part of the
			    tile that flips when the visitor's OS goes dark. */}
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
			{/* Swatch pane pair — the left half paints the token's `base`
			    value onto the light canvas, the right half paints its
			    `_dark` value onto the dark canvas. Both pane surfaces come
			    from `bg.canvas`, so this is the real appearance pair and not
			    an `bg.inverse` simulation of one. */}
			<div
				className={css({
					display: 'grid',
					gridTemplateColumns: '1fr 1fr',
					minHeight: '24',
				})}
			>
				<SwatchPane variant="light" hex={lightHex} />
				<SwatchPane variant="dark" hex={darkHex} />
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
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
					})}
				>
					→ {darkHex}
				</code>
			</div>
		</li>
	);
}

/**
 * One half of the comparison. `variant` selects the appearance being
 * staged; `PANE` supplies that appearance's canvas, label colour and
 * hairline. Those colours are inlined as hex on purpose: they must
 * describe one *fixed* appearance, and a semantic token would follow
 * the page's own theme instead — which is exactly the fake this
 * section used to depend on.
 */
function SwatchPane({ variant, hex }: { variant: 'light' | 'dark'; hex: string }) {
	const pane = PANE[variant];
	return (
		<div
			className={css({
				position: 'relative',
				padding: '3',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'flex-end',
				gap: '1',
			})}
			style={{ backgroundColor: pane.surface }}
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
				})}
				style={{ color: pane.label }}
			>
				{variant}
			</div>
			{/* Token swatch — the semantic token's own resolved value for this
			    appearance. The hex is inlined (a deliberate showcase decision,
			    not a component-level raw colour) so the pane reports exactly
			    what the token resolves to in that mode. */}
			<div
				aria-hidden="true"
				className={css({
					height: '8',
					borderRadius: 'sm',
					borderWidth: '1px',
					borderStyle: 'solid',
				})}
				data-token-swatch
				data-variant={variant}
				data-hex={hex}
				style={{ backgroundColor: hex, borderColor: pane.border }}
			/>
			<code className={css({ fontFamily: 'mono', fontSize: 'xs' })} style={{ color: pane.label }}>
				{hex}
			</code>
		</div>
	);
}
