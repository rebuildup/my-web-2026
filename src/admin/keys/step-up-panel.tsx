import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { STEP_UP_MAX_AGE_SECONDS, type StepUpStatus, confirmStepUp } from '../auth/step-up';

/**
 * Step-up panel for the admin API-key surface (Issue #445).
 *
 * Renders the three states the gate can be in, and never renders
 * anything the operator did not type:
 *
 *   confirmed  the session confirmed its password inside the window —
 *              the panel says how long the window lasts.
 *   required   no confirmation yet. The password form is here; the
 *              create form below is disabled until it succeeds.
 *   expired    a confirmation exists but has lapsed; same form, with
 *              copy that says so.
 *
 * The submitted password is sent once to `confirmStepUp` and dropped
 * from component state as soon as the request settles. A refused
 * password renders a fixed sentence — Better Auth's error detail is
 * not forwarded, and no account field appears here.
 *
 * The window length in the copy comes from `STEP_UP_MAX_AGE_SECONDS`,
 * the same constant the gate enforces, so the sentence cannot drift
 * away from the rule.
 */
export interface StepUpPanelProps {
	status: StepUpStatus;
	/** Called with the fresh status after a successful confirmation. */
	onConfirmed: (status: StepUpStatus) => void;
}

export function StepUpPanel({ status, onConfirmed }: StepUpPanelProps) {
	const confirm = useServerFn(confirmStepUp);
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [rejected, setRejected] = useState(false);

	const confirmed = status.state === 'confirmed';

	const onSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (password.length === 0) return;
		setBusy(true);
		setRejected(false);
		try {
			const next = await confirm({ data: { password } });
			onConfirmed(next);
		} catch {
			// `step_up_rejected` and anything else collapse to the same
			// sentence on purpose: the UI has no reason to describe which
			// part of the credential was wrong.
			setRejected(true);
		} finally {
			// Never keep the submitted password in component state.
			setPassword('');
			setBusy(false);
		}
	};

	return (
		<section
			aria-label="Step-up confirmation"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '4',
				paddingInline: '4',
				border: '1px solid {colors.border.subtle}',
				borderRadius: '4',
				background: 'bg.surface',
			})}
		>
			<div
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					alignItems: 'center',
					gap: '3',
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
					Step-up check
				</span>
				{confirmed ? (
					<Badge tone="accent">confirmed</Badge>
				) : status.state === 'expired' ? (
					<Badge tone="neutral">expired</Badge>
				) : (
					<Badge tone="neutral">required</Badge>
				)}
			</div>

			<output
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				{confirmed
					? `このセッションは確認済み。API キー発行は ${remainingMinutes(status)} 分以内。`
					: status.state === 'expired'
						? '確認の有効期限が切れました。発行前にパスワードで再確認してください。'
						: 'API キーを発行する操作は、期限内のパスワード再認証が必要です。'}
			</output>

			{!confirmed && (
				<form
					onSubmit={onSubmit}
					className={css({
						display: 'flex',
						flexWrap: 'wrap',
						alignItems: 'flex-end',
						gap: '3',
					})}
				>
					<label
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '1',
							flexGrow: '1',
							minWidth: '240px',
						})}
					>
						<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
							Admin password
						</span>
						<input
							type="password"
							name="password"
							autoComplete="current-password"
							value={password}
							required
							onChange={(event) => setPassword(event.target.value)}
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
					</label>
					<button
						type="submit"
						disabled={busy || password.length === 0}
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
						{busy ? 'Confirming…' : `Confirm for ${STEP_UP_MAX_AGE_SECONDS / 60} min`}
					</button>
				</form>
			)}

			{rejected && !confirmed && (
				<p
					role="alert"
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					パスワードを確認できませんでした。再入力してください。
				</p>
			)}
		</section>
	);
}

/**
 * Whole minutes left in the window, floored at 1 while the window is
 * still open, so a confirmation one second from lapsing never renders
 * "0 分".
 */
function remainingMinutes(status: StepUpStatus): number {
	if (status.expiresAtMs === null) return 0;
	const remaining = status.expiresAtMs - Date.now();
	return remaining <= 0 ? 0 : Math.max(1, Math.ceil(remaining / 60_000));
}
