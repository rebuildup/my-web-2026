import { css } from '../../styled-system/css';
import { Button } from '../editorial/primitives/Button';
import { PageSection } from '../editorial/primitives/PageSection';
import { sizeTitle } from '../editorial/primitives/shared-styles';
import { SiteMark } from './mark';

/**
 * Hero — top section of the home page.
 *
 * Issue #925 second pass: the hero is back to being the page's
 * editorial entry — the 現在地 statement in normal flow content.
 * The advertising surfaces are a separate axis and live in
 * `src/home/ads/` (leaderboard strip, in-feed link card, search
 * listing, display rectangles), placed around the content sections
 * by the composer the way a real monetized page mixes formats.
 * See `docs/verification/home/925-ad-reproduction/README.md`.
 *
 * Invariants kept (e2e/smoke.spec.ts, e2e/about.spec.ts):
 *   - exactly one `<h1>` on the page, accessible name `my-web-2026`
 *   - the section stays `aria-labelledby="hero-title"`
 *   - one visible `/about` link and one visible `/portfolio` link
 *     inside the section (the Issue #500 one-click contract)
 */
export function Hero() {
	return (
		<PageSection labelledBy="hero-title" rhythm="hero">
			<p
				className={css({
					margin: '0',
					marginBlockEnd: '4',
					fontFamily: 'mono',
					fontSize: 'sm',
					letterSpacing: '0.08em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				Personal site
			</p>
			<h1 id="hero-title" className={css({ margin: '0' })}>
				<SiteMark className={css({ height: '16', width: 'auto' })} />
				<span className={css({ srOnly: true })}>my-web-2026</span>
			</h1>
			<p
				lang="ja"
				className={css({
					margin: '0',
					marginBlockStart: '6',
					maxWidth: '640px',
					fontFamily: 'sans',
					fontSize: sizeTitle,
					fontWeight: '700',
					lineHeight: '1.4',
					color: 'text.default',
					textWrap: 'balance',
				})}
				data-testid="home-hero-lead"
			>
				木村友亮 / samuido です。ソフトウェアを作りながら、映像やデザインも作る developer /
				creator。
			</p>
			<p
				lang="ja"
				className={css({
					margin: '0',
					marginBlockStart: '4',
					maxWidth: '640px',
					fontFamily: 'sans',
					fontSize: 'md',
					lineHeight: '1.7',
					color: 'text.default',
					textWrap: 'pretty',
				})}
			>
				After Effects 向けのツールを BOOTH で配布し、高専祭の公式サイトを作り、MV
				などの映像制作も受けてきた。今は宇部高専 制御情報工学科の4年生として、Web
				アプリを中心に制作を続けている。
			</p>
			<div className={css({ marginBlockStart: '6', display: 'flex', gap: '4' })}>
				<Button as="a" href="/about" variant="primary" data-testid="home-hero-about">
					About me
				</Button>
				<Button as="a" href="/portfolio" variant="secondary" data-testid="home-hero-portfolio">
					Portfolio
				</Button>
			</div>
		</PageSection>
	);
}
