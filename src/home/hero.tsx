import { css } from '../../styled-system/css';
import { Button } from '../editorial/primitives/Button';
import { Grid, GridItem } from '../editorial/primitives/Grid';
import { PageSection } from '../editorial/primitives/PageSection';
import { EditorialIndex } from '../editorial/primitives/EditorialIndex';
import { TextLink } from '../editorial/primitives/TextLink';
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
 * Issue #1135 — the hero is the page's FOCAL composition, and it
 * used to be a single left column: the statement occupied the
 * measure's left half and the right half of a 1440 px viewport
 * stayed empty from the masthead down to the first section. The
 * L-C review recorded that as the page's largest visual defect
 * ("右半分が空白のまま", `docs/verification/design/1135-lc-review/`).
 *
 * The fix is an asymmetric 12-track composition, not a wider
 * paragraph:
 *
 *   - the statement keeps the 7/12 column (the reading measure the
 *     copy was written for),
 *   - the page's own section index takes the 4/12 column on the
 *     opposite side, aligned to the BOTTOM of the statement, so the
 *     composition reads as a diagonal (dense top-left, light
 *     bottom-right) instead of a column with a hole in it,
 *   - the index labels are the section titles the page already
 *     publishes — the rail restates them, it does not invent copy.
 *
 * Invariants kept (e2e/smoke.spec.ts, e2e/about.spec.ts):
 *   - exactly one `<h1>` on the page, accessible name `my-web-2026`
 *   - the section stays `aria-labelledby="hero-title"`
 *   - one visible `/about` link and one visible `/portfolio` link
 *     inside the section (the Issue #500 one-click contract)
 */

/**
 * The home page's section index.
 *
 * Every entry is an anchor into a section the page renders, and
 * every label is the section's own published title — the rail is a
 * restatement, so the two can never disagree. The anchors are the
 * `id` each owning section declares (`ExploreSection` → `explore`,
 * `CurrentProjects` → `current`, the composer's status band →
 * `status`, the closing band → `contact`).
 */
const SECTION_INDEX = [
	{ id: 'explore', number: '00', title: 'サイト案内' },
	{ id: 'current', number: '01', title: '現在地' },
	{ id: 'status', number: '02', title: 'サイトの状態' },
	{ id: 'contact', number: '03', title: 'お問い合わせ' },
] as const;

export function Hero() {
	return (
		<PageSection labelledBy="hero-title" rhythm="hero" name="hero" testId="home-hero">
			<Grid template="12" gap="6">
				<GridItem span={7}>
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
						{/* Issue #1135 — the identity mark was a 94 px sticker
						    above a 32 px statement: the page's only identity
						    asset read as an ornament and the statement carried
						    the whole entry. The mark is now a display-tier
						    anchor (118 px) and the statement is the loudest
						    element, in that order. */}
						<SiteMark className={css({ height: '20', width: 'auto' })} />
						<span className={css({ srOnly: true })}>my-web-2026</span>
					</h1>
					<p
						lang="ja"
						className={css({
							margin: '0',
							marginBlockStart: '6',
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
				</GridItem>
				{/* The index rail. `alignSelf: 'end'` puts it on the
				    statement's baseline — the bottom-right of the hero
				    carries the rail, so the void the review recorded is
				    occupied by the page's own structure. */}
				<GridItem
					span={4}
					start={9}
					className={css({
						alignSelf: 'end',
						borderTopWidth: '1px',
						borderTopStyle: 'solid',
						borderTopColor: 'border.subtle',
					})}
				>
					<EditorialIndex
						ariaLabel="Index"
						items={SECTION_INDEX.map((entry, index) => ({
							href: `#${entry.id}`,
							number: String(index + 1).padStart(2, '0'),
							label: entry.title,
						}))}
					/>
				</GridItem>
			</Grid>
		</PageSection>
	);
}
