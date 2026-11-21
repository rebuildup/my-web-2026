import { useServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	bodySansMdPlain,
	buttonGhost,
	eyebrowMonoSm,
	listStackGap3,
	noteMonoSm,
	noteSansMdPlain,
	rowGap3,
	spaceCompact,
	spaceSection,
	vStackGap4,
	vStackGap10,
} from '../../editorial/primitives/shared-styles';
import { revokeInvitation } from './load';
import type { Invitation } from './load';

/**
 * Admin invitations UI.
 *
 * Renders the list of outstanding and consumed invitations plus the
 * create form. The create form lives in the route component
 * (composition over a generic UI primitive) so that the route can
 * wire its own `useServerFn` calls.
 *
 * The accept URL of a freshly-created invitation is shown exactly
 * once, at creation time, in the create form. The plaintext token
 * never reaches the database, so this UI is the only place the URL
 * exists (see ADR-0009 §4).
 */
export interface InvitationsViewProps {
	invitations: readonly Invitation[];
	createForm: ReactNode;
}

export function InvitationsView({ invitations, createForm }: InvitationsViewProps) {
	return (
		<section
			className={css({
				paddingBlock: spaceSection,
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="01 — Invitations"
					title="招待 / Invitations"
					description="email を招待して 7 日以内に accept URL を開いてもらう。plaintext token は作成時に一度だけ表示される。"
					variant="spread"
				>
					<div className={css(vStackGap10)}>
						{createForm}

						<div className={css(vStackGap4)}>
							<span className={css(eyebrowMonoSm)}>Issued</span>
							{invitations.length === 0 ? (
								<p className={css(noteSansMdPlain)}>まだ招待はありません。</p>
							) : (
								<ul className={css(listStackGap3)}>
									{invitations.map((inv) => (
										<InvitationRow key={inv.id} invitation={inv} />
									))}
								</ul>
							)}
						</div>
					</div>
				</SectionHeading>
			</Container>
		</section>
	);
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
	return (
		<li
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'minmax(0, 4fr) minmax(0, 3fr) auto' },
				alignItems: 'baseline',
				gap: spaceCompact,
				paddingBlock: '4',
				borderBlockStart: '1px solid {colors.border.subtle}',
			})}
		>
			<span className={css(bodySansMdPlain)}>{invitation.email}</span>
			<span className={css(noteMonoSm)}>expires {formatTimestamp(invitation.expiresAt)}</span>
			<div className={css(rowGap3)}>
				{invitation.consumed ? (
					<Badge tone="neutral">consumed</Badge>
				) : (
					<>
						<Badge tone="accent">active</Badge>
						<RevokeButton id={invitation.id} />
					</>
				)}
			</div>
		</li>
	);
}

function RevokeButton({ id }: { id: string }) {
	const revoke = useServerFn(revokeInvitation);
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			disabled={busy}
			onClick={async () => {
				setBusy(true);
				try {
					await revoke({ data: { id } });
				} finally {
					setBusy(false);
				}
			}}
			className={css(buttonGhost)}
		>
			{busy ? '…' : 'revoke'}
		</button>
	);
}

function formatTimestamp(ms: number): string {
	return new Date(ms)
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d+Z$/, ' UTC');
}
