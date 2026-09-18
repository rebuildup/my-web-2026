import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { css } from '../../../styled-system/css';
import type { SystemService, SystemServiceHealth, SystemServiceStatus } from './health';
import { HEALTH_LABEL } from './health';

export interface StatusTilesProps {
	services: readonly SystemService[];
	statuses: readonly SystemServiceStatus[];
	observedAt: string;
}

const HEALTH_TONE: Record<SystemServiceHealth, 'accent' | 'neutral' | 'neutral'> = {
	ok: 'accent',
	degraded: 'neutral',
	unreachable: 'neutral',
};

function formatObservedAt(iso: string): string {
	// SSR-safe formatter. We render in the visitor's local locale on
	// the client; on the server we render UTC. Either way the value
	// is the same instant — only the displayed time changes.
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return iso;
	}
	return date
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d+Z$/, ' UTC');
}

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
 * From Issue #31 the section adopts the editorial-spread layout:
 * the section heading occupies a sticky left column at `lg` and
 * wider, and the rows sit in the right column with a sans display
 * service label at `xl` so the names read at the same weight as the
 * capability cards. Rows are still separated by hairlines; the
 * first row carries no top border so the section keeps its spacing.
 */
export function StatusTiles({ services, statuses, observedAt }: StatusTilesProps) {
	return (
		<section
			aria-labelledby="status-heading"
			className={css({
				paddingBlock: '12',
				borderBlockStart: '2px solid',
				borderColor: 'border.default',
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
							display: 'grid',
							gridTemplateColumns: {
								base: '1fr',
								md: '1fr',
							},
							rowGap: '0',
							margin: '0',
							padding: '0',
						})}
					>
						{services.map((service, index) => {
							const status = statusFor(service.id, statuses);
							const health: SystemServiceHealth = status?.health ?? 'unreachable';
							return (
								<div
									key={service.id}
									className={css({
										display: 'grid',
										gridTemplateColumns: {
											base: '1fr',
											md: 'minmax(0, 1fr) minmax(0, 2fr) auto',
										},
										alignItems: 'center',
										gap: { base: '2', md: '6' },
										padding: '6',
										borderBlockStart: index === 0 ? 'none' : '1px solid',
										borderColor: 'border.subtle',
										backgroundColor: 'bg.canvas',
									})}
								>
									<dt
										className={css({
											margin: '0',
											fontFamily: 'sans',
											fontSize: 'xl',
											fontWeight: '700',
											color: 'text.default',
											letterSpacing: '-0.01em',
										})}
									>
										{service.label}
										<span
											className={css({
												marginInlineStart: '3',
												fontFamily: 'mono',
												fontSize: 'xs',
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
											fontSize: 'sm',
											color: 'text.muted',
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
							marginBlockStart: '6',
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'xs',
							color: 'text.muted',
						})}
					>
						observed at {formatObservedAt(observedAt)}
					</p>
				</SectionHeading>
			</Container>
		</section>
	);
}
