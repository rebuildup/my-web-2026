import { css } from '../../../styled-system/css';
import { SiteMark } from '../mark';

/**
 * Ad units — the advertising surfaces woven through the home page
 * (Issue #925 redesign, second pass).
 *
 * These reproduce REAL ad formats observed live — the evidence and
 * anatomy mapping live in
 * `docs/verification/home/925-ad-reproduction/README.md`. The page
 * mixes every observed format the way a real monetized page does:
 * leaderboard strip, in-feed link card, video spot, display
 * rectangle and native card. The 現在地 content stays normal flow
 * content; the ads are a separate axis.
 *
 * Direction rule (owner feedback, second pass): an ad must point at
 * real content — a published Tool or Portfolio piece — and must
 * carry a visual. Text-only units were rejected: real display and
 * social ads are image-led. Every creative below is a committed
 * asset (`/tool-previews/*.webp`, the same captures the Tools index
 * uses) and every destination is a real route.
 *
 * Palette note: each unit keeps its observed surface colours as local
 * literals (they are reproductions of other companies' ad chrome, not
 * this site's design tokens). Text/background pairs are checked
 * against the WCAG AA 4.5:1 floor the axe gate enforces.
 */

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const AD = {
	card: '#ffffff',
	ink: '#050505',
	inkSoft: '#65676b',
	line: '#dfdfdf',
	chip: '#f0f2f5',
	cta: '#1773e0',
	ctaHover: '#166fe5',
	page: '#f0f2f5',
	scrim: 'rgba(5, 5, 5, 0.55)',
} as const;

/** The small disclosure label real ad slots carry (「広告」「スポンサー」「PR」). */
function AdTag({ label }: { readonly label: string }) {
	return (
		<span
			className={css({
				fontFamily: 'sans',
				fontSize: '11px',
				fontWeight: '600',
				letterSpacing: '0.04em',
				color: AD.inkSoft,
			})}
		>
			{label}
		</span>
	);
}

const ctaClassName = /* @__PURE__ */ css({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: '9',
	paddingInline: '4',
	borderRadius: 'md',
	backgroundColor: AD.cta,
	color: '#ffffff',
	fontFamily: 'sans',
	fontSize: '14px',
	fontWeight: '600',
	lineHeight: '1',
	textDecoration: 'none',
	whiteSpace: 'nowrap',
	transition: 'background-color 120ms ease',
	_hover: { backgroundColor: AD.ctaHover },
	_focusVisible: {
		outline: `2px solid ${AD.cta}`,
		outlineOffset: '2px',
	},
});

const slotClassName = /* @__PURE__ */ css({
	fontFamily: 'sans',
});

/** Shared props for every visual ad unit: the creative + the destination. */
interface AdVisualProps {
	readonly imageSrc: string;
	readonly imageAlt: string;
	readonly href: string;
}

// ---------------------------------------------------------------------------
// Leaderboard — the 728×90-class strip observed on publisher pages,
// with the product thumbnail real display units carry
// ---------------------------------------------------------------------------

export interface AdLeaderboardProps extends AdVisualProps {
	readonly headline: string;
	readonly sub?: string;
	readonly ctaLabel: string;
}

export function AdLeaderboard({
	imageSrc,
	imageAlt,
	headline,
	sub,
	ctaLabel,
	href,
}: AdLeaderboardProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-leaderboard">
			<AdTag label="広告" />
			<div
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '4',
					backgroundColor: AD.card,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: AD.line,
					borderRadius: 'md',
					padding: '3',
				})}
			>
				<img
					src={imageSrc}
					alt={imageAlt}
					width={1200}
					height={669}
					loading="lazy"
					className={css({
						display: 'block',
						width: '28',
						height: '16',
						objectFit: 'cover',
						borderRadius: 'sm',
						flexShrink: '0',
						backgroundColor: AD.chip,
					})}
				/>
				<div className={css({ minWidth: '0', flex: '1' })}>
					<p
						className={css({
							margin: '0',
							fontSize: 'md',
							fontWeight: '700',
							lineHeight: '1.35',
							color: AD.ink,
							textWrap: 'balance',
						})}
					>
						{headline}
					</p>
					{sub ? (
						<p
							className={css({
								margin: '0',
								marginBlockStart: '1',
								fontSize: 'sm',
								lineHeight: '1.4',
								color: AD.inkSoft,
							})}
						>
							{sub}
						</p>
					) : null}
				</div>
				<a href={href} className={ctaClassName} data-testid="home-ad-leaderboard-cta">
					{ctaLabel}
				</a>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Feed link card — the Facebook/Meta anatomy from the first pass
