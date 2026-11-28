/**
 * Shared style objects for literals that were previously duplicated
 * across three or more feature files (ADR-0022 C-7, Issue #1109).
 *
 * Each export is the SINGLE definition of a repeated css() style
 * object. Consumers reference it inside css()/cva() (e.g.
 * `css(noteMonoSm)` or `_focusVisible: focusRing`) instead of
 * re-declaring the literal, so a style change lands everywhere at once.
 * `as const` preserves the token-literal types Panda expects.
 */

export const noteMonoSm = {
	fontFamily: 'mono',
	fontSize: 'sm',
	color: 'text.muted',
} as const;

/**
 * The tabular date/figure face — mono, small, muted, with
 * `tabular-nums` so a column of dates never jitters (Issue #1319:
 * extracted when the activity archive and highlights both needed it).
 */
export const tabularDateSm = {
	fontFamily: 'mono',
	fontSize: 'sm',
	fontVariantNumeric: 'tabular-nums',
	color: 'text.muted',
} as const;

export const pageTitle = {
	margin: '0',
	marginBlockStart: '2',
	fontFamily: 'heading',
	fontSize: { base: '3xl', lg: '4xl' },
	fontWeight: '700',
	lineHeight: { base: '1.15', lg: '1.05' },
	color: 'text.default',
	letterSpacing: '-0.03em',
} as const;

export const sizeDisplay = { base: '3xl', lg: '4xl' } as const;

export const leadingDisplay = { base: '1.15', lg: '1.05' } as const;

export const eyebrowMonoXs = {
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
} as const;

export const eyebrowMonoXsLoose = {
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
} as const;

export const bodySansMd = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
} as const;

export const rowWrapGap3 = {
	display: 'flex',
	alignItems: 'center',
	gap: '3',
	flexWrap: 'wrap',
} as const;

export const noteSansMd = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.muted',
	lineHeight: '1.6',
} as const;

export const noteSansSm = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
} as const;

export const rowGap3 = {
	display: 'flex',
	alignItems: 'center',
	gap: '3',
} as const;

export const spaceSection = { base: '16', lg: '24' } as const;

export const eyebrowMonoSm = {
	fontFamily: 'mono',
	fontSize: 'sm',
	color: 'text.muted',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
} as const;

export const sizeTitle = { base: 'xl', lg: '2xl' } as const;

export const ledeSansLg = {
	margin: '0',
	marginBlockStart: '6',
	fontFamily: 'sans',
	fontSize: 'lg',
	lineHeight: '1.6',
	color: 'text.default',
	maxWidth: '640px',
} as const;

export const vStackGap1 = {
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
} as const;

export const focusRing = {
	outline: '2px solid {colors.border.focus}',
	outlineOffset: '2px',
} as const;

export const noteSansSmBody = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
} as const;

export const vStackGap10 = {
	display: 'flex',
	flexDirection: 'column',
	gap: '10',
} as const;

export const vStackGap4 = {
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
} as const;

export const listStackGap3 = {
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
} as const;

export const vStackGap2 = {
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
} as const;

export const noteSansMdPlain = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.muted',
} as const;

export const spaceCompact = { base: '2', md: '6' } as const;

export const noteSansXs = {
	fontFamily: 'sans',
	fontSize: 'xs',
	color: 'text.muted',
} as const;

export const buttonGhost = {
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	color: 'text.muted',
	background: 'transparent',
	border: '1px solid {colors.border.subtle}',
	borderRadius: 'full',
	paddingInline: '3',
	paddingBlock: '1',
	cursor: 'pointer',
	_hover: { color: 'text.default' },
	_disabled: { opacity: '0.5' },
} as const;

export const vStackGap3Plain = { display: 'flex', flexDirection: 'column', gap: '3' } as const;

export const noteMonoSmFlush = {
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'sm',
	color: 'text.muted',
} as const;

export const bodySansMdPlain = {
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.default',
} as const;

export const noteSansSmBare = { fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' } as const;

export const buttonAccent = {
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	color: 'text.inverse',
	background: 'bg.accent',
	border: 'none',
	borderRadius: '4',
	paddingBlock: '3',
	paddingInline: '6',
	cursor: 'pointer',
	_disabled: { opacity: '0.5' },
} as const;

export const bodySansMdReset = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.default',
} as const;

export const noteMonoXs = {
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.muted',
} as const;

export const monoXsPlain = {
	fontFamily: 'mono',
	fontSize: 'xs',
} as const;

export const emphasisDefault = { fontWeight: '600', color: 'text.default' } as const;

export const linkAccent = {
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	_hover: { textDecorationThickness: '2px' },
	_focusVisible: focusRing,
} as const;

export const vStackGap6 = {
	display: 'flex',
	flexDirection: 'column',
	gap: '6',
} as const;

export const eyebrowMonoXsReset = {
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
} as const;

export const noteSansSmLoose = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.muted',
} as const;

export const bodySansSmLoose = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
} as const;

export const cols1to2 = { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' } as const;

export const noteSansXsBody = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.6',
	color: 'text.muted',
} as const;

export const titleHeadingLg = {
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
} as const;

export const focusRingMedia = {
	outline: '2px solid {colors.border.focus}',
	outlineOffset: '4px',
	borderRadius: '6px',
} as const;

export const tagMonoXsCaps = {
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
} as const;

export const eyebrowSans = {
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
} as const;

export const labelAction = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.default',
} as const;

export const pageTitleFlush = {
	margin: '0',
	fontFamily: 'heading',
	fontSize: sizeDisplay,
	fontWeight: '700',
	color: 'text.default',
	lineHeight: '1.05',
	letterSpacing: '-0.03em',
	maxWidth: '720px',
} as const;

export const gridMin = {
	display: 'grid',
	minWidth: '0',
} as const;

export const vStackGap1Min = {
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	minWidth: '0',
} as const;

export const spaceNoneTo6 = { base: '0', md: '6' } as const;

export const inlineIconRow = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
} as const;
