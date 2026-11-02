import { css } from '../../../../styled-system/css';
import { StateMark } from '../../../editorial/primitives/StateMark';
import { semanticTokens } from '../../../editorial/semantic-tokens';
import { rawTokens } from '../../../editorial/tokens';

/**
 * ColorSwatches — the colour section of `/design-system`, rebuilt as
 * a COLOUR-FIRST composition (Issue #812).
 *
 * The previous build of this section was a swatch grid: 21 semantic
 * tokens, each rendered as a light pane / dark pane pair on a
 * `bg.canvas` card, with 42 painted panes and 32 distinct hexes
 * inside one section. Read as a page, that is a colour catalogue
 * rather than a colour surface — and it painted 45 pure-white
 * surfaces inside the section, because every pane carried the pure
 * white canvas.
 *
 * The composition this file owns instead:
 *
 *   1. Three classification COLOUR FIELDS — `design`, `code`,
 *      `writing`. Colour is the surface. Each field shows its light
 *      value and, as an inset inside it, its dark value, so both
 *      appearances are visible without a second card.
 *   2. A STATUS row that BORROWS a classification colour. The state
 *      is carried by the word and by the `StateMark` silhouette
 *      (`ok` / `degraded` / `unreachable`); the 2px rule underneath
 *      is the colour the work belongs to. No status hue is introduced
 *      here.
 *   3. An OPERATION row that stays INK (`bg.inverse` / `text.inverse`).
 *      Colour moves on the content side only.
 *   4. A TOKEN LEDGER — every semantic token, by path and by
 *      light / dark hex, as text. The ledger is the reference; the
 *      three fields are the specimen.
 *
 * The rules this file keeps (Issue #812):
 *
 *   - The only colour surfaces on the page are the three
 *     classification families. `tool` stays a token (the ledger lists
 *     it) but it is not a colour field.
 *   - Classification is identified by WORD first, SHAPE second
 *     (`StateMark`), POSITION third (01 / 02 / 03). Colour is the
 *     fourth channel.
 *   - Text is never painted in a classification colour. Colour appears
 *     only as a surface, as the 2px borrowed rule, or as an 8px mark.
 *   - No pure-white surface. `bg.canvas` is not used as a fill here.
 *
 * The ink on every field is PICKED, never hand-written: `pickInk()`
 * measures the field against the two ink candidates and returns the
 * one with the higher contrast ratio, so a field can never end up
 * with unreadable text.
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

/**
 * The three content classifications that are shown AS COLOUR (Issue
 * #812). `tool` keeps its token but is not a colour field: this
 * section shows the classification vocabulary of the content, and
 * the tool surfaces are not part of it.
 *
 * The word is the primary channel, the `StateMark` silhouette the
 * second, and the ordinal (01 / 02 / 03) the third.
 */
const FAMILIES = [
	{
		id: 'design',
		label: 'design',
		token: 'accent.category.design',
		note: '作品の分類は slug から決定的に導く。同じ作品は常に同じ面。',
	},
	{
		id: 'code',
		label: 'code',
		token: 'accent.category.code',
		note: '分類は語と形が担う。色は補助で、単独では意味を持たせない。',
	},
	{
		id: 'writing',
		label: 'writing',
		token: 'accent.category.writing',
		note: '長文の面には色を敷かない。色は 1 語・1 行・1 印まで。',
	},
] as const;

type FamilyId = (typeof FAMILIES)[number]['id'];
type Family = (typeof FAMILIES)[number];

const FAMILY_BY_ID: Record<FamilyId, Family> = {
	design: FAMILIES[0],
	code: FAMILIES[1],
	writing: FAMILIES[2],
};

/**
 * Status specimens. The state is carried by the word and by the mark
 * (`ok` / `degraded` / `unreachable`); the colour is BORROWED from the
 * classification of the work the state belongs to. No status hue
 * (green / red / amber) is introduced in this section.
 */
const STATUS_SPECIMENS = [
	{
		family: 'design',
		mark: 'ok',
		label: 'Done',
		note: '分類 design の作品。完了は形と語で示す。',
	},
	{
		family: 'code',
		mark: 'degraded',
		label: 'In progress',
		note: '分類 code の作品。進行中も hue を足さない。',
	},
	{
		family: 'writing',
		mark: 'unreachable',
		label: 'Failed',
		note: '分類 writing の作品。失敗は形が担う。',
	},
] as const;

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
 * Resolve one semantic path to the hex it paints in each appearance.
 */
function resolvePair(path: string): { lightHex: string; darkHex: string } {
	const { lightRef, darkRef } = resolveSemanticRefs(path);
	return { lightHex: resolveHex(lightRef), darkHex: resolveHex(darkRef) };
}