// ---------------------------------------------------------------------------

const linkCardClassName = /* @__PURE__ */ css({
	display: 'block',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: AD.line,
	borderRadius: 'lg',
	overflow: 'hidden',
	backgroundColor: AD.card,
	textDecoration: 'none',
	color: 'inherit',
	_focusVisible: {
		outline: `2px solid ${AD.cta}`,
		outlineOffset: '2px',
	},
});

const linkCardImageClassName = /* @__PURE__ */ css({
	display: 'block',
	width: '100%',
	aspectRatio: '1.91 / 1',
	objectFit: 'cover',
	backgroundColor: AD.chip,
});

const linkCardBodyClassName = /* @__PURE__ */ css({
	display: 'block',
	padding: '4',
});

const linkDomainClassName = /* @__PURE__ */ css({
	display: 'block',
	fontSize: '12px',
	fontWeight: '600',
	letterSpacing: '0.02em',
	textTransform: 'uppercase',
	color: AD.inkSoft,
	lineHeight: '1.3',
});

const linkHeadlineClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockStart: '1',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.3',
	color: AD.ink,
});

const linkDescriptionClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockStart: '1',
	fontSize: 'sm',
	lineHeight: '1.35',
	color: AD.inkSoft,
});

export interface AdLinkCardProps extends AdVisualProps {
	readonly advertiser: string;
	readonly body: string;
	readonly domain: string;
	readonly headline: string;
	readonly description: string;
	readonly ctaLabel: string;
}

export function AdLinkCard({
	advertiser,
	body,
	domain,
	headline,
	description,
	imageSrc,
	imageAlt,
	href,
	ctaLabel,
}: AdLinkCardProps) {
	return (
		<article className={slotClassName} data-testid="home-ad-linkcard">
			<header
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '2',
					minWidth: '0',
				})}
			>
				<AdAvatarRow pageName={advertiser} />
				<span className={css({ marginLeft: 'auto', color: AD.inkSoft, flexShrink: '0' })}>⋯</span>
			</header>
			<div className={css({ marginBlockStart: '1' })}>
				<AdTag label="スポンサー広告" />
			</div>
			<div className={css({ marginBlockStart: '2' })}>
				<p
					lang="ja"
					className={css({
						margin: '0',
						fontSize: 'md',
						lineHeight: '1.4',
						color: AD.ink,
						whiteSpace: 'pre-line',
					})}
					data-testid="home-ad-linkcard-body"
				>
					{body}
				</p>
				<a href={href} className={linkCardClassName} data-testid="home-ad-linkcard-link">
					<img
						src={imageSrc}
						alt={imageAlt}
						width={1200}
						height={669}
						loading="lazy"
						className={linkCardImageClassName}
					/>
					<span className={linkCardBodyClassName}>
						<span className={linkDomainClassName}>{domain}</span>
						<span className={linkHeadlineClassName}>{headline}</span>
						<span className={linkDescriptionClassName}>{description}</span>
					</span>
				</a>
				<div
					className={css({ display: 'flex', justifyContent: 'flex-end', marginBlockStart: '3' })}
				>
					<a href={href} className={ctaClassName} data-testid="home-ad-linkcard-cta">
						{ctaLabel}
					</a>
				</div>
			</div>
		</article>
	);
}

// ---------------------------------------------------------------------------
// Video spot — the in-feed video unit real feeds run constantly:
// 16:9 creative, play affordance, duration chip, headline + CTA
// ---------------------------------------------------------------------------

export interface AdVideoProps extends AdVisualProps {
	readonly durationLabel: string;
	readonly headline: string;
	readonly ctaLabel: string;
}

