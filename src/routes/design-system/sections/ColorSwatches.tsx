import { css, cx } from '../../../../styled-system/css';
import { StateMark } from '../../../editorial/primitives/StateMark';
import type { DesignSystemMonoRole, DesignSystemTokenData } from '../tokens';

/**
 * ColorSwatches — the colour section of `/design-system`.
 *
 * The composition this file owns (Issue #764, direction B):
 *
 *   1. A SPECIMEN PLATE — three horizontal bands, one per
 *      classification family (`design` / `code` / `writing`), each
 *      painted with the family's approved FIELD token
 *      (`accent.field.<id>`, the 500 step) and read through the
 *      monochrome ink placed on it (`mono.ink.onColour`).
 *   2. THE MONOCHROME GROUND — the 14 roles of the monochrome layer in
 *      both appearances, so the surface a colour field sits on is
 *      visible instead of implied.
 *   3. THE COLOUR ON THAT GROUND — the three field tokens printed as
 *      chips that carry the monochrome ink, which is the whole point:
 *      the colour does not own its text colour.
 *   4. A RAMP ROW — the five raw steps of every family, so the colour
 *      is read as a ladder rather than as one swatch.
 *   5. A STATUS row that BORROWS a classification colour.
 *   6. An OPERATION row that stays INK (`bg.inverse` / `text.inverse`).
 *   7. A TOKEN LEDGER — every semantic token, by path and by light /
 *      dark hex, as text.
 *
 * Why the field is painted at the 500 step, not the semantic 700
 * ------------------------------------------------------------------
 * `accent.category.*` binds the 700 step in the light appearance
 * because it has to work as an 8px non-text mark on the ground, and the
 * 500 step of the cyan and yellow families measures 2.37 : 1 and
 * 1.88 : 1 there — below the 3 : 1 non-text minimum. That constraint
 * is about AREA: a mark is small, so it needs a dark step.
 *
 * A field is the opposite case. Painting the 700 step across a large
 * surface is what made the previous build read as muddy — the writing
 * family's 700 is `#a16207`, an ochre that turns to brown at scale.
 * The owner approved the 500 step as `accent.field.*` (2026-11-04), so
 * the field paints the semantic token itself rather than a step this
 * file picked.
 *
 * Why the ink is a TOKEN now
 * --------------------------
 * The previous build measured the field against two candidate inks and
 * used whichever won. That made every field's text colour a rendering
 * decision, which is exactly what the owner's instruction rules out:
 * 「モノクロのトークンをカラーに載せる」. The ink is now
 * `mono.ink.onColour` (and `mono.ink.onColourInverse` for a deep field),
 * resolved on the server. The measurement stays, as VERIFICATION: the
 * band prints the ratio next to the token it painted, so a token that
 * drifted away from its field shows a failing number instead of
 * quietly looking fine.
 *
 * The rules this file keeps:
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
 * Where the hex values come from
 * ------------------------------
 * The token paths are resolved on the SERVER (`../tokens.ts`, a server
 * function): the section renders resolved hex pairs, and resolving
 * them in the browser meant shipping the whole raw palette plus the
 * whole semantic layer in the route chunk. The route loader passes the
 * resolved pairs in as props; the rendered result is identical either
 * way. The CONTRAST arithmetic stays here only to print the measured
 * ratio next to the token.
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
 * The ink is a token, not a choice. The measurement runs anyway so the
 * section can print the ratio beside the token it painted: a token that
 * stopped clearing its field would show a failing number instead of a
 * comfortable-looking swatch.
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
 * The ratio the section prints: two decimals, always rounded DOWN.
 *
 * The gate (`scripts/check-a11y-contrast.mjs`) reports its ratios the
 * same way, so the number a reader sees on the page is the number the
 * gate would publish. Rounding to nearest would print 5.39 : 1 where
 * the gate says 5.38 : 1, and a showcase that disagrees with its own
 * contract invites the reader to doubt both.
 */
