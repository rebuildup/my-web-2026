import { Container } from '../editorial/primitives/Container';
import { css } from '../../styled-system/css';
import { PACKAGE_VERSION } from './version';

/**
 * Footer — fourth section of the home page.
 *
 * Hosts the public transition metadata for the 2025 / 2026 editions,
 * the canonical source link, and the operational entry points.
 *
 * From Issue #31 the footer adopts an editorial 3-column layout
 * that mirrors the body sections above: the section number `04`
 * sits as a large display in the left column, the meta paragraphs
 * (identity / version / license) stack in the middle, and the
 * outbound links stack in the right column. At `base` the three
 * columns stack vertically; at `lg` they sit on a single row with
 * the same proportions the body sections use.
 */
export function Footer() {
	return (
		<footer
			className={css({
				borderBlockStart: '2px solid',
				borderColor: 'border.default',
				paddingBlock: '12',
				marginBlockStart: '12',
				backgroundColor: 'bg.canvas',
			})}
		>
			<Container>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: {
							base: '1fr',
							lg: 'minmax(0, 2fr) minmax(0, 3fr) minmax(0, 3fr)',
						},
						gap: { base: '8', lg: '12' },
						alignItems: 'start',
					})}
				>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '2',
						})}
					>
						<span
							aria-hidden="true"
							className={css({
								fontFamily: 'mono',
								fontSize: 'xs',
								color: 'text.muted',
								letterSpacing: '0.08em',
								textTransform: 'uppercase',
							})}
						>
							04 — edition
						</span>
						<span
							aria-hidden="true"
							className={css({
								fontFamily: 'sans',
								fontSize: '5xl',
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
							gap: '2',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'xs',
								color: 'text.muted',
								letterSpacing: '0.08em',
								textTransform: 'uppercase',
							})}
						>
							Identity
						</span>
						<p
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'md',
								color: 'text.default',
							})}
						>
							samuido
						</p>
						<p
							className={css({
								margin: '0',
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
							gap: '2',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'xs',
								color: 'text.muted',
								letterSpacing: '0.08em',
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
			</Container>
		</footer>
	);
}
