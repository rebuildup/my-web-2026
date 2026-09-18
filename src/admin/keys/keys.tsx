import type { ReactNode } from 'react';
import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { css } from '../../../styled-system/css';
import { deleteApiKey } from './load';
import type { AdminApiKey } from './load';

/**
 * Admin API keys UI.
 *
 * The create form lives in the route component (composition over a
 * generic UI primitive) so that the route can wire its own
 * `useServerFn` calls without leaking server-only modules here.
 * Plaintext key disclosure happens in the create form, shown
 * exactly once at creation time (the Better Auth plugin hashes before
 * persisting; we never see the plaintext again).
 *
 * Permissions shape (resource/action) is project-owned:
 *   `{ access_counter: ["read","write"], reactions: ["read","write"] }`
 * See ADR-0009 §3.
 */
export interface KeysViewProps {
	keys: readonly AdminApiKey[];
	createForm: ReactNode;
}

export function KeysView({ keys, createForm }: KeysViewProps) {
	return (
		<section
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="02 — API keys"
					title="API キー / API keys"
					description="他のレポジトリから my-web-2026 の API を呼ぶための Bearer キー。plaintext は作成時に一度だけ表示。"
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
							{keys.length === 0 ? (
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										color: 'text.muted',
									})}
								>
									まだ API キーはありません。
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
									{keys.map((k) => (
										<KeyRow key={k.id} apiKey={k} />
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

function KeyRow({ apiKey }: { apiKey: AdminApiKey }) {
	return (
		<li
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'minmax(0, 3fr) minmax(0, 4fr) auto' },
				alignItems: 'baseline',
				gap: { base: '2', md: '6' },
				paddingBlock: '4',
				borderBlockStart: '1px solid {colors.border.subtle}',
			})}
		>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				{apiKey.prefix ?? 'mk_'}
				{apiKey.start ? `…${apiKey.start}` : ''}
			</span>
			<span
				className={css({
					fontFamily: 'sans',
					fontSize: 'md',
					color: 'text.default',
				})}
			>
				{apiKey.name ?? '(unnamed)'} — {summarizePermissions(apiKey.permissions)}
			</span>
			<div
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '3',
				})}
			>
				{apiKey.enabled ? (
					<Badge tone="accent">enabled</Badge>
				) : (
					<Badge tone="neutral">disabled</Badge>
				)}
				<RevokeButton id={apiKey.id} />
			</div>
		</li>
	);
}

function summarizePermissions(perms: AdminApiKey['permissions']): string {
	const entries = Object.entries(perms);
	if (entries.length === 0) return 'no scopes';
	return entries
		.map(([resource, actions]) => `${resource}:${(actions ?? []).join('+')}`)
		.join(', ');
}

function RevokeButton({ id }: { id: string }) {
	const revoke = useServerFn(deleteApiKey);
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
