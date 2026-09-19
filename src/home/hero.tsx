import { Container } from '../editorial/primitives/Container';
import { css } from '../../styled-system/css';
import { PACKAGE_VERSION } from './version';

/**
 * Hero — top section of the home page.
 *
 * Carries the single `<h1>` on the page and identifies the person
 * behind the platform before describing the migration state. The
 * public transition link to the 2025 edition is primary; source is
 * available as a secondary action.
 *
 * Issue #31 — editorial spread (fourth pass). The Hero adopts the
 * 4/12 (rail) + 8/12 (lead) grid split that the body sections use in
 * their spread `SectionHeading`. The metadata rail (edition /
 * my-web-2026 · 2026 Preview / v0.2.0 · MIT) sits in the narrow
 * left column on the same x-axis as the body section headings
 * below. The lead column carries caption → h1 → body → CTAs.
 *
 * Type and spacing jump at golden ratio:
 * - h1 climbs to `4xl` (64px) at `lg` and wider, a 4× jump over
 *   body `md` (16px). That contrast is the editorial voice.
 * - caption ↔ h1 (8px), h1 ↔ lead body (40px), lead ↔ secondary
 *   (0, continuous prose), secondary ↔ CTAs (16px).
 * - Hero padding is `24/32` (96/128px) — the page-entry beat.
 *
 * Below `lg` the columns stack: lead first, rail second. The rail
 * is hidden via `display: none` below `lg` because the lead column
 * already carries the version line in its caption, so the rail
 * duplicates the same metadata at narrow widths.
 */
export function Hero() {
	return (
		<section
			aria-labelledby="hero-title"
			className={css({
				paddingBlock: { base: '16', lg: '32' },
			})}
		>
			<Container>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' },
						columnGap: { base: '0', lg: '10' },
						rowGap: { base: '10', lg: '0' },
						alignItems: 'start',
					})}
				>
					<aside
						aria-hidden="true"
						className={css({
							display: { base: 'none', lg: 'flex' },
							flexDirection: 'column',
							gap: '1',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							lineHeight: '1.6',
						})}
					>
						<span lang="en">edition</span>
						<span lang="en">my-web-2026 · 2026 Preview</span>
						<span lang="en">v{PACKAGE_VERSION} · MIT</span>
					</aside>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							minWidth: '0',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
							})}
						>
							my-web-2026 · v{PACKAGE_VERSION} — 2026 Preview
						</span>
						<h1
							id="hero-title"
							lang="ja"
							className={css({
								margin: '0',
								marginBlockStart: '2',
								fontFamily: 'sans',
								fontSize: { base: '3xl', lg: '4xl' },
								fontWeight: '700',
								lineHeight: { base: '1.15', lg: '1.05' },
								color: 'text.default',
								letterSpacing: '-0.03em',
							})}
						>
							木村友亮 / samuido
						</h1>
						<p
							lang="ja"
							className={css({
								margin: '0',
								marginBlockStart: '10',
								fontFamily: 'sans',
								fontSize: 'lg',
								lineHeight: '1.6',
								color: 'text.default',
							})}
						>
							開発・制作・活動をまとめる次の Personal Web Platform を構築しています。Portfolio /
							content / activity を段階的に移行中です。
						</p>
						<p
							lang="ja"
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'md',
								lineHeight: '1.6',
								color: 'text.muted',
							})}
						>
							2025 edition は引き続き yusuke-kim.com で公開中です。この 2026 edition は移行途中の
							public preview です。
						</p>
						<div
							className={css({
								display: 'flex',
								flexWrap: 'wrap',
								gap: '4',
								marginBlockStart: '6',
							})}
						>
							<a
								href="https://yusuke-kim.com"
								rel="noopener noreferrer"
								target="_blank"
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									gap: '2',
									paddingInline: '4',
									height: '10',
									borderRadius: 'md',
									backgroundColor: 'bg.accent',
									color: 'text.inverse',
									fontFamily: 'sans',
									fontSize: 'md',
									fontWeight: '600',
									textDecoration: 'none',
									transition: 'background-color 120ms ease',
									_hover: { backgroundColor: 'colors.brand.600' },
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								<span lang="en">2025 edition</span> を見る
							</a>
							<a
								href="https://github.com/rebuildup/my-web-2026"
								rel="noopener noreferrer"
								target="_blank"
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									gap: '2',
									color: 'text.accent',
									fontFamily: 'sans',
									fontSize: 'md',
									fontWeight: '600',
									textDecoration: 'none',
									transition: 'color 120ms ease',
									_hover: { textDecoration: 'underline' },
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								<span lang="en">GitHub</span> でソースを見る →
							</a>
						</div>
					</div>
				</div>
			</Container>
		</section>
	);
}
