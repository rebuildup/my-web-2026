import type { ReactNode } from 'react';
import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { css } from '../../../styled-system/css';
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
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="01 — Invitations"
					title="招待 / Invitations"
					description="email を招待して 7 日以内に accept URL を開いてもらう。plaintext token は作成時に一度だけ表示される。"
					variant="spread"
				>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '10',
						})}
					>
						{createForm}

						<div
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '4',
							})}
						>
							<span
								className={css({
									fontFamily: 'mono',
									fontSize: 'sm',
									color: 'text.muted',
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
								})}
							>
								Issued
							</span>
							{invitations.length === 0 ? (
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										color: 'text.muted',
									})}
								>
									まだ招待はありません。
								</p>
							) : (
								<ul
									className={css({
										margin: '0',
										padding: '0',
										listStyle: 'none',
										display: 'flex',
										flexDirection: 'column',
										gap: '3',
									})}
								>
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
				gap: { base: '2', md: '6' },
				paddingBlock: '4',
				borderBlockStart: '1px solid {colors.border.subtle}',
			})}
		>
			<span
				className={css({
					fontFamily: 'sans',
					fontSize: 'md',
					color: 'text.default',
				})}
			>
				{invitation.email}
			</span>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				expires {formatTimestamp(invitation.expiresAt)}
			</span>
			<div
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '3',
				})}
			>
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
			className={css({
				fontFamily: 'sans',
				fontSize: 'xs',
				fontWeight: '600',
				color: 'text.muted',
				background: 'transparent',
				border: '1px solid {colors.border.subtle}',
				borderRadius: 'full',
				paddingInline: '3',
				paddingBlock: '1',
				cursor: 'pointer',
				_hover: { color: 'text.default' },
				_disabled: { opacity: '0.5' },
			})}
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
