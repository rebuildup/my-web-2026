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
 * Renders one block per capability with a status badge. Live
 * capabilities show the badge in `accent` tone; planned capabilities
 * show it in `neutral` tone so the section reads as "what's coming"
 * without any single CTA. When a capability flips to `live`, its
 * block becomes the only interactive surface in the section.
 *
 * Issue #31 — proximity revision. The card has no `gap` on the
 * parent; each child carries its own `marginBlockStart` to encode
 * the semantic relationship:
 *
 * - h3 + badge (header row): flex baseline, no margin — one
 *   title cluster.
 * - h3 ↔ ordinal caption: 1 (4px) — the ordinal is a decoration
 *   on the title, not a separate line.
 * - ordinal ↔ JP summary: 4 (16px) — cluster separator. The
 *   ordinal ends and the body block begins.
 * - JP summary ↔ EN summary: 1 (4px) — translation pair, one
 *   thought in two languages.
 *
 * Between cards the grid uses `rowGap: 8` (32px) so the eye reads
 * them as discrete items rather than continuous prose.
 *
 * The block has no border, no background fill, and no padding box —
 * semantic closeness alone groups the capability label, status,
 * ordinal decoration, and summary paragraphs.
 */
export function CapabilitiesGrid({ capabilities }: CapabilitiesGridProps) {
	return (
		<section
			aria-labelledby="capabilities-heading"
			className={css({
				paddingBlock: { base: '12', lg: '16' },
			})}
		>
			<Container>
				<SectionHeading
					id="capabilities-heading"
					eyebrow="01 — Capabilities"
					title="できごと / What's here"
					description="個人 Platform の機能領域。0.2.0 時点ではまだどれも未公開で、順に組み立てていく。"
				>
					<ul
						className={css({
							display: 'grid',
							gridTemplateColumns: {
								base: '1fr',
								md: 'repeat(2, minmax(0, 1fr))',
							},
							rowGap: '8',
							columnGap: { base: '0', md: '6' },
							margin: '0',
							padding: '0',
							listStyle: 'none',
						})}
					>
						{capabilities.map((capability, index) => {
							const ordinal = String(index + 1).padStart(2, '0');
							return (
								<li
									key={capability.id}
									className={css({
										display: 'flex',
										flexDirection: 'column',
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
												letterSpacing: '-0.01em',
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
											marginBlockStart: '1',
											fontFamily: 'mono',
											fontSize: 'sm',
											color: 'text.muted',
											letterSpacing: '0.04em',
										})}
									>
										{ordinal} · {capability.label}
									</span>
									<p
										className={css({
											margin: '0',
											marginBlockStart: '4',
											fontFamily: 'sans',
											fontSize: 'md',
											color: 'text.muted',
											lineHeight: '1.6',
										})}
									>
										{capability.summaryJa}
									</p>
									<p
										className={css({
											margin: '0',
											marginBlockStart: '1',
											fontFamily: 'sans',
											fontSize: 'sm',
											color: 'text.muted',
											lineHeight: '1.6',
										})}
									>
										{capability.summary}
									</p>
								</li>
							);
						})}
					</ul>
				</SectionHeading>
			</Container>
		</section>
	);
}
