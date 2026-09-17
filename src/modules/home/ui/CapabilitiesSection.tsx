import { Badge } from '../../../design-system/components/Badge';
import { Container } from '../../../design-system/components/Container';
import { SectionHeading } from '../../../design-system/components/SectionHeading';
import { css } from '../../../../styled-system/css';
import type { Capability } from '../model';

export interface CapabilitiesSectionProps {
	capabilities: readonly Capability[];
}

/**
 * CapabilitiesSection — second section of the home page.
 *
 * Renders one Card per capability with a status badge. Live
 * capabilities show the badge in `accent` tone; planned capabilities
 * show it in `neutral` tone so the section reads as "what's coming"
 * without any single CTA. When a capability flips to `live`, its
 * card becomes the only interactive surface in the section.
 */
export function CapabilitiesSection({ capabilities }: CapabilitiesSectionProps) {
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
					eyebrow="Capabilities"
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
						gap: '6',
						margin: '0',
						padding: '0',
						listStyle: 'none',
					})}
				>
					{capabilities.map((capability) => (
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
										alignItems: 'center',
										justifyContent: 'space-between',
										gap: '3',
									})}
								>
									<h3
										className={css({
											margin: '0',
											fontFamily: 'sans',
											fontSize: 'lg',
											fontWeight: '700',
											color: 'text.default',
										})}
									>
										{capability.labelJa}
									</h3>
									<Badge tone={capability.status === 'live' ? 'accent' : 'neutral'}>
										{capability.status === 'live' ? 'live' : 'planned'}
									</Badge>
								</header>
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
					))}
				</ul>
			</Container>
		</section>
	);
}
