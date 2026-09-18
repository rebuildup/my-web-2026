import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { css } from '../../../styled-system/css';
import type { Capability } from './capability';

export interface CapabilitiesGridProps {
	capabilities: readonly Capability[];
}

/**
 * CapabilitiesGrid — second section of the home page.
 *
 * Renders one article per capability with a status badge. Live
 * capabilities show the badge in `accent` tone; planned capabilities
 * show it in `neutral` tone so the section reads as "what's coming"
 * without any single CTA. When a capability flips to `live`, its
 * card becomes the only interactive surface in the section.
 *
 * From Issue #31 the section heading carries an editorial numbering
 * prefix (`01 — Capabilities`) and each card surfaces a small mono
 * numeric decoration in its top-left corner. The card grid gap widens
 * at `md` for editorial air and the card titles move from `lg` to
 * `xl` so they share size parity with the section `<h2>`.
 */
export function CapabilitiesGrid({ capabilities }: CapabilitiesGridProps) {
	return (
		<section
			aria-labelledby="capabilities-heading"
			className={css({
				paddingBlock: '12',
				borderBlockStart: '1px solid',
				borderColor: 'border.subtle',
			})}
		>
			<Container>
				<SectionHeading
					id="capabilities-heading"
					eyebrow="01 — Capabilities"
					title="できごと / What's here"
					description="個人 Platform の機能領域。0.2.0 時点ではまだどれも未公開で、順に組み立てていく。"
				/>
				<ul
					className={css({
						display: 'grid',
						gridTemplateColumns: {
							base: '1fr',
							md: 'repeat(3, minmax(0, 1fr))',
						},
						gap: { base: '6', md: '8' },
						margin: '0',
						padding: '0',
						listStyle: 'none',
					})}
				>
					{capabilities.map((capability, index) => {
						const ordinal = String(index + 1).padStart(2, '0');
						return (
							<li key={capability.id}>
								<article
									className={css({
										display: 'flex',
										flexDirection: 'column',
										gap: '3',
										padding: '6',
										borderRadius: 'lg',
										border: '1px solid',
										borderColor: 'border.subtle',
										backgroundColor: 'bg.surface',
										height: '100%',
										transition: 'border-color 120ms ease',
										_hover: { borderColor: 'border.strong' },
									})}
								>
									<header
										className={css({
											display: 'flex',
											alignItems: 'baseline',
											justifyContent: 'space-between',
											gap: '3',
										})}
									>
										<h3
											className={css({
												margin: '0',
												fontFamily: 'sans',
												fontSize: 'xl',
												fontWeight: '700',
												color: 'text.default',
												lineHeight: '1.2',
											})}
										>
											{capability.labelJa}
										</h3>
										<Badge tone={capability.status === 'live' ? 'accent' : 'neutral'}>
											{capability.status === 'live' ? 'live' : 'planned'}
										</Badge>
									</header>
									<span
										aria-hidden="true"
										className={css({
											fontFamily: 'mono',
											fontSize: 'xs',
											color: 'text.muted',
											letterSpacing: '0.04em',
										})}
									>
										{ordinal} · {capability.label}
									</span>
									<p
										className={css({
											margin: '0',
											fontFamily: 'sans',
											fontSize: 'sm',
											color: 'text.muted',
										})}
									>
										{capability.summaryJa}
									</p>
									<p
										className={css({
											margin: '0',
											fontFamily: 'sans',
											fontSize: 'sm',
											color: 'text.muted',
										})}
									>
										{capability.summary}
									</p>
								</article>
							</li>
						);
					})}
				</ul>
			</Container>
		</section>
	);
}