function reportedRatio(foreground: string, background: string): number {
	return Math.floor(contrastRatio(foreground, background) * 100) / 100;
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

/** A monochrome specimen: one role, painted in one appearance. */
const monoSwatchClassName = css({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	minHeight: '16',
	paddingInline: '4',
	fontFamily: 'sans',
	fontSize: 'sm',
});

const monoCaptionClassName = css({
	display: 'block',
	marginBlockStart: '2',
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.muted',
	overflowWrap: 'anywhere',
});

export function ColorSwatches({ tokenData }: { tokenData: DesignSystemTokenData }) {
	const mono = (path: string, appearance: 'lightHex' | 'darkHex'): string =>
		tokenData.monoRoles.find((role) => role.path === path)?.[appearance] ?? '';
	const ground = {
		lightHex: mono('mono.surface.ground', 'lightHex'),
		darkHex: mono('mono.surface.ground', 'darkHex'),
	};
	const text = {
		lightHex: mono('mono.ink.text', 'lightHex'),
		darkHex: mono('mono.ink.text', 'darkHex'),
	};

	return (
		<>
			{/* 1. The specimen plate. Three stacked bands, each painted
			    with its family's approved field token. The gap between
			    bands is the page canvas, so the plate reads as three
			    specimens on the page rather than as one poster. */}
			<ul
				data-colour-plate
				className={cx(listResetClassName, css({ display: 'grid', rowGap: '2' }))}
			>
				{tokenData.families.map((family, index) => (
					<li key={family.id} className={css({ minWidth: '0' })}>
						<FamilyBand
							family={family}
							note={FAMILY_NOTES[family.id] ?? ''}
							ordinal={index + 1}
							inkHex={tokenData.onColourHex}
						/>
					</li>
				))}
			</ul>

			{/* 2. The monochrome ground. The role ladder the colour sits
			    on: surfaces, lines and ink, each shown in both
			    appearances because light and dark are designed
			    independently rather than inverted. */}
			<section aria-labelledby="design-system-colour-mono" className={subSectionClassName}>
				<h3 id="design-system-colour-mono" className={subHeadingClassName}>
					モノクロ — 色が載る地
				</h3>
				<p className={subBodyClassName}>
					ページ・面・罫線・文字はすべてモノクロの役割で決まります。明るい面と暗い面は反転ではなく別々に設計され、
					色はこの地の上にだけ載ります。色面は自分の文字色を持たず、地の墨（mono.ink.onColour）で読みます。反転地の墨は反転地に、色面の墨は色面に置いて示します。
				</p>
				<ul
					className={cx(
						listResetClassName,
						css({
							display: 'grid',
							gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
							gap: '6',
						}),
					)}
				>
					{tokenData.monoRoles.map((role) => (
						<li key={role.path} data-mono-role={role.path} className={css({ minWidth: '0' })}>
							<MonoRolePair
								role={role}
								groundLight={ground.lightHex}
								groundDark={ground.darkHex}
								textLight={text.lightHex}
								textDark={text.darkHex}
								inverseGround={{
									lightHex: mono('mono.surface.inverse', 'lightHex'),
									darkHex: mono('mono.surface.inverse', 'darkHex'),
								}}
								inverseInk={{
									lightHex: mono('mono.ink.inverse', 'lightHex'),
									darkHex: mono('mono.ink.inverse', 'darkHex'),
								}}
								mutedInk={{
									lightHex: mono('mono.ink.muted', 'lightHex'),
									darkHex: mono('mono.ink.muted', 'darkHex'),
								}}
								onColourGround={
									tokenData.families.find((family) => family.id === 'design')?.fieldHex
								}
							/>
						</li>
					))}
				</ul>
			</section>

			{/* 3. The colour ON that ground. Each approved field token
			    printed as a chip whose text is the monochrome ink, so
			    the composition the owner asked for is the specimen. */}
			<section aria-labelledby="design-system-colour-on-ground" className={subSectionClassName}>
				<h3 id="design-system-colour-on-ground" className={subHeadingClassName}>
					色をモノクロに載せる
				</h3>
				<p className={subBodyClassName}>
					承認されたアクセント色は、面として広がるとき 500 の段で使います。その上の文字は色ではなく
					mono.ink.onColour です。深い段（700〜800）の面には mono.ink.onColourInverse を使います。
				</p>
				<ul
					className={cx(listResetClassName, gridThreeClassName, css({ display: 'grid', gap: '4' }))}
				>
					{tokenData.families.map((family) => {
						const ratio = reportedRatio(family.fieldHex, tokenData.onColourHex);
						return (
							<li key={family.id} className={css({ minWidth: '0' })}>
								<div
									data-colour-on-ground={family.id}
									data-coloured
									data-hue={family.id}
									data-contrast={ratio}
									className={css({
										display: 'flex',
										flexDirection: 'column',
										gap: '1',
										paddingBlock: '5',
										paddingInline: '5',
									})}
									style={{ backgroundColor: family.fieldHex, color: tokenData.onColourHex }}
								>
									<span
										className={css({
											fontFamily: 'heading',
											fontSize: 'xl',
											fontWeight: '700',
											lineHeight: '1.1',
											letterSpacing: '-0.01em',
										})}
									>
										{family.id}
									</span>
									<code className={monoCodeClassName}>{family.fieldToken}</code>
								</div>
								<code className={monoCaptionClassName}>mono.ink.onColour · {ratio} : 1</code>
							</li>
						);
					})}
				</ul>
			</section>

			{/* 4. The ramp. The five raw steps of every family, so the
			    colour is read as a ladder and the 700 mark step is
			    visible next to the field step it sits beside. */}
			<section aria-labelledby="design-system-colour-ramp" className={subSectionClassName}>
				<h3 id="design-system-colour-ramp" className={subHeadingClassName}>
					階調 — 系統ごとの 5 段
				</h3>
				<p className={subBodyClassName}>
					分類の色は 1 色ではなく階調です。面積の小さい印は 700（明るい面で 3:1
					を満たす段）、面として広がるときは 500
					で読みます。両方を並べて、どちらが何のための段かを隠しません。
				</p>
				<ul
					className={cx(
						listResetClassName,
						css({
							display: 'grid',
							gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
							gap: '6',
						}),
					)}
				>
					{tokenData.families.map((family) => (
						<li key={family.id} className={css({ minWidth: '0' })}>
							<span
								className={cx(
									monoLabelClassName,
									css({ display: 'block', marginBlockEnd: '2', color: 'text.muted' }),
								)}
							>
								{family.id}
							</span>
							<ul
								className={cx(
									listResetClassName,
									css({ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }),
								)}
							>
								{family.ramp.map((step) => (
									<li key={step.step} data-ramp-step={step.step}>
										<span
											aria-hidden="true"
											className={css({ display: 'block', height: '10' })}
											style={{ backgroundColor: step.hex }}
										/>
										<code
											className={css({
												display: 'block',
												marginBlockStart: '1',
												fontFamily: 'mono',
												fontSize: 'xs',
												color: step.step === '500' ? 'text.default' : 'text.muted',
												fontWeight: step.step === '500' ? '700' : '400',
											})}
										>
											{step.step}
										</code>
									</li>
								))}
							</ul>
						</li>
					))}
				</ul>
			</section>

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
									style={{ backgroundColor: family?.fieldHex, height: '2px' }}
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
									overflowWrap: 'anywhere',
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
 * One classification band.
 *
 * The band is painted with the family's approved FIELD token (500) and
 * its text is the monochrome ink token — not a measured choice. The
 * ratio in the footer is the verification of that pairing.
 */
function FamilyBand({
	family,
	note,
	ordinal,
	inkHex,
}: {
	family: DesignSystemTokenData['families'][number];
	note: string;
	ordinal: number;
	inkHex: string;
}) {
	const ratio = reportedRatio(family.fieldHex, inkHex);
	const ordinalLabel = String(ordinal).padStart(2, '0');

	return (
		<article
			data-colour-family={family.id}
			data-colour-field="light"
			data-coloured
			data-hue={family.id}
			data-contrast={ratio}
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'minmax(0, 5fr) minmax(0, 7fr)' },
				columnGap: { base: '0', md: '6' },
				rowGap: '3',
				alignItems: 'center',
				paddingBlock: { base: '6', md: '7' },
				paddingInline: { base: '6', md: '8' },
			})}
			style={{ backgroundColor: family.fieldHex, color: inkHex }}
		>
			{/* Channel 3 (position) + channel 1 (word) + the semantic
			    path. The word is the identifier; the colour is fourth. */}
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
					minWidth: '0',
				})}
			>
				<span className={monoLabelClassName}>{ordinalLabel} · CONTENT CLASSIFICATION</span>
				<span
					className={css({
						fontFamily: 'heading',
						fontSize: { base: '2xl', md: '3xl' },
						fontWeight: '700',
						lineHeight: '1.05',
						letterSpacing: '-0.02em',
					})}
				>
					{family.id}
				</span>
				<code
					className={css({
						marginBlockStart: '2',
						fontFamily: 'mono',
						fontSize: 'xs',
						opacity: 0.72,
					})}
				>
					{family.fieldToken}
				</code>
			</div>

			{/* The sentence that says what the colour is NOT, the shape
			    (channel 2), and the measured field / ink values. */}
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					minWidth: '0',
				})}
			>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.6',
						opacity: 0.9,
					})}
				>
					{note}
				</p>
				<div className={cx(flexBetweenClassName, css({ minWidth: '0', flexWrap: 'wrap' }))}>
					<span className={css({ display: 'inline-flex', alignItems: 'center', gap: '2' })}>
						<StateMark kind={family.id} size="sm" />
						<code className={monoCodeClassName}>field {family.fieldHex}</code>
						<code className={monoCodeClassName}>· {ratio} : 1</code>
					</span>
					<span className={css({ display: 'inline-flex', alignItems: 'center', gap: '2' })}>
						<span
							aria-hidden="true"
							className={css({ display: 'block', width: '3', height: '3' })}
							style={{ backgroundColor: family.darkHex }}
						/>
						<code className={monoCodeClassName}>mark dark {family.darkHex}</code>
					</span>
				</div>
			</div>
		</article>
	);
}

