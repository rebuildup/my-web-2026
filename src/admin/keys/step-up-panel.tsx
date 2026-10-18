import { useServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
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
 * Two failure sentences, not one: a refusal the server actually
 * decided on (`step_up_rejected` — the password did not match) reads
 * differently from a request that never reached a verdict (expired
 * session, dropped connection). `step-up.ts` is careful to keep those
 * apart on the server; collapsing them here would undo that.
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
	const [undetermined, setUndetermined] = useState(false);
	// `null` until the client has a clock. See `remainingMinutes`.
	const [nowMs, setNowMs] = useState<number | null>(null);

	const confirmed = status.state === 'confirmed';

	// The countdown runs off a client-only clock. `null` during SSR and
	// during the first client render, so the SSR markup and the hydrated
	// markup are the same sentence — see `remainingMinutes`.
	useEffect(() => {
		if (status.state !== 'confirmed') {
			setNowMs(null);
			return;
		}
		const tick = () => setNowMs(Date.now());
		tick();
		const timer = setInterval(tick, STEP_UP_TICK_MS);
		return () => clearInterval(timer);
	}, [status.state]);

	const onSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (password.length === 0) return;
		setBusy(true);
		setRejected(false);
		setUndetermined(false);
		try {
			const outcome = await confirm({ data: { password } });
			if (outcome.ok) {
				onConfirmed(outcome.status);
			} else {
				// A verdict about the password. Which part was wrong is
				// never described.
				setRejected(true);
			}
		} catch {
			// No verdict at all — the request failed, or the session it
			// needed is gone. Saying "wrong password" here would be a
			// claim the server never made.
			setUndetermined(true);
		} finally {
			// Never keep the submitted password in component state.
			setPassword('');
			setBusy(false);
		}
	};

	// Before the client clock exists (and therefore during SSR) the
	// sentence quotes the constant instead of a live countdown — see
	// `remainingMinutes`.
	const left = remainingMinutes(status, nowMs);
	const summary = confirmed
		? left === null
			? `このセッションは確認済み。API キー発行は ${STEP_UP_MAX_AGE_SECONDS / 60} 分以内。`
			: `このセッションは確認済み。API キー発行は ${left} 分以内。`
		: status.state === 'expired'
			? '確認の有効期限が切れました。発行前にパスワードで再確認してください。'
			: 'API キーを発行する操作は、期限内のパスワード再認証が必要です。';

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
				{summary}
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

			{(rejected || undetermined) && !confirmed && (
				<p
					role="alert"
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{undetermined
						? '確認を完了できませんでした。セッションの有効性を確認して再試行してください。'
						: 'パスワードを確認できませんでした。再入力してください。'}
				</p>
			)}
		</section>
	);
}

/**
 * How often the countdown re-reads the clock while the window is open.
 * The window is five minutes, so half of that is already too coarse to
 * be noticeable; it only has to be short enough that the number in the
 * copy never claims more time than is left.
 */
const STEP_UP_TICK_MS = 30_000;

/**
 * Whole minutes left in the window, or `null` while there is no
 * client clock yet. Floored at 1 while the window is still open, so a
 * confirmation one second from lapsing never renders "0 分".
 *
 * The clock is passed in rather than read here because this component
 * renders on the server too. Reading `Date.now()` during render makes
 * the SSR pass and the hydration pass disagree near the boundary — and
 * when the window lapses between them the sentence changes wholesale,
 * which React reports as a hydration mismatch. The caller supplies
 * `null` until `useEffect` has run, and the copy quotes the constant
 * instead of a live countdown in that render.
 */
function remainingMinutes(status: StepUpStatus, nowMs: number | null): number | null {
	if (nowMs === null || status.expiresAtMs === null) return null;
	const remaining = status.expiresAtMs - nowMs;
	return remaining <= 0 ? 0 : Math.max(1, Math.ceil(remaining / 60_000));
}
