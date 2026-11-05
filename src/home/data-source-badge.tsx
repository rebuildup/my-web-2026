import { css } from '../../styled-system/css';
import { Badge } from '../editorial/primitives/Badge';
import type { DataSourceDescriptor } from './status/data-source';

/**
 * The development data-source indicator (Issue #377).
 *
 * What it answers
 * ---------------
 * "Which data am I looking at right now?" — the one question a
 * developer working on the home page cannot answer from the rendered
 * page alone. The indicator is rendered ONLY when the runtime is not
 * the deployed production Worker, so the shipped page carries no
 * development text and no new public claim.
 *
 * The same component renders every mode. The mode changes the LABEL
 * and the write policy, never the layout — which is what makes the
 * mock screenshot and the production-readonly screenshot comparable
 * (the acceptance criterion of Issue #377).
 *
 * The descriptor comes from the runtime (`src/home/status/data-source.ts`
 * → `src/cloudflare/data-source.ts`), so the indicator cannot claim a
 * source the runtime does not have.
 */
export interface DataSourceBadgeProps {
	source: DataSourceDescriptor;
}

export function DataSourceBadge({ source }: DataSourceBadgeProps) {
	// The deployed Worker is not a development context: the indicator
	// has nothing to say there, and the shipped page stays free of it.
	if (source.source === 'production') return null;
	const readOnly = source.write_policy === 'read-only';
	return (
		<div
			data-testid="home-data-source-badge"
			data-data-source={source.source}
			data-write-policy={source.write_policy}
			role="note"
			className={css({
				display: 'flex',
				flexWrap: 'wrap',
				alignItems: 'center',
				gap: '3',
				px: '4',
				py: '3',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				bg: 'bg.subtle',
				color: 'text.muted',
				fontFamily: 'sans',
				fontSize: 'xs',
			})}
		>
			<span className={css({ fontWeight: '600', color: 'text.default' })}>
				Development data source
			</span>
			<Badge tone={readOnly ? 'accent' : 'neutral'}>{source.label}</Badge>
			<span>{source.detail}</span>
			<span className={css({ fontWeight: '600' })}>
				{readOnly ? 'Writes: refused' : 'Writes: allowed'}
			</span>
			{source.warning ? (
				<span data-testid="home-data-source-warning" className={css({ fontWeight: '600' })}>
					{source.warning}
				</span>
			) : null}
		</div>
	);
}
