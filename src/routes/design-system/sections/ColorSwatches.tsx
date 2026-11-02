import { css } from '../../../../styled-system/css';
import { semanticTokens } from '../../../editorial/semantic-tokens';
import { rawTokens } from '../../../editorial/tokens';

/**
 * ColorSwatches — every editorial semantic token rendered in a strict
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
 *
 * Issue #804 (owner feedback, 2026-11-01): the tiles were different
 * heights because their role sentences wrapped by a different number
 * of lines, and the sentences themselves were more explanation than a
 * colour list needs. The tile anatomy is now fixed — label, path,
 * swatch pair, hex readout — every tile uses the same rows, the
 * swatch pair has one fixed height, and the role sentence is gone.
 * The colour list reads as a grid, not as a set of small articles.
 */

interface TokenEntry {
	/** Semantic path, e.g. `accent.positive`. */
	path: string;
	/** Human-readable label, e.g. `Positive` / `Border subtle`. */
	label: string;
}

/**
 * Canonical catalog. Order is editorial, not alphabetic — surface
 * tokens first, then status, then category. The order mirrors the
 * table in `src/editorial/colors.md` so a reader cross-referencing
 * the guide finds the same row.
 */
const TOKENS: ReadonlyArray<TokenEntry> = [
	// Page surfaces (bg.*)
	{ path: 'bg.canvas', label: 'Canvas' },
	{ path: 'bg.surface', label: 'Surface' },
	{ path: 'bg.subtle', label: 'Subtle' },
	{ path: 'bg.accent', label: 'Accent fill' },
	{ path: 'bg.inverse', label: 'Inverse' },
	// Text (text.*)
	{ path: 'text.default', label: 'Default' },
	{ path: 'text.muted', label: 'Muted' },
	{ path: 'text.accent', label: 'Accent text' },
	{ path: 'text.inverse', label: 'Inverse' },
	// Borders (border.*)
	{ path: 'border.subtle', label: 'Subtle' },
	{ path: 'border.strong', label: 'Strong' },
	{ path: 'border.focus', label: 'Focus ring' },
	// Accent features (accent.*)
	{ path: 'accent.surface', label: 'Surface' },
	{ path: 'accent.interactive', label: 'Interactive' },
	{ path: 'accent.positive', label: 'Positive' },
	{ path: 'accent.negative', label: 'Negative' },
	{ path: 'accent.warning', label: 'Warning' },
	// Category accents (accent.category.*)
	{ path: 'accent.category.design', label: 'Design' },
	{ path: 'accent.category.code', label: 'Code' },
	{ path: 'accent.category.writing', label: 'Writing' },
	{ path: 'accent.category.tool', label: 'Tool' },
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
 * sits on (`bg.canvas`) and the text painted on it (`text.default`).
 * Resolved once so the light pane and the dark pane are guaranteed to
 * be a faithful rendering of the two appearances rather than a
 * hand-picked "dark-ish" colour.
 */
const PANE = {
	light: {
		surface: resolveHex(resolveSemanticRefs('bg.canvas').lightRef),
		label: resolveHex(resolveSemanticRefs('text.default').lightRef),
	},
	dark: {
		surface: resolveHex(resolveSemanticRefs('bg.canvas').darkRef),
		label: resolveHex(resolveSemanticRefs('text.default').darkRef),
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
					// Three columns, not four: 21 tokens divide into 7 full
					// rows, and every token path fits on one line at this
					// width (`accent.category.writing` is the longest). The
					// four-column grid left an orphan tile on the last row
					// and truncated four paths.
					lg: 'repeat(3, minmax(0, 1fr))',
				},
				gridAutoRows: '1fr',
				alignItems: 'stretch',
				gap: '3',
			})}
		>
			{TOKENS.map((entry) => {
				const { lightRef, darkRef } = resolveSemanticRefs(entry.path);
				return (
					<SwatchTile
						key={entry.path}
						path={entry.path}
						label={entry.label}
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
	lightHex: string;
	darkHex: string;
}

/**
 * One tile. The three rows are fixed (`auto 5rem auto`) so every tile
 * in a row has the same height even when a token path is long: the
 * header is exactly two single-line rows, the swatch pair is exactly
 * one fixed-height row, and the hex readout is one row.
 */
function SwatchTile({ path, label, lightHex, darkHex }: TileProps) {
	return (
		<li
			className={css({
				display: 'grid',
				gridTemplateRows: 'auto 5rem auto',
				backgroundColor: 'bg.surface',
				overflow: 'hidden',
			})}
		>
			{/* Header — sits on the card fill and follows the current
			    appearance through the real tokens: this is the part of the
			    tile that flips when the visitor's OS goes dark. */}
			<div
				className={css({
					display: 'grid',
					gridTemplateRows: 'auto auto',
					rowGap: '1',
					paddingBlock: '3',
					paddingInline: '3',
					minWidth: '0',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
						color: 'text.muted',
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
					})}
				>
					{label}
				</span>
				<code
					title={path}
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						lineHeight: '1.3',
						color: 'text.default',
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
					})}
				>
					{path}
				</code>
			</div>
			{/* Swatch pane pair — the left half paints the token's `base`
			    value onto the light canvas, the right half paints its
			    `_dark` value onto the dark canvas. Both pane surfaces come
			    from `bg.canvas`, so this is the real appearance pair and not
			    an `bg.inverse` simulation of one. */}
			<div className={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '0' })}>
				<SwatchPane variant="light" hex={lightHex} />
				<SwatchPane variant="dark" hex={darkHex} />
			</div>
			{/* Token hex readout — one row, two columns, no divider. */}
			<div
				className={css({
					display: 'grid',
					gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
					columnGap: '2',
					paddingBlock: '2',
					paddingInline: '3',
					backgroundColor: 'bg.canvas',
				})}
			>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.default',
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
					})}
				>
					{lightHex}
				</code>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
					})}
				>
					{darkHex}
				</code>
			</div>
		</li>
	);
}

/**
 * One half of the comparison. `variant` selects the appearance being
 * staged; `PANE` supplies that appearance's canvas and label colour.
 * Those colours are inlined as hex on purpose: they must describe one
 * *fixed* appearance, and a semantic token would follow the page's own
 * theme instead — which is exactly the fake this section used to
 * depend on.
 */
function SwatchPane({ variant, hex }: { variant: 'light' | 'dark'; hex: string }) {
	const pane = PANE[variant];
	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'space-between',
				gap: '1',
				paddingBlock: '2',
				paddingInline: '2',
				minWidth: '0',
			})}
			style={{ backgroundColor: pane.surface }}
		>
			<span
				aria-hidden="true"
				className={css({
					fontFamily: 'mono',
					fontSize: 'xs',
					lineHeight: '1.2',
					letterSpacing: '0.06em',
					textTransform: 'uppercase',
				})}
				style={{ color: pane.label }}
			>
				{variant}
			</span>
			{/* Token swatch — the semantic token's own resolved value for this
			    appearance. The hex is inlined (a deliberate showcase decision,
			    not a component-level raw colour) so the pane reports exactly
			    what the token resolves to in that mode. No outline: the
			    fill is the whole statement. */}
			<div
				aria-hidden="true"
				className={css({ height: '10', width: '100%' })}
				data-token-swatch
				data-variant={variant}
				data-hex={hex}
				style={{ backgroundColor: hex }}
			/>
		</div>
	);
}
