import { css } from '../../../styled-system/css';
import type { KnownIncident } from './incidents';
import { INCIDENT_TRACKER_URL, selectPublishableIncidents } from './incidents';

/**
 * IncidentList — the known-incident block of the status section
 * (Issue #502).
 *
 * What this renders
 * -----------------
 * The records of the incidents the platform has published, each with
 * its date, its public summary and a link to a public record of it.
 * When there is nothing to publish, it says exactly that — "no
 * incidents recorded" — and points at the public issue tracker.
 *
 * The two empty-ish states are kept apart on purpose:
 *
 *   - the published list is EMPTY  -> "no incidents recorded" (the
 *     honest starting point of Issue #502);
 *   - records exist but none of them passes the reference rule ->
 *     "withheld" (never "none": a withheld record is not the same
 *     fact as an absent one).
 *
 * What is published / what is not
 * -------------------------------
 * Published: the incident title, its date, its public summary and
 * the link. Nothing else. No operator identity, no credential, no
 * third-party personal data.
 *
 * External communication: NONE. This component performs no request.
 * The tracker link is an ordinary `<a>`; the visitor's own browser
 * resolves it, and the Worker never contacts anything.
 *
 * Dependencies: the committed incident records
 * (`src/home/status/incidents.ts`). No binding, no feed, no
 * third-party read.
 *
 * Auditable: the rendered set is exactly
 * `selectPublishableIncidents(records)` — the same rule the data
 * layer applies — so the page cannot show a record the repository
 * does not hold, and cannot hide one that it does.
 */
export interface IncidentListProps {
	/** The records the caller holds. Invalid records are withheld. */
	incidents: readonly KnownIncident[];
	/** Id of the block heading, so the section can reference it. */
	headingId?: string;
}

const headingClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '700',
	color: 'text.default',
	letterSpacing: '-0.01em',
});

const bodyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.muted',
	lineHeight: '1.6',
});

const listClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
	margin: '0',
	marginBlockStart: '4',
	padding: '0',
	listStyle: 'none',
});

const itemClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	paddingBlockStart: '3',
	borderTop: '1px solid {colors.border.subtle}',
});

const itemTitleClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	color: 'text.default',
	lineHeight: '1.4',
});

const itemMetaClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.muted',
	letterSpacing: '0.04em',
});

const linkClassName = css({
	color: 'text.accent',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	textDecoration: 'none',
	_hover: { textDecoration: 'underline' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

export function IncidentList({ incidents, headingId = 'status-incidents' }: IncidentListProps) {
	const publishable = selectPublishableIncidents(incidents);
	const withheld = incidents.length > 0 && publishable.length === 0;
	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				marginBlockStart: '8',
				paddingBlockStart: '6',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<h3 id={headingId} className={headingClassName}>
				既知の障害 / Known incidents
			</h3>
			{incidents.length === 0 ? (
				<>
					<p className={bodyClassName}>
						記録された障害はありません。公開されている記録はここへ掲載されます。
					</p>
				</>
			) : null}
			{withheld ? (
				<p className={bodyClassName}>
					障害記録は公開できません。参照先を確認できない記録は掲載されません。
				</p>
			) : null}
			{publishable.length > 0 ? (
				<ul className={listClassName}>
					{publishable.map((incident) => (
						<li key={incident.id} className={itemClassName}>
							<p className={itemTitleClassName}>{incident.title}</p>
							<p className={itemMetaClassName}>{incident.occurredAt}</p>
							<p className={bodyClassName}>{incident.summary}</p>
							<p className={bodyClassName}>
								<a
									href={incident.reference}
									rel="noopener noreferrer"
									target="_blank"
									className={linkClassName}
								>
									記録を開く / Open the record
								</a>
							</p>
						</li>
					))}
				</ul>
			) : null}
			{incidents.length === 0 ? (
				<p className={bodyClassName}>
					<a
						href={INCIDENT_TRACKER_URL}
						rel="noopener noreferrer"
						target="_blank"
						className={linkClassName}
					>
						公開 tracker を見る / Open the public tracker
					</a>
				</p>
			) : null}
		</div>
	);
}
