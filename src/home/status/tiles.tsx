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
 * From Issue #31 the section heading carries an editorial numbering
 * prefix (`02 — System status`), the service label renders in mono
 * for a ledger feel, and rows are separated by hairlines rather than
 * each carrying its own card border.
 */
export function StatusTiles({ services, statuses, observedAt }: StatusTilesProps) {
	return (
		<section
			aria-labelledby="status-heading"
			className={css({
				paddingBlock: '12',
				borderBlockStart: '1px solid',
				borderColor: 'border.subtle',
			})}
		>
			<Container>
				<SectionHeading
					id="status-heading"
					eyebrow="02 — System status"
					title="プラットフォームの状態 / Platform health"
					description="各 binding と外部境界の最新到達性。createServerFn で観測したスナップショット。"
				/>
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
									gap: { base: '1', md: '4' },
									padding: '4',
									borderBlockStart: index === 0 ? 'none' : '1px solid',
									borderColor: 'border.subtle',
									backgroundColor: 'bg.canvas',
								})}
							>
								<dt
									className={css({
										margin: '0',
										fontFamily: 'mono',
										fontSize: 'sm',
										fontWeight: '600',
										color: 'text.default',
										letterSpacing: '0.02em',
									})}
								>
									{service.label}
									<span
										className={css({
											marginInlineStart: '2',
											fontFamily: 'mono',
											fontSize: 'xs',
											fontWeight: '400',
											color: 'text.muted',
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
			</Container>
		</section>
	);
}
