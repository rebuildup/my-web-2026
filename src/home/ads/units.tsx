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
 * Direction rules (owner feedback, second/third pass):
 *   - an ad must point at real content — a published Tool — and must
 *     carry a visual; text-only units were rejected;
 *   - copy is minimal — one hook line plus the CTA;
 *   - format mimicry alone is not enough: each unit is built as a
 *     designed ad CREATIVE (bold type scale, colour fields, image-led
 *     composition, offer-style chips) because that — not the frame —
 *     is what gives real ads their pull.
 *
 * Every creative is a committed asset (`/tool-previews/*.webp`, the
 * same captures the Tools index uses) and every destination is a real
 * route. Palette literals below are the observed ad chrome colours,
 * scoped to this file — not editorial tokens.
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

/** Blue CTA used on light surfaces (the observed ad blue, AA-adjusted). */
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

/** White pill CTA for dark/image creatives — the high-contrast button real banners use. */
const lightCtaClassName = /* @__PURE__ */ css({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: '9',
	paddingInline: '4',
	borderRadius: 'md',
	backgroundColor: '#ffffff',
	color: AD.ink,
	fontFamily: 'sans',
	fontSize: '14px',
	fontWeight: '700',
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

/** Offer chip — the 「無料」「期間限定」burst real ad creatives carry. */
const offerChipClassName = /* @__PURE__ */ css({
	display: 'inline-flex',
	alignItems: 'center',
	alignSelf: 'flex-start',
	paddingInline: '2',
	paddingBlock: '1',
	borderRadius: 'full',
	backgroundColor: 'rgba(255, 255, 255, 0.16)',
	color: '#ffffff',
	fontSize: '11px',
	fontWeight: '700',
	letterSpacing: '0.06em',
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
// Leaderboard — designed banner creative: dark field, huge headline,
// offer chip, product visual bleeding in from the right
// ---------------------------------------------------------------------------

export interface AdLeaderboardProps extends AdVisualProps {
	readonly chip: string;
	readonly headline: string;
	readonly ctaLabel: string;
}

export function AdLeaderboard({
	imageSrc,
	imageAlt,
	chip,
	headline,
	ctaLabel,
	href,
}: AdLeaderboardProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-leaderboard">
			<AdTag label="広告" />
			<a
				href={href}
				className={css({
					display: 'flex',
					flexDirection: { base: 'column', sm: 'row' },
					sm: { height: '44' },
					marginBlockStart: '2',
					overflow: 'hidden',
					borderRadius: 'lg',
					backgroundColor: AD.ink,
					textDecoration: 'none',
					_focusVisible: {
						outline: `2px solid ${AD.cta}`,
						outlineOffset: '2px',
					},
				})}
				data-testid="home-ad-leaderboard-link"
			>
				<div
					className={css({
						flexShrink: '0',
						height: { base: '48', sm: 'auto' },
						sm: { width: '34%' },
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
							width: '100%',
							height: '100%',
							objectFit: 'cover',
						})}
					/>
				</div>
				<div
					className={css({
						flex: '1',
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'center',
						gap: '3',
						padding: '6',
						minWidth: '0',
					})}
				>
					<span className={offerChipClassName}>{chip}</span>
					<p
						className={css({
							margin: '0',
							fontSize: { base: 'xl', sm: '3xl' },
							fontWeight: '800',
							lineHeight: '1.25',
							letterSpacing: '-0.01em',
							color: '#ffffff',
							textWrap: 'balance',
						})}
					>
						{headline}
					</p>
					<span>
						<span className={lightCtaClassName} data-testid="home-ad-leaderboard-cta">
							{ctaLabel}
						</span>
					</span>
				</div>
			</a>
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
		// Feed link cards render at feed-column width (~470–640 px), not
		// full bleed — the observed anatomy is a column unit.
		<article
			className={css({ fontFamily: 'sans', maxWidth: '160' })}
			data-testid="home-ad-linkcard"
		>
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
						fontWeight: '600',
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
// Video spot — 16:9 creative + play affordance + headline, the in-feed
// video unit real feeds run constantly
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
							backgroundColor: 'rgba(5, 5, 5, 0.35)',
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
								backgroundColor: 'rgba(255, 255, 255, 0.95)',
								boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
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
					<span
						className={css({
							position: 'absolute',
							left: '4',
							bottom: '4',
							right: '4',
							fontSize: { base: 'lg', sm: 'xl' },
							fontWeight: '800',
							lineHeight: '1.3',
							color: '#ffffff',
							textShadow: '0 1px 8px rgba(0, 0, 0, 0.6)',
							textWrap: 'balance',
						})}
					>
						{headline}
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
					<span className={css({ fontSize: 'sm', fontWeight: '600', color: AD.ink })}>
						rebuildup.dev
					</span>
					<span className={ctaClassName} data-testid="home-ad-video-cta">
						{ctaLabel}
					</span>
				</span>
			</a>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Display rectangle — full-bleed creative: image under a scrim gradient,
// huge headline, offer-style CTA. The IAB unit real pages run.
// ---------------------------------------------------------------------------

export interface AdRectProps extends AdVisualProps {
	readonly headline: string;
	readonly sub?: string;
	readonly ctaLabel: string;
}

export function AdRect({ imageSrc, imageAlt, headline, sub, ctaLabel, href }: AdRectProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-rect">
			<AdTag label="広告" />
			<a
				href={href}
				className={css({
					position: 'relative',
					display: 'block',
					marginBlockStart: '2',
					overflow: 'hidden',
					borderRadius: 'lg',
					minHeight: '64',
					sm: { height: '80' },
					backgroundColor: AD.ink,
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
						position: 'absolute',
						inset: '0',
						width: '100%',
						height: '100%',
						objectFit: 'cover',
					})}
				/>
				<span
					aria-hidden="true"
					className={css({
						position: 'absolute',
						inset: '0',
						backgroundImage:
							'linear-gradient(to top, rgba(5, 5, 5, 0.94) 0%, rgba(5, 5, 5, 0.6) 45%, rgba(5, 5, 5, 0.15) 100%)',
					})}
				/>
				<span
					className={css({
						position: 'relative',
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'flex-end',
						gap: '3',
						height: '100%',
						minHeight: '64',
						padding: '6',
					})}
				>
					<span
						className={css({
							fontSize: { base: '2xl', sm: '4xl' },
							fontWeight: '800',
							lineHeight: '1.2',
							letterSpacing: '-0.015em',
							color: '#ffffff',
							textWrap: 'balance',
							textShadow: '0 2px 12px rgba(0, 0, 0, 0.45)',
						})}
					>
						{headline}
					</span>
					{sub ? (
						<span
							className={css({
								fontSize: { base: 'sm', sm: 'md' },
								fontWeight: '500',
								lineHeight: '1.5',
								color: 'rgba(255, 255, 255, 0.88)',
							})}
						>
							{sub}
						</span>
					) : null}
					<span>
						<span className={lightCtaClassName} data-testid="home-ad-rect-cta">
							{ctaLabel}
						</span>
					</span>
				</span>
			</a>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Native card — thumbnail teaser unit, selling a Tool
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
						width: '40',
						height: '24',
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

// ---------------------------------------------------------------------------
// Carousel — the swipeable multi-card unit feeds and search run:
// 「スワイプしよう」 cards, each its own creative + destination
// ---------------------------------------------------------------------------

export interface AdCarouselItem {
	readonly imageSrc: string;
	readonly imageAlt: string;
	readonly title: string;
	readonly href: string;
}

export interface AdCarouselProps {
	readonly items: readonly AdCarouselItem[];
}

export function AdCarousel({ items }: AdCarouselProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-carousel">
			<div
				className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}
			>
				<AdTag label="広告" />
				<span
					aria-hidden="true"
					className={css({ fontSize: 'xs', fontWeight: '600', color: AD.inkSoft })}
				>
					‹ スワイプ ›
				</span>
			</div>
			<div
				className={css({
					display: 'flex',
					gap: '3',
					overflowX: 'auto',
					scrollSnapType: 'x mandatory',
					marginBlockStart: '2',
					paddingBlock: '2',
					// Bleed the scroll area to the container edges so cards can
					// scroll under the padding like a real feed carousel.
					marginInline: '-2',
					paddingInline: '2',
				})}
			>
				{items.map((item) => (
					<a
						key={item.href}
						href={item.href}
						className={css({
							flexShrink: '0',
							width: { base: '56', sm: '52' },
							scrollSnapAlign: 'start',
							display: 'flex',
							flexDirection: 'column',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: AD.line,
							borderRadius: 'lg',
							overflow: 'hidden',
							backgroundColor: AD.card,
							textDecoration: 'none',
							_focusVisible: {
								outline: `2px solid ${AD.cta}`,
								outlineOffset: '2px',
							},
						})}
					>
						<img
							src={item.imageSrc}
							alt={item.imageAlt}
							width={1200}
							height={669}
							loading="lazy"
							className={css({
								display: 'block',
								width: '100%',
								aspectRatio: '16 / 9',
								objectFit: 'cover',
								backgroundColor: AD.chip,
							})}
						/>
						<span
							className={css({
								display: 'block',
								padding: '3',
								fontSize: 'sm',
								fontWeight: '700',
								lineHeight: '1.35',
								color: AD.ink,
							})}
						>
							{item.title}
						</span>
					</a>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Playable ad — the in-feed unit game ads run: a live, framed piece of
// the product itself with play chrome and a CTA bar
// ---------------------------------------------------------------------------

export interface AdPlayableProps {
	/** The chromeless tool shell the frame embeds (`/tools/<slug>`). */
	readonly embedSrc: string;
	readonly embedTitle: string;
	readonly headline: string;
	readonly domain: string;
	readonly ctaLabel: string;
	readonly href: string;
}

export function AdPlayable({
	embedSrc,
	embedTitle,
	headline,
	domain,
	ctaLabel,
	href,
}: AdPlayableProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-playable">
			<div className={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
				<AdTag label="プレイアブル広告" />
				<span
					className={css({
						fontSize: '11px',
						fontWeight: '700',
						letterSpacing: '0.06em',
						color: '#ffffff',
						backgroundColor: AD.ink,
						borderRadius: 'sm',
						paddingInline: '2',
						paddingBlock: '1',
					})}
				>
					TRY IT
				</span>
			</div>
			<div
				className={css({
					marginBlockStart: '2',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: AD.line,
					borderRadius: 'lg',
					overflow: 'hidden',
					backgroundColor: AD.ink,
				})}
			>
				<div
					className={css({
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '3',
						paddingInline: '3',
						paddingBlock: '2',
						backgroundColor: AD.ink,
						color: '#ffffff',
					})}
				>
					<span className={css({ fontSize: 'sm', fontWeight: '700' })}>▶ {headline}</span>
					<span className={css({ fontSize: 'xs', color: 'rgba(255,255,255,0.7)' })}>
						その場でプレイ
					</span>
				</div>
				<iframe
					src={embedSrc}
					title={embedTitle}
					loading="lazy"
					className={css({
						display: 'block',
						width: '100%',
						height: { base: '80', sm: '96' },
						border: '0',
						backgroundColor: '#ffffff',
					})}
				/>
				<div
					className={css({
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '3',
						backgroundColor: AD.card,
						padding: '3',
					})}
				>
					<span className={css({ fontSize: 'sm', fontWeight: '600', color: AD.inkSoft })}>
						{domain}
					</span>
					<a href={href} className={ctaClassName} data-testid="home-ad-playable-cta">
						{ctaLabel}
					</a>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// App-install ad — the store-listing anatomy game/app ads run:
// icon, name, developer, free badge, install CTA
// ---------------------------------------------------------------------------

export interface AdInstallProps {
	readonly iconSrc: string;
	readonly iconAlt: string;
	readonly name: string;
	readonly tagline: string;
	readonly ctaLabel: string;
	readonly href: string;
}

export function AdInstall({ iconSrc, iconAlt, name, tagline, ctaLabel, href }: AdInstallProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-install">
			<AdTag label="広告" />
			<div
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '4',
					marginBlockStart: '2',
					padding: '4',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: AD.line,
					borderRadius: 'lg',
					backgroundColor: AD.card,
				})}
			>
				<img
					src={iconSrc}
					alt={iconAlt}
					width={1200}
					height={669}
					loading="lazy"
					className={css({
						display: 'block',
						width: '20',
						height: '20',
						objectFit: 'cover',
						borderRadius: 'xl',
						flexShrink: '0',
						backgroundColor: AD.chip,
					})}
				/>
				<div className={css({ flex: '1', minWidth: '0' })}>
					<p className={css({ margin: '0', fontSize: 'md', fontWeight: '700', color: AD.ink })}>
						{name}
					</p>
					<p className={css({ margin: '0', fontSize: 'xs', color: AD.inkSoft })}>
						rebuildup · <span className={css({ fontWeight: '700', color: AD.cta })}>無料</span>
					</p>
					<p
						className={css({
							margin: '0',
							marginBlockStart: '1',
							fontSize: 'sm',
							lineHeight: '1.45',
							color: AD.inkSoft,
						})}
					>
						{tagline}
					</p>
				</div>
				<a href={href} className={ctaClassName} data-testid="home-ad-install-cta">
					{ctaLabel}
				</a>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Product/listing ad — the commerce anatomy Amazon-style ads run:
// hero image, long product title, domain, price-row CTA
// ---------------------------------------------------------------------------

export interface AdProductProps extends AdVisualProps {
	readonly title: string;
	readonly description: string;
	readonly domain: string;
	readonly ctaLabel: string;
}

export function AdProduct({
	imageSrc,
	imageAlt,
	title,
	description,
	domain,
	ctaLabel,
	href,
}: AdProductProps) {
	return (
		<div className={slotClassName} data-testid="home-ad-product">
			<AdTag label="スポンサー広告" />
			<a
				href={href}
				className={css({
					display: 'block',
					marginBlockStart: '2',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: AD.line,
					borderRadius: 'lg',
					overflow: 'hidden',
					backgroundColor: AD.card,
					textDecoration: 'none',
					_focusVisible: {
						outline: `2px solid ${AD.cta}`,
						outlineOffset: '2px',
					},
				})}
				data-testid="home-ad-product-link"
			>
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
						backgroundColor: AD.chip,
					})}
				/>
				<span className={css({ display: 'block', padding: '4' })}>
					<span
						className={css({
							display: 'block',
							fontSize: 'xs',
							fontWeight: '600',
							letterSpacing: '0.02em',
							color: AD.inkSoft,
						})}
					>
						{domain}
					</span>
					<span
						className={css({
							display: 'block',
							marginBlockStart: '1',
							fontSize: 'md',
							fontWeight: '700',
							lineHeight: '1.4',
							color: AD.ink,
						})}
					>
						{title}
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
					<span
						className={css({
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							gap: '3',
							marginBlockStart: '3',
						})}
					>
						<span
							className={css({
								fontSize: 'lg',
								fontWeight: '800',
								color: AD.cta,
							})}
						>
							無料
						</span>
						<span className={ctaClassName} data-testid="home-ad-product-cta">
							{ctaLabel}
						</span>
					</span>
				</span>
			</a>
		</div>
	);
}
