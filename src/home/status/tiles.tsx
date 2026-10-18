import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import type { HomeLocale } from '../format';
import { createHomeFormat } from '../format';
import type { SystemService, SystemServiceHealth, SystemServiceStatus } from './health';
import { HEALTH_LABEL } from './health';

export interface StatusTilesProps {
	services: readonly SystemService[];
	statuses: readonly SystemServiceStatus[];
	observedAt: string;
	/**
	 * Opt-in locale for the observed-at instant (Issue #430). Defaults
	 * to `'en'`, which is what this section shipped before the
	 * adapter existed.
	 */
	locale?: HomeLocale;
	/**
	 * IANA time zone the snapshot is read in. Defaults to `'UTC'`:
	 * the observed-at instant is one server snapshot shared by every
	 * visitor of the response, so a per-visitor zone would make the
	 * server HTML and the hydrated HTML disagree.
	 */
	timeZone?: string;
}

const HEALTH_TONE: Record<SystemServiceHealth, 'accent' | 'neutral' | 'neutral'> = {
	ok: 'accent',
	degraded: 'neutral',
	unreachable: 'neutral',
};

function statusFor(
	id: SystemService['id'],
	statuses: readonly SystemServiceStatus[],
): SystemServiceStatus | undefined {
	return statuses.find((status) => status.id === id);
}

/**
 * StatusTiles — third section of the home page.
 *
 * Renders one row per registered service with its binding name and
 * the latest health read. The observed-at timestamp comes from the
 * server loader so visitors see the same freshness on every
 * request that hit the same SSR snapshot.
 *
 * Issue #31 — editorial spread (fourth pass). The section uses the
 * spread `SectionHeading`. Rows are separated by `gap: 10` (40px)
 * — a golden-ratio jump from the card-level `gap: 4` to mark the
 * transition from heading cluster to service rows. The `dt` is
 * sans-bold at `lg` with the binding rendering adjacent in mono
 * `sm`; the badge anchors the right edge.
 *
 * The observed-at line renders the snapshot instant through the home
 * format adapter (Issue #430): the same instant reads per locale and
 * names the time zone it was read in. The zone defaults to UTC so
 * the server HTML and the hydrated HTML stay identical.
 */
export function StatusTiles({
	services,
	statuses,
	observedAt,
	locale,
	timeZone,
}: StatusTilesProps) {
	const format = createHomeFormat({ locale, timeZone });
	return (
		<section
			aria-labelledby="status-heading"
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					id="status-heading"
					eyebrow="02 — System status"
					title="プラットフォームの状態 / Platform health"
					description="各 binding と外部境界の最新到達性。createServerFn で観測したスナップショット。"
					variant="spread"
				>
					<dl
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '10',
							margin: '0',
							padding: '0',
						})}
					>
						{services.map((service) => {
							const status = statusFor(service.id, statuses);
							const health: SystemServiceHealth = status?.health ?? 'unreachable';
							return (
								<div
									key={service.id}
									className={css({
										display: 'grid',
										// Issue #300: measured at the Container
										// width — label + binding needs 202px,
										// the longest detail 300px, the badge
										// 82px. `3fr/5fr` gave the label only
										// 181px (「External boundary」 wrapped)
										// and `4fr/5fr` starved the detail to
										// 269px (longest line wrapped). Content-
										// sized label + 1fr detail + auto badge
										// with a 12px gutter fits all three on
										// one line (608px of 613px).
										gridTemplateColumns: {
											base: '1fr',
											md: 'minmax(0, auto) minmax(0, 1fr) auto',
										},
										alignItems: 'baseline',
										gap: { base: '2', md: '3' },
									})}
								>
									<dt
										className={css({
											margin: '0',
											fontFamily: 'sans',
											fontSize: 'lg',
											fontWeight: '700',
											color: 'text.default',
											lineHeight: '1.4',
											letterSpacing: '-0.01em',
										})}
									>
										{service.label}
										<span
											className={css({
												marginInlineStart: '3',
												fontFamily: 'mono',
												fontSize: 'sm',
												fontWeight: '400',
												color: 'text.muted',
												letterSpacing: '0.02em',
											})}
										>
											{service.binding}
										</span>
									</dt>
									<dd
										className={css({
											margin: '0',
											fontFamily: 'sans',
											fontSize: 'md',
											color: 'text.muted',
											lineHeight: '1.6',
										})}
									>
										{status?.detail ?? service.description}
									</dd>
									<div
										className={css({
											display: 'flex',
											justifyContent: { base: 'flex-start', md: 'flex-end' },
										})}
									>
										<Badge tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</Badge>
									</div>
								</div>
							);
						})}
					</dl>
					<p
						className={css({
							marginBlockStart: '10',
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						observed at {format.formatInstant(observedAt)}
					</p>
				</SectionHeading>
			</Container>
		</section>
	);
}
