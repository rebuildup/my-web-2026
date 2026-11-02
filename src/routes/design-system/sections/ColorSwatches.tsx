import { css, cx } from '../../../../styled-system/css';
import { StateMark } from '../../../editorial/primitives/StateMark';
import type { DesignSystemTokenData } from '../tokens';

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
 *
 * Where the hex values come from
 * ------------------------------
 * The token paths are resolved on the SERVER (`../tokens.ts`, a server
 * function): the section renders resolved hex pairs, and resolving
 * them in the browser meant shipping the whole raw palette plus the
 * whole semantic layer in the route chunk (≈ 3.7 KB) to display 24
 * pairs. The route loader passes the resolved pairs in as props; the
 * rendered result is identical either way. The CONTRAST arithmetic
 * stays here, because choosing the ink is a rendering decision and
 * needs the resolved values in the browser.
 */

/**
 * The sentence each classification carries. The classification id is
 * the word (channel 1), so the copy is keyed by it.
 */
const FAMILY_NOTES: Record<string, string> = {
	design: '作品の分類は slug から決定的に導く。同じ作品は常に同じ面。',
	code: '分類は語と形が担う。色は補助で、単独では意味を持たせない。',
	writing: '長文の面には色を敷かない。色は 1 語・1 行・1 印まで。',
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

/* ------------------------------------------------------------------ *
 * Contrast arithmetic
 *
 * The ink on a colour field is measured, never chosen by hand. A
 * hand-picked ink is how a field ends up with 2 : 1 text, and a
 * showcase that prints its own contrast table has to be right.
 * ------------------------------------------------------------------ */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const value = hex.replace('#', '');
	return {
		r: Number.parseInt(value.slice(0, 2), 16),
		g: Number.parseInt(value.slice(2, 4), 16),
		b: Number.parseInt(value.slice(4, 6), 16),
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
 * Pick the ink with the higher contrast against the field, and report
 * the measured ratio so the DOM can carry it (`data-contrast`).
 *
 * The two candidates are the light-appearance values of `text.default`
 * and `bg.surface` — they arrive with the resolved token data, so the
 * ink is never a hand-written hex.
 */
function pickInk(
	fieldHex: string,
	candidates: ReadonlyArray<string>,
): { hex: string; ratio: number } {
	let best = {
		hex: candidates[0],
		ratio: Number(contrastRatio(fieldHex, candidates[0]).toFixed(2)),
	};
	for (const hex of candidates.slice(1)) {
		const ratio = Number(contrastRatio(fieldHex, hex).toFixed(2));
		if (ratio > best.ratio) best = { hex, ratio };
	}
	return best;
}

/* ------------------------------------------------------------------ *
 * Style constants
 *
 * Panda's `css()` takes a plain object, so every call site pays for
 * its own property names in the bundle. The utilities the section
 * repeats are declared once here and composed with `cx`.
 * ------------------------------------------------------------------ */

const listResetClassName = css({ margin: '0', padding: '0', listStyle: 'none' });

const gridThreeClassName = css({
	gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
});

const flexBetweenClassName = css({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: '2',
});

const monoLabelClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.08em',
	textTransform: 'uppercase',
});

const monoCodeClassName = css({ fontFamily: 'mono', fontSize: 'xs' });

const subSectionClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	marginBlockStart: '10',
});

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

export function ColorSwatches({ tokenData }: { tokenData: DesignSystemTokenData }) {
	return (
		<>
			<ul
				data-colour-triptych
				className={cx(
					listResetClassName,
					css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
						gap: '0',
					}),
				)}
			>
				{tokenData.families.map((family, index) => (
					<li key={family.id} className={css({ minWidth: '0' })}>
						<FamilyField
							family={family}
							note={FAMILY_NOTES[family.id] ?? ''}
							ordinal={index + 1}
							inkCandidates={tokenData.inkCandidates}
						/>
					</li>
				))}
			</ul>

			<section aria-labelledby="design-system-colour-status" className={subSectionClassName}>
				<h3 id="design-system-colour-status" className={subHeadingClassName}>
					状態 — 分類の色を借りる
				</h3>
				<p className={subBodyClassName}>
					状態は形（StateMark）と語で示し、新しい hue を足しません。色はその作品の分類から借ります。
				</p>
				<ul
					className={cx(listResetClassName, gridThreeClassName, css({ display: 'grid', gap: '6' }))}
				>
					{STATUS_SPECIMENS.map((specimen) => {
						const family = tokenData.families.find((entry) => entry.id === specimen.family);
						return (
							<li key={specimen.label}>
								<div
									data-borrowed-family={specimen.family}
									data-hue={specimen.family}
									data-coloured
									className={css({ marginBlockEnd: '3' })}
									style={{ backgroundColor: family?.lightHex, height: '2px' }}
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
									借用: {family?.token}
								</code>
							</li>
						);
					})}
				</ul>
			</section>

			<section aria-labelledby="design-system-colour-operation" className={subSectionClassName}>
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

			<section aria-labelledby="design-system-colour-ledger" className={subSectionClassName}>
				<h3 id="design-system-colour-ledger" className={subHeadingClassName}>
					Token 台帳
				</h3>
				<p className={subBodyClassName}>
					色面として提示するのは分類の 3 系統だけです。全 semantic token の値はここで path と light
					/ dark の hex で参照できます。
				</p>
				<ul
					className={cx(
						listResetClassName,
						css({
							display: 'grid',
							gridTemplateColumns: {
								base: '1fr',
								sm: 'repeat(2, minmax(0, 1fr))',
								lg: 'repeat(3, minmax(0, 1fr))',
							},
							columnGap: '6',
							rowGap: '2',
						}),
					)}
				>
					{tokenData.ledger.map((entry) => (
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
								{entry.lightHex} / {entry.darkHex}
							</code>
						</li>
					))}
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
function FamilyField({
	family,
	note,
	ordinal,
	inkCandidates,
}: {
	family: DesignSystemTokenData['families'][number];
	note: string;
	ordinal: number;
	inkCandidates: ReadonlyArray<string>;
}) {
	const onLight = pickInk(family.lightHex, inkCandidates);
	const onDark = pickInk(family.darkHex, inkCandidates);
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
				style={{ backgroundColor: family.lightHex, color: onLight.hex }}
			>
				{/* Channel 3 (position) + channel 2 (shape): the ordinal
				    and the classification silhouette. The word comes
				    below, in the body of the field. */}
				<div
					className={cx(
						monoLabelClassName,
						css({ display: 'flex', alignItems: 'center', gap: '2' }),
					)}
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
						{family.id}
					</span>
					<p
						className={css({
							margin: '0',
							fontFamily: 'sans',
							fontSize: 'sm',
							lineHeight: '1.6',
						})}
					>
						{note}
					</p>
				</div>

				{/* The dark appearance, as an inset inside the light
				    field. Its own ink is picked by measurement too. */}
				<div
					data-colour-field="dark"
					data-hue={family.id}
					data-contrast={onDark.ratio}
					className={cx(flexBetweenClassName, css({ paddingBlock: '2', paddingInline: '3' }))}
					style={{ backgroundColor: family.darkHex, color: onDark.hex }}
				>
					<span className={monoLabelClassName}>dark</span>
					<code className={monoCodeClassName}>{family.darkHex}</code>
				</div>

				{/* The token this field paints, and its light value. */}
				<div className={cx(flexBetweenClassName, css({ minWidth: '0' }))}>
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
					<code className={monoCodeClassName}>{family.lightHex}</code>
				</div>
			</div>
		</article>
	);
}