export function AdVideo({
	imageSrc,
	imageAlt,
	durationLabel,
	headline,
	ctaLabel,
	href,
}: AdVideoProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-video">
			<AdTag label="広告" />
			<a
				href={href}
				className={css({
					display: 'block',
					marginBlockStart: '2',
					borderRadius: 'lg',
					overflow: 'hidden',
					backgroundColor: AD.ink,
					textDecoration: 'none',
					_focusVisible: {
						outline: `2px solid ${AD.cta}`,
						outlineOffset: '2px',
					},
				})}
				data-testid="home-ad-video-link"
			>
				<span className={css({ position: 'relative', display: 'block' })}>
					<img
						src={imageSrc}
						alt={imageAlt}
						width={1200}
						height={669}
						loading="lazy"
						className={css({
							display: 'block',
							width: '100%',
							aspectRatio: '16 / 9',
							objectFit: 'cover',
						})}
					/>
					<span
						aria-hidden="true"
						className={css({
							position: 'absolute',
							inset: '0',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							backgroundColor: AD.scrim,
						})}
					>
						<span
							className={css({
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								width: '16',
								height: '16',
								borderRadius: 'full',
								backgroundColor: 'rgba(255, 255, 255, 0.92)',
							})}
						>
							<span
								className={css({
									display: 'block',
									width: '0',
									height: '0',
									borderTop: '8px solid transparent',
									borderBottom: '8px solid transparent',
									borderLeft: '12px solid #050505',
									marginLeft: '2px',
								})}
							/>
						</span>
					</span>
					<span
						className={css({
							position: 'absolute',
							right: '3',
							bottom: '3',
							paddingInline: '2',
							paddingBlock: '1',
							borderRadius: 'sm',
							backgroundColor: 'rgba(5, 5, 5, 0.8)',
							color: '#ffffff',
							fontSize: '11px',
							fontWeight: '600',
							fontVariantNumeric: 'tabular-nums',
						})}
					>
						{durationLabel}
					</span>
				</span>
				<span
					className={css({
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '3',
						backgroundColor: AD.card,
						padding: '3',
					})}
				>
					<span
						className={css({
							fontSize: 'md',
							fontWeight: '700',
							lineHeight: '1.35',
							color: AD.ink,
						})}
					>
						{headline}
					</span>
					<span className={ctaClassName}>{ctaLabel}</span>
				</span>
			</a>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Display rectangle — the 300×250 / 336×280-class unit observed on
// publisher pages, image-led with the copy beside it
// ---------------------------------------------------------------------------

export interface AdRectProps extends AdVisualProps {
	readonly headline: string;
	readonly sub?: string;
	readonly ctaLabel: string;
	/** 'dark' inverts to the ink surface real display ads often use. */
	readonly tone?: 'light' | 'dark';
}

export function AdRect({
	imageSrc,
	imageAlt,
	headline,
	sub,
	ctaLabel,
	href,
	tone = 'light',
}: AdRectProps) {
	const dark = tone === 'dark';
	return (
		<div className={slotClassName} data-testid="home-ad-rect">
			<AdTag label="広告" />
			<a
				href={href}
				className={css({
					display: 'flex',
					flexDirection: { base: 'column', sm: 'row' },
					alignItems: 'stretch',
					gap: '0',
					marginBlockStart: '2',
					minHeight: '56',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: dark ? AD.ink : AD.line,
					borderRadius: 'lg',
					overflow: 'hidden',
					backgroundColor: dark ? AD.ink : AD.card,
					textDecoration: 'none',
					_focusVisible: {
						outline: `2px solid ${AD.cta}`,
						outlineOffset: '2px',
					},
				})}
				data-testid="home-ad-rect-link"
			>
				<img
					src={imageSrc}
					alt={imageAlt}
					width={1200}
					height={669}
					loading="lazy"
					className={css({
						display: 'block',
						width: { base: '100%', sm: '44%' },
						flexShrink: '0',
						aspectRatio: '16 / 9',
						objectFit: 'cover',
						backgroundColor: AD.chip,
					})}
				/>
				<span
					className={css({
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'center',
						gap: '2',
						padding: '5',
						minWidth: '0',
					})}
				>
					<span
						className={css({
							fontSize: 'lg',
							fontWeight: '700',
							lineHeight: '1.3',
							color: dark ? '#ffffff' : AD.ink,
							textWrap: 'balance',
						})}
					>
						{headline}
					</span>
					{sub ? (
						<span
							className={css({
								fontSize: 'sm',
								lineHeight: '1.5',
								color: dark ? AD.chip : AD.inkSoft,
							})}
						>
							{sub}
						</span>
					) : null}
					<span>
						<span className={dark ? darkCtaClassName : ctaClassName} data-testid="home-ad-rect-cta">
							{ctaLabel}
						</span>
					</span>
				</span>
			</a>
		</div>
	);
}

const darkCtaClassName = /* @__PURE__ */ css({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: '9',
	width: 'fit-content',
	paddingInline: '4',
	borderRadius: 'md',
	backgroundColor: '#ffffff',
	color: AD.ink,
	fontFamily: 'sans',
	fontSize: '14px',
	fontWeight: '600',
	lineHeight: '1',
	textDecoration: 'none',
	whiteSpace: 'nowrap',
	transition: 'background-color 120ms ease',
	_hover: { backgroundColor: AD.chip },
	_focusVisible: {
		outline: '2px solid #ffffff',
		outlineOffset: '2px',
	},
});

// ---------------------------------------------------------------------------
// Native card — the thumbnail-and-teaser unit content feeds run:
// small creative, headline, description, 「PR」 disclosure, domain
// ---------------------------------------------------------------------------

export interface AdNativeProps extends AdVisualProps {
	readonly headline: string;
	readonly description: string;
	readonly domain: string;
}

export function AdNative({
	imageSrc,
	imageAlt,
	headline,
	description,
	domain,
	href,
}: AdNativeProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-native">
			<div className={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
				<AdTag label="PR" />
				<span className={css({ color: AD.inkSoft })}>·</span>
				<span
					className={css({
						fontSize: '11px',
						fontWeight: '600',
						letterSpacing: '0.04em',
						color: AD.inkSoft,
					})}
				>
					{domain}
				</span>
			</div>
			<a
				href={href}
				className={css({
					display: 'flex',
					gap: '4',
					alignItems: 'flex-start',
					marginBlockStart: '2',
					padding: '4',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: AD.line,
					borderRadius: 'lg',
					backgroundColor: AD.card,
					textDecoration: 'none',
					_focusVisible: {
						outline: `2px solid ${AD.cta}`,
						outlineOffset: '2px',
					},
				})}
				data-testid="home-ad-native-link"
			>
				<img
					src={imageSrc}
					alt={imageAlt}
					width={1200}
					height={669}
					loading="lazy"
					className={css({
						display: 'block',
						width: '32',
						height: '20',
						objectFit: 'cover',
						borderRadius: 'md',
						flexShrink: '0',
						backgroundColor: AD.chip,
					})}
				/>
				<span className={css({ minWidth: '0' })}>
					<span
						className={css({
							display: 'block',
							fontSize: 'md',
							fontWeight: '700',
							lineHeight: '1.35',
							color: AD.ink,
						})}
					>
						{headline}
					</span>
					<span
						className={css({
							display: 'block',
							marginBlockStart: '1',
							fontSize: 'sm',
							lineHeight: '1.5',
							color: AD.inkSoft,
						})}
					>
						{description}
					</span>
				</span>
			</a>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Avatar row — the advertiser header the link card carries
// ---------------------------------------------------------------------------

function AdAvatarRow({ pageName }: { readonly pageName: string }) {
	return (
		<span className={css({ display: 'flex', alignItems: 'center', gap: '2', minWidth: '0' })}>
			<span
				className={css({
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: '10',
					height: '10',
					borderRadius: 'full',
					backgroundColor: AD.card,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: AD.line,
					flexShrink: '0',
					overflow: 'hidden',
				})}
			>
				<SiteMark className={css({ height: '6', width: 'auto' })} />
			</span>
			<span
				className={css({
					fontSize: 'md',
					fontWeight: '700',
					lineHeight: '1.3',
					color: AD.ink,
				})}
			>
				{pageName}
			</span>
		</span>
	);
}
