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
 * Issue #31 — proximity revision (second iteration). The Hero
 * drops the asymmetric 2-column layout and renders as a single
 * column inside the Container. The metadata rail sits below the
 * CTAs as a tight inline footer (three mono lines, gap 1) so the
 * Hero reads as a single editorial unit instead of a split layout.
 *
 * Per-element `marginBlockStart` encodes the semantic proximity:
 *
 * - caption ↔ h1: 2 (8px) — they are one identity cluster.
 * - h1 ↔ lead body: 5 (20px) — cluster separator; the heading ends
 *   and the body block begins.
 * - lead body ↔ secondary body: 0 — continuous prose; the two
 *   paragraphs are one thought split across muted/default contrast.
 * - secondary body ↔ CTAs: 4 (16px) — CTAs close the body block.
 * - CTAs ↔ metadata rail: 8 (32px) — the rail is a separate
 *   annotation cluster; proximity alone marks it as a footnote.
 */
export function Hero() {
	return (
		<section
			aria-labelledby="hero-title"
			className={css({
				paddingBlock: { base: '10', lg: '14' },
			})}
		>
			<Container>
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						maxWidth: '720px',
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
							fontSize: { base: '2xl', lg: '3xl' },
							fontWeight: '700',
							lineHeight: { base: '1.2', lg: '1.1' },
							color: 'text.default',
							letterSpacing: '-0.02em',
						})}
					>
						木村友亮 / samuido
					</h1>
					<p
						lang="ja"
						className={css({
							margin: '0',
							marginBlockStart: '5',
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
							marginBlockStart: '4',
						})}
					>
						<a
							href="https://yusuke-kim.com"
							rel="noopener noreferrer"
							target="_blank"
							lang="en"
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
							2025 edition を見る
						</a>
						<a
							href="https://github.com/rebuildup/my-web-2026"
							rel="noopener noreferrer"
							target="_blank"
							lang="en"
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
							GitHub でソースを見る →
						</a>
					</div>
					<div
						aria-hidden="true"
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '1',
							marginBlockStart: '8',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							lineHeight: '1.6',
						})}
					>
						<span lang="en">edition</span>
						<span lang="en">my-web-2026 · 2026 Preview</span>
						<span lang="en">v{PACKAGE_VERSION} · MIT</span>
					</div>
				</div>
			</Container>
		</section>
	);
}