/**
 * One monochrome role, shown in both appearances.
 *
 * The specimen paints the role as it is used rather than as a flat
 * swatch: a surface carries a label in that appearance's text ink, a
 * line is drawn as a rule on that appearance's ground, and an ink is
 * printed on the ground in its own value. Light and dark are shown
 * because they are two designs, not two ends of one ramp.
 */
function MonoRolePair({
	role,
	groundLight,
	groundDark,
	textLight,
	textDark,
	inverseGround,
	inverseInk,
	mutedInk,
	onColourGround,
}: {
	role: DesignSystemMonoRole;
	groundLight: string;
	groundDark: string;
	textLight: string;
	textDark: string;
	inverseGround: { lightHex: string; darkHex: string };
	inverseInk: { lightHex: string; darkHex: string };
	mutedInk: { lightHex: string; darkHex: string };
	onColourGround: string | undefined;
}) {
	/**
	 * The ground a role is shown ON. Most roles sit on the page ground,
	 * but two inks exist only for another surface: the inverse ink is
	 * for the inverse ground, and the on-colour ink is for a colour
	 * field. Showing them on the page ground would make them look
	 * broken, so the specimen moves them to the ground they serve —
	 * which is the composition the owner asked to see.
	 */
	const groundFor = (appearance: 'light' | 'dark'): string => {
		if (role.path === 'mono.ink.inverse') {
			return appearance === 'light' ? inverseGround.lightHex : inverseGround.darkHex;
		}
		if (role.path === 'mono.ink.onColour') {
			return onColourGround ?? groundLight;
		}
		return appearance === 'light' ? groundLight : groundDark;
	};

	return (
		<>
			<span
				className={css({
					display: 'flex',
					alignItems: 'baseline',
					justifyContent: 'space-between',
					gap: '2',
					marginBlockEnd: '2',
				})}
			>
				<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.default' })}>
					{role.label}
				</span>
				<code className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}>
					{role.path}
				</code>
			</span>
			<div
				className={css({
					display: 'grid',
					gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
					columnGap: '2',
					rowGap: '1',
				})}
			>
				<MonoSwatch
					role={role}
					appearance="light"
					hex={role.lightHex}
					groundHex={groundFor('light')}
					textHex={textLight}
					inverseHex={inverseInk.lightHex}
					mutedHex={mutedInk.lightHex}
				/>
				<MonoSwatch
					role={role}
					appearance="dark"
					hex={role.darkHex}
					groundHex={groundFor('dark')}
					textHex={textDark}
					inverseHex={inverseInk.darkHex}
					mutedHex={mutedInk.darkHex}
				/>
				<code className={monoCaptionClassName}>light {role.lightHex}</code>
				<code className={cx(monoCaptionClassName, css({ marginBlockStart: '0' }))}>
					dark {role.darkHex}
				</code>
			</div>
		</>
	);
}

