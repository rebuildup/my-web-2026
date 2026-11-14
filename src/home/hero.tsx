import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { formatCount } from './current/derive';
import { SiteMark } from './mark';

/**
 * Hero — top section of the home page (Issue #925 redesign).
 *
 * Composition source: a REAL web advertisement, observed live — the
 * Facebook feed link-ad card anatomy documented in
 * `docs/verification/home/925-ad-reproduction/README.md` (Meta Ad
 * Library, JP, active ads only). The reproduction keeps the ad's
 * structure — advertiser row, primary text, link card, single CTA —
 * and replaces every asset and claim with this site's own committed
 * facts. The card is deliberately styled with the ad's own palette
 * (FB blue CTA, white card, #050505 ink) rather than the editorial
 * tokens: it is a reproduced creative surface, not a new design-token
 * decision, and direction B's monochrome rule resumes below it.
 *
 * What the ad sells is the site's 現在地: what is being built, what is
 * in flight, and where it is going. Every number in the body is either
 * a committed registry fact (15 tools) or a measured git fact passed in
 * by the composer (`stats`) — no invented claims.
 *
 * Invariants kept from the pre-#925 hero (e2e/smoke.spec.ts):
 *   - exactly one `<h1>` on the page, accessible name `my-web-2026`
 *   - the section stays `aria-labelledby="hero-title"`
 *   - the hero links to `/about` through the ad's single CTA (the old
 *     `/portfolio` hero link moved to the link card destination
 *     decision recorded in the verification doc)
 */
export interface HeroStats {
	/** Commits counted inside the activity window (measured, git-sourced). */
	readonly commitsInWindow: number;
	/** The window `commitsInWindow` was counted over, in days. */
	readonly windowDays: number;
	/** Whole-history commit count, when the source knows it. */
	readonly commitsTotal?: number;
}

export interface HeroProps {
	/**
	 * The measured activity facts the ad body cites. Optional because
	 * the bullet is omitted rather than faked when no source supplies
	 * them — an ad that cannot prove a number does not print one.
	 */
	readonly stats?: HeroStats;
}

// The reproduced creative's palette — literal values on purpose. These
// are the observed ad's colours (Meta link-ad card: white card,
// #050505 ink, #65676b secondary, #1877F2 CTA), scoped to this
// component; they are NOT new semantic tokens and do not leak into the
// rest of the page.
const AD = {
	card: '#ffffff',
	ink: '#050505',
	inkSoft: '#65676b',
	line: '#dfdfdf',
	cta: '#1877f2',
	ctaHover: '#166fe5',
	chip: '#f0f2f5',
} as const;

/** Card padding — FB feed cards pad their content 16px. */
const cardClassName = /* @__PURE__ */ css({
	backgroundColor: AD.card,
	color: AD.ink,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: AD.line,
	borderRadius: 'lg',
	padding: '4',
	maxWidth: '640px',
	marginInline: 'auto',
	fontFamily: 'sans',
});

const headerClassName = /* @__PURE__ */ css({
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	minWidth: '0',
});

const avatarClassName = /* @__PURE__ */ css({
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
});

const pageNameClassName = /* @__PURE__ */ css({
	fontSize: '15px',
	fontWeight: '700',
	lineHeight: '1.3',
	color: AD.ink,
});

const adLabelClassName = /* @__PURE__ */ css({
	fontSize: '13px',
	lineHeight: '1.3',
	color: AD.inkSoft,
});

const moreClassName = /* @__PURE__ */ css({
	display: 'inline-flex',
	alignItems: 'center',
	color: AD.inkSoft,
	marginLeft: 'auto',
	flexShrink: '0',
});

const bodyClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockStart: '3',
	fontSize: '15px',
	lineHeight: '1.36',
	color: AD.ink,
	whiteSpace: 'pre-line',
});

