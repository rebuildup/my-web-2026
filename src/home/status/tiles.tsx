import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { StateMark } from '../../editorial/primitives/StateMark';
import type { HomeLocale } from '../format';
import { createHomeFormat } from '../format';
import type { SystemService, SystemServiceHealth, SystemServiceStatus } from './health';
import { HEALTH_LABEL, UNOBSERVED_DETAIL } from './health';
import { IncidentList } from './incident-list';
import type { KnownIncident } from './incidents';

export interface StatusTilesProps {
	services: readonly SystemService[];
	statuses: readonly SystemServiceStatus[];
	observedAt: string;
	/**
	 * The known-incident records to publish (Issue #502). Defaults to
	 * an empty list, which renders the explicit "no incidents
	 * recorded" state.
	 */
	incidents?: readonly KnownIncident[];
	/**
	 * Id of the section heading, so a page that renders the section
	 * twice (the verification gallery does) keeps the ids unique.
	 */
	headingId?: string;
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

const HEALTH_TONE: Record<SystemServiceHealth, 'accent' | 'neutral'> = {
	ok: 'accent',
	degraded: 'neutral',
	unreachable: 'neutral',
	unobserved: 'neutral',
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
 *
 * Issue #411 — the health badge is no longer distinguished by fill
 * alone. `ok` painted an accent-filled pill and BOTH failure states
 * painted the same neutral pill, so with hue removed the three
 * states were three identical rounded rectangles. Each badge now
 * carries a `StateMark` whose silhouette is unique per health
 * (disc / triangle / cross) next to the existing word. Shape + text
 * satisfies WCAG 2.2 SC 1.4.1 (Level A): the mark is `aria-hidden`
 * and never the accessible name, and it paints in the badge's own
 * foreground so it adds no contrast obligation (1.4.11) of its own.
 *
 * Issue #502 — "no reading" is now its own state. A service with no
 * entry in the snapshot used to fall back to `unreachable`, so a
 * measurement gap and a failed probe rendered the same word and the
 * same cross: a visitor could not tell "we did not observe it" from
 * "it is broken". The absence now renders as `unobserved` — its own
 * label, its own silhouette (a broken ring) and a detail that states
 * the absence instead of implying a fault.
 *
 * Issue #502 — the section also publishes the KNOWN INCIDENTS: the
 * committed incident records (`src/home/status/incidents.ts`) and a
 * link to a public record of each one. The list is a committed data
 * file, never a runtime fetch of a third party, and this component
 * performs NO external communication of its own.
 *
 * What is published here: the service labels, their binding names,
 * the health word, the probe detail, the observed-at instant and the
 * known-incident records. What is NOT published: any credential, any
 * third-party personal data, any guessed fact about a person, and any
 * incident record whose reference cannot be verified.
 */
export function StatusTiles({
	services,
	statuses,
	observedAt,
	incidents = [],
	headingId = 'status-heading',
	locale,
	timeZone,
}: StatusTilesProps) {
	const format = createHomeFormat({ locale, timeZone });
	return (
		<section
			aria-labelledby={headingId}
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					id={headingId}
					eyebrow="02 — System status"
					title="プラットフォームの状態 / Platform health"
					description="各 binding と外部境界の最新到達性。createServerFn で観測したスナップショット。観測できなかった状態は「未観測」として、到達障害と区別して表示します。"
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
							// Issue #502: no entry means "not observed",
							// not "unreachable". The absence of a reading
							// is its own fact and must not wear the
							// failure state.
							const health: SystemServiceHealth = status?.health ?? 'unobserved';
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
										{health === 'unobserved' ? (
											<span
												className={css({
													marginInlineStart: '2',
													fontFamily: 'mono',
													fontSize: 'sm',
													letterSpacing: '0.02em',
												})}
											>
												— {UNOBSERVED_DETAIL}
											</span>
										) : null}
									</dd>
									{/* Issue #718: the health badge is a second
									    description of the same term, so it is a
									    `<dd>` — not a bare `<div>`. A `<dl>` group
									    may only contain `<dt>` / `<dd>` (WCAG 2.2
									    SC 1.3.1); the badge keeps its own grid
									    column and its own box, so the row looks
									    exactly as it did. */}
									<dd
										className={css({
											display: 'flex',
											justifyContent: { base: 'flex-start', md: 'flex-end' },
											margin: '0',
										})}
									>
										<Badge tone={HEALTH_TONE[health]}>
											<span
												className={css({
													display: 'inline-flex',
													alignItems: 'center',
													gap: '1',
												})}
											>
												<StateMark kind={health} size="sm" />
												{HEALTH_LABEL[health]}
											</span>
										</Badge>
									</dd>
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
					<IncidentList incidents={incidents} headingId={`${headingId}-incidents`} />
				</SectionHeading>
			</Container>
		</section>
	);
}
