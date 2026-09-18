import { Container } from '../editorial/primitives/Container';
import { css } from '../../styled-system/css';
import { PACKAGE_VERSION } from './version';

/**
 * Footer — fourth section of the home page.
 *
 * Stays in a single row at desktop and stacks at mobile. Contains
 * public transition metadata for the 2025 / 2026 editions plus the
 * canonical source link. Operational API endpoints remain available
 * but are not promoted as visitor navigation.
 *
 * From Issue #31 the leading edge carries the editorial numbering
 * `04` (mono / xs / muted) and the meta paragraph drops to xs to
 * keep the footer weight subordinate to the body sections.
 */
export function Footer() {
	return (
		<footer
			className={css({
				borderBlockStart: '1px solid',
				borderColor: 'border.subtle',
				paddingBlock: '8',
				marginBlockStart: '12',
				backgroundColor: 'bg.canvas',
			})}
		>
			<Container>
				<div
					className={css({
						display: 'flex',
						flexDirection: { base: 'column', md: 'row' },
						alignItems: { base: 'flex-start', md: 'center' },
						justifyContent: 'space-between',
						gap: '4',
					})}
				>
					<div
						className={css({
							display: 'flex',
							alignItems: { base: 'flex-start', md: 'baseline' },
							flexWrap: 'wrap',
							gap: { base: '2', md: '3' },
						})}
					>
						<span
							aria-hidden="true"
							className={css({
								fontFamily: 'mono',
								fontSize: 'xs',
								color: 'text.muted',
								letterSpacing: '0.04em',
							})}
						>
							04
						</span>
						<p
							className={css({
								margin: '0',
								fontFamily: 'mono',
								fontSize: 'xs',
								color: 'text.muted',
							})}
						>
							samuido · my-web-2026 · v{PACKAGE_VERSION} · MIT
						</p>
					</div>
					<ul
						className={css({
							display: 'flex',
							flexWrap: 'wrap',
							gap: '4',
							margin: '0',
							padding: '0',
							listStyle: 'none',
							fontFamily: 'sans',
							fontSize: 'sm',
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
			</Container>
		</footer>
	);
}