const linkCardClassName = /* @__PURE__ */ css({
	display: 'block',
	marginBlockStart: '3',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: AD.line,
	borderRadius: 'md',
	overflow: 'hidden',
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
	padding: '3',
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
	fontSize: '16px',
	fontWeight: '700',
	lineHeight: '1.3',
	color: AD.ink,
});

const linkDescriptionClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockStart: '1',
	fontSize: '13px',
	lineHeight: '1.35',
	color: AD.inkSoft,
});

const ctaRowClassName = /* @__PURE__ */ css({
	display: 'flex',
	justifyContent: 'flex-end',
	marginBlockStart: '3',
});

const ctaClassName = /* @__PURE__ */ css({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: '9',
	paddingInline: '4',
	borderRadius: 'md',
	backgroundColor: AD.cta,
	color: '#ffffff',
	fontSize: '14px',
	fontWeight: '600',
	lineHeight: '1',
	textDecoration: 'none',
	transition: 'background-color 120ms ease',
	_hover: { backgroundColor: AD.ctaHover },
	_focusVisible: {
		outline: `2px solid ${AD.cta}`,
		outlineOffset: '2px',
	},
});

// The link card previews the destination the way a real link ad
// previews the landing page: same domain, same og:image, and the
// same description `src/routes/index.tsx` publishes as the page's
// meta description.
const LINK_DESCRIPTION =
	'開発・制作・活動をまとめる次の Personal Web Platform を構築しています。Portfolio / content / activity を段階的に移行中です。この 2026 edition は移行途中の public preview です。';

/**
 * The ad body — hook, benefit bullets, close. The measured-activity
 * bullet renders only when the composer can prove the numbers; the
 * copy never prints an unmeasured figure.
 */
function adBody(stats: HeroStats | undefined): string {
	const bullets = [
		'・Cloudflare Workers で動く自分専用の基盤',
		'・公開中の単体 Web ツール 15 個',
		'・制作物を Notion CMS へ全件移行中',
	];
	if (stats) {
		bullets.push(
			`・直近 ${stats.windowDays} 日で ${formatCount(stats.commitsInWindow)} 件のコミット`,
		);
	}
	return [
		'個人の Web プラットフォームを、毎日作り直している。',
		'.',
		...bullets,
		'.',
		'完成していないから、毎日更新されている。',
	].join('\n');
}

export function Hero({ stats }: HeroProps) {
	return (
		<section
			aria-labelledby="hero-title"
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<article className={cardClassName} data-testid="home-hero-ad">
					<header className={headerClassName}>
						<h1 id="hero-title" className={css({ margin: '0', display: 'flex' })}>
							<span className={avatarClassName}>
								<SiteMark className={css({ height: '6', width: 'auto' })} />
							</span>
							<span className={css({ srOnly: true })}>my-web-2026</span>
						</h1>
						<span className={pageNameClassName}>rebuildup</span>
						<span className={adLabelClassName}>· スポンサー広告</span>
						<span aria-hidden="true" className={moreClassName}>
							⋯
						</span>
					</header>
					<p lang="ja" className={bodyClassName} data-testid="home-hero-ad-body">
						{adBody(stats)}
					</p>
					<a href="/about" className={linkCardClassName} data-testid="home-hero-ad-linkcard">
						<img
							src="/og/default-card.png"
							alt=""
							width={1200}
							height={630}
							loading="eager"
							className={linkCardImageClassName}
						/>
						<span className={linkCardBodyClassName}>
							<span className={linkDomainClassName}>rebuildup.dev</span>
							<span className={linkHeadlineClassName}>
								開発・制作・活動をまとめる次の Personal Web Platform
							</span>
							<span className={linkDescriptionClassName}>{LINK_DESCRIPTION}</span>
						</span>
					</a>
					<div className={ctaRowClassName}>
						<a href="/about" className={ctaClassName} data-testid="home-hero-ad-cta">
							詳しくはこちら
						</a>
					</div>
				</article>
			</Container>
		</section>
	);
}