/* ------------------------------------------------------------------ *
 * Contrast arithmetic
 *
 * The ink on a colour field is measured, never chosen by hand. A
 * hand-picked ink is how a field ends up with 2 : 1 text, and a
 * showcase that prints its own contrast table has to be right.
 * ------------------------------------------------------------------ */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const value = hex.replace('#', '');
	const full =
		value.length === 3
			? value
					.split('')
					.map((c) => c + c)
					.join('')
			: value;
	return {
		r: Number.parseInt(full.slice(0, 2), 16),
		g: Number.parseInt(full.slice(2, 4), 16),
		b: Number.parseInt(full.slice(4, 6), 16),
	};
}

function relativeLuminance(hex: string): number {
	const { r, g, b } = hexToRgb(hex);
	const channel = (raw: number): number => {
		const s = raw / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * The two inks a colour field may carry: the near-black body ink
 * (`text.default`, light value) and the near-white surface ink
 * (`bg.surface`, light value). Both are resolved through the
 * semantic layer, so they follow the palette.
 */
const INK_CANDIDATES: ReadonlyArray<string> = [
	resolvePair('text.default').lightHex,
	resolvePair('bg.surface').lightHex,
];

/**
 * Pick the ink with the higher contrast against the field, and report
 * the measured ratio so the DOM can carry it (`data-contrast`).
 */
function pickInk(fieldHex: string): { hex: string; ratio: number } {
	return INK_CANDIDATES.map((hex) => ({
		hex,
		ratio: Number(contrastRatio(fieldHex, hex).toFixed(2)),
	})).reduce((best, candidate) => (candidate.ratio > best.ratio ? candidate : best));
}

/* ------------------------------------------------------------------ *
 * Section sub-headings
 * ------------------------------------------------------------------ */

const subHeadingClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.2',
	letterSpacing: '-0.01em',
	color: 'text.default',
});

