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
 * Issue #31 — editorial spread (fourth pass). The section uses the
 * spread `SectionHeading` so the heading cluster (eyebrow / h2 /
 * description) sits in the narrow 4/12 left column and the card
 * grid lives in the wide 8/12 right column. The right column is
 * single-card wide per row at `base` and 2-up at `md`+ so the
 * cards stay readable in the narrower 8/12 column.
 *
 * Per-card semantics — per-element `marginBlockStart`:
 * - h3 ↔ badge: flex row, gap 4 — one title cluster.
 * - h3 ↔ ordinal: 1 (4px) — the ordinal is a decoration on the
 *   title, not a separate line.
 * - ordinal ↔ JP summary: 4 (16px) — cluster separator.
 * - JP ↔ EN summary: 1 (4px) — translation pair, one thought in
 *   two languages.
 */
export function CapabilitiesGrid({ capabilities }: CapabilitiesGridProps) {
	return (
		<section
			aria-labelledby="capabilities-heading"
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					id="capabilities-heading"
					eyebrow="01 — Capabilities"
					title="できごと / What's here"
					description="個人 Platform の機能領域。0.2.0 時点ではまだどれも未公開で、順に組み立てていく。"
					variant="spread"
				>
					<ul
						className={css({
							display: 'grid',
							gridTemplateColumns: {
								base: '1fr',
								md: 'repeat(2, minmax(0, 1fr))',
							},
							rowGap: '10',
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
											gap: '4',
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