/** The specimen for one role in one appearance. */
function MonoSwatch({
	role,
	appearance,
	hex,
	groundHex,
	textHex,
	inverseHex,
	mutedHex,
}: {
	role: DesignSystemMonoRole;
	appearance: 'light' | 'dark';
	hex: string;
	groundHex: string;
	textHex: string;
	inverseHex: string;
	mutedHex: string;
}) {
	if (role.group === 'ink') {
		return (
			<div
				data-mono-appearance={appearance}
				data-mono-group={role.group}
				className={monoSwatchClassName}
				style={{ backgroundColor: groundHex, color: hex }}
			>
				<span>色 Aa</span>
			</div>
		);
	}

	if (role.group === 'line') {
		return (
			<div
				data-mono-appearance={appearance}
				data-mono-group={role.group}
				className={cx(monoSwatchClassName, css({ flexDirection: 'column', gap: '2' }))}
				style={{ backgroundColor: groundHex, color: textHex }}
			>
				<span
					aria-hidden="true"
					className={css({ display: 'block', width: 'full', height: '1' })}
					style={{ backgroundColor: hex }}
				/>
				<span className={css({ fontFamily: 'mono', fontSize: 'xs' })}>罫線</span>
			</div>
		);
	}

	// A surface: the label is read through the ink that belongs ON that
	// surface, which is the role the surface exists to pair with.
	const onSurfaceInk = role.path.endsWith('.inverse')
		? inverseHex
		: role.path.endsWith('.disabled')
			? mutedHex
			: textHex;

	return (
		<div
			data-mono-appearance={appearance}
			data-mono-group={role.group}
			className={monoSwatchClassName}
			style={{ backgroundColor: hex, color: onSurfaceInk }}
		>
			<span>面</span>
		</div>
	);
}
