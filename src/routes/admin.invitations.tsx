import { createFileRoute, redirect } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { css } from '../../styled-system/css';
import { InvitationsView } from '../admin/invitations/invitations';
import { createInvitation, listInvitations, revokeInvitation } from '../admin/invitations/load';
import { getCurrentSession } from '../admin/public';

/**
 * `/admin/invitations` — invitation management.
 *
 * Loader: admin-only. List existing invitations + render the
 * create form. Revoke is wired via the row's RevokeButton.
 */
export const Route = createFileRoute('/admin/invitations')({
	loader: async () => {
		const session = await getCurrentSession();
		if (!session) {
			throw redirect({ to: '/admin/login' });
		}
		if (session.user.role !== 'admin') {
			throw redirect({ to: '/admin' });
		}
		const invitations = await listInvitations({ data: {} });
		return { invitations };
	},
	component: InvitationsRoute,
});

function InvitationsRoute() {
	const { invitations } = Route.useLoaderData();
	return <InvitationsView invitations={invitations} createForm={<CreateInvitationForm />} />;
}

function CreateInvitationForm() {
	const create = useServerFn(createInvitation);
	const [email, setEmail] = useState('');
	const [busy, setBusy] = useState(false);
	const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	return (
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
				New invitation
			</span>
			<form
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						const result = await create({ data: { email } });
						setAcceptUrl(result.acceptUrl);
						setEmail('');
					} catch (err) {
						const reason = (err as { reason?: string }).reason;
						setError(
							reason === 'email_already_registered'
								? 'この email は既に登録されています。'
								: '作成に失敗しました。',
						);
					} finally {
						setBusy(false);
					}
				}}
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
				})}
			>
				<input
					type="email"
					name="email"
					placeholder="user@example.com"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
					className={css({
						fontFamily: 'sans',
						fontSize: 'md',
						paddingInline: '3',
						paddingBlock: '2',
						border: '1px solid {colors.border.subtle}',
						borderRadius: '4',
						background: 'bg.surface',
						color: 'text.default',
					})}
				/>
				<button
					type="submit"
					disabled={busy || email.length === 0}
					className={css({
						fontFamily: 'sans',
						fontSize: 'md',
						fontWeight: '600',
						color: 'text.inverse',
						background: 'bg.accent',
						border: 'none',
						borderRadius: '4',
						paddingBlock: '3',
						paddingInline: '6',
						cursor: 'pointer',
						_disabled: { opacity: '0.5' },
					})}
				>
					{busy ? 'Creating…' : 'Create invitation'}
				</button>
			</form>
			{error && (
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{error}
				</p>
			)}
			{acceptUrl && (
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '2',
						paddingBlock: '4',
						paddingInline: '4',
						border: '1px solid {colors.border.subtle}',
						borderRadius: '4',
						background: 'bg.surface',
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
						Accept URL (1 回のみ表示)
					</span>
					<code
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							wordBreak: 'break-all',
							color: 'text.default',
						})}
					>
						{acceptUrl}
					</code>
					<button
						type="button"
						onClick={() => navigator.clipboard.writeText(acceptUrl)}
						className={css({
							alignSelf: 'flex-start',
							fontFamily: 'sans',
							fontSize: 'xs',
							fontWeight: '600',
							color: 'text.inverse',
							background: 'bg.accent',
							border: 'none',
							borderRadius: 'full',
							paddingInline: '3',
							paddingBlock: '1',
							cursor: 'pointer',
						})}
					>
						copy
					</button>
				</div>
			)}
		</div>
	);
}
