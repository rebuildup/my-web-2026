import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { PACKAGE_VERSION } from './version';

/**
 * Footer — fourth section of the home page.
 *
 * Hosts the public transition metadata for the 2025 / 2026 editions,
 * the canonical source link, and the operational entry points.
 *
 * Issue #31 — editorial spread (fourth pass). The footer sits on
 * the same 12-column grid as the rest of the page, divided into
 * three equal columns. The `04` decoration jumps to `4xl` (64px)
 * so it shares the display voice with the Hero h1 — the page reads
 * with one display voice across Hero and Footer. Per-element
 * `marginBlockStart` carries the proximity rule within each column.
 */
export function Footer() {
	return (
		<footer
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: {
							base: '1fr',
							lg: 'minmax(0, 4fr) minmax(0, 4fr) minmax(0, 4fr)',
						},
						columnGap: { base: '0', lg: '10' },
						rowGap: { base: '10', lg: '0' },
						alignItems: 'start',
					})}
				>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
						})}
					>
						<span
							aria-hidden="true"
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
							})}
						>
							04 — Edition
						</span>
						<span
							aria-hidden="true"
							className={css({
								marginBlockStart: '2',
								fontFamily: 'heading',
								fontSize: '4xl',
								fontWeight: '700',
								color: 'text.default',
								lineHeight: '1',
								letterSpacing: '-0.04em',
							})}
						>
							04
						</span>
					</div>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
							})}
						>
							Identity
						</span>
						<p
							className={css({
								margin: '0',
								marginBlockStart: '2',
								fontFamily: 'heading',
								fontSize: '2xl',
								color: 'text.default',
								fontWeight: '600',
								letterSpacing: '-0.02em',
							})}
						>
							samuido
						</p>
						<p
							className={css({
								margin: '0',
								marginBlockStart: '1',
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
							})}
						>
							my-web-2026 · v{PACKAGE_VERSION} · MIT
						</p>
					</div>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
							})}
						>
							Index
						</span>
						<ul
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '2',
								margin: '0',
								marginBlockStart: '2',
								padding: '0',
								listStyle: 'none',
								fontFamily: 'sans',
								fontSize: 'md',
							})}
						>
							<li>
								<a
									href="https://github.com/rebuildup/my-web-2026"
									rel="noopener noreferrer"
									target="_blank"
									className={css({
										color: 'text.accent',
										textDecoration: 'none',
										_hover: { textDecoration: 'underline' },
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
									})}
								>
									Source
								</a>
							</li>
							<li>
								<a
									href="https://yusuke-kim.com"
									rel="noopener noreferrer"
									target="_blank"
									className={css({
										color: 'text.accent',
										textDecoration: 'none',
										_hover: { textDecoration: 'underline' },
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
									})}
								>
									2025 edition
								</a>
							</li>
						</ul>
					</div>
				</div>
				<p
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '10',
						paddingBlockStart: '6',
						borderBlockStartWidth: '1px',
						borderBlockStartColor: 'border.subtle',
						borderBlockStartStyle: 'solid',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.6',
						color: 'text.muted',
					})}
				>
					このサイトは閲覧解析のため <code>mw_actor_id</code> という匿名の Cookie
					を使用します（個人を特定しません）。
					<span lang="en">
						{' '}
						This site uses an anonymous <code>mw_actor_id</code> cookie for visitor analytics.
					</span>
				</p>
			</Container>
		</footer>
	);
}