const subBodyClassName = css({
	margin: '0',
	marginBlockStart: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

export function ColorSwatches() {
	return (
		<>
			<ul
				data-colour-triptych
				className={css({
					margin: '0',
					padding: '0',
					listStyle: 'none',
					display: 'grid',
					gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
					gap: '0',
				})}
			>
				{FAMILIES.map((family, index) => (
					<li key={family.id} className={css({ minWidth: '0' })}>
						<FamilyField family={family} ordinal={index + 1} />
					</li>
				))}
			</ul>

			<section
				aria-labelledby="design-system-colour-status"
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					marginBlockStart: '10',
				})}
			>
				<h3 id="design-system-colour-status" className={subHeadingClassName}>
					状態 — 分類の色を借りる
				</h3>
				<p className={subBodyClassName}>
					状態は形（StateMark）と語で示し、新しい hue を足しません。色はその作品の分類から借ります。
				</p>
				<ul
					className={css({
						margin: '0',
						padding: '0',
						listStyle: 'none',
						display: 'grid',
						gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
						gap: '6',
					})}
				>
					{STATUS_SPECIMENS.map((specimen) => {
						const family = FAMILY_BY_ID[specimen.family];
						const { lightHex } = resolvePair(family.token);
						return (
							<li key={specimen.label}>
								<div
									data-borrowed-family={specimen.family}
									data-hue={specimen.family}
									data-coloured
									className={css({ marginBlockEnd: '3' })}
									style={{ backgroundColor: lightHex, height: '2px' }}
								/>
								<span
									className={css({
										display: 'inline-flex',
										alignItems: 'center',
										gap: '2',
										fontFamily: 'sans',
										fontSize: 'sm',
										fontWeight: '600',
										color: 'text.default',
									})}
								>
									<StateMark kind={specimen.mark} size="sm" />
									{specimen.label}
								</span>
								<p className={subBodyClassName}>{specimen.note}</p>
								<code
									className={css({
										display: 'block',
										marginBlockStart: '2',
										fontFamily: 'mono',
										fontSize: 'xs',
										color: 'text.muted',
									})}
								>
									借用: {family.token}
								</code>
							</li>
						);
					})}
				</ul>
			</section>

			<section
				aria-labelledby="design-system-colour-operation"
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					marginBlockStart: '10',
				})}
			>
				<h3 id="design-system-colour-operation" className={subHeadingClassName}>
					操作 — 墨
				</h3>
				<p className={subBodyClassName}>
					操作は墨のまま、画面ごとに操作の hue を増やしません。色が動くのはコンテンツ側だけです。
				</p>
				<span
					data-element="cta-ink"
					className={css({
						display: 'inline-flex',
						alignItems: 'center',
						alignSelf: 'flex-start',
						height: '10',
						paddingInline: '5',
						borderRadius: 'md',
						backgroundColor: 'bg.inverse',
						color: 'text.inverse',
						fontFamily: 'sans',
						fontSize: 'sm',
						fontWeight: '600',
					})}
				>
					Continue
				</span>
			</section>

			<section
				aria-labelledby="design-system-colour-ledger"
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					marginBlockStart: '10',
				})}
			>
				<h3 id="design-system-colour-ledger" className={subHeadingClassName}>
					Token 台帳
				</h3>
				<p className={subBodyClassName}>
					色面として提示するのは分類の 3 系統だけです。全 semantic token の値はここで path と light
					/ dark の hex で参照できます。
				</p>
				<ul
					className={css({
						margin: '0',
						padding: '0',
						listStyle: 'none',
						display: 'grid',
						gridTemplateColumns: {
							base: '1fr',
							sm: 'repeat(2, minmax(0, 1fr))',
							lg: 'repeat(3, minmax(0, 1fr))',
						},
						columnGap: '6',
						rowGap: '2',
					})}
				>
					{TOKENS.map((entry) => {
						const { lightHex, darkHex } = resolvePair(entry.path);
						return (
							<li
								key={entry.path}
								data-token-path={entry.path}
								className={css({
									display: 'grid',
									gridTemplateColumns: 'minmax(0, 1fr) auto',
									columnGap: '2',
									minWidth: '0',
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
									{entry.path}
								</code>
								<code
									className={css({
										fontFamily: 'mono',
										fontSize: 'xs',
										color: 'text.muted',
										whiteSpace: 'nowrap',
									})}
								>
									{lightHex} / {darkHex}
								</code>
							</li>
						);
					})}
				</ul>
			</section>
		</>
	);
}

/**
 * One classification colour field.
 *
 * The light value is the field itself; the dark value is an inset
 * inside it, so both appearances are readable without a second card.
 * The ink on both is picked by measurement (`pickInk`), and the
 * measured ratio is published on the DOM as `data-contrast`.
 */
function FamilyField({ family, ordinal }: { family: Family; ordinal: number }) {
	const { lightHex, darkHex } = resolvePair(family.token);
	const onLight = pickInk(lightHex);
	const onDark = pickInk(darkHex);
	const ordinalLabel = String(ordinal).padStart(2, '0');

	return (
		<article
			data-colour-family={family.id}
			data-coloured
			data-hue={family.id}
			className={css({ display: 'grid', minWidth: '0' })}
		>
			<div
				data-colour-field="light"
				data-hue={family.id}
				data-contrast={onLight.ratio}
				className={css({
					display: 'grid',
					gridTemplateRows: 'auto 1fr auto auto',
					rowGap: '5',
					minHeight: { base: '16rem', md: '20rem' },
					paddingBlock: { base: '6', md: '8' },
					paddingInline: { base: '6', md: '8' },
				})}
				style={{ backgroundColor: lightHex, color: onLight.hex }}
			>
				{/* Channel 3 (position) + channel 2 (shape): the ordinal
				    and the classification silhouette. The word comes
				    below, in the body of the field. */}
				<div
					className={css({
						display: 'flex',
						alignItems: 'center',
						gap: '2',
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.08em',
						textTransform: 'uppercase',
					})}
				>
					<span>{ordinalLabel} · CONTENT CLASSIFICATION</span>
					<span className={css({ marginInlineStart: 'auto' })}>
						<StateMark kind={family.id} size="sm" />
					</span>
				</div>

				{/* Channel 1 (word) and the sentence that says what the
				    colour is NOT. */}
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'flex-end',
						gap: '3',
						minWidth: '0',
					})}
				>
					<span
						className={css({
							fontFamily: 'heading',
							fontSize: { base: '2xl', md: '3xl' },
							fontWeight: '700',
							lineHeight: '1.1',
							letterSpacing: '-0.02em',
						})}
					>
						{family.label}
					</span>
					<p
						className={css({
							margin: '0',
							fontFamily: 'sans',
							fontSize: 'sm',
							lineHeight: '1.6',
						})}
					>
						{family.note}
					</p>
				</div>

				{/* The dark appearance, as an inset inside the light
				    field. Its own ink is picked by measurement too. */}
				<div
					data-colour-field="dark"
					data-hue={family.id}
					data-contrast={onDark.ratio}
					className={css({
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '2',
						paddingBlock: '2',
						paddingInline: '3',
					})}
					style={{ backgroundColor: darkHex, color: onDark.hex }}
				>
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							letterSpacing: '0.08em',
							textTransform: 'uppercase',
						})}
					>
						dark
					</span>
					<code className={css({ fontFamily: 'mono', fontSize: 'xs' })}>{darkHex}</code>
				</div>

				{/* The token this field paints, and its light value. */}
				<div
					className={css({
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '2',
						minWidth: '0',
					})}
				>
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						})}
					>
						{family.token}
					</span>
					<code className={css({ fontFamily: 'mono', fontSize: 'xs' })}>{lightHex}</code>
				</div>
			</div>
		</article>
	);
}
